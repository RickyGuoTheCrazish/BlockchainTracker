import express from 'express';
import { db } from '../db/index.js';
import { transactions } from '../db/schema/transactions.js';
import { logger } from '../utils/logger.js';
import { desc, eq, sql } from 'drizzle-orm';
import { fetchTransactionByHash, extractSenderAddress, extractReceiverAddress, getEstimatedWaitTimeForNewRequest, getEstimatedWaitTimeForRequest, getRequestStatus, fetchRecentTransactionsWithTimeFilter } from '../services/blockchairApi.js';
import { triggerTransactionFetch } from '../services/scheduler.js';
import { blockchairQueue } from '../services/blockchairRequestQueue.js';

const router = express.Router();

/**
 * POST /api/transactions/refresh
 * Manually trigger a transaction refresh with user priority
 * Respects free tier rate limit (1 request per minute)
 */
router.post('/refresh', async (req, res) => {
  try {
    logger.info('Manual transaction refresh requested by user');
    
    // Check if we're within rate limits
    const timeUntilNextAllowed = blockchairQueue.getTimeUntilNextRequest();
    if (timeUntilNextAllowed > 0) {
      logger.warn(`Manual transaction refresh requested but within rate limit cooldown (${Math.round(timeUntilNextAllowed/1000)}s remaining)`);
      
      return res.json({
        success: false,
        rate_limited: true,
        message: `Transaction refresh not possible due to API rate limits. Next API request allowed in ${Math.round(timeUntilNextAllowed/1000)} seconds.`,
        time_until_next_allowed: Math.round(timeUntilNextAllowed/1000)
      });
    }
    
    // This will execute with user priority
    await triggerTransactionFetch();
    
    res.json({ success: true, message: 'Transaction refresh initiated' });
  } catch (error) {
    logger.error('Error triggering transaction refresh', error);
    res.status(500).json({ error: 'Failed to refresh transactions', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/transactions/refresh-with-timefilter
 * Manually trigger a transaction refresh using the time-filter method
 * More efficient than standard refresh as it gets multiple transactions in a single API call
 */
router.post('/refresh-with-timefilter', async (req, res) => {
  try {
    const { timeMinutes = 15, limit = 20 } = req.body;
    logger.info(`Manual transaction refresh with time filter requested by user (limit: ${limit})`);
    
    // Check if we're within rate limits
    const timeUntilNextAllowed = blockchairQueue.getTimeUntilNextRequest();
    if (timeUntilNextAllowed > 0) {
      logger.warn(`Manual transaction refresh requested but within rate limit cooldown (${Math.round(timeUntilNextAllowed/1000)}s remaining)`);
      
      return res.json({
        success: false,
        rate_limited: true,
        message: `Transaction refresh not possible due to API rate limits. Next API request allowed in ${Math.round(timeUntilNextAllowed/1000)} seconds.`,
        time_until_next_allowed: Math.round(timeUntilNextAllowed/1000)
      });
    }
    
    // First fetch and process Bitcoin transactions
    const btcTxData = await fetchRecentTransactionsWithTimeFilter('bitcoin', timeMinutes, limit, true);
    let btcCount = 0;
    
    if (btcTxData && btcTxData.data) {
      // Handle different response formats
      let txList: any[] = [];
      
      if (Array.isArray(btcTxData.data)) {
        // Direct array format
        txList = btcTxData.data;
      } else if (typeof btcTxData.data === 'object') {
        // Object format with hash keys
        txList = Object.values(btcTxData.data) as any[];
      }
      
      for (const tx of txList) {
        if (!tx.hash) continue;
        
        // Check if transaction already exists in database
        const existingTx = await db.select()
          .from(transactions)
          .where(eq(transactions.hash, tx.hash))
          .limit(1);
          
        if (existingTx.length === 0) {
          // Extract sender and receiver addresses
          let senderAddress = null;
          let receiverAddress = null;
          
          // Check for detailed transaction data
          if (tx.has_detailed_info) {
            if (tx.details && tx.details.inputs && Array.isArray(tx.details.inputs) && tx.details.inputs.length > 0) {
              const senderInput = tx.details.inputs.find((input: any) => input.recipient);
              senderAddress = senderInput ? senderInput.recipient : null;
            } else if (Array.isArray(tx.input_addresses) && tx.input_addresses.length > 0) {
              senderAddress = tx.input_addresses[0];
            }
            
            if (tx.details && tx.details.outputs && Array.isArray(tx.details.outputs) && tx.details.outputs.length > 0) {
              const receiverOutput = tx.details.outputs.find((output: any) => output.recipient);
              receiverAddress = receiverOutput ? receiverOutput.recipient : null;
            } else if (Array.isArray(tx.output_addresses) && tx.output_addresses.length > 0) {
              receiverAddress = tx.output_addresses[0];
            }
          } else {
            // Try to extract from basic data
            if (Array.isArray(tx.input_addresses) && tx.input_addresses.length > 0) {
              senderAddress = tx.input_addresses[0];
            }
            
            if (Array.isArray(tx.output_addresses) && tx.output_addresses.length > 0) {
              receiverAddress = tx.output_addresses[0];
            }
          }
          
          // Insert new BTC transaction
          await db.insert(transactions).values({
            hash: tx.hash,
            chain: 'BTC',
            block_number: tx.block_id || null,
            block_time: tx.time && !isNaN(tx.time) ? new Date(tx.time * 1000) : new Date(),
            value: String(tx.output_total || '0'),
            fee: String(tx.fee || '0'),
            sender: senderAddress,
            receiver: receiverAddress,
            status: tx.block_id ? 'confirmed' : 'pending',
            raw_payload: tx,
          });
          btcCount++;
        }
      }
    }
    
    // Check rate limit before fetching Ethereum transactions
    const timeBeforeEthFetch = blockchairQueue.getTimeUntilNextRequest();
    if (timeBeforeEthFetch > 0) {
      logger.info(`Waiting ${Math.round(timeBeforeEthFetch/1000)}s before fetching ETH transactions due to rate limit`);
      await new Promise(resolve => setTimeout(resolve, timeBeforeEthFetch + 500));
    }
    
    // Then fetch and process Ethereum transactions
    const ethTxData = await fetchRecentTransactionsWithTimeFilter('ethereum', timeMinutes, limit, true);
    let ethCount = 0;
    
    if (ethTxData && ethTxData.data) {
      // Handle different response formats
      let txList: any[] = [];
      
      if (Array.isArray(ethTxData.data)) {
        // Direct array format
        txList = ethTxData.data;
      } else if (typeof ethTxData.data === 'object') {
        // Object format with hash keys
        txList = Object.values(ethTxData.data) as any[];
      }
      
      for (const tx of txList) {
        if (!tx.hash) continue;
        
        // Check if transaction already exists in database
        const existingTx = await db.select()
          .from(transactions)
          .where(eq(transactions.hash, tx.hash))
          .limit(1);
          
        if (existingTx.length === 0) {
          // Get sender and receiver
          const sender = tx.sender || null;
          const receiver = tx.recipient || tx.receiver || null;
          
          // Insert new ETH transaction
          await db.insert(transactions).values({
            hash: tx.hash,
            chain: 'ETH',
            block_number: tx.block_id || null,
            block_time: tx.time && !isNaN(tx.time) ? new Date(tx.time * 1000) : new Date(),
            value: String(tx.value || '0'),
            fee: String(tx.fee || '0'),
            sender: sender,
            receiver: receiver,
            status: tx.block_id ? 'confirmed' : 'pending',
            raw_payload: tx,
          });
          ethCount++;
        }
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Transaction refresh completed using optimized method',
      btc_transactions: btcCount,
      eth_transactions: ethCount
    });
  } catch (error) {
    logger.error('Error triggering time-filtered transaction refresh', error);
    res.status(500).json({ error: 'Failed to refresh transactions', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/transactions
 * Fetch recent transactions with pagination
 * This always returns data from the database, never makes API calls
 */
router.get('/', async (req, res) => {
  try {
    const { page = '1', limit = '20', chain, sortOrder = 'desc' } = req.query;
    
    // Convert page and limit to numbers
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;
    
    // Determine sort direction
    const sortDirection = (sortOrder as string).toLowerCase() === 'asc' ? 'asc' : 'desc';
    
    // Build base query
    const baseQuery = db.select().from(transactions);
    
    // Execute query with pagination and optional chain filter
    const recentTransactions = await (chain 
      ? baseQuery
          .where(eq(transactions.chain, chain as string))
          .orderBy(sortDirection === 'desc' ? desc(transactions.block_time) : transactions.block_time)
          .limit(limitNum)
          .offset(offset)
      : baseQuery
          .orderBy(sortDirection === 'desc' ? desc(transactions.block_time) : transactions.block_time)
          .limit(limitNum)
          .offset(offset)
    );
    
    // Get total count for pagination - adjust for chain filter if present
    const countQuery = chain
      ? db.select({ count: sql`COUNT(*)` })
          .from(transactions)
          .where(eq(transactions.chain, chain as string))
      : db.select({ count: sql`COUNT(*)` })
          .from(transactions);
    
    const countResult = await countQuery;
    const total = parseInt(countResult[0].count as string, 10);
    
    logger.debug(`Returning ${recentTransactions.length} transactions from database (page ${pageNum}${chain ? `, filtered to ${chain}` : ''})`);
    
    res.json({
      data: recentTransactions,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    logger.error('Error fetching transactions', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

/**
 * GET /api/transactions/recent
 * Fetch the most recent transactions
 */
router.get('/recent', async (req, res) => {
  try {
    const recentTransactions = await db.select()
      .from(transactions)
      .orderBy(desc(transactions.block_time))
      .limit(20);
    
    // Fetch detailed information for transactions with missing sender/receiver
    const updatedTransactions = await Promise.all(
      recentTransactions.map(async (tx) => {
        // If transaction is missing sender or receiver, fetch more details
        if (!tx.sender || !tx.receiver) {
          try {
            // Determine chain type for API call
            const chainType = tx.chain === 'BTC' ? 'bitcoin' : 'ethereum';
            
            // Fetch detailed transaction information
            const txData = await fetchTransactionByHash(chainType, tx.hash);
            
            if (txData && txData.data && txData.data[tx.hash]) {
              const detailedTx = txData.data[tx.hash];
              
              // Extract sender and receiver using helper functions
              if (!tx.sender) {
                tx.sender = extractSenderAddress(detailedTx, chainType);
                
                // Also update in database for future queries
                if (tx.sender) {
                  await db.update(transactions)
                    .set({ sender: tx.sender })
                    .where(eq(transactions.hash, tx.hash));
                }
              }
              
              if (!tx.receiver) {
                tx.receiver = extractReceiverAddress(detailedTx, chainType);
                
                // Also update in database for future queries
                if (tx.receiver) {
                  await db.update(transactions)
                    .set({ receiver: tx.receiver })
                    .where(eq(transactions.hash, tx.hash));
                }
              }
            }
          } catch (error) {
            logger.warn(`Error updating transaction details for ${tx.hash}`, error);
            // Continue with existing transaction data
          }
        }
        
        return tx;
      })
    );
    
    res.json(updatedTransactions);
  } catch (error) {
    logger.error('Error fetching recent transactions', error);
    res.status(500).json({ error: 'Failed to fetch recent transactions' });
  }
});

/**
 * GET /api/transactions/from-database
 * Fetch the latest transactions from the database without making external API calls
 * This is used to refresh the UI with the latest data that already exists in the database
 */
router.get('/from-database', async (req, res) => {
  try {
    const { page = '1', limit = '20', sortOrder = 'desc' } = req.query;
    
    // Convert page and limit to numbers
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;
    
    // Determine sort direction
    const sortDirection = (sortOrder as string).toLowerCase() === 'asc' ? 'asc' : 'desc';
    
    // Just fetch the latest data from database, no API calls
    const recentTransactions = await db.select()
      .from(transactions)
      .orderBy(sortDirection === 'desc' ? desc(transactions.block_time) : transactions.block_time)
      .limit(limitNum)
      .offset(offset);
    
    // Get total count for pagination
    const countResult = await db.select({ count: sql`COUNT(*)` })
      .from(transactions);
    
    const total = parseInt(countResult[0].count as string, 10);
    
    logger.info(`Returning ${recentTransactions.length} transactions from database (no API calls)`);
    
    res.json({
      data: recentTransactions,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      },
      fromDatabase: true
    });
  } catch (error) {
    logger.error('Error fetching transactions from database', error);
    res.status(500).json({ error: 'Failed to fetch transactions from database' });
  }
});

/**
 * GET /api/transactions/status/:requestId
 * Get the status of a pending transaction request by request ID
 */
router.get('/status/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const status = getRequestStatus(requestId);
  if (!status) {
    return res.status(404).json({ error: 'Request not found' });
  }
  res.json({
    status: status.status,
    result: status.result,
    error: status.error,
    estimated_wait_ms: getEstimatedWaitTimeForRequest(requestId)
  });
});

/**
 * GET /api/transactions/:hash
 * Fetch a specific transaction by hash
 * This must be the last route defined to avoid capturing other endpoints
 */
router.get('/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    
    // Make sure this isn't trying to access another endpoint
    if (['refresh', 'recent', 'from-database', 'status'].includes(hash)) {
      return res.status(404).json({ error: 'Invalid transaction hash' });
    }
    
    // First check our database
    const existingTx = await db.select()
      .from(transactions)
      .where(eq(transactions.hash, hash))
      .limit(1);
    if (existingTx.length > 0) {
      return res.json(existingTx[0]);
    }
    // If not in database, queue a request and return pending status
    // Determine chain type for API call
    const chain = hash.length >= 64 ? 'ethereum' : 'bitcoin';
    const requestPromise = fetchTransactionByHash(chain, hash);
    const estimatedWait = getEstimatedWaitTimeForNewRequest();
    res.status(202).json({
      status: 'pending',
      message: 'Transaction data is being fetched from Blockchair. Please poll the status endpoint for updates.',
      estimated_wait_ms: estimatedWait
    });
  } catch (error) {
    logger.error(`Error fetching transaction ${req.params.hash}`, error);
    res.status(500).json({ error: 'Failed to fetch transaction' });
  }
});

export default router; 