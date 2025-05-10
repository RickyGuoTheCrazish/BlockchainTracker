import express from 'express';
import { logger } from '../utils/logger.js';
import { pageTracker } from '../services/pageTracker.js';
import { scheduleDelayedTransactionFetch, cancelDelayedTransactionFetch } from '../services/scheduler.js';

const router = express.Router();

/**
 * POST /api/page-tracker/enter
 * Register a user entering a page (use 'home' for homepage/dashboard)
 */
router.post('/enter', (req, res) => {
  try {
    const { pageType, userId } = req.body;
    
    logger.info(`👁️ Page ENTER request received: User ${userId} entered '${pageType}' page`);
    
    if (!pageType) {
      logger.warn('Page tracker received enter request without pageType');
      return res.status(400).json({ error: 'Page type is required' });
    }
    
    pageTracker.userEntered(pageType, userId || 'anonymous');
    
    // If this is the transactions page, schedule a delayed fetch
    if (pageType === 'transactions') {
      scheduleDelayedTransactionFetch();
    }
    
    // Log active page counts after update
    const activePages = pageTracker.getStatus();
    logger.info(`👁️ Active pages after ENTER: ${JSON.stringify(activePages)}`);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Error tracking page entry', error);
    res.status(500).json({ error: 'Failed to track page entry' });
  }
});

/**
 * POST /api/page-tracker/leave
 * Register a user leaving a page (use 'home' for homepage/dashboard)
 */
router.post('/leave', (req, res) => {
  try {
    const { pageType, userId } = req.body;
    
    logger.info(`👁️ Page LEAVE request received: User ${userId} left '${pageType}' page`);
    
    if (!pageType) {
      logger.warn('Page tracker received leave request without pageType');
      return res.status(400).json({ error: 'Page type is required' });
    }
    
    pageTracker.userLeft(pageType, userId || 'anonymous');
    
    // If this is the transactions page, cancel any pending delayed fetch
    if (pageType === 'transactions') {
      cancelDelayedTransactionFetch();
    }
    
    // Log active page counts after update
    const activePages = pageTracker.getStatus();
    logger.info(`👁️ Active pages after LEAVE: ${JSON.stringify(activePages)}`);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Error tracking page exit', error);
    res.status(500).json({ error: 'Failed to track page exit' });
  }
});

/**
 * GET /api/page-tracker/status
 * Get the current status of page trackers (homepage is 'home')
 */
router.get('/status', (req, res) => {
  try {
    const status = pageTracker.getStatus();
    logger.info(`👁️ Page tracker status requested: ${JSON.stringify(status)}`);
    res.json(status);
  } catch (error) {
    logger.error('Error getting page tracker status', error);
    res.status(500).json({ error: 'Failed to get page tracker status' });
  }
});

export default router; 