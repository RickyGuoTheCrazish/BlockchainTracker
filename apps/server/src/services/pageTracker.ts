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
    // Handle homepage and dashboard as equivalent
    if (pageType === 'homepage' || pageType === 'dashboard') {
      return (this.activePages.get('homepage') || 0) > 0 || 
             (this.activePages.get('dashboard') || 0) > 0;
    }
    
    return (this.activePages.get(pageType) || 0) > 0;
  }
  
  /**
   * Get the count of users viewing a specific page
   * @param pageType The type of page to check
   * @returns The number of users viewing the page
   */
  getActiveCount(pageType: string): number {
    // For homepage and dashboard, combine the counts
    if (pageType === 'homepage' || pageType === 'dashboard') {
      return (this.activePages.get('homepage') || 0) + 
             (this.activePages.get('dashboard') || 0);
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
    
    // Add combined count for dashboard/homepage
    if (this.activePages.has('homepage') || this.activePages.has('dashboard')) {
      status['homepage_or_dashboard'] = this.getActiveCount('homepage');
    }
    
    return status;
  }
}

// Singleton instance
export const pageTracker = new PageTracker(); 