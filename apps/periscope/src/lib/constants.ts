// Shared constants used across multiple modules

/** Tables included in backup/export operations (intel + log data, NOT static stellar data). */
export const EXPORT_TABLES = [
	"deployables",
	"assemblies",
	"players",
	"locations",
	"killmails",
	"notes",
	"activities",
	"chatIntel",
	"targets",
	"targetEvents",
	"inventoryDiffs",
	"characters",
	"extensions",
	"permissionGroups",
	"groupMembers",
	"assemblyPolicies",
	"betrayalAlerts",
	"settings",
	"logEvents",
	"logSessions",
	"logOffsets",
] as const;

/** Tables that participate in P2P sync (excludes settings, log data, and cache metadata). */
export const SYNC_TABLES = [
	"deployables",
	"assemblies",
	"players",
	"locations",
	"killmails",
	"notes",
	"activities",
	"chatIntel",
	"targets",
	"targetEvents",
	"inventoryDiffs",
	"characters",
	"extensions",
	"permissionGroups",
	"groupMembers",
	"assemblyPolicies",
	"betrayalAlerts",
] as const;

/** Fuel warning thresholds (hours). */
export const FUEL_CRITICAL_HOURS = 6;
export const FUEL_WARNING_HOURS = 24;

/** Maximum age for killmail retention (30 days in ms). */
export const KILLMAIL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
