import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import { logger } from '../utils/logger.js';
import * as statsSchema from './schema/stats.js';
import * as transactionsSchema from './schema/transactions.js';
import * as walletsSchema from './schema/wallets.js';

// Create PostgreSQL connection pool
const queryClient = postgres(env.DATABASE_URL, { max: 10 });

// Create Drizzle ORM instance
export const db = drizzle(queryClient, {
  schema: {
    ...statsSchema,
    ...transactionsSchema,
    ...walletsSchema,
  },
});

// Test and initialize database connection
export async function setupDatabaseConnection() {
  try {
    // Run a simple query to test connection
    await queryClient`SELECT 1`;
    logger.info('Database connection successful');
    
    // You can add migration logic here if needed
    // await migrateToLatest();
    
    return db;
  } catch (error) {
    logger.error('Database connection failed', error);
    throw error;
  }
}

// Function to close database connection
export async function closeDatabase() {
  try {
    await queryClient.end();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection', error);
  }
} 