import express from 'express';
import { db } from '../db/index.js';
import { stats } from '../db/schema/stats.js';
import { logger } from '../utils/logger.js';
import { desc, sql } from 'drizzle-orm';
import { blockchairQueue } from '../services/blockchairRequestQueue.js';
import { fetchDashboardStats } from '../services/blockchairApi.js';
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
 * POST /api/stats/refresh
 * Force a refresh of the blockchain stats with maximum priority
 */
router.post('/refresh', async (req, res) => {
  try {
    logger.info('Manually refreshing blockchain stats with USER CRITICAL priority');
    
    // Pause all scheduled tasks
    pauseScheduler();
    
    try {
      // Temporarily pause other requests for this critical operation
      blockchairQueue.enterExclusiveMode(true);
      
      // Fetch fresh data with critical priority
      const statsData = await blockchairQueue.addUserCriticalRequest(
        async () => {
          logger.info('Executing user-critical stats refresh');
          const response = await fetch('https://api.blockchair.com/stats');
          
          if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
          }
          
          return await response.json();
        },
        'USER CRITICAL stats refresh'
      );
      
      if (!statsData || !statsData.data) {
        throw new Error('Invalid response from Blockchair API');
      }
      
      // Extract stats from the response
      const btcData = statsData.data.bitcoin?.data || {};
      const ethData = statsData.data.ethereum?.data || {};
      
      // Store in database
      const newStats = {
        bitcoin_blocks: btcData.blocks || 0,
        bitcoin_hashrate: btcData.hashrate_24h || 0,
        bitcoin_mempool_transactions: btcData.mempool_transactions || 0,
        bitcoin_market_price_usd: btcData.market_price_usd || 0,
        ethereum_blocks: ethData.blocks || 0,
        ethereum_hashrate: ethData.hashrate_24h || 0,
        ethereum_mempool_transactions: ethData.mempool_transactions || 0,
        ethereum_market_price_usd: ethData.market_price_usd || 0,
        timestamp: new Date(),
        raw_payload: statsData
      };
      
      await db.insert(stats).values(newStats);
      
      // Exit exclusive mode
      blockchairQueue.exitExclusiveMode();
      
      // Resume scheduler
      resumeScheduler();
      
      // Return success with the fresh data
      return res.json({ 
        success: true, 
        data: newStats,
        message: 'Stats refreshed successfully'
      });
      
    } catch (error) {
      // Make sure to exit exclusive mode on error
      blockchairQueue.exitExclusiveMode();
      
      // Resume scheduler on error
      resumeScheduler();
      
      logger.error('Error in critical stats refresh', error);
      
      // Get the latest data from database to return
      const latestStats = await db.select()
        .from(stats)
        .orderBy(desc(stats.timestamp))
        .limit(1);
        
      if (latestStats.length > 0) {
        // Return cached data with error info
        return res.json({
          success: false,
          data: latestStats[0],
          error: 'API request failed, returning cached data',
          cached: true
        });
      }
      
      throw error; // Re-throw if no cached data available
    }
  } catch (error) {
    logger.error('Error refreshing stats', error);
    res.status(500).json({ error: 'Failed to refresh stats' });
  }
});

export default router; 