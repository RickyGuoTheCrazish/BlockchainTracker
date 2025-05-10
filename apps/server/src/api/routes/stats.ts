import express from 'express';
import { logger } from '../../utils/logger.js';
import { sseClients } from '../../services/scheduler.js';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/index.js';
import { stats } from '../../db/schema/stats.js';
import { desc } from 'drizzle-orm';

const router = express.Router();

/**
 * GET /api/events/stats
 * SSE endpoint for real-time stats updates
 */
router.get('/', async (req, res) => {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Create a unique ID for this client
  const clientId = uuidv4();
  
  // Add this client to our tracked clients
  sseClients.set(clientId, { response: res });
  
  logger.info(`Stats SSE client connected: ${clientId}`);
  
  // Send initial data from database
  try {
    // Fetch latest stats
    const latestStats = await db.select()
      .from(stats)
      .orderBy(desc(stats.timestamp))
      .limit(1);
    
    if (latestStats.length > 0) {
      // Get raw payload which contains the original Blockchair format
      const rawPayload = latestStats[0].raw_payload;
      
      logger.info(`Sending initial stats data to client ${clientId}. Data sample: ${JSON.stringify(latestStats[0].bitcoin_blocks)}`);
      console.log("Bitcoin blocks:", latestStats[0].bitcoin_blocks);
      console.log("Raw payload bitcoin blocks:", rawPayload && typeof rawPayload === 'object' ? 
        (rawPayload as Record<string, any>).data?.bitcoin?.data?.blocks : 'No data');
      
      // Send in the format expected by the client
      res.write(`event: stats\n`);
      res.write(`data: ${JSON.stringify(rawPayload)}\n\n`);
    } else {
      logger.warn(`No stats data found to send to client ${clientId}`);
    }
  } catch (error) {
    logger.error('Error sending initial SSE stats data', error);
  }
  
  // Send initial connected message
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ message: 'Stats stream connected' })}\n\n`);
  
  // Set up a keep-alive interval
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(`event: ping\n`);
      res.write(`data: ${Date.now()}\n\n`);
    } catch (error) {
      clearInterval(keepAliveInterval);
      sseClients.delete(clientId);
      logger.info(`Stats SSE client disconnected (ping failed): ${clientId}`);
    }
  }, 30000); // Send a ping every 30 seconds
  
  // Handle client disconnect
  req.on('close', () => {
    clearInterval(keepAliveInterval);
    sseClients.delete(clientId);
    logger.info(`Stats SSE client disconnected: ${clientId}`);
  });
});

export default router; 