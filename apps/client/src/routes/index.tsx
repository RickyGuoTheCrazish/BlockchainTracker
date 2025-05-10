import { createBrowserRouter, redirect } from "react-router-dom";
import Layout from "../components/Layout";
import ErrorPage from "../pages/ErrorPage";
import HomePage from "../pages/HomePage";
import TransactionsPage from "../pages/TransactionsPage";
import WalletsPage from "../pages/WalletsPage";
import WalletDetailPage from "../pages/WalletDetailPage";
import SearchPage from "../pages/SearchPage";
import { API_BASE_URL } from "../lib/constants";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      {
        index: true,
        element: <HomePage />,
        loader: async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/stats/latest`);
            if (!response.ok) {
              console.error("Failed to fetch blockchain stats:", response.statusText);
              // Return default values if API fails
              return {
                bitcoin_blocks: 0,
                bitcoin_hashrate: 0,
                bitcoin_mempool_transactions: 0,
                bitcoin_market_price_usd: 0,
                ethereum_blocks: 0,
                ethereum_hashrate: 0,
                ethereum_mempool_transactions: 0,
                ethereum_market_price_usd: 0,
                timestamp: new Date().toISOString()
              };
            }
            const data = await response.json();
            return data;
          } catch (error) {
            console.error("Error loading initial stats:", error);
            // Return default values if API fails
            return {
              bitcoin_blocks: 0,
              bitcoin_hashrate: 0,
              bitcoin_mempool_transactions: 0,
              bitcoin_market_price_usd: 0,
              ethereum_blocks: 0,
              ethereum_hashrate: 0,
              ethereum_mempool_transactions: 0,
              ethereum_market_price_usd: 0,
              timestamp: new Date().toISOString()
            };
          }
        }
      },
      {
        path: "transactions",
        element: <TransactionsPage />,
        loader: async ({ request }) => {
          // Get pagination params from URL
          const url = new URL(request.url);
          const page = url.searchParams.get("page") || "1";
          const limit = url.searchParams.get("limit") || "20";
          const sort = url.searchParams.get("sort") || "desc";
          
          // Call the paginated endpoint with sort parameter
          const response = await fetch(`${API_BASE_URL}/transactions?page=${page}&limit=${limit}&sortOrder=${sort}`);
          if (!response.ok) {
            throw new Response("Failed to fetch transactions", { status: response.status });
          }
          return await response.json();
        }
      },
      {
        path: "wallets",
        element: <WalletsPage />,
        loader: async () => {
          const response = await fetch(`${API_BASE_URL}/wallets`);
          if (!response.ok) {
            throw new Response("Failed to fetch wallets", { status: response.status });
          }
          return await response.json();
        },
        action: async ({ request }) => {
          if (request.method === "POST") {
            const formData = await request.formData();
            const address = formData.get("address");
            const name = formData.get("name");
            
            const response = await fetch(`${API_BASE_URL}/wallets`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ address, name }),
            });
            
            if (!response.ok) {
              throw new Response("Failed to add wallet", { status: response.status });
            }
            
            return redirect("/wallets");
          }
          
          return null;
        }
      },
      {
        path: "wallets/:address",
        element: <WalletDetailPage />,
        loader: async ({ params }) => {
          try {
            const response = await fetch(`${API_BASE_URL}/wallets/${params.address}`);
            if (!response.ok) {
              // If we get a 500 error, it might be due to API rate limiting
              const status = response.status;
              if (status === 500) {
                return { 
                  error: true,
                  address: params.address,
                  errorMessage: "Unable to fetch wallet data. The blockchain API may be rate limited. Please try again later."
                };
              }
              throw new Response("Failed to fetch wallet details", { status });
            }
            return await response.json();
          } catch (error) {
            console.error("Error loading wallet details:", error);
            return { 
              error: true,
              address: params.address,
              errorMessage: "An error occurred while fetching wallet data. Please try again later."
            };
          }
        }
      },
      {
        path: "search",
        element: <SearchPage />,
        loader: async ({ request }) => {
          const url = new URL(request.url);
          const query = url.searchParams.get("q");
          
          if (!query) {
            return { 
              type: "general", 
              query: "", 
              transactions: [], 
              wallets: [] 
            };
          }
          
          const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
          
          if (!response.ok) {
            throw new Response("Failed to perform search", { status: response.status });
          }
          
          return await response.json();
        }
      }
    ]
  }
]); 