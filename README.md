# Blockchain Tracker

## Quick Start


- [ ] env files are uploaded to github for testing runs
- [ ] Start with Docker:
   - 1.docker compose build 
   - 2.docker compose up
   - or 
   - 1.docker-compose build 
   - 2.docker-compose up 
- [ ]frontend Access at http://localhost:5173
- [ ]backend Access at http://localhost:8000
- [ ]pgadmin Access at http://localhost:5050
- [ ]postgres at http://localhost:5432


## Architecture

### Route Hierarchy
- Using React Router with loaders/actions pattern
- Centralized route definitions in `apps/client/src/routes/index.tsx`
- Loaders fetch data before rendering components
- SSE wiring in `apps/client/src/lib/eventSource.ts` for real-time updates
- Caching strategy: Database as primary cache, client-side caching via React Query

### DB Choice: PostgreSQL with Drizzle ORM

- **Why PostgreSQL**: 
  - Better JSON/JSONB support for blockchain data
  - Complex transaction queries
  - Schema validation

- **Why Drizzle**:
  - Type-safe schema definitions
  - Efficient query building
  - Simple migrations

### API Quota Handling

- Respects Blockchair's free-tier limits:
  - Maximum 60-second interval between API calls
  - Request queue with priority system
  - Batch API endpoints for multiple transactions
  - Limits transaction fetch to 100 rows maximum

### Testing

- Unit tests for route loaders:
  - `apps/client/src/tests/unit/homeLoader.test.ts`

- E2E tests with Playwright:
  - `apps/client/src/tests/e2e/homepage.spec.ts`
