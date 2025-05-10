import { logger } from '../utils/logger.js';
import { env } from '../env.js';

// Priority levels for different types of requests
export enum RequestPriority {
  USER_INITIATED_CRITICAL = -20, // User directly requested something critical (pause everything else)
  CRITICAL_REQUEST = -10,        // Critical requests that must go through even during restricted mode
  USER_REQUEST = 0,              // User-initiated requests (highest normal priority)
  SYSTEM_REQUEST = 10            // Background/system tasks (lower priority)
}

// Request item structure
interface QueueItem<T> {
  requestFn: () => Promise<T>;
  priority: RequestPriority;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
  timestamp: number;
  description: string;
  isCritical?: boolean;
}

/**
 * Centralized queue for all Blockchair API requests
 * - Manages rate limiting across all API calls
 * - Prioritizes user requests over background tasks
 * - Provides status and monitoring capabilities
 */
class BlockchairRequestQueue {
  private queue: Array<QueueItem<any>> = [];
  private processing = false;
  private lastRequestTime = 0;
  private totalProcessed = 0;
  private totalErrors = 0;
  private paused = false;
  private exclusiveMode = false;
  private waitingForExclusiveRequest = false;
  private exclusiveRequestId: string | null = null;
  // Add backoff tracking
  private consecutiveErrors = 0;
  private baseBackoffTime = 1000; // 1 second base
  private currentBackoffTime = 1000;
  private maxBackoffTime = 60000; // Max 1 minute
  // Global processing pause for critical user operations
  private globalUserPause = false;
  private globalPauseReason = '';
  private schedulerPaused = false;

  constructor() {
    logger.info('Blockchair request queue initialized');
  }

  /**
   * Add a request to the queue with priority
   * @param requestFn The function that makes the actual API call
   * @param isUserRequest Whether this is a user-initiated request that should get priority
   * @param description Description of the request for logging
   * @returns Promise that resolves with the API response
   */
  async addRequest<T>(
    requestFn: () => Promise<T>, 
    isUserRequest: boolean = false,
    description: string = 'API Request'
  ): Promise<T> {
    const priority = isUserRequest ? RequestPriority.USER_REQUEST : RequestPriority.SYSTEM_REQUEST;
    logger.debug(`Adding request to queue: ${description} (priority: ${priority === RequestPriority.USER_REQUEST ? 'USER' : 'SYSTEM'})`);
    
    return new Promise<T>((resolve, reject) => {
      // If we're in exclusive mode, only allow critical requests
      if (this.exclusiveMode) {
        logger.debug(`Rejecting request ${description} due to exclusive mode`);
        reject(new Error('API request rejected: system is in exclusive mode'));
        return;
      }
      
      // Add request to queue
      this.queue.push({
        requestFn,
        priority,
        resolve,
        reject,
        timestamp: Date.now(),
        description,
        isCritical: false  // Regular requests are not critical
      });
      
      // Sort queue by priority (lower number = higher priority)
      this.sortQueue();
      
      // Start processing if not already running
      if (!this.processing && !this.paused) {
        this.processQueue();
      }
    });
  }
  
