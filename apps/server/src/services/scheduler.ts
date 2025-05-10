import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { env } from '../env.js';
import { db } from '../db/index.js';
import { stats } from '../db/schema/stats.js';
import { transactions } from '../db/schema/transactions.js';
import { 
  fetchDashboardStats, 
  fetchRecentBitcoinTransactions,
  fetchRecentEthereumTransactions,
  fetchTransactionByHash,
  extractSenderAddress,
  extractReceiverAddress,
  fetchRecentTransactionsWithTimeFilter
} from './blockchairApi.js';
import { eq, desc, sql } from 'drizzle-orm';
import { pageTracker } from './pageTracker.js';
import { blockchairQueue } from './blockchairRequestQueue.js';

// Track active SSE clients for real-time updates
export const sseClients = new Map<string, { response: any }>();

// Maximum number of transactions to keep in the database
const MAX_TRANSACTION_RECORDS = 1000;

// Task schedules
let transactionFetchingTask: cron.ScheduledTask | null = null;
let delayedFetchTimeout: NodeJS.Timeout | null = null;
let statsFetchingTask: cron.ScheduledTask | null = null;

/**
 * Initialize the scheduler for periodic data fetching
 * Uses the queue's rate limiting to ensure only one request per minute is sent to Blockchair
 */
export function initScheduler() {
  logger.info('Initializing scheduler for periodic data fetching (strict 1 request per minute enforced by queue)');
  setTimeout(async () => {
    logger.info('Fetching initial stats from DATABASE ONLY after startup delay');
    try {
      const latestStats = await db.select()
        .from(stats)
        .orderBy(desc(stats.timestamp))
        .limit(1);
      if (latestStats.length > 0) {
        logger.info('Initial stats loaded from database:', latestStats[0]);
      } else {
        logger.warn('No stats found in database on startup');
      }
    } catch (error) {
      logger.error('Initial stats DB fetch failed:', error);
    }
    // Schedule stats fetching every minute (real Blockchair API call, queued)
    statsFetchingTask = cron.schedule('*/1 * * * *', async () => {
      try {
        if (blockchairQueue.isGloballyPaused() || blockchairQueue.isSchedulerPaused()) {
          logger.info('Skipping scheduled stats fetch due to system pause');
          return;
        }
        if (!pageTracker.isPageActive('home')) {
          logger.info('Skipping stats fetch as no users are viewing the homepage');
          return;
        }
        logger.info('Queueing stats fetch as users are viewing the homepage');
        await fetchAndStoreStats();
      } catch (error) {
        logger.error('Scheduled stats fetch failed:', error);
      }
    });
  }, 10000);
  // Schedule transaction fetching every 5 minutes
  transactionFetchingTask = cron.schedule('*/5 * * * *', async () => {
    try {
      if (blockchairQueue.isGloballyPaused() || blockchairQueue.isSchedulerPaused()) {
        logger.info('Skipping scheduled transaction fetch due to system pause');
        return;
      }
      if (!pageTracker.isPageActive('transactions')) {
        logger.info('Skipping transactions fetch as no users are viewing the transactions page');
        return;
      }
      logger.debug('Queueing background transaction fetch - users are on transactions page');
      await fetchAndStoreTransactions(false);
    } catch (error) {
      logger.error('Background transaction fetch failed:', error);
    }
  });
}

/**
 * Manually trigger a transaction fetch (used for user-initiated requests)
 */
export async function triggerTransactionFetch() {
  logger.debug('Manually triggering user-initiated transaction fetch');
  
  // Check if we're within rate limits before proceeding
  const timeUntilNextAllowed = blockchairQueue.getTimeUntilNextRequest();
  if (timeUntilNextAllowed > 0) {
    logger.info(`Delaying user-initiated transaction fetch for ${Math.round(timeUntilNextAllowed/1000)}s due to free tier rate limit`);
    await new Promise(resolve => setTimeout(resolve, timeUntilNextAllowed + 500)); // Add buffer
  }
  
  await fetchAndStoreTransactions(true);
}

