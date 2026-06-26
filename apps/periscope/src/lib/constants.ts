// Shared constants used across multiple modules

/** Tables included in backup/export operations (intel + log data, NOT static stellar data). */
export const EXPORT_TABLES = [
	"deployables",
	"assemblies",
	"killmails",
	"characters",
	"extensions",
	"settings",
	"logEvents",
	"logSessions",
	"logOffsets",
] as const;

/**
 * Cycle-bound tables -- the CLEAR partition for the cycle-reset mechanism, and the single source
 * of truth for it. EVE Frontier re-mints every on-chain object with new ids at each cycle boundary,
 * so these tables are archived then `.clear()`ed on reset. Plan 28's V33 should reference this for
 * its chain-derived CLEAR subset.
 *
 * KEPT (NOT listed here): app preferences (`settings`, `cacheMetadata`, `logOffsets`), static
 * reference data (stellar / `celestials` / `gameTypes` -- each has its own version guard),
 * user-authored stores (`currencies`, `notes`, etc.), and harmless legacy/dropped stores.
 *
 * `sonarState` is intentionally excluded -- its two cursor rows have no archival value and are
 * re-seeded (`local` / `chain`) immediately after the clear.
 */
export const CYCLE_BOUND_TABLES = [
	// Characters (re-minted with new ids each cycle)
	"characters",
	// Structures / deployables
	"deployables",
	"assemblies",
	"extensions",
	"structureExtensionConfigs",
	"killmails",
	// Manifest caches
	"manifestCharacters",
	"manifestTribes",
	"manifestLocations",
	"manifestMarkets",
	"manifestRegistries",
	"manifestExchangePairs",
	// Private maps
	"manifestPrivateMapIndex",
	"manifestPrivateMaps",
	"manifestMapLocations",
	"manifestPrivateMapsV2",
	// Registry subscriptions
	"subscribedRegistries",
	"registryStandings",
	// Treasury
	"treasuries",
	// On-chain system claims
	"systemClaims",
	// Standings (cycle-bound)
	"contacts",
	"sonarWatchlist",
	// Sonar / log (LARGE -- archived for forensics, then cleared)
	"sonarEvents",
	"logEvents",
	"logSessions",
] as const;

/** Fuel warning thresholds (hours). */
export const FUEL_CRITICAL_HOURS = 6;
export const FUEL_WARNING_HOURS = 24;

/** Maximum age for killmail retention (30 days in ms). */
export const KILLMAIL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