  /**
   * Add a critical request that must be processed even during exclusive mode
   * @param requestFn The function that makes the actual API call
   * @param description Description of the request for logging
   * @param exclusiveId Optional ID to track this exclusive request
   * @returns Promise that resolves with the API response
   */
  async addCriticalRequest<T>(
    requestFn: () => Promise<T>,
    description: string,
    exclusiveId?: string
  ): Promise<T> {
    logger.info(`Adding CRITICAL request to queue: ${description}`);
    
    // If provided an exclusive ID, set it
    if (exclusiveId) {
      this.exclusiveRequestId = exclusiveId;
    }
    
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        requestFn,
        priority: RequestPriority.CRITICAL_REQUEST,
        resolve,
        reject,
        timestamp: Date.now(),
        description,
        isCritical: true
      });
      
      this.sortQueue();
      
      // Start processing if not already running
      if (!this.processing && !this.paused) {
        this.processQueue();
      }
    });
  }
  
  /**
   * Enter exclusive mode - only critical requests will be processed
   * existing requests in the queue will be canceled
   * @param preserveUserRequests Whether to keep user requests in the queue
   */
  enterExclusiveMode(preserveUserRequests: boolean = false): void {
    this.exclusiveMode = true;
    this.waitingForExclusiveRequest = true;
    logger.info(`Entering exclusive API request mode${preserveUserRequests ? ' (preserving user requests)' : ''}`);
    
    // Clear all non-critical and optionally non-user requests
    const removedCount = this.queue.reduce((count, item) => {
      if (item.isCritical) {
        return count; // Keep critical requests
      }
      
      if (preserveUserRequests && item.priority === RequestPriority.USER_REQUEST) {
        return count; // Keep user requests if preserveUserRequests is true
      }
      
      // Reject the request
      item.reject(new Error('Request canceled: system entered exclusive mode'));
      return count + 1;
    }, 0);
    
    // Remove the rejected items from the queue
    this.queue = this.queue.filter(item => 
      item.isCritical || (preserveUserRequests && item.priority === RequestPriority.USER_REQUEST)
    );
    
    logger.info(`Removed ${removedCount} non-critical requests from queue`);
  }
  
  /**
   * Exit exclusive mode - return to normal operation
   */
  exitExclusiveMode(): void {
    this.exclusiveMode = false;
    this.waitingForExclusiveRequest = false;
    this.exclusiveRequestId = null;
    logger.info('Exiting exclusive API request mode');
    
    // Resume processing if needed
    if (this.queue.length > 0 && !this.processing && !this.paused) {
      this.processQueue();
    }
  }
  
  /**
   * Sort the queue by priority and then by timestamp
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      // First by priority (lower number = higher priority)
      // Compare as numbers to ensure proper ordering of enum values
      const priorityA = Number(a.priority);
      const priorityB = Number(b.priority);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      // Then by timestamp (older requests first)
      return a.timestamp - b.timestamp;
    });
  }
  
  /**
   * Add a user-initiated critical request that pauses the entire system
   * This is for direct user interactions that should take precedence over everything
   * @param requestFn The function that makes the actual API call
   * @param description Description of the request for logging
   * @returns Promise that resolves with the API response
   */
  async addUserCriticalRequest<T>(
    requestFn: () => Promise<T>,
    description: string
  ): Promise<T> {
    // Pause the entire system for this request
    this.setGlobalUserPause(true, description);
    logger.info(`Pausing ALL activity for USER CRITICAL request: ${description}`);
    
    try {
      // Skip the queue entirely and process immediately
      // We don't add to queue, we just execute right away
      this.lastRequestTime = Date.now();
      const result = await requestFn();
      
      // Reset consecutive errors
      this.consecutiveErrors = 0;
      this.currentBackoffTime = this.baseBackoffTime;
      
      // Resume system activity
      this.setGlobalUserPause(false);
      
      return result;
    } catch (error: any) {
      // Check if this is a rate limit error (430)
      if (error.message && error.message.includes('430')) {
        // Increase consecutive errors and apply exponential backoff
        this.consecutiveErrors++;
        this.currentBackoffTime = Math.min(
          this.baseBackoffTime * Math.pow(2, this.consecutiveErrors),
          this.maxBackoffTime
        );
        logger.warn(`Rate limit error detected (430) on USER CRITICAL request. Increasing backoff to ${this.currentBackoffTime}ms`);
      }
      
      // Resume system activity even on error
      this.setGlobalUserPause(false);
      
      logger.error(`Error in user critical request: ${description}`, error);
      throw error;
    }
  }
  
  /**
   * Pause or resume all activity due to a critical user operation
   * @param pause Whether to pause or resume
   * @param reason Reason for pausing (for logging)
   */
  private setGlobalUserPause(pause: boolean, reason: string = ''): void {
    this.globalUserPause = pause;
    if (pause) {
      this.globalPauseReason = reason;
      logger.info(`GLOBAL PAUSE activated for: ${reason}`);
    } else {
      logger.info(`GLOBAL PAUSE deactivated (was: ${this.globalPauseReason})`);
      this.globalPauseReason = '';
      
      // Resume queue processing if needed
      if (this.queue.length > 0 && !this.processing && !this.paused) {
        this.processQueue();
      }
    }
  }
  
  /**
   * Check if the entire system is paused for a critical user operation
   */
  isGloballyPaused(): boolean {
    return this.globalUserPause;
  }
  
  /**
   * Pause scheduler specifically (used for critical operations)
   */
  pauseScheduler(): void {
    this.schedulerPaused = true;
    logger.info('Scheduler paused');
  }
  
  /**
   * Resume scheduler operations
   */
  resumeScheduler(): void {
    this.schedulerPaused = false;
    logger.info('Scheduler resumed');
  }
  
  /**
   * Check if scheduler is paused
   */
  isSchedulerPaused(): boolean {
    return this.schedulerPaused;
  }
  
  /**
   * Process the next request in the queue
   */
  private async processQueue(): Promise<void> {
    // Don't process if there's a global user pause
    if (this.globalUserPause) {
      logger.debug(`Queue processing blocked due to GLOBAL PAUSE (${this.globalPauseReason})`);
      this.processing = false;
      return;
    }
    
    if (this.queue.length === 0 || this.paused) {
      this.processing = false;
      return;
    }
    
    this.processing = true;
    
    // Respect rate limit with potential backoff
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const waitTime = Math.max(this.currentBackoffTime, env.API_THROTTLE_MS - timeSinceLastRequest);
    
    if (waitTime > 0) {
      logger.debug(`Throttling API call, waiting ${waitTime}ms (backoff: ${this.currentBackoffTime}ms)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Take the next request (highest priority first)
    const item = this.queue.shift();
    
    if (item) {
      try {
        let priorityType = 'SYSTEM';
        if (item.priority === RequestPriority.USER_REQUEST) priorityType = 'USER';
        if (item.priority === RequestPriority.CRITICAL_REQUEST) priorityType = 'CRITICAL';
        
        logger.debug(`Processing ${priorityType} request: ${item.description} (waited ${(Date.now() - item.timestamp)/1000}s)`);
        this.lastRequestTime = Date.now();
        
        // Execute the request
        const result = await item.requestFn();
        
        // Request succeeded, reset backoff
        this.consecutiveErrors = 0;
        this.currentBackoffTime = this.baseBackoffTime;
        
        // Resolve the promise
        item.resolve(result);
        this.totalProcessed++;
        
        // If this was the exclusive request we were waiting for, exit exclusive mode
        if (this.waitingForExclusiveRequest && item.isCritical && 
            this.exclusiveRequestId && item.description.includes(this.exclusiveRequestId)) {
          this.waitingForExclusiveRequest = false;
          // We'll keep exclusive mode on until explicitly turned off
        }
        
        // Process next request after a short delay to update lastRequestTime
        setTimeout(() => this.processQueue(), 10);
      } catch (error: any) {
        logger.error(`Error processing queued request: ${item.description}`, error);
        item.reject(error);
        this.totalErrors++;
        
        // Check if this is a rate limit error (430)
        if (error.message && error.message.includes('430')) {
          // Increase consecutive errors and apply exponential backoff
          this.consecutiveErrors++;
          this.currentBackoffTime = Math.min(
            this.baseBackoffTime * Math.pow(2, this.consecutiveErrors),
            this.maxBackoffTime
          );
          logger.warn(`Rate limit error detected (430). Increasing backoff to ${this.currentBackoffTime}ms. Consecutive errors: ${this.consecutiveErrors}`);
        }
        
        // If this was the exclusive request we were waiting for, exit exclusive mode
        // even on error so the system doesn't get stuck
        if (this.waitingForExclusiveRequest && item.isCritical && 
            this.exclusiveRequestId && item.description.includes(this.exclusiveRequestId)) {
          this.waitingForExclusiveRequest = false;
          // We'll keep exclusive mode on until explicitly turned off
        }
        
        // Continue processing the queue even if this request failed
        setTimeout(() => this.processQueue(), 10);
      }
    } else {
      this.processing = false;
    }
  }
  
  /**
   * Pause the queue processing (useful during server shutdown)
   */
  pause(): void {
    this.paused = true;
    logger.info('Blockchair request queue paused');
  }
  
  /**
   * Resume queue processing
   */
  resume(): void {
    this.paused = false;
    logger.info('Blockchair request queue resumed');
    
    if (this.queue.length > 0 && !this.processing) {
      this.processQueue();
    }
  }
  
  /**
   * Get queue status for monitoring
   */
  getStatus(): any {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      paused: this.paused,
      exclusiveMode: this.exclusiveMode,
      waitingForExclusiveRequest: this.waitingForExclusiveRequest,
      globalUserPause: this.globalUserPause,
      globalUserPauseReason: this.globalPauseReason,
      schedulerPaused: this.schedulerPaused,
      lastRequestTime: this.lastRequestTime,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors,
      criticalRequestCount: this.queue.filter(item => item.priority === RequestPriority.CRITICAL_REQUEST).length,
      userRequestCount: this.queue.filter(item => item.priority === RequestPriority.USER_REQUEST).length,
      systemRequestCount: this.queue.filter(item => item.priority === RequestPriority.SYSTEM_REQUEST).length,
      backoffStatus: {
        consecutiveErrors: this.consecutiveErrors,
        currentBackoffTime: this.currentBackoffTime,
      },
      oldestRequest: this.queue.length > 0 ? 
        Math.round((Date.now() - Math.min(...this.queue.map(item => item.timestamp))) / 1000) + 's ago' : 'none'
    };
  }
  
  /**
   * Check if we're in exclusive mode
   */
  isExclusiveMode(): boolean {
    return this.exclusiveMode;
  }
}

// Create a singleton instance
export const blockchairQueue = new BlockchairRequestQueue(); 