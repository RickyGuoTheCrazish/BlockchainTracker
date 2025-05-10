import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import { logger } from './utils/logger.js';
import { setupDatabaseConnection } from './db/index.js';
import { initScheduler, triggerTransactionFetch } from './services/scheduler.js';
import { blockchairQueue } from './services/blockchairRequestQueue.js';

// Import routes
import statsRoutes from './api/statsRoutes.js';
import transactionsRoutes from './api/transactionsRoutes.js';
import walletsRoutes from './api/walletsRoutes.js';
import searchRoutes from './api/searchRoutes.js';
import sseRoutes from './api/sseRoutes.js';
import statsEventsRoutes from './api/routes/stats.js';

async function startServer() {
  logger.info('Starting Blockchain Tracker server...');
  const app = express();

  // Middleware
  app.use(cors({
    origin: ['http://localhost:5173'], // Frontend URL
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  }));
  app.use(express.json());

  // Initialize database connection
  try {
    await setupDatabaseConnection();
    logger.info('Database connection established');
  } catch (error) {
    logger.error('Failed to connect to database', error);
    process.exit(1);
  }

  // Root route
  app.get('/', (req, res) => {
    res.json({
      message: 'Blockchain Tracker API',
      version: '1.0.0',
      endpoints: [
        '/api/stats',
        '/api/transactions',
        '/api/wallets',
        '/api/search',
        '/api/sse',
        '/api/events/stats'
      ],
      docs: '/api-docs'
    });
  });

  // API routes
  app.use('/api/stats', statsRoutes);
  app.use('/api/transactions', transactionsRoutes);
  app.use('/api/wallets', walletsRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/sse', sseRoutes);
  app.use('/api/events/stats', statsEventsRoutes);

  // Health check
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Start scheduler for periodic data fetching
  initScheduler();
  
  logger.info(`API throttle time set to ${env.API_THROTTLE_MS / 1000} seconds`);
  logger.info('Using prioritized BlockchairRequestQueue to handle all API calls');
  logger.info('User-initiated requests get priority over background fetching tasks');

  // Start server
  app.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
  });
}

startServer().catch(error => {
  logger.error('Failed to start server', error);
  process.exit(1);
}); 