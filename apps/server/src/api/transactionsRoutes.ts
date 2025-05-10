import express from 'express';
import { db } from '../db/index.js';
import { transactions } from '../db/schema/transactions.js';
import { logger } from '../utils/logger.js';
import { desc, eq, sql } from 'drizzle-orm';
import { fetchTransactionByHash, extractSenderAddress, extractReceiverAddress, getEstimatedWaitTimeForNewRequest, getEstimatedWaitTimeForRequest, getRequestStatus } from '../services/blockchairApi.js';
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
    res.status(500).json({ error: 'Failed to refresh transactions' });
  }
});

/**
 * GET /api/transactions
 * Fetch recent transactions with pagination
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
    
    // Get total count for pagination
    const countResult = await db.select({ count: sql`COUNT(*)` })
      .from(transactions);
    
    const total = parseInt(countResult[0].count as string, 10);
    
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
 */
router.get('/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
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