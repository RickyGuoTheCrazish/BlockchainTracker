import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { sseClients } from '../services/scheduler.js';
import { db } from '../db/index.js';
import { stats } from '../db/schema/stats.js';
import { transactions } from '../db/schema/transactions.js';
import { desc } from 'drizzle-orm';

const router = express.Router();

/**
 * GET /api/sse
 * Establish SSE connection for real-time updates
 */
router.get('/', async (req, res) => {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Create a unique ID for this client
  const clientId = uuidv4();
  
  // Add this client to our tracked clients
  sseClients.set(clientId, { response: res });
  
  logger.info(`SSE client connected: ${clientId}`);
  
  // Send initial data
  try {
    // Fetch latest stats
    const latestStats = await db.select()
      .from(stats)
      .orderBy(desc(stats.timestamp))
      .limit(1);
    
    if (latestStats.length > 0) {
      res.write(`event: stats\n`);
      res.write(`data: ${JSON.stringify(latestStats[0])}\n\n`);
    }
    
    // Fetch latest transactions
    const latestTransactions = await db.select()
      .from(transactions)
      .orderBy(desc(transactions.block_time))
      .limit(10);
    
    if (latestTransactions.length > 0) {
      res.write(`event: transactions\n`);
      res.write(`data: ${JSON.stringify({ transactions: latestTransactions })}\n\n`);
    }
  } catch (error) {
    logger.error('Error sending initial SSE data', error);
  }
  
  // Send a test message to keep the connection alive
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ message: 'Connection established' })}\n\n`);
  
  // Set up a keep-alive interval
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(`event: ping\n`);
      res.write(`data: ${Date.now()}\n\n`);
    } catch (error) {
      clearInterval(keepAliveInterval);
      sseClients.delete(clientId);
      logger.info(`SSE client disconnected (ping failed): ${clientId}`);
    }
  }, 30000); // Send a ping every 30 seconds
  
  // Handle client disconnect
  req.on('close', () => {
    clearInterval(keepAliveInterval);
    sseClients.delete(clientId);
    logger.info(`SSE client disconnected: ${clientId}`);
  });
});

export default router; 