import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const syncedEvents = pgTable("synced_events", {
	id: uuid("id").defaultRandom().primaryKey(),
	eventType: text("event_type").notNull(),
	txDigest: text("tx_digest").notNull(),
	eventData: jsonb("event_data").notNull(),
	checkpoint: text("checkpoint").notNull(),
	syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export const smartObjectsCache = pgTable("smart_objects_cache", {
	id: uuid("id").defaultRandom().primaryKey(),
	objectId: text("object_id").notNull().unique(),
	objectType: text("object_type").notNull(),
	objectData: jsonb("object_data").notNull(),
	lastUpdated: timestamp("last_updated").defaultNow().notNull(),
});