/**
 * Schedule a delayed transaction fetch when a user enters the transactions page
 * This allows the frontend to use cached data first, and only fetch fresh data after a delay
 */
export function scheduleDelayedTransactionFetch() {
  // Clear any existing timeout to avoid multiple fetches
  if (delayedFetchTimeout) {
    clearTimeout(delayedFetchTimeout);
  }
  
  // Check if the queue is empty and no API calls have been made yet
  if (blockchairQueue.getStatus().totalProcessed === 0 || blockchairQueue.getStatus().lastRequestTime === 0) {
    logger.debug('Scheduling immediate transaction fetch (no prior API calls)');
    // Use a tiny delay just to let other operations finish
    delayedFetchTimeout = setTimeout(async () => {
      if (blockchairQueue.isGloballyPaused() || blockchairQueue.isSchedulerPaused()) {
        logger.info('Skipping immediate transaction fetch due to system pause');
        return;
      }
      
      logger.debug('Executing immediate transaction fetch (no prior API calls)');
      await fetchAndStoreTransactions(true);
      delayedFetchTimeout = null;
    }, 1000);
    return;
  }
  
  // Calculate how long we should wait based on rate limits
  const timeUntilNextAllowed = blockchairQueue.getTimeUntilNextRequest();
  // Add a small buffer to ensure we're not hitting rate limits
  const delayTime = Math.max(timeUntilNextAllowed + 1000, 5000);
  
  logger.debug(`Scheduling delayed transaction fetch (${Math.round(delayTime/1000)}s delay, respecting rate limits)`);
  
  // Set a new timeout
  delayedFetchTimeout = setTimeout(async () => {
    // Skip if system is paused
    if (blockchairQueue.isGloballyPaused() || blockchairQueue.isSchedulerPaused()) {
      logger.info('Skipping delayed transaction fetch due to system pause');
      return;
    }
    
    logger.debug(`Executing delayed transaction fetch after ${Math.round(delayTime/1000)}s wait`);
    await fetchAndStoreTransactions(true);
    delayedFetchTimeout = null;
  }, delayTime);
}

/**
 * Cancel any pending delayed transaction fetch
 */
export function cancelDelayedTransactionFetch() {
  if (delayedFetchTimeout) {
    logger.debug('Cancelling delayed transaction fetch');
    clearTimeout(delayedFetchTimeout);
    delayedFetchTimeout = null;
  }
}

/**
 * Pause all scheduled tasks (used during critical operations)
 */
export function pauseScheduler() {
  blockchairQueue.pauseScheduler();
  logger.info('All scheduled tasks paused');
}

/**
 * Resume all scheduled tasks
 */
export function resumeScheduler() {
  blockchairQueue.resumeScheduler();
  logger.info('All scheduled tasks resumed');
}

/**
 * Fetch and store blockchain stats
 */
async function fetchAndStoreStats() {
  try {
    logger.debug('Fetching blockchain stats');
    const statsData = await fetchDashboardStats();
    
    if (!statsData || !statsData.data) {
      throw new Error('Invalid stats data received');
    }
    
    // Extract relevant stats
    const btcData = statsData.data.bitcoin?.data || {};
    const ethData = statsData.data.ethereum?.data || {};
    
    // Store in database
    await db.insert(stats).values({
      raw_payload: statsData,
      bitcoin_blocks: btcData.blocks || 0,
      bitcoin_hashrate: String(btcData.hashrate_24h || '0'),
      bitcoin_mempool_transactions: btcData.mempool_transactions || 0,
      bitcoin_market_price_usd: String(btcData.market_price_usd || '0'),
      ethereum_blocks: ethData.blocks || 0,
      ethereum_hashrate: String(ethData.hashrate_24h || '0'),
      ethereum_mempool_transactions: ethData.mempool_transactions || 0,
      ethereum_market_price_usd: String(ethData.market_price_usd || '0'),
    });
    
    // Notify connected clients with the raw API response
    notifyClients('stats', statsData);
    
    logger.debug('Stats stored successfully');
  } catch (error) {
    logger.error('Error in fetchAndStoreStats', error);
  }
}

