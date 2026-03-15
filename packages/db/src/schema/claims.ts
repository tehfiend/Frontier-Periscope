import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./governance.js";

export const claimTypeEnum = pgEnum("claim_type", [
	"sovereignty",
	"mining",
	"trade_hub",
	"military",
]);
export const claimStatusEnum = pgEnum("claim_status", ["active", "contested", "expired"]);
export const disputeStatusEnum = pgEnum("dispute_status", ["open", "resolved", "escalated"]);

export const claims = pgTable("claims", {
	id: uuid("id").defaultRandom().primaryKey(),
	orgId: uuid("org_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	systemId: text("system_id").notNull(),
	claimType: claimTypeEnum("claim_type").notNull(),
	status: claimStatusEnum("status").notNull().default("active"),
	networkNodeId: text("network_node_id"),
	chainObjectId: text("chain_object_id"),
	claimedAt: timestamp("claimed_at").defaultNow().notNull(),
	expiresAt: timestamp("expires_at"),
});

export const claimDisputes = pgTable("claim_disputes", {
	id: uuid("id").defaultRandom().primaryKey(),
	claimId: uuid("claim_id")
		.notNull()
		.references(() => claims.id, { onDelete: "cascade" }),
	challengerOrgId: uuid("challenger_org_id")
		.notNull()
		.references(() => organizations.id),
	reason: text("reason").notNull(),
	status: disputeStatusEnum("status").notNull().default("open"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	resolvedAt: timestamp("resolved_at"),
});
