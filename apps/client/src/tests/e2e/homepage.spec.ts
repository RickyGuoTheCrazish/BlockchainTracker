import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('should load homepage and display blockchain stats', async ({ page }) => {
    // Mock API response for stats
    await page.route('**/api/stats/latest', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          bitcoin_blocks: 800000,
          bitcoin_hashrate: '250000000000000',
          bitcoin_mempool_transactions: 5000,
          bitcoin_market_price_usd: '60000',
          ethereum_blocks: 18000000,
          ethereum_hashrate: '1000000000000',
          ethereum_mempool_transactions: 3000,
          ethereum_market_price_usd: '3000',
          timestamp: new Date().toISOString()
        })
      });
    });

    // Go to the homepage
    await page.goto('/');
    
    // Check if the page title is present
    const title = page.locator('h1:has-text("Blockchain Tracker")');
    await expect(title).toBeVisible();
    
    // Check if Bitcoin stats are displayed
    const bitcoinCard = page.locator('.stat-card:has-text("Bitcoin")');
    await expect(bitcoinCard).toBeVisible();
    
    // Check if the Bitcoin price is displayed correctly
    const bitcoinPrice = page.locator('.stat-card:has-text("Bitcoin") .stat-price');
    await expect(bitcoinPrice).toContainText('$60,000');
    
    // Check if Ethereum stats are displayed
    const ethereumCard = page.locator('.stat-card:has-text("Ethereum")');
    await expect(ethereumCard).toBeVisible();
    
    // Check if the Ethereum price is displayed correctly
    const ethereumPrice = page.locator('.stat-card:has-text("Ethereum") .stat-price');
    await expect(ethereumPrice).toContainText('$3,000');
  });
  
  test('should navigate to transactions page when clicking Transactions', async ({ page }) => {
    // Go to the homepage
    await page.goto('/');
    
    // Click on the Transactions link in the navigation
    await page.click('nav a:has-text("Transactions")');
    
    // Check if we're on the transactions page
    await expect(page).toHaveURL(/.*\/transactions/);
    
    // Verify transactions page title is shown
    const title = page.locator('h2:has-text("Recent Transactions")');
    await expect(title).toBeVisible();
  });
}); 