/**
 * Fetch and store recent transactions
 * @param isUserRequest Whether this is triggered by user action (higher priority)
 */
async function fetchAndStoreTransactions(isUserRequest: boolean = false) {
  try {
    logger.debug(`Fetching recent transactions (user-initiated: ${isUserRequest})`);
    
    // Calculate how many transactions to fetch from each blockchain
    const limit = 10; // Number of transactions to fetch from each blockchain - Blockchair batch limit
    const timeMinutes = 15; // Look for transactions from the last 15 minutes
    
    // ----- FETCH BITCOIN TRANSACTIONS -----
    logger.info('Fetching Bitcoin transactions...');
    
    // First try using our optimized batch API approach
    try {
      const btcTxData = await fetchRecentTransactionsWithTimeFilter('bitcoin', timeMinutes, limit, isUserRequest);
      await processTransactionData('BTC', btcTxData, isUserRequest);
      logger.info('Successfully processed Bitcoin transactions with batch API');
    } catch (batchError: any) {
      logger.warn(`Batch Bitcoin fetch failed, falling back to individual fetches: ${batchError.message}`);
      
      // Fall back to the original approach if batch fails
      const btcTxData = await fetchRecentBitcoinTransactions(limit);
      
      if (btcTxData && btcTxData.data && Array.isArray(btcTxData.data)) {
        let processedCount = 0;
        
        logger.info(`Processing ${btcTxData.data.length} Bitcoin transactions individually`);
        
        for (const tx of btcTxData.data) {
          if (!tx || !tx.hash) continue;
          
          // Check if we already have this transaction
          const existingTx = await db.select()
            .from(transactions)
            .where(eq(transactions.hash, tx.hash))
            .limit(1);
            
          if (existingTx.length > 0) {
            logger.debug(`Transaction ${tx.hash} already exists, skipping`);
            continue;
          }
          
          // First, try to get the transaction details with inputs/outputs
          try {
            // Make sure we respect rate limits between individual transaction fetches
            const timeUntilNextAllowed = blockchairQueue.getTimeUntilNextRequest();
            if (timeUntilNextAllowed > 0) {
              logger.debug(`Waiting ${Math.round(timeUntilNextAllowed/1000)}s before fetching next transaction details`);
              await new Promise(resolve => setTimeout(resolve, timeUntilNextAllowed + 1000));
            }
            
            // Pass the isUserRequest flag down to the API call
            const txDetails = await fetchTransactionByHash('bitcoin', tx.hash, isUserRequest);
            
            if (txDetails && txDetails.data && txDetails.data[tx.hash]) {
              const detailedTx = txDetails.data[tx.hash];
              
              await insertTransaction({
                hash: tx.hash,
                chain: 'BTC',
                block_number: tx.block_id || null,
                block_time: tx.time && !isNaN(Date.parse(tx.time)) ? new Date(tx.time) : 
                          (tx.time && !isNaN(parseInt(tx.time)) ? new Date(parseInt(tx.time) * 1000) : new Date()),
                value: String(tx.output_total || tx.value || '0'),
                fee: String(tx.fee || '0'),
                sender: extractSenderAddress(detailedTx, 'bitcoin') || 'Unknown',
                receiver: extractReceiverAddress(detailedTx, 'bitcoin') || 'Unknown',
                status: tx.block_id ? 'confirmed' : 'pending',
                raw_payload: {
                  transaction: tx,
                  details: detailedTx
                },
              });
              
              processedCount++;
              logger.debug(`Processed Bitcoin transaction ${tx.hash} with detailed info`);
            } else {
              // Fall back to simple transaction data
              await insertTransaction({
                hash: tx.hash,
                chain: 'BTC',
                block_number: tx.block_id || null,
                block_time: tx.time && !isNaN(Date.parse(tx.time)) ? new Date(tx.time) : 
                          (tx.time && !isNaN(parseInt(tx.time)) ? new Date(parseInt(tx.time) * 1000) : new Date()),
                value: String(tx.output_total || tx.value || '0'),
                fee: String(tx.fee || '0'),
                sender: (tx.input_addresses && tx.input_addresses[0]) || 'Unknown',
                receiver: (tx.output_addresses && tx.output_addresses[0]) || 'Unknown',
                status: tx.block_id ? 'confirmed' : 'pending',
                raw_payload: tx,
              });
              
              processedCount++;
              logger.debug(`Processed Bitcoin transaction ${tx.hash} with basic info`);
            }
          } catch (fetchError: any) {
            // If detailed fetch fails, try with simple data
            logger.debug(`Error fetching details for ${tx.hash}: ${fetchError.message}`);
            
            await insertTransaction({
              hash: tx.hash,
              chain: 'BTC',
              block_number: tx.block_id || null,
              block_time: tx.time && !isNaN(Date.parse(tx.time)) ? new Date(tx.time) : 
                        (tx.time && !isNaN(parseInt(tx.time)) ? new Date(parseInt(tx.time) * 1000) : new Date()),
              value: String(tx.output_total || tx.value || '0'),
              fee: String(tx.fee || '0'),
              sender: (tx.input_addresses && tx.input_addresses[0]) || 'Unknown',
              receiver: (tx.output_addresses && tx.output_addresses[0]) || 'Unknown',
              status: tx.block_id ? 'confirmed' : 'pending',
              raw_payload: tx,
            });
            
            processedCount++;
            logger.debug(`Processed Bitcoin transaction ${tx.hash} with fallback info after error`);
          }
          
          // Limit the number of individual fetches to respect rate limits
          if (processedCount >= 5) {
            logger.info(`Limiting to ${processedCount} individual Bitcoin transactions to respect rate limits`);
            break;
          }
        }
        
        logger.info(`Successfully processed ${processedCount} Bitcoin transactions individually`);
      }
    }
    
    // Check rate limit before fetching Ethereum transactions
    const timeBeforeEthFetch = blockchairQueue.getTimeUntilNextRequest();
    if (timeBeforeEthFetch > 0) {
      logger.info(`Waiting ${Math.round(timeBeforeEthFetch/1000)}s before fetching ETH transactions due to rate limit`);
      await new Promise(resolve => setTimeout(resolve, timeBeforeEthFetch + 500));
    }
    
    // ----- FETCH ETHEREUM TRANSACTIONS -----
    logger.info('Fetching Ethereum transactions...');
    
    // First try using our optimized batch API approach
    try {
      const ethTxData = await fetchRecentTransactionsWithTimeFilter('ethereum', timeMinutes, limit, isUserRequest);
      await processTransactionData('ETH', ethTxData, isUserRequest);
      logger.info('Successfully processed Ethereum transactions with batch API');
    } catch (batchError: any) {
      logger.warn(`Batch Ethereum fetch failed, falling back to individual fetches: ${batchError.message}`);
      
      // Fall back to the original approach if batch fails
      const ethTxData = await fetchRecentEthereumTransactions(limit);
      
      if (ethTxData && ethTxData.data && Array.isArray(ethTxData.data)) {
        let processedCount = 0;
        
        logger.info(`Processing ${ethTxData.data.length} Ethereum transactions individually`);
        
        for (const tx of ethTxData.data) {
          if (!tx || !tx.hash) continue;
          
          // Check if we already have this transaction
          const existingTx = await db.select()
            .from(transactions)
            .where(eq(transactions.hash, tx.hash))
            .limit(1);
            
          if (existingTx.length > 0) {
            logger.debug(`Transaction ${tx.hash} already exists, skipping`);
            continue;
          }
          
          try {
            // Make sure we respect rate limits between individual transaction fetches
            const timeUntilNextAllowed = blockchairQueue.getTimeUntilNextRequest();
            if (timeUntilNextAllowed > 0) {
              logger.debug(`Waiting ${Math.round(timeUntilNextAllowed/1000)}s before fetching next transaction details`);
              await new Promise(resolve => setTimeout(resolve, timeUntilNextAllowed + 1000));
            }
            
            // Pass the isUserRequest flag down to the API call
            const txDetails = await fetchTransactionByHash('ethereum', tx.hash, isUserRequest);
            
            if (txDetails && txDetails.data && txDetails.data[tx.hash]) {
              const detailedTx = txDetails.data[tx.hash];
              
              await insertTransaction({
                hash: tx.hash,
                chain: 'ETH',
                block_number: tx.block_id || null,
                block_time: tx.time && !isNaN(Date.parse(tx.time)) ? new Date(tx.time) : 
                          (tx.time && !isNaN(parseInt(tx.time)) ? new Date(parseInt(tx.time) * 1000) : new Date()),
                value: String(tx.value || '0'),
                fee: String(tx.fee || '0'),
                sender: extractSenderAddress(detailedTx, 'ethereum') || 'Unknown',
                receiver: extractReceiverAddress(detailedTx, 'ethereum') || 'Unknown',
                status: tx.block_id ? 'confirmed' : 'pending',
                raw_payload: {
                  transaction: tx,
                  details: detailedTx
                },
              });
              
              processedCount++;
              logger.debug(`Processed Ethereum transaction ${tx.hash} with detailed info`);
            } else {
              await insertTransaction({
                hash: tx.hash,
                chain: 'ETH',
                block_number: tx.block_id || null,
                block_time: tx.time && !isNaN(Date.parse(tx.time)) ? new Date(tx.time) : 
                          (tx.time && !isNaN(parseInt(tx.time)) ? new Date(parseInt(tx.time) * 1000) : new Date()),
                value: String(tx.value || '0'),
                fee: String(tx.fee || '0'),
                sender: tx.sender || 'Unknown',
                receiver: tx.recipient || tx.receiver || 'Unknown',
                status: tx.block_id ? 'confirmed' : 'pending',
                raw_payload: tx,
              });
              
              processedCount++;
              logger.debug(`Processed Ethereum transaction ${tx.hash} with basic info`);
            }
          } catch (fetchError: any) {
            logger.debug(`Error fetching details for ${tx.hash}: ${fetchError.message}`);
            
            await insertTransaction({
              hash: tx.hash,
              chain: 'ETH',
              block_number: tx.block_id || null,
              block_time: tx.time && !isNaN(Date.parse(tx.time)) ? new Date(tx.time) : 
                        (tx.time && !isNaN(parseInt(tx.time)) ? new Date(parseInt(tx.time) * 1000) : new Date()),
              value: String(tx.value || '0'),
              fee: String(tx.fee || '0'),
              sender: tx.sender || 'Unknown',
              receiver: tx.recipient || tx.receiver || 'Unknown',
              status: tx.block_id ? 'confirmed' : 'pending',
              raw_payload: tx,
            });
            
            processedCount++;
            logger.debug(`Processed Ethereum transaction ${tx.hash} with fallback info after error`);
          }
          
          // Limit the number of individual fetches to respect rate limits
          if (processedCount >= 5) {
            logger.info(`Limiting to ${processedCount} individual Ethereum transactions to respect rate limits`);
            break;
          }
        }
        
        logger.info(`Successfully processed ${processedCount} Ethereum transactions individually`);
      }
    }
    
    // Notify connected clients
    const latestTxs = await db.select()
      .from(transactions)
      .orderBy(desc(transactions.block_time))
      .limit(20);
    
    notifyClients('transactions', { transactions: latestTxs });
    
    logger.debug('Transactions stored successfully');
  } catch (error) {
    logger.error('Error in fetchAndStoreTransactions', error);
  }
}

