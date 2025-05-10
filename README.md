# Blockchain Tracker & Explorer

A full-stack application that tracks live blockchain activity via the Blockchair API, stores payloads in a PostgreSQL database, and displays data through a modern React UI.

## Quick Start

### Prerequisites

- Node.js (v16+)
- Docker and Docker Compose

### Environment Setup

1. Clone the repository:
```
git clone <repository-url>
cd blockchain-tracker
```

2. Start the PostgreSQL database:
```
docker-compose up -d
```

3. Install server dependencies:
```
cd apps/server
npm install
```

4. Create a `.env` file in the server directory:
```
PORT=5000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/blockchain
NODE_ENV=development
```

5. Install client dependencies:
```
cd ../client
npm install
```

6. Run the application:
```
# In server directory
npm run dev

# In client directory
npm run dev
```

7. Access the application at `http://localhost:5173`

## Architecture

This application follows a client-server architecture with these key components:

### Route Hierarchy

- Framework Mode React Router v7 with top-level data router
- Loaders and actions in `apps/client/src/routes/`
- Centralized error handling and data fetching

### DB Choice: PostgreSQL with Drizzle ORM

We chose PostgreSQL because:
- It offers robust JSON/JSONB support for blockchain data
- Complex queries for transaction and wallet analysis
- Better schema validation and type safety

Drizzle ORM provides:
- Type-safe schema definitions
- Efficient query building
- Simple migration management

### API Quota Handling

The application respects Blockchair's free-tier limits by:
- Using a maximum 60-second interval between API calls
- Limiting transaction fetch to the last 10 minutes (≤100 rows)
- Implementing a cache-first approach via the database

### Testing

- Unit tests for route loaders and API service functions
- Integration tests for database operations
- End-to-end flow tests for key user journeys

## Project Structure

```
blockchain-tracker/
├── apps/
│   ├── client/                       # Vite + React frontend
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── components/          # Shared UI (shadcn)
│   │   │   ├── pages/               # Route components
│   │   │   ├── routes/              # Route loaders/actions
│   │   │   ├── lib/                 # SSE handling, utils
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── index.css
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   │
│   └── server/                      # Express backend + Drizzle
│       ├── src/
│       │   ├── db/
│       │   │   ├── schema/          # drizzle schema definitions
│       │   │   ├── migrations/      # drizzle-kit migrations
│       │   │   └── client.ts        # drizzle + postgres pool
│       │   ├── routes/
│       │   │   ├── stats.ts         # /events/stats SSE stream
│       │   │   ├── transactions.ts  # recent txs endpoint
│       │   │   ├── wallet.ts        # /wallet/:address handler
│       │   │   └── search.ts        # /search?q= handler
│       │   ├── services/
│       │   │   ├── blockchair.ts    # API fetching logic
│       │   │   └── scheduler.ts     # interval tasks (stats, txs)
│       │   ├── utils/
│       │   │   └── logger.ts
│       │   ├── index.ts             # Entry point for Express app
│       │   └── env.ts               # dotenv/config handling
│       ├── drizzle.config.ts
│       └── tsconfig.json
│
├── docker/
│   └── init.sql                     # Optional seed or admin SQL
│
├── docker-compose.yml              # PostgreSQL + pgAdmin
├── .env                            # Shared environment variables
└── .gitignore
```

## Security Setup

This application uses environment variables for configuration. For security:

1. **Environment Configuration**:
   - Environment variables are loaded from `.env` files
   - In production, sensitive variables are required with no fallbacks
   - Development mode allows safe defaults for local testing only

2. **Docker Setup**:
   - Sensitive information is stored in separate environment files in the `config/` directory
   - Environment files are excluded from version control
   - Example templates are provided in `*.env.example` files

3. **Setup Instructions**:
   ```bash
   # Copy example files
   cp config/postgres.env.example config/postgres.env
   cp config/pgadmin.env.example config/pgadmin.env
   cp config/server.env.example config/server.env
   
   # Edit each file with secure credentials
   nano config/postgres.env
   nano config/pgadmin.env
   nano config/server.env
   
   # Start the application
   docker compose up -d
   ```

## Application Structure

- `apps/client`: Frontend React application
- `apps/server`: Backend Express API
- `config/`: Environment configuration (not committed to Git)

## Getting Started

See the `config/README.md` file for detailed setup instructions. 