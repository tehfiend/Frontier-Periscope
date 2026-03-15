import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

export const orgRoleEnum = pgEnum("org_role", ["owner", "admin", "member"]);
export const proposalStatusEnum = pgEnum("proposal_status", [
	"draft",
	"active",
	"passed",
	"rejected",
	"executed",
]);

export const organizations = pgTable("organizations", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	creatorId: uuid("creator_id")
		.notNull()
		.references(() => users.id),
	chainObjectId: text("chain_object_id"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orgMembers = pgTable("org_members", {
	id: uuid("id").defaultRandom().primaryKey(),
	orgId: uuid("org_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	role: orgRoleEnum("role").notNull().default("member"),
	joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const proposals = pgTable("proposals", {
	id: uuid("id").defaultRandom().primaryKey(),
	orgId: uuid("org_id")
		.notNull()
		.references(() => organizations.id, { onDelete: "cascade" }),
	title: text("title").notNull(),
	description: text("description").notNull(),
	status: proposalStatusEnum("status").notNull().default("draft"),
	creatorId: uuid("creator_id")
		.notNull()
		.references(() => users.id),
	votesFor: integer("votes_for").notNull().default(0),
	votesAgainst: integer("votes_against").notNull().default(0),
	startsAt: timestamp("starts_at").notNull(),
	endsAt: timestamp("ends_at").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const votes = pgTable("votes", {
	id: uuid("id").defaultRandom().primaryKey(),
	proposalId: uuid("proposal_id")
		.notNull()
		.references(() => proposals.id, { onDelete: "cascade" }),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id),
	support: integer("support").notNull(), // 1 = for, 0 = against
	createdAt: timestamp("created_at").defaultNow().notNull(),
});
