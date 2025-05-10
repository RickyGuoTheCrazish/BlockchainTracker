import { useLoaderData, useSearchParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import Pagination from "../components/Pagination";
import TransactionModal from "../components/TransactionModal";
import { API_BASE_URL } from "../lib/constants";
import "./TransactionsPage.css";
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

interface PaginatedResponse {
  data: Transaction[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

const TransactionsPage = () => {
  const { data: transactions, pagination } = useLoaderData() as PaginatedResponse;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // State for modal
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  // State for refresh
  const [isRefreshing, setIsRefreshing] = useState(false);
  // State to track if using cached data
  const [usingCachedData, setUsingCachedData] = useState(true);
  // Track if automatic refresh is scheduled
  const [autoRefreshScheduled, setAutoRefreshScheduled] = useState(false);
  
  const currentPage = parseInt(searchParams.get("page") || "1", 10);
  const sortOrder = searchParams.get("sort") || "desc";

  // Function to manually refresh transactions
  const refreshTransactions = useCallback(async () => {
    setIsRefreshing(true);
    
    try {
      // Make a direct request to trigger transaction fetch with user request priority
      const response = await fetch(`${API_BASE_URL}/transactions/refresh`, {
        method: 'POST'
      });
      
      if (response.ok) {
        // If successful, reload the page to get fresh data
        window.location.reload();
      } else {
        console.error("Failed to refresh transactions");
        setIsRefreshing(false);
      }
    } catch (error) {
      console.error("Error refreshing transactions:", error);
      setIsRefreshing(false);
    }
  }, []);

  // Schedule automatic refresh after 1 minute
  useEffect(() => {
    if (!autoRefreshScheduled) {
      setAutoRefreshScheduled(true);
      
      // After 1 minute, update the status to indicate we're no longer using cached data
      const timer = setTimeout(() => {
        setUsingCachedData(false);
      }, 60000);
      
      return () => clearTimeout(timer);
    }
  }, [autoRefreshScheduled]);

  // Track page visit for backend optimization
  useEffect(() => {
    // Use our page tracking hook to notify the backend
    const cleanup = usePageTracking('transactions');
    return cleanup;
  }, []);

  if (!transactions || transactions.length === 0) {
    return <div>No recent transactions found.</div>;
  }

  // Function to format addresses for display
  const formatAddress = (address: string | null) => {
    if (!address) return "N/A";
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  // Function to format crypto values (convert satoshis/wei to BTC/ETH)
  const formatCryptoValue = (value: string, chain: string) => {
    if (!value) return "0";
    const numValue = Number(value);
    if (isNaN(numValue)) return value;
    
    // Convert satoshis to BTC (1 BTC = 100,000,000 satoshis)
    // Convert wei to ETH (1 ETH = 10^18 wei)
    const divisor = chain === "BTC" ? 100000000 : 1000000000000000000;
    
    // Format with commas for readability
    return (numValue / divisor).toLocaleString(undefined, { 
      minimumFractionDigits: 2,
      maximumFractionDigits: 8
    });
  };

  // Handle sort toggle
  const toggleSort = () => {
    const newSortOrder = sortOrder === "desc" ? "asc" : "desc";
    const params = new URLSearchParams(searchParams);
    params.set("sort", newSortOrder);
    // Reset to page 1 when changing sort
    params.set("page", "1");
    navigate(`/transactions?${params.toString()}`);
  };

  // Open transaction modal
  const openTransactionModal = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
  };

  // Close transaction modal
  const closeTransactionModal = () => {
    setSelectedTransaction(null);
  };

  // Navigate to wallet details
  const navigateToWallet = (address: string | null) => {
    if (!address || address === "N/A") return;
    
    // Show a notification about potential delays
    const notification = document.createElement('div');
    notification.className = 'wallet-loading-notification';
    notification.innerHTML = `
      <div class="wallet-loading-content">
        <div class="wallet-loading-spinner"></div>
        <div class="wallet-loading-message">
          <p>Loading wallet details...</p>
          <p class="wallet-loading-note">Note: This might take a moment due to API rate limits</p>
        </div>
      </div>
    `;
    document.body.appendChild(notification);
    
    // Navigate after a short delay to allow notification to appear
    setTimeout(() => {
      navigate(`/wallets/${address}`);
      // Remove notification after navigation
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 500);
    }, 100);
  };

  return (
    <div className="transactions-container">
      <div className="transactions-header">
        <h2>Recent Transactions</h2>
        <div className="transactions-controls">
          {usingCachedData && (
            <div className="cached-data-notice">
              Using cached data. Fresh data will be fetched automatically in 1 minute.
            </div>
          )}
          <button
            onClick={refreshTransactions}
            className="refresh-button"
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh Now'}
          </button>
          <button
            onClick={toggleSort}
            className="sort-toggle-button"
            aria-label={`Sort by ${sortOrder === "desc" ? "oldest" : "newest"}`}
          >
            <span>Sort</span>
            <span className="sort-icon">
              {sortOrder === "desc" ? "↓" : "↑"}
            </span>
            <span className="sort-label">{sortOrder === "desc" ? "Newest first" : "Oldest first"}</span>
          </button>
        </div>
      </div>
      
      <div className="transactions-table-container">
        <table className="transactions-table">
          <thead>
            <tr>
              <th>Blockchain</th>
              <th>Hash</th>
              <th>From</th>
              <th>To</th>
              <th>Amount</th>
              <th>Fee</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.hash} className={tx.chain === "BTC" ? "bitcoin-row" : "ethereum-row"}>
                <td>
                  <span className={`blockchain-badge ${tx.chain === "BTC" ? "bitcoin" : "ethereum"}`}>
                    {tx.chain}
                  </span>
                </td>
                <td className="hash-cell">
                  <button
                    className="transaction-hash-button"
                    onClick={() => openTransactionModal(tx)}
                  >
                    {formatAddress(tx.hash)}
                  </button>
                </td>
                <td>
                  <button
                    className={`address-button ${!tx.sender ? 'disabled' : ''}`}
                    onClick={() => navigateToWallet(tx.sender)}
                    disabled={!tx.sender}
                  >
                    {formatAddress(tx.sender)}
                  </button>
                </td>
                <td>
                  <button
                    className={`address-button ${!tx.receiver ? 'disabled' : ''}`}
                    onClick={() => navigateToWallet(tx.receiver)}
                    disabled={!tx.receiver}
                  >
                    {formatAddress(tx.receiver)}
                  </button>
                </td>
                <td>{formatCryptoValue(tx.value, tx.chain)} {tx.chain}</td>
                <td>{formatCryptoValue(tx.fee, tx.chain)} {tx.chain}</td>
                <td>{new Date(tx.block_time).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Add pagination component */}
      <Pagination 
        currentPage={currentPage}
        totalPages={pagination.pages}
        basePath="/transactions"
        queryParams={{ sort: sortOrder }}
      />
      
      <div className="transactions-info">
        Showing {transactions.length} of {pagination.total} transactions
      </div>

      {/* Transaction modal */}
      {selectedTransaction && (
        <TransactionModal
          transaction={selectedTransaction}
          onClose={closeTransactionModal}
        />
      )}
    </div>
  );
};

export default TransactionsPage; 