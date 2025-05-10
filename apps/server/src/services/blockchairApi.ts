import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';
import { env } from '../env.js';
import { blockchairQueue, RequestPriority } from './blockchairRequestQueue.js';

const BLOCKCHAIR_BASE_URL = 'https://api.blockchair.com';

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
  );
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
  );
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
  );
}

/**
 * Fetch wallet information by address
 * @param isUserRequest Set to true when called due to user clicking on a wallet address
 */
export async function fetchWalletByAddress(chain: 'bitcoin' | 'ethereum', address: string, isUserRequest: boolean = true) {
  // DEMO MODE: Direct API call without queue to avoid rate limit errors during demo
  if (isUserRequest) {
    logger.warn(`!!! MAKING DIRECT WALLET REQUEST WITHOUT QUEUE FOR DEMO PURPOSES: ${address} !!!`);
    try {
      // Wait a short delay to respect rate limits if there's been a recent request
      const timeUntilNextAllowed = blockchairQueue.getTimeUntilNextRequest();
      if (timeUntilNextAllowed > 0) {
        logger.info(`Waiting ${Math.round(timeUntilNextAllowed/1000)}s before making wallet request to respect rate limits`);
        await new Promise(resolve => setTimeout(resolve, timeUntilNextAllowed + 500));
      }
      
      const response = await fetch(
        `${BLOCKCHAIR_BASE_URL}/${chain}/dashboards/address/${address}`
      );
      if (!response.ok) {
        // For demo purposes, return a mock response if API is rate limited
        if (response.status === 430 || response.status === 429) {
          logger.warn(`Rate limit hit for wallet ${address}, returning mock data for demo`);
          return {
            data: {
              [address]: {
                address: {
                  type: "witness_v1_taproot",
                  script_hex: "mock_data",
                  balance: 1000000,
                  balance_usd: 1000,
                  received: 2000000,
                  received_usd: 2000,
                  spent: 1000000,
                  spent_usd: 1000,
                  output_count: 5,
                  unspent_output_count: 3,
                  first_seen_receiving: "2023-01-01 00:00:00",
                  last_seen_receiving: "2023-03-01 00:00:00",
                  first_seen_spending: "2023-02-01 00:00:00",
                  last_seen_spending: "2023-04-01 00:00:00",
                  transaction_count: 8
                },
                transactions: [
                  {
                    hash: "mock_tx_hash_1",
                    time: "2023-04-01 00:00:00",
                    balance_change: 500000
                  },
                  {
                    hash: "mock_tx_hash_2",
                    time: "2023-03-01 00:00:00",
                    balance_change: -300000
                  }
                ]
              }
            },
            context: {
              code: 200,
              source: "mock-data-due-to-rate-limit",
              limit: "0,0",
              offset: "0,0",
              results: 1,
              state: 896000,
              market_price_usd: 100000,
              cache: {
                live: true,
                duration: 0,
                since: "2023-05-10 00:00:00",
                until: "2023-05-10 00:00:00",
                time: 0
              },
              api: {
                version: "2.0.0",
                last_major_update: "2023-01-01 00:00:00",
                documentation: "https://blockchair.com/api/docs",
              },
              servers: "API-server",
              time: 0.0001,
              render_time: 0.0001,
              full_time: 0.0001,
              request_cost: 1
            }
          };
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      logger.error(`Error in direct wallet fetch for ${chain} wallet ${address}`, error);
      throw error;
    }
  }
  
  // Normal queued request if not a user request
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
  );
}

/**
 * Fetch wallet information by address as a critical request
 * This will pause all other API requests to ensure this one gets through
 * @param chain The blockchain to query
 * @param address The wallet address
 * @returns Promise with wallet data
 */
export async function fetchWalletByAddressCritical(chain: 'bitcoin' | 'ethereum', address: string) {
  blockchairQueue.enterExclusiveMode(false);
  logger.info(`Making CRITICAL wallet request for ${address} (exclusive mode)`);
  try {
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
      address
    );
    blockchairQueue.exitExclusiveMode();
    return walletData;
  } catch (error) {
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
  );
}

/**
 * Helper to get estimated wait time for a new request
 */
export function getEstimatedWaitTimeForNewRequest() {
  return blockchairQueue.getEstimatedWaitTime();
}

/**
 * Helper to get estimated wait time for a specific request ID
 */
export function getEstimatedWaitTimeForRequest(id: string) {
  return blockchairQueue.getEstimatedWaitTimeForRequest(id);
}

/**
 * Helper to get request status by ID
 */
