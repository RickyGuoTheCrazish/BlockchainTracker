import { useState } from "react";
import { useLoaderData, Form } from "react-router-dom";
import "./WalletsPage.css";

interface Wallet {
  id: string;
  address: string;
  name: string;
  balance: number;
  blockchain: string;
  created_at: string;
}

const WalletsPage = () => {
  const wallets = useLoaderData() as Wallet[];
  const [showAddForm, setShowAddForm] = useState(false);

  // Calculate total balance in BTC and ETH
  const totalBalances = wallets.reduce(
    (acc, wallet) => {
      if (wallet.blockchain === "bitcoin") {
        acc.btc += wallet.balance;
      } else if (wallet.blockchain === "ethereum") {
        acc.eth += wallet.balance;
      }
      return acc;
    },
    { btc: 0, eth: 0 }
  );

  // Function to format addresses for display
  const formatAddress = (address: string) => {
    if (!address) return "N/A";
    return `${address.substring(0, 10)}...${address.substring(address.length - 6)}`;
  };

  return (
    <div className="wallets-container">
      <div className="wallets-header">
        <h2>Tracked Wallets</h2>
        <button
          className="add-wallet-button"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? "Cancel" : "Add Wallet"}
        </button>
      </div>

      {showAddForm && (
        <div className="add-wallet-form-container">
          <h3>Add New Wallet</h3>
          <Form method="post" className="add-wallet-form">
            <div className="form-group">
              <label htmlFor="address">Wallet Address</label>
              <input
                type="text"
                id="address"
                name="address"
                required
                placeholder="Enter blockchain address"
              />
            </div>
            <div className="form-group">
              <label htmlFor="name">Wallet Name (Optional)</label>
              <input
                type="text"
                id="name"
                name="name"
                placeholder="Enter a name for this wallet"
              />
            </div>
            <div className="form-group">
              <label htmlFor="blockchain">Blockchain</label>
              <select id="blockchain" name="blockchain" required>
                <option value="bitcoin">Bitcoin</option>
                <option value="ethereum">Ethereum</option>
              </select>
            </div>
            <button type="submit" className="submit-button">
              Add Wallet
            </button>
          </Form>
        </div>
      )}

      {wallets.length > 0 ? (
        <>
          <div className="balance-summary">
            <div className="balance-card bitcoin">
              <h4>Total BTC</h4>
              <p>{totalBalances.btc.toFixed(8)} BTC</p>
            </div>
            <div className="balance-card ethereum">
              <h4>Total ETH</h4>
              <p>{totalBalances.eth.toFixed(8)} ETH</p>
            </div>
          </div>

          <div className="wallets-table-container">
            <table className="wallets-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Blockchain</th>
                  <th>Balance</th>
                  <th>Added On</th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((wallet) => (
                  <tr key={wallet.id}>
                    <td>{wallet.name || "Unnamed Wallet"}</td>
                    <td className="address-cell">
                      <a
                        href={`https://${
                          wallet.blockchain === "bitcoin"
                            ? "blockchain.info/address/"
                            : "etherscan.io/address/"
                        }${wallet.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {formatAddress(wallet.address)}
                      </a>
                    </td>
                    <td>
                      <span
                        className={`blockchain-badge ${wallet.blockchain}`}
                      >
                        {wallet.blockchain.charAt(0).toUpperCase() +
                          wallet.blockchain.slice(1)}
                      </span>
                    </td>
                    <td>
                      {wallet.balance.toFixed(8)}{" "}
                      {wallet.blockchain === "bitcoin" ? "BTC" : "ETH"}
                    </td>
                    <td>{new Date(wallet.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="no-wallets-message">
          <p>No wallets tracked yet. Add your first wallet to get started.</p>
        </div>
      )}
    </div>
  );
};

export default WalletsPage; 