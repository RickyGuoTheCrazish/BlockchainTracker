import express from 'express';
import { db } from '../db/index.js';
import { stats } from '../db/schema/stats.js';
import { logger } from '../utils/logger.js';
import { desc, sql } from 'drizzle-orm';
import { blockchairQueue } from '../services/blockchairRequestQueue.js';
import { fetchDashboardStats, getEstimatedWaitTimeForNewRequest, getEstimatedWaitTimeForRequest, getRequestStatus } from '../services/blockchairApi.js';
import { pauseScheduler, resumeScheduler } from '../services/scheduler.js';

const router = express.Router();

/**
 * GET /api/stats
 * Fetch the latest blockchain statistics - ALWAYS from database
 */
router.get('/', async (req, res) => {
  try {
    logger.info('Fetching latest stats from DATABASE ONLY (no API call)');
    
    // Fetch latest stats from database
    const latestStats = await db.select()
      .from(stats)
      .orderBy(desc(stats.timestamp))
      .limit(1);
    
    if (latestStats.length === 0) {
      return res.status(404).json({ error: 'No stats found in database' });
    }
    
    // Return from cache only, no API calls
    res.json(latestStats[0]);
  } catch (error) {
    logger.error('Error fetching stats', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/stats/latest
 * Fetch latest stats from the database (alias for /)
 */
router.get('/latest', async (req, res) => {
  try {
    const latestStats = await db.select()
      .from(stats)
      .orderBy(desc(stats.timestamp))
      .limit(1);
    
    if (latestStats.length === 0) {
      return res.status(404).json({ error: 'No stats found' });
    }
    
    res.json(latestStats[0]);
  } catch (error) {
    logger.error('Error fetching latest stats', error);
    res.status(500).json({ error: 'Failed to fetch latest stats' });
  }
});

/**
 * GET /api/stats/history
 * Fetch historical stats with optional time range
 */
router.get('/history', async (req, res) => {
  try {
    const { hours = 24, interval = '1h' } = req.query;
    
    // Convert hours to a number
    const hoursNum = parseInt(hours as string, 10);
    
    // Calculate the timestamp for the start of the period
    const startTime = new Date();
    startTime.setHours(startTime.getHours() - hoursNum);
    
    // Get stats with the specified interval
    const historicalStats = await db.select({
      timestamp: stats.timestamp,
      bitcoin_blocks: stats.bitcoin_blocks,
      bitcoin_market_price_usd: stats.bitcoin_market_price_usd,
      ethereum_blocks: stats.ethereum_blocks,
      ethereum_market_price_usd: stats.ethereum_market_price_usd,
    })
    .from(stats)
    .where(sql`${stats.timestamp} >= ${startTime}`)
    .orderBy(stats.timestamp);
    
    res.json(historicalStats);
  } catch (error) {
    logger.error('Error fetching stats history', error);
    res.status(500).json({ error: 'Failed to fetch stats history' });
  }
});

/**
 * GET /api/stats/queue
 * Get current status of the Blockchair API request queue
 */
router.get('/queue', (req, res) => {
  try {
    const queueStatus = blockchairQueue.getStatus();
    res.json(queueStatus);
  } catch (error) {
    logger.error('Error fetching queue status', error);
    res.status(500).json({ error: 'Failed to fetch queue status' });
  }
});

/**
 * GET /api/stats/status/:requestId
 * Get the status of a pending stats request by request ID
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
 * POST /api/stats/refresh
 * Force a refresh of the blockchain stats with maximum priority
 * Respects free tier rate limit (1 request per minute)
 */
router.post('/refresh', async (req, res) => {
  try {
    logger.info('Manually refreshing blockchain stats with USER CRITICAL priority');
    // Check if we're within rate limits
    // Instead of waiting, queue the request and return pending status
    const estimatedWait = getEstimatedWaitTimeForNewRequest();
    // Queue the request (the actual fetch will be handled by the queue)
    const requestPromise = fetchDashboardStats();
    res.status(202).json({
      status: 'pending',
      message: 'Stats refresh is being processed. Please poll the status endpoint for updates.',
      estimated_wait_ms: estimatedWait
    });
  } catch (error) {
    logger.error('Error refreshing stats', error);
    res.status(500).json({ error: 'Failed to refresh stats' });
  }
});

export default router; 