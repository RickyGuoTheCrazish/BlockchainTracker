import { logger } from '../utils/logger.js';
import { env } from '../env.js';
import { v4 as uuidv4 } from 'uuid';

// Priority levels for different types of requests
export enum RequestPriority {
  USER_INITIATED_CRITICAL = -20, // User directly requested something critical (pause everything else)
  CRITICAL_REQUEST = -10,        // Critical requests that must go through even during restricted mode
  USER_REQUEST = 0,              // User-initiated requests (highest normal priority)
  SYSTEM_REQUEST = 10            // Background/system tasks (lower priority)
}

// Request item structure
interface QueueItem<T> {
  id: string;
  requestFn: () => Promise<T>;
  priority: RequestPriority;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
  timestamp: number;
  description: string;
  isCritical?: boolean;
  status: 'pending' | 'processing' | 'done' | 'error';
  result?: T;
  error?: any;
}

/**
 * Centralized queue for all Blockchair API requests
 * - Manages rate limiting across all API calls
 * - Prioritizes user requests over background tasks
 * - Provides status and monitoring capabilities
 * - Strictly enforces the 1 request per minute free tier limit
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
  // Strict rate limit for free tier (60 seconds)
  private readonly FREE_TIER_RATE_LIMIT_MS = 60000;
  // Track if a request is scheduled to be sent
  private requestScheduled = false;
  private requestStatusMap: Map<string, QueueItem<any>> = new Map();

  constructor() {
    logger.info('Blockchair request queue initialized with strict 1 request per minute serialization');
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
    const id = uuidv4();
    logger.debug(`Adding request to queue: ${description} (priority: ${priority === RequestPriority.USER_REQUEST ? 'USER' : 'SYSTEM'}) [${id}]`);
    
    return new Promise<T>((resolve, reject) => {
      // If we're in exclusive mode, only allow critical requests
      if (this.exclusiveMode) {
        logger.debug(`Rejecting request ${description} due to exclusive mode`);
        reject(new Error('API request rejected: system is in exclusive mode'));
        return;
      }
      
      // Add request to queue
      const item: QueueItem<T> = {
        id,
        requestFn,
        priority,
        resolve,
        reject,
        timestamp: Date.now(),
        description,
        isCritical: false,  // Regular requests are not critical
        status: 'pending',
      };
      this.queue.push(item);
      this.requestStatusMap.set(id, item);
      
      // Sort queue by priority (lower number = higher priority)
      this.sortQueue();
      
      // Start processing if not already running
      if (!this.processing && !this.paused && !this.requestScheduled) {
        this.scheduleNextRequest();
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
    
    const id = uuidv4();
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        id,
        requestFn,
        priority: RequestPriority.CRITICAL_REQUEST,
        resolve,
        reject,
        timestamp: Date.now(),
        description,
        isCritical: true,
        status: 'pending',
      };
      this.queue.push(item);
      this.requestStatusMap.set(id, item);
      
      this.sortQueue();
      
      // Start processing if not already running
      if (!this.processing && !this.paused && !this.requestScheduled) {
        this.scheduleNextRequest();
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
    if (this.queue.length > 0 && !this.processing && !this.paused && !this.requestScheduled) {
      this.scheduleNextRequest();
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
   * But still obeys the 1 request per minute rule
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
    
    const id = uuidv4();
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        id,
        requestFn,
        priority: RequestPriority.USER_INITIATED_CRITICAL,
        resolve,
        reject,
        timestamp: Date.now(),
        description,
        isCritical: true,
        status: 'pending',
      };
      this.queue.unshift(item); // Always put user critical at the front
      this.requestStatusMap.set(id, item);
      this.sortQueue();
      if (!this.processing && !this.paused && !this.requestScheduled) {
        this.scheduleNextRequest();
      }
    });
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
      if (this.queue.length > 0 && !this.processing && !this.paused && !this.requestScheduled) {
        this.scheduleNextRequest();
      }
    }
  }
  
  /**
   * Schedule the next API request strictly every 60 seconds
   */
  private scheduleNextRequest(): void {
    if (this.requestScheduled) return;
    if (this.globalUserPause) return;
    if (this.queue.length === 0 || this.paused) return;
    
    this.requestScheduled = true;
    const now = Date.now();
    
    // If no request has been made yet (lastRequestTime is 0), or if no requests have been processed successfully
    if (this.lastRequestTime === 0 || this.totalProcessed === 0) {
      logger.debug('Scheduling immediate processing of first request');
      setTimeout(() => {
        this.requestScheduled = false;
        this.processQueue();
      }, 0);
      return;
    }
    
    const timeSinceLastRequest = now - this.lastRequestTime;
    const waitTime = Math.max(0, this.FREE_TIER_RATE_LIMIT_MS - timeSinceLastRequest);
    
    logger.debug(`Scheduling next request with ${waitTime/1000}s wait time (last request: ${timeSinceLastRequest/1000}s ago)`);
    setTimeout(() => {
      this.requestScheduled = false;
      this.processQueue();
    }, waitTime);
  }
  
  /**
   * Helper to get a string representation of priority
   */
  private getPriorityTypeString(priority: RequestPriority): string {
    switch(priority) {
      case RequestPriority.USER_INITIATED_CRITICAL:
        return 'USER CRITICAL';
      case RequestPriority.CRITICAL_REQUEST:
        return 'CRITICAL';
      case RequestPriority.USER_REQUEST:
        return 'USER';
      case RequestPriority.SYSTEM_REQUEST:
        return 'SYSTEM';
      default:
        return 'UNKNOWN';
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
    if (this.globalUserPause) {
      this.processing = false;
      return;
    }
    if (this.queue.length === 0 || this.paused) {
      this.processing = false;
      return;
    }
    this.processing = true;
    const item = this.queue.shift();
    if (item) {
      item.status = 'processing';
      this.lastRequestTime = Date.now();
      try {
        const priorityType = this.getPriorityTypeString(item.priority);
        
        logger.debug(`Processing ${priorityType} request: ${item.description} (waited ${(Date.now() - item.timestamp)/1000}s)`);
        
        // Execute the request
        const result = await item.requestFn();
        
        item.status = 'done';
        item.result = result;
        item.resolve(result);
        this.totalProcessed++;
        
        // If this was the exclusive request we were waiting for, exit exclusive mode
        if (this.waitingForExclusiveRequest && item.isCritical && 
            this.exclusiveRequestId && item.description.includes(this.exclusiveRequestId)) {
          this.waitingForExclusiveRequest = false;
          // We'll keep exclusive mode on until explicitly turned off
        }
        
        // Schedule the next request if there are any in the queue
        if (this.queue.length > 0) {
          this.scheduleNextRequest();
        } else {
          this.processing = false;
        }
      } catch (error: any) {
        item.status = 'error';
        item.error = error;
        item.reject(error);
        this.totalErrors++;
        
        // Enhanced rate limit violation logging
        if (error.message && error.message.includes('430')) {
          const nextAllowed = new Date(this.lastRequestTime + this.FREE_TIER_RATE_LIMIT_MS);
          logger.error(`\n[RATE LIMIT VIOLATION] Blockchair free-tier limit hit!\n  Request: ${item.description}\n  Queue length: ${this.queue.length}\n  Next allowed request: ${nextAllowed.toISOString()}\n  Error: ${error.message}\n`);
        }
        
        // If this was the exclusive request we were waiting for, exit exclusive mode
        // even on error so the system doesn't get stuck
        if (this.waitingForExclusiveRequest && item.isCritical && 
            this.exclusiveRequestId && item.description.includes(this.exclusiveRequestId)) {
          this.waitingForExclusiveRequest = false;
          // We'll keep exclusive mode on until explicitly turned off
        }
        
        // Schedule the next request with a delay if there are any in the queue
        if (this.queue.length > 0) {
          this.scheduleNextRequest();
        } else {
          this.processing = false;
        }
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
    
    if (this.queue.length > 0 && !this.processing && !this.requestScheduled) {
      this.scheduleNextRequest();
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
      timeSinceLastRequest: `${Math.round((Date.now() - this.lastRequestTime) / 1000)}s`,
      timeUntilNextAllowed: `${Math.max(0, Math.round((this.FREE_TIER_RATE_LIMIT_MS - (Date.now() - this.lastRequestTime)) / 1000))}s`,
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
        Math.round((Date.now() - Math.min(...this.queue.map(item => item.timestamp))) / 1000) + 's ago' : 'none',
      requestScheduled: this.requestScheduled
    };
  }
  
  /**
   * Check if we're in exclusive mode
   */
  isExclusiveMode(): boolean {
    return this.exclusiveMode;
  }
  
  /**
   * Returns the estimated time until the next request can be made
   */
  getTimeUntilNextRequest(): number {
    const now = Date.now();
    // If no request has been made yet or if we're processing the first request since startup
    if (this.lastRequestTime === 0) {
      logger.debug(`No prior requests made (lastRequestTime=0), no wait needed`);
      return 0;
    }
    const timeSinceLastRequest = now - this.lastRequestTime;
    // Only apply rate limiting if we've actually made a request
    if (this.totalProcessed > 0) {
      const waitTime = Math.max(0, this.FREE_TIER_RATE_LIMIT_MS - timeSinceLastRequest);
      logger.debug(`Last request was ${Math.round(timeSinceLastRequest/1000)}s ago, wait time: ${Math.round(waitTime/1000)}s`);
      return waitTime;
    }
    logger.debug(`No requests processed yet (totalProcessed=0), no wait needed`);
    return 0;
  }

  /**
   * Get the estimated wait time (ms) for a new request added now
   */
  getEstimatedWaitTime(): number {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const queueLength = this.queue.length;
    const baseWait = Math.max(0, this.FREE_TIER_RATE_LIMIT_MS - timeSinceLastRequest);
    return baseWait + queueLength * this.FREE_TIER_RATE_LIMIT_MS;
  }

  /**
   * Get the estimated wait time (ms) for a specific request ID
   */
  getEstimatedWaitTimeForRequest(id: string): number | null {
    const item = this.requestStatusMap.get(id);
    if (!item) return null;
    const index = this.queue.findIndex(q => q.id === id);
    if (index === -1) return 0; // Already processing or done
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const baseWait = Math.max(0, this.FREE_TIER_RATE_LIMIT_MS - timeSinceLastRequest);
    return baseWait + index * this.FREE_TIER_RATE_LIMIT_MS;
  }

  /**
   * Get the status of a request by ID
   */
  getRequestStatus(id: string): QueueItem<any> | undefined {
    return this.requestStatusMap.get(id);
  }
}

// Create a singleton instance
export const blockchairQueue = new BlockchairRequestQueue(); 