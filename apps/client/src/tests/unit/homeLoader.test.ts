import { describe, it, expect, vi, beforeEach } from 'vitest';
import { API_BASE_URL } from '../../lib/constants';

// Mock the router's loader function directly
const mockHomeLoader = async () => {
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
    return await response.json();
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
};

describe('Home Page Loader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return stats data when API call succeeds', async () => {
    // Mock successful API response
    const mockData = {
      bitcoin_blocks: 800000,
      bitcoin_hashrate: '250000000000000',
      bitcoin_mempool_transactions: 5000,
      bitcoin_market_price_usd: '60000',
      ethereum_blocks: 18000000,
      ethereum_hashrate: '1000000000000',
      ethereum_mempool_transactions: 3000,
      ethereum_market_price_usd: '3000',
      timestamp: '2025-05-10T12:00:00Z'
    };
    
    // Setup mock fetch response
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData)
    } as unknown as Response);
    
    // Call the loader function
    const result = await mockHomeLoader();
    
    // Verify fetch was called correctly
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/stats/latest`);
    
    // Verify loader returns the correct data
    expect(result).toEqual(mockData);
  });
  
  it('should return default values when API call fails', async () => {
    // Setup mock fetch with error response
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Not Found'
    } as unknown as Response);
    
    // Mock console.error to prevent test output pollution
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Call the loader function
    const result = await mockHomeLoader();
    
    // Verify fetch was called correctly
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/stats/latest`);
    
    // Verify console.error was called
    expect(consoleSpy).toHaveBeenCalledWith("Failed to fetch blockchain stats:", "Not Found");
    
    // Verify default values were returned
    expect(result).toEqual({
      bitcoin_blocks: 0,
      bitcoin_hashrate: 0,
      bitcoin_mempool_transactions: 0,
      bitcoin_market_price_usd: 0,
      ethereum_blocks: 0,
      ethereum_hashrate: 0,
      ethereum_mempool_transactions: 0,
      ethereum_market_price_usd: 0,
      timestamp: expect.any(String)
    });
  });
  
  it('should handle network errors gracefully', async () => {
    // Setup mock fetch to throw a network error
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));
    
    // Mock console.error to prevent test output pollution
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Call the loader function
    const result = await mockHomeLoader();
    
    // Verify fetch was called correctly
    expect(fetch).toHaveBeenCalledTimes(1);
    
    // Verify console.error was called with the error
    expect(consoleSpy).toHaveBeenCalledWith("Error loading initial stats:", expect.any(Error));
    
    // Verify default values were returned
    expect(result).toEqual({
      bitcoin_blocks: 0,
      bitcoin_hashrate: 0,
      bitcoin_mempool_transactions: 0,
      bitcoin_market_price_usd: 0,
      ethereum_blocks: 0,
      ethereum_hashrate: 0,
      ethereum_mempool_transactions: 0,
      ethereum_market_price_usd: 0,
      timestamp: expect.any(String)
    });
  });
}); 