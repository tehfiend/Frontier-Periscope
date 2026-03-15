import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

export const contractStatusEnum = pgEnum("contract_status", [
	"open",
	"accepted",
	"completed",
	"cancelled",
	"disputed",
]);

export const tradeContracts = pgTable("trade_contracts", {
	id: uuid("id").defaultRandom().primaryKey(),
	creatorId: uuid("creator_id")
		.notNull()
		.references(() => users.id),
	acceptorId: uuid("acceptor_id").references(() => users.id),
	title: text("title").notNull(),
	description: text("description"),
	status: contractStatusEnum("status").notNull().default("open"),
	itemTypeId: text("item_type_id").notNull(),
	quantity: integer("quantity").notNull(),
	pricePerUnit: text("price_per_unit").notNull(),
	location: text("location").notNull(),
	chainTxId: text("chain_tx_id"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	expiresAt: timestamp("expires_at"),
});

export const marketSnapshots = pgTable("market_snapshots", {
	id: uuid("id").defaultRandom().primaryKey(),
	itemTypeId: text("item_type_id").notNull(),
	avgPrice: text("avg_price").notNull(),
	volume: integer("volume").notNull(),
	snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
});
