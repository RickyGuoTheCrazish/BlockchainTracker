import express from 'express';
import { db } from '../db/index.js';
import { wallets } from '../db/schema/wallets.js';
import { transactions } from '../db/schema/transactions.js';
import { logger } from '../utils/logger.js';
import { desc, eq, or } from 'drizzle-orm';
import { 
  fetchWalletByAddress, 
  fetchWalletByAddressUserCritical
} from '../services/blockchairApi.js';
import { pauseScheduler, resumeScheduler } from '../services/scheduler.js';

const router = express.Router();

// Cache settings in milliseconds
const CACHE_REFRESH_THRESHOLD = 15 * 60 * 1000; // 15 minutes
const FAILED_REFRESH_COOLDOWN = 5 * 60 * 1000;  // 5 minutes

// Track recent failed refreshes to avoid redundant API calls
const recentFailedRefreshes = new Map<string, number>();

// Helper function to determine blockchain type based on address format
function getChainType(address: string): 'ethereum' | 'bitcoin' {
  return address.startsWith('0x') ? 'ethereum' : 'bitcoin';
}

// Helper function to get chain code
function getChainCode(chainType: 'ethereum' | 'bitcoin'): string {
  return chainType === 'bitcoin' ? 'BTC' : 'ETH';
}

// Helper function to fetch related transactions
async function getRelatedTransactions(address: string, limit = 20) {
  return db.select()
    .from(transactions)
    .where(
      or(
        eq(transactions.sender, address),
        eq(transactions.receiver, address)
      )
    )
    .orderBy(desc(transactions.block_time))
    .limit(limit);
}

// Helper function to update wallet in database from API data
async function updateWalletFromApiData(address: string, walletData: any, firstSeen?: Date) {
  if (!walletData?.data) return null;
  
  const walletDetails = Object.values(walletData.data)[0] as any;
  const chainType = getChainType(address);
  
  const walletRecord = {
    address,
    chain: getChainCode(chainType),
    first_seen: firstSeen || new Date(),
    last_seen: new Date(),
    balance: String(walletDetails.address?.balance || '0'),
    transaction_count: walletDetails.address?.transaction_count || 0,
    raw_payload: walletData
  };
  
  await db.update(wallets)
    .set(walletRecord)
    .where(eq(wallets.address, address));
    
  return walletRecord;
}

// Helper function to check if wallet data needs a refresh
function needsRefresh(wallet: any): boolean {
  // Check if this address has had a recent failed refresh
  const lastFailedTime = recentFailedRefreshes.get(wallet.address);
  if (lastFailedTime && Date.now() - lastFailedTime < FAILED_REFRESH_COOLDOWN) {
    logger.debug(`Skipping refresh for ${wallet.address} due to recent failure (${Math.round((Date.now() - lastFailedTime)/1000)}s ago)`);
    return false;
  }
  
  // Check if the wallet data is older than our threshold
  const lastSeen = new Date(wallet.last_seen).getTime();
  const dataAge = Date.now() - lastSeen;
  
  if (dataAge < CACHE_REFRESH_THRESHOLD) {
    logger.debug(`Skipping refresh for ${wallet.address} - data is fresh (${Math.round(dataAge/1000)}s old)`);
    return false;
  }
  
  return true;
}

// Helper function to update wallet in background
async function backgroundRefreshWallet(address: string, priority = 'low') {
  try {
    // Skip refresh if this address recently failed
    const lastFailedTime = recentFailedRefreshes.get(address);
    if (lastFailedTime && Date.now() - lastFailedTime < FAILED_REFRESH_COOLDOWN) {
      logger.debug(`Skipping background refresh for ${address} - API recently failed (${Math.round((Date.now() - lastFailedTime)/1000)}s ago)`);
      return false;
    }
    
    const chainType = getChainType(address);
    const isLowPriority = priority === 'low';
    const freshData = await fetchWalletByAddress(chainType, address, isLowPriority);
    
    if (freshData?.data) {
      const walletDetails = Object.values(freshData.data)[0] as any;
      
      await db.update(wallets)
        .set({
          balance: String(walletDetails.address?.balance || '0'),
          transaction_count: walletDetails.address?.transaction_count || 0,
          last_seen: new Date(),
          raw_payload: freshData
        })
        .where(eq(wallets.address, address));
        
      logger.info(`Background ${priority} refresh successful for ${address}`);
      
      // Clear from failed refreshes if present
      recentFailedRefreshes.delete(address);
      return true;
    }
    return false;
  } catch (error: any) {
    // Record the failure time to avoid redundant API calls
    recentFailedRefreshes.set(address, Date.now());
    
    logger.debug(`Background ${priority} refresh failed for ${address}: ${error.message}`);
    return false;
  }
}

