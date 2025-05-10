import { pgTable, text, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";

export const transactions = pgTable("transactions", {
  hash: text("hash").primaryKey(),
  chain: text("chain").notNull(), // 'BTC' | 'ETH'
  block_number: numeric("block_number"),
  block_time: timestamp("block_time").notNull(),
  value: text("value"), // Store as text to avoid numeric overflow
  fee: text("fee"), // Store as text to avoid numeric overflow
  sender: text("sender"),
  receiver: text("receiver"),
  status: text("status"), // 'confirmed', 'pending', etc.
  raw_payload: jsonb("raw_payload"), // full JSON blob from Blockchair
}); 