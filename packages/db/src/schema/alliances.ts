import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./governance.js";
import { users } from "./auth.js";

export const allianceStatusEnum = pgEnum("alliance_status", ["active", "dissolved"]);
export const agreementTypeEnum = pgEnum("agreement_type", [
	"mutual_defense",
	"trade",
	"non_aggression",
	"resource_sharing",
]);
export const agreementStatusEnum = pgEnum("agreement_status", [
	"proposed",
	"active",
	"expired",
	"terminated",
]);

export const alliances = pgTable("alliances", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	status: allianceStatusEnum("status").notNull().default("active"),
	founderOrgId: uuid("founder_org_id")
		.notNull()
		.references(() => organizations.id),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const allianceMembers = pgTable("alliance_members", {
	id: uuid("id").defaultRandom().primaryKey(),
	allianceId: uuid("alliance_id")
		.notNull()
		.references(() => alliances.id, { onDelete: "cascade" }),
	orgId: uuid("org_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const agreements = pgTable("agreements", {
	id: uuid("id").defaultRandom().primaryKey(),
	allianceId: uuid("alliance_id")
		.notNull()
		.references(() => alliances.id, { onDelete: "cascade" }),
	type: agreementTypeEnum("type").notNull(),
	title: text("title").notNull(),
	terms: text("terms").notNull(),
	status: agreementStatusEnum("status").notNull().default("proposed"),
	proposedBy: uuid("proposed_by")
		.notNull()
		.references(() => users.id),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	expiresAt: timestamp("expires_at"),
});