// Helper for creating a basic wallet from transaction data
async function createBasicWalletFromTransactions(address: string, walletTxs: any[]) {
  if (walletTxs.length === 0) return null;
  
  const basicWallet = {
    address,
    chain: walletTxs[0].chain,
    first_seen: new Date(),
    last_seen: new Date(),
    balance: "0", // Default as we don't know exact balance
    transaction_count: String(walletTxs.length),
    raw_payload: { info: "Created from transactions", transactions: walletTxs }
  };
  
  try {
    await db.insert(wallets).values(basicWallet);
    logger.info(`Basic wallet record created for ${address}`);
  } catch (dbError) {
    logger.error(`Error saving basic wallet data for ${address}`, dbError);
  }
  
  return {
    ...basicWallet,
    transactions: walletTxs,
    api_fetched: false,
    from_transactions: true
  };
}

// Helper to execute critical wallet fetch with proper cleanup
async function fetchWalletWithCriticalPriority(address: string) {
  const chainType = getChainType(address);
  
  try {
    pauseScheduler();
    const walletData = await fetchWalletByAddressUserCritical(chainType, address);
    return walletData;
  } finally {
    // Always resume scheduler whether successful or not
    resumeScheduler();
  }
}

/**
 * GET /api/wallets/:address
 * Fetch wallet information by address, return cache immediately but try to refresh in background
 */
router.get('/:address', async (req, res) => {
  try {
    const { address } = req.params;
    logger.info(`Wallet information requested for ${address}`);
    
    // Get cached wallet if it exists
    const existingWallet = await db.select()
      .from(wallets)
      .where(eq(wallets.address, address))
      .limit(1);
    
    // Fetch related transactions for this wallet
    const walletTransactions = await getRelatedTransactions(address);
    
    // CASE 1: Wallet exists in cache - return immediately and conditionally refresh in background
    if (existingWallet.length > 0) {
      // Update last_seen timestamp
      await db.update(wallets)
        .set({ last_seen: new Date() })
        .where(eq(wallets.address, address));
      
      logger.info(`Wallet ${address} found in cache - returning and conditionally refreshing`);
      
      // Send cached response immediately
      res.json({
        ...existingWallet[0],
        transactions: walletTransactions,
        from_cache: true
      });
      
      // Conditionally attempt background refresh based on data freshness and failure history
      if (needsRefresh(existingWallet[0])) {
        backgroundRefreshWallet(address, 'low')
          .catch(err => logger.debug(`Background refresh error: ${err.message}`));
      }
      
      return;
    }
    
    // CASE 2: Wallet not in cache but we have transactions - create basic record
    if (walletTransactions.length > 0) {
      logger.info(`Wallet ${address} not found, but has ${walletTransactions.length} transactions - creating basic record`);
      
      const basicWallet = await createBasicWalletFromTransactions(address, walletTransactions);
      res.json(basicWallet);
      
      // Check if this address has recently failed before trying to update
      const lastFailedTime = recentFailedRefreshes.get(address);
      if (!lastFailedTime || Date.now() - lastFailedTime > FAILED_REFRESH_COOLDOWN) {
        backgroundRefreshWallet(address, 'medium')
          .catch(err => logger.debug(`Background fetch error: ${err.message}`));
      }
      
      return;
    }
    
    // CASE 3: No wallet record and no transactions - check if recently failed before direct API fetch
    const lastFailedTime = recentFailedRefreshes.get(address);
    if (lastFailedTime && Date.now() - lastFailedTime < FAILED_REFRESH_COOLDOWN) {
      // If recently failed, return a descriptive error rather than hitting API again
      logger.info(`Skipping API fetch for ${address} due to recent failure (${Math.round((Date.now() - lastFailedTime)/1000)}s ago)`);
      return res.status(503).json({ 
        error: 'API services temporarily unavailable',
        message: 'Could not fetch wallet data due to recent API errors. Please try again later.',
        is_rate_limited: true
      });
    }
    
    // Otherwise proceed with API fetch
    logger.info(`Wallet ${address} not found in database - fetching from API with user-critical priority`);
    
    try {
      const walletData = await fetchWalletWithCriticalPriority(address);
      
      if (!walletData || !walletData.data) {
        return res.status(404).json({ error: 'Wallet not found' });
      }
      
      // Extract wallet details and store in database
      const walletDetails = Object.values(walletData.data)[0] as any;
      const chainType = getChainType(address);
      
      const newWallet = {
        address,
        chain: getChainCode(chainType),
        first_seen: new Date(),
        last_seen: new Date(),
        balance: String(walletDetails.address?.balance || '0'),
        transaction_count: walletDetails.address?.transaction_count || 0,
        raw_payload: walletData
      };
      
      await db.insert(wallets).values(newWallet);
      logger.info(`New wallet record created for ${address} from API`);
      
      // Remove from failed refreshes if present
      recentFailedRefreshes.delete(address);
      
      return res.json({
        ...newWallet,
        transactions: walletTransactions,
        from_api: true
      });
    } catch (apiError: any) {
      // Record the failure time
      recentFailedRefreshes.set(address, Date.now());
      
      logger.error(`Error fetching wallet data from API for ${address}`, apiError);
      
      return res.status(500).json({ 
        error: 'API request failed',
        message: 'Could not fetch wallet data. Please try again later.'
      });
    }
  } catch (error) {
    logger.error(`Error fetching wallet ${req.params.address}`, error);
    res.status(500).json({ error: 'Failed to fetch wallet information' });
  }
});

