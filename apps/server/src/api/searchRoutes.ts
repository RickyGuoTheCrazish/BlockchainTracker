import express from 'express';
import { db } from '../db/index.js';
import { transactions } from '../db/schema/transactions.js';
import { wallets } from '../db/schema/wallets.js';
import { logger } from '../utils/logger.js';
import { ilike, or, eq, sql } from 'drizzle-orm';
import { fetchTransactionByHash, fetchWalletByAddress } from '../services/blockchairApi.js';

const router = express.Router();

/**
 * Search for matching wallets or transactions by query
 * This endpoint ONLY uses database data, never makes direct API calls
 */
router.get('/', async (req, res) => {
  try {
    const { q: query } = req.query;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Normalize query
    const normalizedQuery = query.trim().toLowerCase();
    
    // Try to detect query type (transaction hash, wallet address, or general search)
    let queryType = 'general';
    
    // Simple heuristics to detect query type
    if (normalizedQuery.length > 60) {
      queryType = 'transaction'; // Likely a transaction hash
    } else if (normalizedQuery.startsWith('0x') || normalizedQuery.match(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/)) {
      queryType = 'wallet'; // Likely an ETH or BTC address
    }
    
    const results: any = {
      type: queryType,
      query: normalizedQuery,
      transactions: [],
      wallets: [],
      data_source: 'database_only' // Flag that we only used cached data
    };
    
    // 1. Try to find exact match for transaction hash (DATABASE ONLY)
    if (queryType === 'transaction' || queryType === 'general') {
      const transactionMatch = await db.select()
        .from(transactions)
        .where(eq(transactions.hash, normalizedQuery))
        .limit(1);
      
      if (transactionMatch.length > 0) {
        results.type = 'transaction';
        results.transactions = transactionMatch;
      } else if (queryType === 'transaction') {
        // If it's likely a transaction hash but not found in DB, suggest looking up directly
        results.type = 'transaction_suggestion';
        results.message = 'Transaction not found in our database. Click on the hash to view details.';
        results.suggested_hash = normalizedQuery;
      }
    }
    
    // 2. Try to find exact match for wallet address (DATABASE ONLY)
    if (queryType === 'wallet' || queryType === 'general') {
      const walletMatch = await db.select()
        .from(wallets)
        .where(eq(wallets.address, normalizedQuery))
        .limit(1);
      
      if (walletMatch.length > 0) {
        results.type = 'wallet';
        results.wallets = walletMatch;
      } else if (queryType === 'wallet') {
        // If it's likely a wallet address but not found in DB, don't try API immediately
        // Instead, return a suggestion to look up the wallet directly
        results.type = 'wallet_suggestion';
        results.message = 'Wallet address not found in our database. Click on the address to view details.';
        results.suggested_address = normalizedQuery;
      }
    }
    
    // 3. If general search or no exact matches yet, try partial matches
    if (queryType === 'general' && results.transactions.length === 0 && results.wallets.length === 0) {
      // Search for partial wallet address or label matches
      const walletMatches = await db.select()
        .from(wallets)
        .where(
          or(
            ilike(wallets.address, `%${normalizedQuery}%`),
            ilike(wallets.label as any, `%${normalizedQuery}%`)
          )
        )
        .limit(5);
      
      if (walletMatches.length > 0) {
        results.wallets = walletMatches;
      }
      
      // Search for transactions with matching sender or receiver
      const transactionMatches = await db.select()
        .from(transactions)
        .where(
          or(
            ilike(transactions.sender as any, `%${normalizedQuery}%`),
            ilike(transactions.receiver as any, `%${normalizedQuery}%`)
          )
        )
        .limit(5);
      
      if (transactionMatches.length > 0) {
        results.transactions = transactionMatches;
      }
    }
    
    res.json(results);
  } catch (error) {
    logger.error(`Error performing search for ${req.query.q}`, error);
    res.status(500).json({ error: 'Failed to perform search' });
  }
});

export default router; 