/**
 * Helper function to process transaction data from Blockchair API
 * @param chain Chain identifier (BTC or ETH)
 * @param txData Response data from Blockchair
 * @param isUserRequest Whether this is a user-initiated request
 */
async function processTransactionData(chain: string, txData: any, isUserRequest: boolean) {
  if (!txData || !txData.data) {
    logger.warn(`No ${chain} transaction data found or invalid response format`);
    return;
  }
  
  // Check if data is in expected format
  let txList: any[] = [];
  
  // Handle different response formats
  if (Array.isArray(txData.data)) {
    // Direct array format
    txList = txData.data;
    logger.debug(`Processing ${chain} transactions in array format (${txList.length} items)`);
  } else if (typeof txData.data === 'object') {
    // Object format with hash keys
    txList = Object.values(txData.data) as any[];
    logger.debug(`Processing ${chain} transactions in object format (${txList.length} items)`);
  } else {
    logger.warn(`Unexpected data format from ${chain} API: ${typeof txData.data}`);
    return;
  }
  
  logger.info(`Processing ${txList.length} transactions from ${chain}`);
  
  // Log the structure of the first transaction for debugging
  if (txList.length > 0) {
    const sampleTx = txList[0];
    logger.debug(`Sample ${chain} transaction structure:`, JSON.stringify(sampleTx).substring(0, 500));
  }
  
  const newTransactionsToProcess = [];
  
  // First, identify which transactions are new and need to be processed
  for (let i = 0; i < txList.length; i++) {
    const tx = txList[i];
    if (!tx || !tx.hash) {
      logger.debug(`Skipping transaction with no hash`);
      continue;
    }
    
    // Check if transaction already exists in database
    const existingTx = await db.select()
      .from(transactions)
      .where(eq(transactions.hash, tx.hash))
      .limit(1);
      
    if (existingTx.length === 0) {
      // This is a new transaction, add it to our processing list
      newTransactionsToProcess.push(tx);
    } else {
      logger.debug(`Transaction ${tx.hash} already exists, skipping`);
    }
  }
  
  // Log how many new transactions we found
  logger.info(`Found ${newTransactionsToProcess.length} new ${chain} transactions to process`);
  
  // Process new transactions
  for (const tx of newTransactionsToProcess) {
    try {
      // Process based on chain type
      if (chain === 'BTC') {
        // For Bitcoin, we need to handle the basic format without detailed address information
        let senderAddress = null;
        let receiverAddress = null;
        
        // For basic Bitcoin transaction format, like the one shown in the example
        // We won't have sender/receiver addresses directly - we need to fetch them separately
        // or use the batch request to get more details
        
        // In the simplified basic format, attempt to use any address info we might have
        if (tx.input_addresses && Array.isArray(tx.input_addresses) && tx.input_addresses.length > 0) {
          senderAddress = tx.input_addresses[0];
        }
        
        if (tx.output_addresses && Array.isArray(tx.output_addresses) && tx.output_addresses.length > 0) {
          receiverAddress = tx.output_addresses[0];
        }
        
        // If we have detailed transaction info, try to extract addresses from there
        if (tx.has_detailed_info) {
          if (tx.details && tx.details.inputs && Array.isArray(tx.details.inputs) && tx.details.inputs.length > 0) {
            const senderInput = tx.details.inputs.find((input: any) => input.recipient);
            senderAddress = senderInput ? senderInput.recipient : senderAddress;
          }
          
          if (tx.details && tx.details.outputs && Array.isArray(tx.details.outputs) && tx.details.outputs.length > 0) {
            const receiverOutput = tx.details.outputs.find((output: any) => output.recipient);
            receiverAddress = receiverOutput ? receiverOutput.recipient : receiverAddress;
          }
        }
        
        // For transactions without address info, use placeholder text
        // At least we'll store the transaction in the database
        if (!senderAddress) {
          logger.warn(`No sender address found for BTC transaction ${tx.hash}`);
          senderAddress = 'Unknown';
        }
        
        if (!receiverAddress) {
          logger.warn(`No receiver address found for BTC transaction ${tx.hash}`);
          receiverAddress = 'Unknown';
        }
        
        logger.debug(`Bitcoin transaction ${tx.hash} - sender: ${senderAddress}, receiver: ${receiverAddress}`);
        
        // Insert transaction with the data we have
        await insertTransaction({
          hash: tx.hash,
          chain: 'BTC',
          block_number: tx.block_id || null,
          block_time: tx.time && !isNaN(Date.parse(tx.time)) ? new Date(tx.time) : 
                      (tx.time && !isNaN(parseInt(tx.time)) ? new Date(parseInt(tx.time) * 1000) : new Date()),
          value: String(tx.output_total || tx.value || '0'),
          fee: String(tx.fee || '0'),
          sender: senderAddress,
          receiver: receiverAddress,
          status: tx.block_id ? 'confirmed' : 'pending',
          raw_payload: tx,
        });
      } else if (chain === 'ETH') {
        let sender = tx.sender || null;
        let receiver = tx.recipient || tx.receiver || null;
        
        // Additional fallbacks for Ethereum
        if (!sender && tx.transaction && tx.transaction.sender) {
          sender = tx.transaction.sender;
        }
        
        if (!receiver && tx.transaction && tx.transaction.recipient) {
          receiver = tx.transaction.recipient;
        }
        
        // For transactions without address info, use placeholder text
        if (!sender) {
          logger.warn(`No sender address found for ETH transaction ${tx.hash}`);
          sender = 'Unknown';
        }
        
        if (!receiver) {
          logger.warn(`No receiver address found for ETH transaction ${tx.hash}`);
          receiver = 'Unknown';
        }
        
        logger.debug(`Ethereum transaction ${tx.hash} - sender: ${sender}, receiver: ${receiver}`);
        
        await insertTransaction({
          hash: tx.hash,
          chain: 'ETH',
          block_number: tx.block_id || null,
          block_time: tx.time && !isNaN(Date.parse(tx.time)) ? new Date(tx.time) : 
                      (tx.time && !isNaN(parseInt(tx.time)) ? new Date(parseInt(tx.time) * 1000) : new Date()),
          value: String(tx.value || '0'),
          fee: String(tx.fee || '0'),
          sender: sender,
          receiver: receiver,
          status: tx.block_id ? 'confirmed' : 'pending',
          raw_payload: tx,
        });
      }
      logger.debug(`Processed ${chain} transaction ${tx.hash}`);
    } catch (error) {
      logger.error(`Error processing ${chain} transaction ${tx.hash}:`, error);
      // Continue with the next transaction
    }
  }
}

