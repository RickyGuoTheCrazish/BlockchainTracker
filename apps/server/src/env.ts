import dotenv from 'dotenv';
import { resolve } from 'path';

// Try to load from root .env first, then from server directory
dotenv.config({ path: resolve(process.cwd(), '../../.env') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

interface Env {
  PORT: number;
  DATABASE_URL: string;
  NODE_ENV: 'development' | 'production' | 'test';
  API_THROTTLE_MS: number;
  MAX_TRANSACTIONS: number;
}

// Validate required environment variables
function validateEnv(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
}

// Only in development, we allow defaults
const isDev = process.env.NODE_ENV !== 'production';

// Validate in production
if (!isDev) {
  validateEnv();
}

// Environment variables with safe defaults
export const env: Env = {
  PORT: parseInt(process.env.PORT || '8000', 10),
  DATABASE_URL: process.env.DATABASE_URL || (isDev ? 'postgres://postgres:postgres@localhost:5432/blockchain' : ''),
  NODE_ENV: (process.env.NODE_ENV as Env['NODE_ENV']) || 'development',
  API_THROTTLE_MS: parseInt(process.env.API_THROTTLE_MS || '60000', 10),
  MAX_TRANSACTIONS: parseInt(process.env.MAX_TRANSACTIONS || '100', 10),
}; 