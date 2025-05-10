import { pgTable, text, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";

export const wallets = pgTable("wallets", {
  address: text("address").primaryKey(),
  chain: text("chain").notNull(), // 'BTC' | 'ETH'
  first_seen: timestamp("first_seen").defaultNow().notNull(),
  last_seen: timestamp("last_seen").defaultNow().notNull(),
  balance: numeric("balance", { precision: 36, scale: 18 }),
  transaction_count: numeric("transaction_count"),
  label: text("label"), // Optional user-set label for the wallet
  raw_payload: jsonb("raw_payload"), // last fetched data from Blockchair
}); 