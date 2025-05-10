import { API_BASE_URL } from './constants';

/**
 * Notify the backend about page entry/exit events
 * This helps optimize API calls based on active pages
 */

// Generate a random ID for this session
const sessionId = 'user-' + Math.random().toString(36).substring(2, 9);

/**
 * Notify the backend that a user entered a specific page
 * @param pageType Type of page being viewed ('home', 'transactions', 'wallet', etc)
 */
export const enterPage = (pageType: string): void => {
  console.log(`🔍 Tracking: User entered '${pageType}' page`);
  fetch(`${API_BASE_URL}/page-tracker/enter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      pageType,
      userId: sessionId
    }),
  })
  .then(response => {
    if (!response.ok) {
      console.error(`Failed to notify entry to ${pageType} page: Server responded with ${response.status}`);
    } else {
      console.log(`✅ Successfully tracked entry to '${pageType}' page`);
    }
  })
  .catch(err => console.error(`❌ Failed to notify entry to ${pageType} page:`, err));
};

/**
 * Notify the backend that a user left a specific page
 * @param pageType Type of page being left ('home', 'transactions', 'wallet', etc)
 */
export const leavePage = (pageType: string): void => {
  console.log(`🔍 Tracking: User left '${pageType}' page`);
  fetch(`${API_BASE_URL}/page-tracker/leave`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      pageType,
      userId: sessionId
    }),
  })
  .then(response => {
    if (!response.ok) {
      console.error(`Failed to notify exit from ${pageType} page: Server responded with ${response.status}`);
    }
  })
  .catch(err => console.error(`❌ Failed to notify exit from ${pageType} page:`, err));
};

/**
 * React hook for page tracking
 * Use in component useEffect to track page views
 * @param pageType Type of page being viewed ('home', 'transactions', 'wallet', etc)
 * @returns A cleanup function that notifies when user leaves
 */
export const usePageTracking = (pageType: string): (() => void) => {
  // Notify backend that user entered page
  enterPage(pageType);
  
  // Return cleanup function for useEffect
  return () => leavePage(pageType);
}; 