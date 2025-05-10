import { logger } from '../utils/logger.js';

/**
 * Tracks which pages users are currently viewing
 * Used to optimize background fetching based on user activity
 */
class PageTracker {
  // Count of users on each page type
  private activePages: Map<string, number> = new Map();
  
  constructor() {
    logger.info('Page tracker initialized');
  }
  
  /**
   * Register a user viewing a specific page
   * @param pageType The type of page being viewed (e.g., 'transactions', 'wallet')
   * @param userId Optional user identifier for tracking individual sessions
   */
  userEntered(pageType: string, userId: string = 'anonymous'): void {
    // Treat empty string as 'home'
    if (pageType === '') pageType = 'home';
    const currentCount = this.activePages.get(pageType) || 0;
    this.activePages.set(pageType, currentCount + 1);
    logger.debug(`User ${userId} entered ${pageType} page. Active users: ${currentCount + 1}`);
  }
  
  /**
   * Unregister a user leaving a specific page
   * @param pageType The type of page being left
   * @param userId Optional user identifier for tracking individual sessions
   */
  userLeft(pageType: string, userId: string = 'anonymous'): void {
    // Treat empty string as 'home'
    if (pageType === '') pageType = 'home';
    const currentCount = this.activePages.get(pageType) || 0;
    if (currentCount > 0) {
      this.activePages.set(pageType, currentCount - 1);
      logger.debug(`User ${userId} left ${pageType} page. Active users: ${currentCount - 1}`);
    }
  }
  
  /**
   * Check if a specific page type is being viewed by any users
   * @param pageType The type of page to check
   * @returns true if at least one user is viewing the page
   */
  isPageActive(pageType: string): boolean {
    // Treat empty string as 'home'
    if (pageType === '') pageType = 'home';
    // Check if the requested page type is active
    return (this.activePages.get(pageType) || 0) > 0;
  }
  
  /**
   * Get the count of users viewing a specific page
   * @param pageType The type of page to check
   * @returns The number of users viewing the page
   */
  getActiveCount(pageType: string): number {
    // Treat empty string as 'home'
    if (pageType === '') pageType = 'home';
    // Only count 'home' for homepage
    if (pageType === 'home') {
      return this.activePages.get('home') || 0;
    }
    return this.activePages.get(pageType) || 0;
  }
  
  /**
   * Get current active page counts for all page types
   */
  getStatus(): Record<string, number> {
    const status: Record<string, number> = {};
    this.activePages.forEach((count, pageType) => {
      status[pageType] = count;
    });
    // Add homepage count for clarity
    if (this.activePages.has('home')) {
      status['homepage'] = this.getActiveCount('home');
    }
    return status;
  }
}

// Singleton instance
export const pageTracker = new PageTracker(); 