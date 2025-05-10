import { API_BASE_URL } from './constants';

/**
 * Set up Server-Sent Events connection to receive real-time updates
 */
export function setupSSE(callbacks: {
  onStats?: (data: any) => void;
  onTransactions?: (data: any) => void;
  onConnected?: (data: any) => void;
  onError?: (error: any) => void;
}) {
  // Create EventSource for SSE connection
  const eventSource = new EventSource(`${API_BASE_URL}/events/stats`);
  
  // Set up event listeners
  if (callbacks.onStats) {
    eventSource.addEventListener('stats', (event) => {
      try {
        const data = JSON.parse(event.data);
        callbacks.onStats?.(data);
      } catch (error) {
        console.error('Error parsing stats data:', error);
      }
    });
  }
  
  if (callbacks.onTransactions) {
    eventSource.addEventListener('transactions', (event) => {
      try {
        const data = JSON.parse(event.data);
        callbacks.onTransactions?.(data);
      } catch (error) {
        console.error('Error parsing transactions data:', error);
      }
    });
  }
  
  if (callbacks.onConnected) {
    eventSource.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse(event.data);
        callbacks.onConnected?.(data);
      } catch (error) {
        console.error('Error parsing connected data:', error);
      }
    });
  }
  
  // Add ping listener to keep connection alive
  eventSource.addEventListener('ping', () => {
    // Process ping event if needed
    console.log("Received ping from server");
  });
  
  // Handle connection errors
  eventSource.onerror = (error) => {
    console.error('SSE connection error:', error);
    callbacks.onError?.(error);
  };
  
  // Return function to close the connection
  return () => {
    eventSource.close();
  };
} 