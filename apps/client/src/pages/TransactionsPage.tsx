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
  // State for refresh from API
  const [isRefreshingFromAPI, setIsRefreshingFromAPI] = useState(false);
  // State for refresh from database
  const [isRefreshingFromDB, setIsRefreshingFromDB] = useState(false);
  // State for transaction data
  const [transactionData, setTransactionData] = useState<Transaction[]>(transactions);
  // State for pagination data
  const [paginationData, setPaginationData] = useState(pagination);
  // State to track if using cached data
  const [usingCachedData, setUsingCachedData] = useState(true);
  // Track if automatic refresh is scheduled
  const [autoRefreshScheduled, setAutoRefreshScheduled] = useState(false);
  // State for blockchain filter
  const [blockchainFilter, setBlockchainFilter] = useState<'all' | 'BTC' | 'ETH'>('all');
  
  const currentPage = parseInt(searchParams.get("page") || "1", 10);
  const sortOrder = searchParams.get("sort") || "desc";

  // Function to refresh transactions from database
  const refreshTransactionsFromDB = useCallback(async () => {
    setIsRefreshingFromDB(true);
    
    try {
      // Get current page and sort from URL
      const params = new URLSearchParams(searchParams);
      const page = params.get('page') || '1';
      const sortOrder = params.get('sort') || 'desc';
      
      // Add chain parameter if filtering is active
      const chainParam = blockchainFilter !== 'all' ? `&chain=${blockchainFilter}` : '';
      
      // Use the standard endpoint with optional chain filter
      const response = await fetch(`${API_BASE_URL}/transactions?page=${page}&sortOrder=${sortOrder}${chainParam}`);
      
      if (response.ok) {
        const data = await response.json();
        setTransactionData(data.data);
        setPaginationData(data.pagination);
        setUsingCachedData(false);
      } else {
        console.error("Failed to refresh transactions from database");
      }
    } catch (error) {
      console.error("Error refreshing transactions from database:", error);
    } finally {
      setIsRefreshingFromDB(false);
    }
  }, [searchParams, blockchainFilter]);

  // Apply filter when it changes
  useEffect(() => {
    refreshTransactionsFromDB();
  }, [blockchainFilter, refreshTransactionsFromDB]);

  // Function to manually refresh transactions from API
  const refreshTransactionsFromAPI = useCallback(async () => {
    setIsRefreshingFromAPI(true);
    
    try {
      // Use the more efficient refresh-with-timefilter endpoint
      const response = await fetch(`${API_BASE_URL}/transactions/refresh-with-timefilter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          timeMinutes: 30, // Look back 30 minutes for transactions
          limit: 20 // Get up to 20 transactions per blockchain
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // If rate limited, show message to user
        if (data.rate_limited) {
          alert(`Rate limit reached. Please try again in ${data.time_until_next_allowed} seconds.`);
          setIsRefreshingFromAPI(false);
          return;
        }
        
        // If successful, reload the page data from the database
        await refreshTransactionsFromDB();
        
        // Show success message
        const transactionCount = (data.btc_transactions || 0) + (data.eth_transactions || 0);
        alert(`Successfully fetched latest blockchain data (${transactionCount} transactions found).`);
      } else {
        console.error("Failed to refresh transactions:", data.message || "Unknown error");
        alert("Failed to refresh transactions. Please try again later.");
      }
    } catch (error) {
      console.error("Error refreshing transactions:", error);
      alert("Error refreshing transactions. Please try again later.");
    } finally {
      setIsRefreshingFromAPI(false);
    }
  }, [refreshTransactionsFromDB]);

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
    if (!address) return "Unknown";
    
    // For contract creations in Ethereum
    if (address === '0x0000000000000000000000000000000000000000') return "Contract Creation";
    
    // Some Bitcoin addresses might have special formats or be very long
    return address.length > 12 
      ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}`
      : address;
  };

  // Function to check if an address is clickable (has wallet details)
  const isAddressClickable = (address: string | null) => {
    return address !== null && 
           address !== "Unknown" &&
           address !== "Contract Creation";
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
    if (!isAddressClickable(address)) return;
    
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

  // Get filtered transactions
  const filteredTransactions = blockchainFilter === 'all' 
    ? transactionData 
    : transactionData.filter(tx => tx.chain === blockchainFilter);

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
          <div className="blockchain-filter">
            <span>Filter: </span>
            <div className="filter-buttons">
              <button 
                className={`filter-button ${blockchainFilter === 'all' ? 'active' : ''}`}
                onClick={() => setBlockchainFilter('all')}
              >
                All
              </button>
              <button 
                className={`filter-button bitcoin ${blockchainFilter === 'BTC' ? 'active' : ''}`}
                onClick={() => setBlockchainFilter('BTC')}
              >
                Bitcoin
              </button>
              <button 
                className={`filter-button ethereum ${blockchainFilter === 'ETH' ? 'active' : ''}`}
                onClick={() => setBlockchainFilter('ETH')}
              >
                Ethereum
              </button>
            </div>
          </div>
          <button
            onClick={refreshTransactionsFromDB}
            className="refresh-button db-refresh"
            disabled={isRefreshingFromDB}
          >
            {isRefreshingFromDB ? 'Loading...' : 'Refresh from Database'}
          </button>
          <button
            onClick={refreshTransactionsFromAPI}
            className="refresh-button api-refresh"
            disabled={isRefreshingFromAPI}
            title="Uses optimized time-based filtering to fetch multiple transactions in a single API call"
          >
            {isRefreshingFromAPI ? 'Refreshing...' : 'Refresh from API'}
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
            {filteredTransactions.map((tx) => (
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
                    className={`address-button ${!isAddressClickable(tx.sender) ? 'disabled' : ''}`}
                    onClick={() => navigateToWallet(tx.sender)}
                    disabled={!isAddressClickable(tx.sender)}
                  >
                    {formatAddress(tx.sender)}
                  </button>
                </td>
                <td>
                  <button
                    className={`address-button ${!isAddressClickable(tx.receiver) ? 'disabled' : ''}`}
                    onClick={() => navigateToWallet(tx.receiver)}
                    disabled={!isAddressClickable(tx.receiver)}
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
        totalPages={paginationData.pages}
        basePath="/transactions"
        queryParams={{ sort: sortOrder }}
      />
      
      <div className="transactions-info">
        Showing {filteredTransactions.length} of {paginationData.total} transactions
        {blockchainFilter !== 'all' && ` (filtered to ${blockchainFilter} only)`}
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