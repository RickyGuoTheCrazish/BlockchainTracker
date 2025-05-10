import { pgTable, serial, jsonb, timestamp, text } from "drizzle-orm/pg-core";

export const stats = pgTable("stats", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  raw_payload: jsonb("raw_payload").notNull(),
  // Add specific fields we care about for quick querying
  bitcoin_blocks: serial("bitcoin_blocks"),
  bitcoin_hashrate: text("bitcoin_hashrate"),
  bitcoin_mempool_transactions: serial("bitcoin_mempool_transactions"),
  bitcoin_market_price_usd: text("bitcoin_market_price_usd"),
  ethereum_blocks: serial("ethereum_blocks"),
  ethereum_hashrate: text("ethereum_hashrate"),
  ethereum_mempool_transactions: serial("ethereum_mempool_transactions"),
  ethereum_market_price_usd: text("ethereum_market_price_usd"),
}); 