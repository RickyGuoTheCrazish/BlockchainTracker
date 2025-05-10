import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

// Mock fetch globally for tests
globalThis.fetch = vi.fn() as unknown as typeof fetch;

// Mock environment variables
(window as any).API_BASE_URL = 'http://localhost:8000';

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
}); 