import { useLoaderData, useSearchParams, Link } from "react-router-dom";
import "./SearchPage.css";

interface SearchResult {
  type: string;
  query: string;
  transactions: any[];
  wallets: any[];
}

const SearchPage = () => {
  const searchResult = useLoaderData() as SearchResult;
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";

  // Format addresses for display
  const formatAddress = (address: string) => {
    if (!address) return "N/A";
    return `${address.substring(0, 10)}...${address.substring(address.length - 6)}`;
  };

  return (
    <div className="search-results-container">
      <h2>Search Results for "{query}"</h2>
      
      {searchResult.transactions.length === 0 && searchResult.wallets.length === 0 && (
        <div className="no-results">
          <p>No results found for your search query. Try a different search term.</p>
        </div>
      )}
      
      {searchResult.wallets.length > 0 && (
        <div className="result-section">
          <h3>Wallets</h3>
          <div className="wallets-list">
            {searchResult.wallets.map((wallet: any) => (
              <div key={wallet.address} className="wallet-item">
                <h4>
                  <Link to={`/wallets/${wallet.address}`}>
                    {wallet.label || formatAddress(wallet.address)}
                  </Link>
                </h4>
                <div className="wallet-details">
                  <div>
                    <span className="label">Chain:</span> {wallet.chain}
                  </div>
                  <div>
                    <span className="label">Balance:</span> {wallet.balance?.toLocaleString() || "0"}
                  </div>
                  <div>
                    <span className="label">Transactions:</span> {wallet.transaction_count?.toLocaleString() || "0"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {searchResult.transactions.length > 0 && (
        <div className="result-section">
          <h3>Transactions</h3>
          <table className="transactions-table">
            <thead>
              <tr>
                <th>Hash</th>
                <th>Chain</th>
                <th>Value</th>
                <th>From</th>
                <th>To</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {searchResult.transactions.map((tx: any) => (
                <tr key={tx.hash}>
                  <td>
                    <Link to={`/transactions/${tx.hash}`}>
                      {tx.hash.substring(0, 10)}...
                    </Link>
                  </td>
                  <td>{tx.chain}</td>
                  <td>{typeof tx.value === 'number' ? tx.value.toLocaleString() : 'N/A'}</td>
                  <td>{formatAddress(tx.sender)}</td>
                  <td>{formatAddress(tx.receiver)}</td>
                  <td>{new Date(tx.block_time).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SearchPage; 