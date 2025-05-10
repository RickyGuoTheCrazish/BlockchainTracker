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
  extractReceiverAddress
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
  
  // Calculate how long we should wait based on rate limits
  // We wait at least 60 seconds, but longer if needed for rate limiting
  const timeUntilNextAllowed = blockchairQueue.getTimeUntilNextRequest();
  const delayTime = Math.max(60000, timeUntilNextAllowed + 1000);
  
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
    // Reducing the total number helps minimize API calls for details later
    const limit = 5; // Reduced from env.MAX_TRANSACTIONS/2 to minimize API calls
    
    // Fetch Bitcoin transactions (with proper priority flag)
    const btcTxData = await fetchRecentBitcoinTransactions(limit);
    if (btcTxData && btcTxData.data) {
      const txList = Object.values(btcTxData.data) as any[];
      // Use only the first few to reduce API calls
      for (let i = 0; i < Math.min(txList.length, limit); i++) {
        const tx = txList[i];
        if (!tx.hash) continue;
        
        try {
          // Check if we need to insert this transaction at all
          const existingTx = await db.select()
            .from(transactions)
            .where(eq(transactions.hash, tx.hash))
            .limit(1);
            
          if (existingTx.length > 0) {
            logger.debug(`Transaction ${tx.hash} already exists, skipping detailed fetch to save API calls`);
            continue;
          }
        
          // Check rate limits before fetching details - only fetch if we're within limits
          const timeUntilNextAllowed = blockchairQueue.getTimeUntilNextRequest();
          if (timeUntilNextAllowed > 0) {
            logger.info(`Deferring transaction detail fetch for ${Math.round(timeUntilNextAllowed/1000)}s due to free tier rate limit`);
            await new Promise(resolve => setTimeout(resolve, timeUntilNextAllowed + 500));
          }
          
          // Now fetch details
          const txDetails = await fetchTransactionByHash('bitcoin', tx.hash, isUserRequest);
          
          if (txDetails && txDetails.data && txDetails.data[tx.hash]) {
            const detailedTx = txDetails.data[tx.hash];
            
            await insertTransaction({
              hash: tx.hash,
              chain: 'BTC',
              block_number: tx.block_id || null,
              block_time: tx.time && !isNaN(tx.time) ? new Date(tx.time * 1000) : new Date(),
              value: String(tx.output_total || '0'),
              fee: String(tx.fee || '0'),
              sender: extractSenderAddress(detailedTx, 'bitcoin'),
              receiver: extractReceiverAddress(detailedTx, 'bitcoin'),
              status: tx.block_id ? 'confirmed' : 'pending',
              raw_payload: {
                transaction: tx,
                details: detailedTx
              },
            });
          } else {
            // Fall back to simple transaction data
            await insertTransaction({
              hash: tx.hash,
              chain: 'BTC',
              block_number: tx.block_id || null,
              block_time: tx.time && !isNaN(tx.time) ? new Date(tx.time * 1000) : new Date(),
              value: String(tx.output_total || '0'),
              fee: String(tx.fee || '0'),
              sender: tx.input_addresses?.[0] || null,
              receiver: tx.output_addresses?.[0] || null,
              status: tx.block_id ? 'confirmed' : 'pending',
              raw_payload: tx,
            });
          }
        } catch (fetchError: any) {
          // If detailed fetch fails, try with simple data
          logger.debug(`Error fetching details for ${tx.hash}: ${fetchError.message}`);
          
          await insertTransaction({
            hash: tx.hash,
            chain: 'BTC',
            block_number: tx.block_id || null,
            block_time: tx.time && !isNaN(tx.time) ? new Date(tx.time * 1000) : new Date(),
            value: String(tx.output_total || '0'),
            fee: String(tx.fee || '0'),
            sender: tx.input_addresses?.[0] || null,
            receiver: tx.output_addresses?.[0] || null,
            status: tx.block_id ? 'confirmed' : 'pending',
            raw_payload: tx,
          });
        }
      }
    }
    
    // Check rate limit before fetching Ethereum transactions
    const timeBeforeEthFetch = blockchairQueue.getTimeUntilNextRequest();
    if (timeBeforeEthFetch > 0) {
      logger.info(`Waiting ${Math.round(timeBeforeEthFetch/1000)}s before fetching ETH transactions due to rate limit`);
      await new Promise(resolve => setTimeout(resolve, timeBeforeEthFetch + 500));
    }
    
    // Fetch Ethereum transactions (with proper priority flag)
    const ethTxData = await fetchRecentEthereumTransactions(limit);
    if (ethTxData && ethTxData.data) {
      const txList = Object.values(ethTxData.data) as any[];
      // Use only the first few to reduce API calls
      for (let i = 0; i < Math.min(txList.length, limit); i++) {
        const tx = txList[i];
        if (!tx.hash) continue;
        
        try {
          // Check if we need to insert this transaction at all
          const existingTx = await db.select()
            .from(transactions)
            .where(eq(transactions.hash, tx.hash))
            .limit(1);
            
          if (existingTx.length > 0) {
            logger.debug(`Transaction ${tx.hash} already exists, skipping detailed fetch to save API calls`);
            continue;
          }
          
          // Check rate limits before fetching details
          const timeUntilNextAllowed = blockchairQueue.getTimeUntilNextRequest();
          if (timeUntilNextAllowed > 0) {
            logger.info(`Deferring ETH transaction detail fetch for ${Math.round(timeUntilNextAllowed/1000)}s due to free tier rate limit`);
            await new Promise(resolve => setTimeout(resolve, timeUntilNextAllowed + 500));
          }
          
          // Pass the isUserRequest flag down to the API call
          const txDetails = await fetchTransactionByHash('ethereum', tx.hash, isUserRequest);
          
          if (txDetails && txDetails.data && txDetails.data[tx.hash]) {
            const detailedTx = txDetails.data[tx.hash];
            
            await insertTransaction({
              hash: tx.hash,
              chain: 'ETH',
              block_number: tx.block_id || null,
              block_time: tx.time && !isNaN(tx.time) ? new Date(tx.time * 1000) : new Date(),
              value: String(tx.value || '0'),
              fee: String(tx.fee || '0'),
              sender: extractSenderAddress(detailedTx, 'ethereum'),
              receiver: extractReceiverAddress(detailedTx, 'ethereum'),
              status: tx.block_id ? 'confirmed' : 'pending',
              raw_payload: {
                transaction: tx,
                details: detailedTx
              },
            });
          } else {
            await insertTransaction({
              hash: tx.hash,
              chain: 'ETH',
              block_number: tx.block_id || null,
              block_time: tx.time && !isNaN(tx.time) ? new Date(tx.time * 1000) : new Date(),
              value: String(tx.value || '0'),
              fee: String(tx.fee || '0'),
              sender: tx.sender || null,
              receiver: tx.recipient || null,
              status: tx.block_id ? 'confirmed' : 'pending',
              raw_payload: tx,
            });
          }
        } catch (fetchError: any) {
          logger.debug(`Error fetching details for ${tx.hash}: ${fetchError.message}`);
          
          await insertTransaction({
            hash: tx.hash,
            chain: 'ETH',
            block_number: tx.block_id || null,
            block_time: tx.time && !isNaN(tx.time) ? new Date(tx.time * 1000) : new Date(),
            value: String(tx.value || '0'),
            fee: String(tx.fee || '0'),
            sender: tx.sender || null,
            receiver: tx.recipient || null,
            status: tx.block_id ? 'confirmed' : 'pending',
            raw_payload: tx,
          });
        }
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