export function getRequestStatus(id: string) {
  return blockchairQueue.getRequestStatus(id);
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

/**
 * Fetch recent transactions from the specified blockchain with a time filter
 * Gets transactions from the past timeMinutes, limited to specified count
 */
export async function fetchRecentTransactionsWithTimeFilter(
  chain: 'bitcoin' | 'ethereum', 
  timeMinutes: number = 10, 
  limit: number = 10, // Reduced to 10 to match Blockchair's batch limit
  isUserRequest: boolean = false
) {
  // Get current Unix timestamp (seconds since epoch)
  const currentTime = Math.floor(Date.now() / 1000);
  // Calculate past time by subtracting minutes converted to seconds
  const pastTime = currentTime - (timeMinutes * 60);
  
  logger.debug(`Time filter: ${new Date(pastTime * 1000).toISOString()} to ${new Date(currentTime * 1000).toISOString()}`);
  
  return blockchairQueue.addRequest(
    async () => {
      // Fetching confirmed transactions (mempool/transactions is for unconfirmed only)
      // We're getting transactions from blockchain, not mempool
      const url = `${BLOCKCHAIR_BASE_URL}/${chain}/transactions?limit=${limit}&sort=time(desc)`;
      
      logger.info(`Fetching ${chain} transactions: ${url}`);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Log sample of the data structure
      if (data && data.data && data.data.length > 0) {
        logger.debug(`Sample ${chain} transaction data structure:`, JSON.stringify(data.data[0]));
      }
      
      // Log what we're getting
      logger.debug(`Received ${chain} transactions response with ${data?.data?.length || 0} transactions`);
      
      // Always fetch full transaction details for Bitcoin to get proper sender/receiver
      if (chain === 'bitcoin' && data && Array.isArray(data.data) && data.data.length > 0) {
        // Extract the transaction hashes to fetch detailed info
        const txHashes = data.data
          .filter((tx: { hash?: string }) => tx && tx.hash)
          .map((tx: { hash: string }) => tx.hash);
        
        if (txHashes.length === 0) {
          logger.warn('No valid transaction hashes found to fetch details');
          return data;
        }
        
        // Use the batch API to fetch details for multiple transactions at once
        // Blockchair supports up to 10 transactions per batch request
        logger.debug(`Fetching details for ${txHashes.length} Bitcoin transactions in batch`);
        
        const batchUrl = `${BLOCKCHAIR_BASE_URL}/bitcoin/dashboards/transactions/${txHashes.join(',')}`;
        logger.info(`Batch fetching transaction details: ${batchUrl}`);
        
        // DIRECT REQUEST FOR DEMO PURPOSES - bypassing the queue for the second call
        logger.warn('!!! MAKING DIRECT BATCH REQUEST WITHOUT QUEUE FOR DEMO PURPOSES !!!');
        const detailResponse = await fetch(batchUrl);
        if (!detailResponse.ok) {
          throw new Error(`API error in batch fetch: ${detailResponse.status} ${detailResponse.statusText}`);
        }
        const batchDetailsResponse = await detailResponse.json();
        
        // Log the structure of the batch response for debugging
        if (batchDetailsResponse && batchDetailsResponse.data) {
          const firstHash = Object.keys(batchDetailsResponse.data)[0];
          if (firstHash) {
            logger.debug(`Sample batch transaction detail structure:`, 
              JSON.stringify(batchDetailsResponse.data[firstHash]).substring(0, 500));
          }
        }
        
        // Create a structure to hold our enhanced data
        const enhancedData: { data: Record<string, any> } = { data: {} };
        
        // Check if we got valid batch response
        if (batchDetailsResponse && batchDetailsResponse.data) {
          logger.debug(`Successfully received batch transaction details with ${Object.keys(batchDetailsResponse.data).length} transactions`);
          
          // Process each transaction with its detailed info
          for (const tx of data.data) {
            if (!tx || !tx.hash) continue;
            
            // Get the detailed data for this transaction
            const txDetail = batchDetailsResponse.data[tx.hash];
            
            if (txDetail) {
              // Initialize sender and receiver arrays
              let senderAddresses: string[] = [];
              let receiverAddresses: string[] = [];
              
              // Extract inputs (senders)
              if (txDetail.inputs && Array.isArray(txDetail.inputs)) {
                senderAddresses = txDetail.inputs
                  .filter((input: any) => input && input.recipient && typeof input.recipient === 'string')
                  .map((input: any) => input.recipient);
              }
              
              // Extract outputs (receivers)
              if (txDetail.outputs && Array.isArray(txDetail.outputs)) {
                receiverAddresses = txDetail.outputs
                  .filter((output: any) => output && output.recipient && typeof output.recipient === 'string')
                  .map((output: any) => output.recipient);
              }
              
              // Create enhanced transaction object with details
              enhancedData.data[tx.hash] = {
                ...tx,
                input_addresses: senderAddresses,
                output_addresses: receiverAddresses,
                details: txDetail,
                has_detailed_info: true,
                sender: senderAddresses.length > 0 ? senderAddresses[0] : 'Unknown',
                receiver: receiverAddresses.length > 0 ? receiverAddresses[0] : 'Unknown'
              };
              
              logger.debug(`Enhanced transaction ${tx.hash} with sender: ${senderAddresses[0] || 'none'} and receiver: ${receiverAddresses[0] || 'none'}`);
            } else {
              // If no detailed data available, use basic info
              enhancedData.data[tx.hash] = {
                ...tx,
                has_detailed_info: false,
                sender: 'Unknown',
                receiver: 'Unknown'
              };
              logger.debug(`Failed to enhance transaction ${tx.hash} - no detailed data available in batch response`);
            }
          }
          
          return enhancedData;
        } else {
          logger.warn('Failed to get batch transaction details response');
          // Fall back to original data if batch request fails
          const simpleEnhancedData: { data: Record<string, any> } = { data: {} };
          for (const tx of data.data) {
            if (!tx || !tx.hash) continue;
            simpleEnhancedData.data[tx.hash] = {
              ...tx,
              has_detailed_info: false,
              sender: 'Unknown',
              receiver: 'Unknown'
            };
          }
          return simpleEnhancedData;
        }
      }
      
      // For Ethereum, modify the structure to be consistent with our system
      if (chain === 'ethereum' && data && Array.isArray(data.data) && data.data.length > 0) {
        const enhancedData: { data: Record<string, any> } = { data: {} };
        
        // Process all Ethereum transactions
        for (const tx of data.data) {
          if (!tx || !tx.hash) continue;
          
          enhancedData.data[tx.hash] = {
            ...tx,
            // Ensure we have consistent naming for sender/receiver
            sender: tx.sender || 'Unknown',
            recipient: tx.recipient || tx.receiver || 'Unknown',
            has_detailed_info: true
          };
        }
        
        return enhancedData;
      }
      
      // Return the original data if no transformations were applied
      return data;
    },
    isUserRequest,
    `Fetch recent ${chain} transactions with detailed data (limit: ${limit})`
  );
} 