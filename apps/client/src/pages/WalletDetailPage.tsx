import { useLoaderData, Link } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import TransactionModal from "../components/TransactionModal";
import { API_BASE_URL } from "../lib/constants";
import "./WalletDetailPage.css";
import { usePageTracking } from "../lib/pageTracker";

interface Transaction {
  hash: string;
  chain: string;
  block_number: number | null;
  block_time: string;
  value: string;
  fee: string;
  sender: string | null;
  receiver: string | null;
  status: string;
  raw_payload?: any;
}

interface WalletDetail {
  address: string;
  chain: string;
  balance: string;
  transaction_count: number;
  first_seen: string;
  last_seen: string;
  transactions: Transaction[];
  raw_payload: any;
  error?: boolean;
  errorMessage?: string;
  api_limited?: boolean;
  error_message?: string;
}

const WalletDetailPage = () => {
  const wallet = useLoaderData() as WalletDetail;
  // State for transaction modal
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  // State for refresh operation
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Function to manually refresh wallet data
  const refreshWallet = useCallback(async () => {
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    
    try {
      // Show a loading notification
      const notification = document.createElement('div');
      notification.className = 'wallet-loading-notification';
      notification.innerHTML = `
        <div class="wallet-loading-content">
          <div class="wallet-loading-spinner"></div>
          <div class="wallet-loading-message">
            <p>Refreshing wallet data...</p>
            <p class="wallet-loading-note">This may take a moment as we're fetching fresh data from the blockchain.</p>
          </div>
        </div>
      `;
      document.body.appendChild(notification);
      
      // Call refresh endpoint
      const response = await fetch(`${API_BASE_URL}/wallets/${wallet.address}/refresh`, {
        method: 'POST',
      });
      
      // Remove the notification
      document.body.removeChild(notification);
      
      if (response.ok) {
        // Reload the page to show refreshed data
        window.location.reload();
      } else {
        setIsRefreshing(false);
        alert('Could not refresh wallet data. API rate limit may still be in effect. Please try again later.');
      }
    } catch (error) {
      setIsRefreshing(false);
      console.error('Error refreshing wallet data:', error);
      alert('Error refreshing wallet data. Please try again later.');
    }
  }, [wallet.address, isRefreshing]);
  
  // Track page visit for backend optimization
  useEffect(() => {
    // Use our page tracking hook to notify the backend
    const cleanup = usePageTracking('wallet');
    return cleanup;
  }, []);
  
  // Handle error state
  if (wallet.error) {
    return (
      <div className="wallet-error-container">
        <div className="wallet-error-card">
          <h2>Error Loading Wallet</h2>
          <p>{wallet.errorMessage || "Failed to load wallet data"}</p>
          <div className="wallet-error-address">
            <strong>Address:</strong> {wallet.address}
          </div>
          <div className="wallet-error-actions">
            <Link to="/transactions" className="wallet-error-button">
              Return to Transactions
            </Link>
            <button 
              onClick={() => window.location.reload()} 
              className="wallet-error-button primary"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  if (!wallet) {
    return <div>Wallet not found.</div>;
  }

  // Format crypto values (convert satoshis/wei to BTC/ETH)
  const formatCryptoValue = (value: string, chain: string) => {
    if (!value) return "0";
    const numValue = Number(value);
    if (isNaN(numValue)) return value;
    
    // Convert satoshis to BTC (1 BTC = 100,000,000 satoshis)
    // Convert wei to ETH (1 ETH = 10^18 wei)
    const divisor = chain === "BTC" ? 100000000 : 1000000000000000000;
    
    return (numValue / divisor).toLocaleString(undefined, { 
      minimumFractionDigits: 2,
      maximumFractionDigits: 8
    });
  };

  // Format addresses for display
  const formatAddress = (address: string | null, full = false) => {
    if (!address) return "N/A";
    if (full) return address;
    return `${address.substring(0, 10)}...${address.substring(address.length - 6)}`;
  };

  // Open transaction modal
  const openTransactionModal = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
  };

  // Close transaction modal
  const closeTransactionModal = () => {
    setSelectedTransaction(null);
  };

  // Get wallet data from API response
  const walletData = wallet.raw_payload?.data?.[wallet.address] || {};
  
  // Extract useful properties
  const balance = wallet.api_limited ? wallet.balance : (walletData.balance ? formatCryptoValue(walletData.balance, wallet.chain) : "0");
  const totalReceived = walletData.received ? formatCryptoValue(walletData.received, wallet.chain) : "0";
  const totalSent = walletData.spent ? formatCryptoValue(walletData.spent, wallet.chain) : "0";
  
  return (
    <div className="wallet-detail-container">
      {wallet.api_limited && (
        <div className="wallet-api-limited-notice">
          <p>
            <strong>Note:</strong> {wallet.error_message || "Limited wallet data available due to API rate limits."}
            Only transaction data is shown. Balance information may not be accurate.
          </p>
          <button 
            onClick={refreshWallet} 
            className="wallet-refresh-button" 
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh Wallet Data'}
          </button>
        </div>
      )}
      
      <div className="wallet-header">
        <h2>
          <span className={`blockchain-badge ${wallet.chain === "BTC" ? "bitcoin" : "ethereum"}`}>
            {wallet.chain}
          </span>
          Wallet Details
        </h2>
        <div className="wallet-header-actions">
          {!wallet.api_limited && (
            <button 
              onClick={refreshWallet} 
              className="wallet-refresh-button" 
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
          <div className="wallet-external-links">
            <a 
              href={`https://${wallet.chain === "BTC" ? "blockchain.info" : "etherscan.io"}/address/${wallet.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="external-link"
            >
              View on {wallet.chain === "BTC" ? "Blockchain.info" : "Etherscan"}
            </a>
          </div>
        </div>
      </div>
      
      <div className="wallet-address-card">
        <h3>Address</h3>
        <div className="wallet-address">
          {formatAddress(wallet.address, true)}
        </div>
      </div>
      
      <div className="wallet-summary-cards">
        <div className="summary-card">
          <h3>Balance</h3>
          <div className="summary-value">{balance} {wallet.chain}</div>
        </div>
        
        <div className="summary-card">
          <h3>Transactions</h3>
          <div className="summary-value">{wallet.transaction_count.toLocaleString()}</div>
        </div>
        
        {!wallet.api_limited && (
          <>
            <div className="summary-card">
              <h3>Total Received</h3>
              <div className="summary-value">{totalReceived} {wallet.chain}</div>
            </div>
            
            <div className="summary-card">
              <h3>Total Sent</h3>
              <div className="summary-value">{totalSent} {wallet.chain}</div>
            </div>
          </>
        )}
      </div>
      
      {wallet.transactions && wallet.transactions.length > 0 && (
        <div className="wallet-transactions">
          <h3>Recent Transactions</h3>
          <div className="transactions-table-container">
            <table className="transactions-table">
              <thead>
                <tr>
                  <th>Hash</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {wallet.transactions.slice(0, 10).map((tx: Transaction) => {
                  const isIncoming = tx.receiver === wallet.address;
                  return (
                    <tr key={tx.hash}>
                      <td className="hash-cell">
                        <button 
                          className="transaction-link"
                          onClick={() => openTransactionModal(tx)}
                        >
                          {formatAddress(tx.hash)}
                        </button>
                      </td>
                      <td>
                        <span className={`transaction-type ${isIncoming ? 'incoming' : 'outgoing'}`}>
                          {isIncoming ? 'Received' : 'Sent'}
                        </span>
                      </td>
                      <td>{formatCryptoValue(tx.value, wallet.chain)} {wallet.chain}</td>
                      <td>{new Date(tx.block_time).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Additional data section if available */}
      {wallet.raw_payload && (
        <div className="wallet-additional-info">
          <h3>Additional Information</h3>
          <div className="additional-info-grid">
            {wallet.first_seen && (
              <div className="info-item">
                <div className="info-label">First Seen</div>
                <div className="info-value">{new Date(wallet.first_seen).toLocaleString()}</div>
              </div>
            )}
            
            {wallet.last_seen && (
              <div className="info-item">
                <div className="info-label">Last Seen</div>
                <div className="info-value">{new Date(wallet.last_seen).toLocaleString()}</div>
              </div>
            )}
            
            {/* Add any additional properties based on what's available in the API response */}
            {walletData.unspent_output_count !== undefined && (
              <div className="info-item">
                <div className="info-label">Unspent Outputs</div>
                <div className="info-value">{walletData.unspent_output_count}</div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Transaction Modal */}
      {selectedTransaction && (
        <TransactionModal
          transaction={selectedTransaction}
          onClose={closeTransactionModal}
        />
      )}
    </div>
  );
};

export default WalletDetailPage; 