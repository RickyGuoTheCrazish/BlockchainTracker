import { useState, useEffect } from "react";
import { useLoaderData, Form, useNavigate } from "react-router-dom";
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
  const loadedWallets = useLoaderData() as Wallet[];
  const [wallets, setWallets] = useState<Wallet[]>(loadedWallets);
  const [showAddForm, setShowAddForm] = useState(false);
  const [useSimulatedData, setUseSimulatedData] = useState(loadedWallets.length === 0);
  const navigate = useNavigate();
  
  // Generate sample wallet addresses
  const generateWalletAddress = (isEthereum: boolean) => {
    if (isEthereum) {
      return '0x' + Array(40).fill(0).map(() => 
        Math.floor(Math.random() * 16).toString(16)).join('');
    } else {
      return 'bc1' + Array(40).fill(0).map(() => 
        Math.floor(Math.random() * 16).toString(16)).join('');
    }
  };
  
  // Generate simulated wallets
  const generateSimulatedWallets = () => {
    // Create 5 simulated wallets (3 BTC, 2 ETH)
    const simulatedWallets: Wallet[] = [
      {
        id: 'sim-1',
        address: generateWalletAddress(false),
        name: 'My Bitcoin Wallet',
        balance: 0.75431,
        blockchain: 'bitcoin',
        created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'sim-2',
        address: generateWalletAddress(false),
        name: 'BTC Storage',
        balance: 2.34128,
        blockchain: 'bitcoin',
        created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'sim-3',
        address: generateWalletAddress(false),
        name: 'Bitcoin Trading',
        balance: 0.01542,
        blockchain: 'bitcoin',
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'sim-4',
        address: generateWalletAddress(true),
        name: 'ETH Main',
        balance: 3.21547,
        blockchain: 'ethereum',
        created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'sim-5',
        address: generateWalletAddress(true),
        name: 'Ethereum Savings',
        balance: 10.54321,
        blockchain: 'ethereum',
        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      }
    ];
    
    setWallets(simulatedWallets);
    setUseSimulatedData(true);
    
    // Update the UI to show we're using simulated data
    const simulationNotice = document.createElement('div');
    simulationNotice.className = 'simulation-notice';
    simulationNotice.innerHTML = `
      <div class="simulation-banner">
        <strong>⚠️ Using simulated wallet data for demonstration</strong>
        <p>API rate limits were hit, so we're showing mock data instead.</p>
      </div>
    `;
    
    // Only add if it doesn't already exist
    if (!document.querySelector('.simulation-notice')) {
      document.body.insertBefore(simulationNotice, document.body.firstChild);
    }
  };
  
  // If no wallets are loaded, generate simulated data
  useEffect(() => {
    if (loadedWallets.length === 0 && !useSimulatedData) {
      generateSimulatedWallets();
    }
  }, [loadedWallets.length, useSimulatedData]);
  
  // Handle wallet form submission - in demo mode, just create a simulated wallet
  const handleAddWallet = (event: React.FormEvent) => {
    event.preventDefault();
    
    const formData = new FormData(event.target as HTMLFormElement);
    const address = formData.get('address') as string;
    const name = formData.get('name') as string || 'Unnamed Wallet';
    const blockchain = formData.get('blockchain') as string;
    
    // Create a new simulated wallet
    const newWallet: Wallet = {
      id: `sim-${wallets.length + 1}`,
      address,
      name,
      balance: Math.random() * (blockchain === 'bitcoin' ? 2 : 15),
      blockchain,
      created_at: new Date().toISOString()
    };
    
    setWallets(prevWallets => [...prevWallets, newWallet]);
    setShowAddForm(false);
    
    if (!useSimulatedData) {
      setUseSimulatedData(true);
      // Show simulation notice
      const simulationNotice = document.createElement('div');
      simulationNotice.className = 'simulation-notice';
      simulationNotice.innerHTML = `
        <div class="simulation-banner">
          <strong>⚠️ Using simulated wallet data for demonstration</strong>
          <p>Demo mode activated. New wallet data is simulated.</p>
        </div>
      `;
      if (!document.querySelector('.simulation-notice')) {
        document.body.insertBefore(simulationNotice, document.body.firstChild);
      }
    }
  };
  
  // Handle wallet click - navigate to a simulated wallet detail page
  const handleWalletClick = (wallet: Wallet) => {
    // Always navigate, not just in simulation mode
    navigate(`/wallets/${wallet.address}`);
  };

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
        <div className="wallet-header-actions">
          <button
            className="add-wallet-button"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? "Cancel" : "Add Wallet"}
          </button>
          
          {!useSimulatedData && wallets.length === 0 && (
            <button 
              className="use-demo-button"
              onClick={generateSimulatedWallets}
            >
              Use Demo Data
            </button>
          )}
        </div>
      </div>
      
      {useSimulatedData && (
        <div className="wallet-simulation-notice">
          <p>
            <strong>⚠️ Demo Mode:</strong> Showing simulated wallet data for demonstration purposes.
            This data is not real and is generated locally.
          </p>
        </div>
      )}

      {showAddForm && (
        <div className="add-wallet-form-container">
          <h3>Add New Wallet</h3>
          {useSimulatedData ? (
            <form className="add-wallet-form" onSubmit={handleAddWallet}>
              <div className="form-group">
                <label htmlFor="address">Wallet Address</label>
                <input
                  type="text"
                  id="address"
                  name="address"
                  required
                  placeholder="Enter blockchain address"
                  defaultValue={generateWalletAddress(false)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="name">Wallet Name</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  placeholder="Enter a name for this wallet"
                  defaultValue="My Demo Wallet"
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
                Add Simulated Wallet
              </button>
            </form>
          ) : (
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
          )}
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
                  <tr key={wallet.id} onClick={() => handleWalletClick(wallet)} className="clickable-row">
                    <td>{wallet.name || "Unnamed Wallet"}</td>
                    <td className="address-cell">
                      {useSimulatedData ? (
                        <span className="wallet-address-text">{formatAddress(wallet.address)}</span>
                      ) : (
                        <a
                          href={`https://${
                            wallet.blockchain === "bitcoin"
                              ? "blockchain.info/address/"
                              : "etherscan.io/address/"
                          }${wallet.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {formatAddress(wallet.address)}
                        </a>
                      )}
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
          <button 
            className="use-demo-button large" 
            onClick={generateSimulatedWallets}
          >
            Use Demo Data
          </button>
        </div>
      )}
    </div>
  );
};

export default WalletsPage; 