/**
 * POST /api/wallets/:address/label
 * Add a label to a wallet
 */
router.post('/:address/label', async (req, res) => {
  try {
    const { address } = req.params;
    const { label } = req.body;
    
    if (!label) {
      return res.status(400).json({ error: 'Label is required' });
    }
    
    // Check if wallet exists
    const existingWallet = await db.select()
      .from(wallets)
      .where(eq(wallets.address, address))
      .limit(1);
    
    if (existingWallet.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    
    // Update wallet label
    await db.update(wallets)
      .set({ label })
      .where(eq(wallets.address, address));
    
    res.json({ message: 'Wallet label updated successfully' });
  } catch (error) {
    logger.error(`Error updating wallet label for ${req.params.address}`, error);
    res.status(500).json({ error: 'Failed to update wallet label' });
  }
});

/**
 * POST /api/wallets/:address/refresh
 * Force refresh wallet data with absolute top priority, falls back to cache if API fails
 */
router.post('/:address/refresh', async (req, res) => {
  try {
    const { address } = req.params;
    logger.info(`Manual wallet refresh requested for ${address} with TOP PRIORITY`);
    
    // Get cached data for fallback
    const existingWallet = await db.select()
      .from(wallets)
      .where(eq(wallets.address, address))
      .limit(1);
    
    // Get related transactions
    const relatedTransactions = await getRelatedTransactions(address);
    
    // Check if this address has recently failed within a shorter window (30 seconds)
    // User-initiated refreshes have a much shorter cooldown than background ones
    const lastFailedTime = recentFailedRefreshes.get(address);
    const shortCooldown = 30 * 1000; // 30 seconds for manual refresh attempts
    
    if (lastFailedTime && Date.now() - lastFailedTime < shortCooldown) {
      logger.info(`Skipping user-initiated refresh for ${address} due to very recent failure (${Math.round((Date.now() - lastFailedTime)/1000)}s ago)`);
      
      // Return cached data with rate limit explanation
      if (existingWallet.length > 0) {
        return res.json({
          ...existingWallet[0],
          transactions: relatedTransactions,
          using_cached_data: true,
          api_limited: true,
          error_message: "Using cached wallet data due to API rate limits",
          success: false,
          error: "Recent API failures detected"
        });
      }
    }
    
    try {
      // Try to get fresh data first with highest priority
      const walletData = await fetchWalletWithCriticalPriority(address);
      
      if (!walletData || !walletData.data) {
        throw new Error('No wallet data returned from API');
      }
      
      // Extract wallet details
      const walletDetails = Object.values(walletData.data)[0] as any;
      const chainType = getChainType(address);
      
      // Prepare wallet data for database
      const newWallet = {
        address,
        chain: getChainCode(chainType),
        first_seen: existingWallet.length > 0 ? existingWallet[0].first_seen : new Date(),
        last_seen: new Date(),
        label: existingWallet.length > 0 ? existingWallet[0].label : null,
        balance: String(walletDetails.address?.balance || '0'),
        transaction_count: walletDetails.address?.transaction_count || 0,
        raw_payload: walletData
      };
      
      // Update or insert wallet data
      if (existingWallet.length > 0) {
        await db.update(wallets)
          .set(newWallet)
          .where(eq(wallets.address, address));
      } else {
        await db.insert(wallets).values(newWallet);
      }
      
      // Clear from failed refreshes if present
      recentFailedRefreshes.delete(address);
      
      // Return success with fresh data
      return res.json({
        ...newWallet,
        transactions: relatedTransactions,
        fresh_data: true,
        success: true
      });
    } catch (apiError: any) {
      // Record the failure time
      recentFailedRefreshes.set(address, Date.now());
      
      logger.error(`Error fetching wallet data from API for ${address}`, apiError);
      
      // FALLBACK 1: Return cached data if available
      if (existingWallet.length > 0) {
        return res.json({
          ...existingWallet[0],
          transactions: relatedTransactions,
          using_cached_data: true,
          api_limited: true,
          error_message: "Using cached wallet data due to API rate limits",
          success: false,
          error: apiError.message
        });
      }
      
      // FALLBACK 2: Create basic wallet from transactions if no cached data
      if (relatedTransactions.length > 0) {
        const basicWallet = await createBasicWalletFromTransactions(address, relatedTransactions);
        
        if (basicWallet) {
          return res.json({
            ...basicWallet,
            api_limited: true,
            success: false,
            error_message: "Could not fetch complete wallet data due to API rate limits"
          });
        }
      }
      
      // FALLBACK 3: No data at all - return error
      return res.status(500).json({ 
        error: 'API rate limit exceeded',
        message: 'Could not fetch wallet data due to API rate limits. Please try again later.',
        success: false
      });
    }
  } catch (error) {
    logger.error(`Error in wallet refresh route for ${req.params.address}`, error);
    res.status(500).json({ error: 'Failed to process wallet refresh' });
  }
});

export default router; 