/**
 * Helper function to safely insert a transaction with duplicate handling
 */
async function insertTransaction(txData: any) {
  try {
    // Check if transaction already exists
    const existingTx = await db.select()
      .from(transactions)
      .where(eq(transactions.hash, txData.hash))
      .limit(1);
    
    if (existingTx.length === 0) {
      // Count current records before inserting
      const countResult = await db.select({ count: sql`COUNT(*)` })
        .from(transactions);
      
      const total = parseInt(countResult[0].count as string, 10);
      
      // If we're at or above the limit, delete the oldest transaction first
      if (total >= MAX_TRANSACTION_RECORDS) {
        // Find the oldest transaction
        const oldestTx = await db.select({ hash: transactions.hash })
          .from(transactions)
          .orderBy(transactions.block_time)
          .limit(1);
        
        if (oldestTx.length > 0) {
          // Delete the oldest transaction
          await db.delete(transactions)
            .where(eq(transactions.hash, oldestTx[0].hash));
          
          logger.debug(`Deleted oldest transaction ${oldestTx[0].hash} to maintain limit of ${MAX_TRANSACTION_RECORDS}`);
        }
      }
      
      // Insert new transaction
      await db.insert(transactions).values(txData);
      logger.debug(`Inserted transaction ${txData.hash}`);
    } else {
      // Optional: update transaction if needed (e.g., status changes)
      // For now, we're just skipping duplicates
      logger.debug(`Transaction ${txData.hash} already exists, skipping`);
    }
  } catch (error: any) {
    // Handle possible race condition where transaction was inserted after our check
    if (error.message?.includes('duplicate key value violates unique constraint')) {
      logger.debug(`Transaction ${txData.hash} was inserted by another process`);
    } else {
      // Re-throw other errors
      throw error;
    }
  }
}

/**
 * Notify SSE clients with updates
 */
function notifyClients(event: string, data: any) {
  sseClients.forEach(client => {
    try {
      client.response.write(`event: ${event}\n`);
      client.response.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      logger.error(`Error sending SSE update to client`, error);
    }
  });
} 