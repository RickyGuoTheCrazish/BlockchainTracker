import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';
import { env } from '../env.js';
import { blockchairQueue, RequestPriority } from './blockchairRequestQueue.js';

const BLOCKCHAIR_BASE_URL = 'https://api.blockchair.com';

// This throttling function will be kept for backward compatibility
// but all calls should now go through the request queue
async function throttleApiCall() {
  logger.warn('Direct throttleApiCall used - should be migrated to request queue');
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCallTime;
  
  if (timeSinceLastCall < env.API_THROTTLE_MS) {
    const waitTime = env.API_THROTTLE_MS - timeSinceLastCall;
    logger.debug(`Throttling API call, waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastApiCallTime = Date.now();
}

// Legacy API throttling (kept for compatibility)
let lastApiCallTime = 0;

/**
 * Fetch dashboard stats from Blockchair
 */
export async function fetchDashboardStats() {
  return blockchairQueue.addRequest(
    async () => {
      const response = await fetch(`${BLOCKCHAIR_BASE_URL}/stats`);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    },
    false, // Not a user request
    'Fetch dashboard stats'
  ).catch(error => {
    logger.error('Error fetching dashboard stats', error);
    throw error;
  });
}

/**
 * Fetch recent Bitcoin transactions
 */
export async function fetchRecentBitcoinTransactions(limit = 10) {
  return blockchairQueue.addRequest(
    async () => {
      const response = await fetch(
        `${BLOCKCHAIR_BASE_URL}/bitcoin/mempool/transactions?limit=${limit}`
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    },
    false, // Not a user request
    `Fetch recent Bitcoin transactions (limit: ${limit})`
  ).catch(error => {
    logger.error('Error fetching recent Bitcoin transactions', error);
    throw error;
  });
}

/**
 * Fetch recent Ethereum transactions
 */
export async function fetchRecentEthereumTransactions(limit = 10) {
  return blockchairQueue.addRequest(
    async () => {
      const response = await fetch(
        `${BLOCKCHAIR_BASE_URL}/ethereum/mempool/transactions?limit=${limit}`
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    },
    false, // Not a user request
    `Fetch recent Ethereum transactions (limit: ${limit})`
  ).catch(error => {
    logger.error('Error fetching recent Ethereum transactions', error);
    throw error;
  });
}

/**
 * Fetch wallet information by address
 * @param isUserRequest Set to true when called due to user clicking on a wallet address
 */
export async function fetchWalletByAddress(chain: 'bitcoin' | 'ethereum', address: string, isUserRequest: boolean = true) {
  return blockchairQueue.addRequest(
    async () => {
      const response = await fetch(
        `${BLOCKCHAIR_BASE_URL}/${chain}/dashboards/address/${address}`
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    },
    isUserRequest, // Usually a user-initiated request
    `Fetch ${chain} wallet ${address}`
  ).catch(error => {
    logger.error(`Error fetching ${chain} wallet ${address}`, error);
    throw error;
  });
}

/**
 * Fetch wallet information by address as a critical request
 * This will pause all other API requests to ensure this one gets through
 * @param chain The blockchain to query
 * @param address The wallet address
 * @returns Promise with wallet data
 */
export async function fetchWalletByAddressCritical(chain: 'bitcoin' | 'ethereum', address: string) {
  // Enable exclusive mode before making the request
  blockchairQueue.enterExclusiveMode(false);
  
  logger.info(`Making CRITICAL wallet request for ${address} (exclusive mode)`);
  
  try {
    // Make the critical request with a unique ID based on the address
    const walletData = await blockchairQueue.addCriticalRequest(
      async () => {
        const response = await fetch(
          `${BLOCKCHAIR_BASE_URL}/${chain}/dashboards/address/${address}`
        );
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        return await response.json();
      },
      `CRITICAL Fetch ${chain} wallet ${address}`,
      address // Use the address as the exclusive ID
    );
    
    // Exit exclusive mode after successful fetch
    blockchairQueue.exitExclusiveMode();
    return walletData;
  } catch (error) {
    // Make sure to exit exclusive mode even on error
    blockchairQueue.exitExclusiveMode();
    logger.error(`Error in critical fetch for ${chain} wallet ${address}`, error);
    throw error;
  }
}

/**
 * Fetch transaction details by hash
 * @param isUserRequest Set to true when called due to user clicking on a transaction
 */
export async function fetchTransactionByHash(chain: 'bitcoin' | 'ethereum', hash: string, isUserRequest: boolean = true) {
  return blockchairQueue.addRequest(
    async () => {
      const response = await fetch(
        `${BLOCKCHAIR_BASE_URL}/${chain}/dashboards/transaction/${hash}`
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    },
    isUserRequest, // Usually a user-initiated request
    `Fetch ${chain} transaction ${hash}`
  ).catch(error => {
    logger.error(`Error fetching ${chain} transaction ${hash}`, error);
    throw error;
  });
}

/**
 * Extract sender address from transaction data
 */
export function extractSenderAddress(txData: any, chain: 'bitcoin' | 'ethereum'): string | null {
  if (!txData) return null;
  
  if (chain === 'bitcoin') {
    // For Bitcoin, check inputs array
    if (txData.inputs && txData.inputs.length > 0) {
      // Use the first input's recipient as sender
      return txData.inputs[0].recipient || null;
    }
    // Fallback to sender field
    return txData.sender || null;
  } else {
    // For Ethereum
    if (txData.transaction && txData.transaction.sender) {
      return txData.transaction.sender;
    }
    return txData.sender || null;
  }
}

/**
 * Extract receiver address from transaction data
 */
export function extractReceiverAddress(txData: any, chain: 'bitcoin' | 'ethereum'): string | null {
  if (!txData) return null;
  
  if (chain === 'bitcoin') {
    // For Bitcoin, check outputs array
    if (txData.outputs && txData.outputs.length > 0) {
      // Use the first output's recipient as receiver
      return txData.outputs[0].recipient || null;
    }
    // Fallback to recipient field
    return txData.recipient || null;
  } else {
    // For Ethereum
    if (txData.transaction && txData.transaction.recipient) {
      return txData.transaction.recipient;
    }
    return txData.recipient || null;
  }
}

/**
 * Fetch wallet information by address as a user-initiated critical request
 * This will completely pause the entire system and directly execute the request
 * @param chain The blockchain to query
 * @param address The wallet address
 * @returns Promise with wallet data
 */
export async function fetchWalletByAddressUserCritical(chain: 'bitcoin' | 'ethereum', address: string) {
  logger.info(`Making USER CRITICAL wallet request for ${address} (pausing all other activity)`);
  
  try {
    // Use the user critical request method which bypasses the queue
    const walletData = await blockchairQueue.addUserCriticalRequest(
      async () => {
        const response = await fetch(
          `${BLOCKCHAIR_BASE_URL}/${chain}/dashboards/address/${address}`
        );
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        return await response.json();
      },
      `USER CRITICAL ${chain} wallet ${address}`
    );
    
    return walletData;
  } catch (error) {
    logger.error(`Error in user critical wallet fetch for ${chain} wallet ${address}`, error);
    throw error;
  }
} 