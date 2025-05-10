import { useLoaderData } from "react-router-dom";
import { useState, useEffect } from "react";
import { setupSSE } from "../lib/sse";
import { usePageTracking } from "../lib/pageTracker";
import { API_BASE_URL } from "../lib/constants";
import "./HomePage.css";

interface BlockchainStats {
  bitcoin_blocks: number;
  bitcoin_hashrate: number;
  bitcoin_mempool_transactions: number;
  bitcoin_market_price_usd: number;
  ethereum_blocks: number;
  ethereum_hashrate: number;
  ethereum_mempool_transactions: number;
  ethereum_market_price_usd: number;
  timestamp: string;
}

const HomePage = () => {
  // Initial stats from the loader (always from database, no API calls)
  const initialStats = useLoaderData() as BlockchainStats;
  // State for live updates
  const [stats, setStats] = useState<BlockchainStats>(initialStats);
  // Connection status
  const [connected, setConnected] = useState(false);
  // Loading state for refresh button
  const [isRefreshing, setIsRefreshing] = useState(false);
  // SSE connection cleanup function
  const [sseCleanup, setSseCleanup] = useState<(() => void) | null>(null);
  // Data freshness indicator
  const [dataAge, setDataAge] = useState<'cached' | 'fresh'>('cached');
  // Time since last refresh
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(new Date(initialStats.timestamp));

  // Track page visit for backend optimization
  useEffect(() => {
    const cleanup = usePageTracking('home');
    return cleanup;
  }, []);

  // DON'T automatically connect to SSE or refresh data
  // Let the user decide when to get fresh data via the refresh button

  // Function to manually refresh stats data
  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      
      // Temporarily disconnect SSE to reduce API load during critical request
      if (sseCleanup) {
        sseCleanup();
        setSseCleanup(null);
        setConnected(false);
      }
      
      // Use the refresh endpoint for critical stats update
      const response = await fetch(`${API_BASE_URL}/stats/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to refresh stats: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success && result.data) {
        setStats(result.data);
        setDataAge('fresh');
        setLastRefreshTime(new Date());
      } else {
        throw new Error('Invalid response from refresh endpoint');
      }
      
      // Don't automatically reconnect SSE
      // Let the user choose to enable live updates
      
    } catch (error) {
      console.error("Error refreshing stats:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Function to toggle live updates
  const toggleLiveUpdates = () => {
    if (connected && sseCleanup) {
      // Disconnect if currently connected
      sseCleanup();
      setSseCleanup(null);
      setConnected(false);
    } else {
      // Connect if currently disconnected
      const cleanup = setupSSE({
        onStats: (data) => {
          if (data && data.data) {
            const btcData = data.data.bitcoin?.data || {};
            const ethData = data.data.ethereum?.data || {};
            
            setStats({
              bitcoin_blocks: btcData.blocks || 0,
              bitcoin_hashrate: btcData.hashrate_24h || 0,
              bitcoin_mempool_transactions: btcData.mempool_transactions || 0,
              bitcoin_market_price_usd: btcData.market_price_usd || 0,
              ethereum_blocks: ethData.blocks || 0,
              ethereum_hashrate: ethData.hashrate_24h || 0,
              ethereum_mempool_transactions: ethData.mempool_transactions || 0,
              ethereum_market_price_usd: ethData.market_price_usd || 0,
              timestamp: new Date().toISOString()
            });
            setDataAge('fresh');
            setLastRefreshTime(new Date());
          }
        },
        onConnected: () => setConnected(true),
        onError: () => setConnected(false)
      });
      
      setSseCleanup(() => cleanup);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Blockchain Overview</h2>
        <div className="action-buttons">
          <button 
            className={`live-updates-button ${connected ? 'connected' : ''}`} 
            onClick={toggleLiveUpdates}
          >
            {connected ? 'Live Updates On' : 'Enable Live Updates'}
          </button>
          <button 
            className={`refresh-button primary ${isRefreshing ? 'refreshing' : ''}`} 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh Now'}
          </button>
        </div>
      </div>
      
      <div className="data-freshness-indicator">
        {dataAge === 'cached' && 
          <span className="cached-data">
            Showing cached data. For fresh data, click Refresh Now.
          </span>
        }
        {dataAge === 'fresh' && 
          <span className="fresh-data">
            Showing latest blockchain data.
          </span>
        }
      </div>
      
      <div className="stats-container">
        <div className="stats-card bitcoin">
          <h3>Bitcoin</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Price</span>
              <span className="stat-value">${stats.bitcoin_market_price_usd.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Block Height</span>
              <span className="stat-value">{stats.bitcoin_blocks.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Hashrate</span>
              <span className="stat-value">{(stats.bitcoin_hashrate / 1e9).toFixed(2)} GH/s</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Mempool Txs</span>
              <span className="stat-value">{stats.bitcoin_mempool_transactions.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="stats-card ethereum">
          <h3>Ethereum</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Price</span>
              <span className="stat-value">${stats.ethereum_market_price_usd.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Block Height</span>
              <span className="stat-value">{stats.ethereum_blocks.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Hashrate</span>
              <span className="stat-value">{(stats.ethereum_hashrate / 1e6).toFixed(2)} MH/s</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Mempool Txs</span>
              <span className="stat-value">{stats.ethereum_mempool_transactions.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="last-updated">
        Last updated: {lastRefreshTime ? lastRefreshTime.toLocaleString() : 'Unknown'}
        {connected && <span className="update-indicator"></span>}
      </div>
    </div>
  );
};

export default HomePage; 