import express from 'express';
import { db } from '../db/index.js';
import { transactions } from '../db/schema/transactions.js';
import { logger } from '../utils/logger.js';
import { desc, eq, sql } from 'drizzle-orm';
import { fetchTransactionByHash, extractSenderAddress, extractReceiverAddress } from '../services/blockchairApi.js';
import { triggerTransactionFetch } from '../services/scheduler.js';

const router = express.Router();

/**
 * POST /api/transactions/refresh
 * Manually trigger a transaction refresh with user priority
 */
router.post('/refresh', async (req, res) => {
  try {
    logger.info('Manual transaction refresh requested by user');
    
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
    
    // If not in database, try to fetch from Blockchair API
    // First, determine if it's a Bitcoin or Ethereum hash
    // This is a simplification - in reality we might need a more robust way
    const chain = hash.length >= 64 ? 'ethereum' : 'bitcoin';
    
    const txData = await fetchTransactionByHash(chain, hash);
    
    if (!txData || !txData.data) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    // Format and return the transaction data
    const txDetails = Object.values(txData.data)[0] as any;
    
    // Validate timestamp before creating Date object
    let blockTime;
    try {
      blockTime = txDetails.time && !isNaN(txDetails.time) ? new Date(txDetails.time * 1000) : new Date();
    } catch (e) {
      // In case of invalid date, use current time
      blockTime = new Date();
      logger.warn(`Invalid timestamp for transaction ${hash}, using current time`);
    }
    
    // Insert into database for future queries
    try {
      const chainType = chain === 'bitcoin' ? 'bitcoin' : 'ethereum';
      await db.insert(transactions).values({
        hash,
        chain: chain === 'bitcoin' ? 'BTC' : 'ETH',
        block_number: txDetails.block_id || null,
        block_time: blockTime,
        value: String(txDetails.output_total || txDetails.value || '0'),
        fee: String(txDetails.fee || '0'),
        sender: extractSenderAddress(txDetails, chainType),
        receiver: extractReceiverAddress(txDetails, chainType),
        status: txDetails.block_id ? 'confirmed' : 'pending',
        raw_payload: txDetails,
      });
      logger.debug(`Inserted transaction ${hash} into database`);
    } catch (error: any) {
      // Handle possible race condition where transaction was inserted after our check
      if (error.message?.includes('duplicate key value violates unique constraint')) {
        logger.debug(`Transaction ${hash} was inserted by another process`);
      } else {
        // Log but continue - we still want to return the transaction data to the client
        logger.error(`Error inserting transaction ${hash}`, error);
      }
    }
    
    const chainType = chain === 'bitcoin' ? 'bitcoin' : 'ethereum';
    res.json({
      hash,
      chain: chain === 'bitcoin' ? 'BTC' : 'ETH',
      block_number: txDetails.block_id,
      block_time: blockTime,
      value: txDetails.output_total || txDetails.value,
      fee: txDetails.fee,
      sender: extractSenderAddress(txDetails, chainType),
      receiver: extractReceiverAddress(txDetails, chainType),
      status: txDetails.block_id ? 'confirmed' : 'pending',
      raw_payload: txDetails,
    });
  } catch (error) {
    logger.error(`Error fetching transaction ${req.params.hash}`, error);
    res.status(500).json({ error: 'Failed to fetch transaction' });
  }
});

export default router; 