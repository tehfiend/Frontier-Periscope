// ── Static Data Types ────────────────────────────────────────────────────────

export interface SolarSystem {
	id: number;
	name?: string;
	center: [number, number, number];
	constellationId: number;
	regionId: number;
	neighbours: number[];
	factionId?: number | null;
	sunTypeId?: number;
	planetCount?: number;
	planetCountByType?: Record<number, number>;
	planetItemIds?: number[];
}

export interface Constellation {
	id: number;
	name?: string;
	center: [number, number, number];
	neighbours: number[];
	solarSystemIds: number[];
	regionId: number;
}

export interface Region {
	id: number;
	name?: string;
	center: [number, number, number];
	neighbours: number[];
	solarSystemIds: number[];
	constellationIds: number[];
}

export interface Jump {
	fromSystemId: number;
	toSystemId: number;
}

export interface Celestial {
	id: number; // celestialID
	systemId: number; // solarSystemID
	index: number; // celestialIndex (planet number 1-13)
	typeId: number; // planet type (11, 12, 13, 2014-2016, 2063)
	x: number; // position relative to sun (meters)
	y: number;
	z: number;
}

export interface GameType {
	id: number;
	name: string;
	description: string;
	mass: number;
	radius: number;
	volume: number;
	portionSize: number;
	groupName: string;
	groupId: number;
	categoryName: string;
	categoryId: number;
	iconUrl: string;
}

// ── Sync Metadata ───────────────────────────────────────────────────────────

export interface SyncMeta {
	_hlc?: string;
	_deleted?: boolean;
	_origin?: string;
}

// ── Intel Types ──────────────────────────────────────────────────────────────

export type IntelSource = "chain" | "api" | "log" | "manual";
export type ThreatLevel = "unknown" | "friendly" | "neutral" | "hostile" | "critical";
export type AssemblyStatus =
	| "online"
	| "offline"
	| "anchoring"
	| "unanchoring"
	| "destroyed"
	| "unknown";

export interface IntelBase extends SyncMeta {
	id: string;
	createdAt: string;
	updatedAt: string;
	source: IntelSource;
	tags: string[];
}

export interface DeployableIntel extends IntelBase {
	objectId: string;
	assemblyType: string;
	owner?: string; // Sui address of the owning character
	status: AssemblyStatus;
	label: string;
	systemId?: number;
	lPoint?: string; // "P{n}-L{m}" e.g. "P2-L3" or "L1"-"L5" for legacy
	fuelLevel?: number;
	fuelExpiresAt?: string;
	position?: [number, number, number];
	notes?: string;
	/** In-game item ID from TenantItemId (needed for dApp URL) */
	itemId?: string;
	/** Custom dApp URL set on the assembly metadata (if any) */
	dappUrl?: string;
	/** OwnerCap object ID (needed for on-chain rename) */
	ownerCapId?: string;
	/** Move module name for this assembly (e.g. "turret", "gate", "network_node") */
	assemblyModule?: string;
	/** Character Sui object ID (needed for borrow_owner_cap PTB step) */
	characterObjectId?: string;
	/** Parent structure ID (reference to another deployable or assembly) */
	parentId?: string;
	/** On-chain extension TypeName (e.g. "0xabc::turret_priority::TurretPriorityAuth") */
	extensionType?: string;
}

export interface AssemblyIntel extends IntelBase {
	objectId: string;
	assemblyType: string;
	owner: string;
	status: AssemblyStatus;
	systemId?: number;
	lPoint?: string; // "P{n}-L{m}" e.g. "P2-L3" or "L1"-"L5" for legacy
	label?: string;
	notes?: string;
	/** Parent structure ID (reference to another deployable or assembly) */
	parentId?: string;
	/** On-chain extension TypeName (e.g. "0xabc::turret_priority::TurretPriorityAuth") */
	extensionType?: string;
}

export interface PlayerIntel extends IntelBase {
	address: string;
	name: string;
	threat: ThreatLevel;
	tribe?: string;
	lastSeenSystem?: number;
	lastSeenAt?: string;
	notes?: string;
}

export interface LocationIntel extends IntelBase {
	name: string;
	systemId: number;
	category: string;
	coordinates?: [number, number, number];
	notes?: string;
}

export interface KillmailIntel extends IntelBase {
	killmailId: string;
	victim: string;
	finalBlow: string;
	involved: string[];
	timestamp: string;
	systemId?: number;
}

export interface ChatIntelEntry extends IntelBase {
	channel: string;
	reporter: string;
	systemId: number;
	rawMessage: string;
	reportedPlayers: string[];
	severity: "low" | "medium" | "high";
	expiresAt: string;
}

// ── Character Types ─────────────────────────────────────────────────────────

export type CharacterSource = "log" | "wallet" | "manual";

export interface CharacterRecord extends SyncMeta {
	id: string; // characterId from log filenames (e.g. "2112077599"), or UUID for manual entries
	characterId?: string; // Numeric character ID from logs (in-game item_id)
	characterName: string; // From log header "Listener:" field
	suiAddress?: string; // Sui address (resolved from chain or manually linked)
	tenant?: string; // Tenant this character belongs to (stillness/utopia)
	tribe?: string; // Tribe name (resolved from chain)
	tribeId?: number; // Tribe ID (from chain)
	source?: CharacterSource; // How this character was discovered
	manifestId?: string; // Link to ManifestCharacter.id (Sui object ID)
	isActive: boolean; // Currently has an open game client (log watcher detected)
	lastSeenAt?: string; // Last log event timestamp
	createdAt: string;
	updatedAt: string;
}

// ── App State Types ──────────────────────────────────────────────────────────

export interface SettingsEntry {
	key: string;
	value: unknown;
}

export interface CacheMetadataEntry {
	key: string;
	version: string;
	importedAt: string;
	counts?: Record<string, number>;
}

export interface LogOffset {
	fileName: string;
	byteOffset: number;
	lastModified: number;
}

// ── Extension Manager Types ─────────────────────────────────────────────────

export type ExtensionStatus = "authorized" | "configured" | "failed";

export interface ExtensionRecord extends SyncMeta {
	id: string;
	assemblyId: string;
	assemblyType:
		| "turret"
		| "gate"
		| "storage_unit"
		| "smart_storage_unit"
		| "network_node"
		| "protocol_depot";
	templateId: string;
	templateName: string;
	status: ExtensionStatus;
	txDigest?: string;
	configuration?: Record<string, unknown>;
	authorizedAt?: string;
	owner: string; // Sui address
	createdAt: string;
	updatedAt: string;
}

// ── Structure Extension Config (standings-based) ────────────────────────────

export interface StructureExtensionConfig {
	/** Primary key -- same as assemblyId */
	id: string;
	assemblyId: string;
	assemblyType: string;
	registryId: string;
	registryName?: string;
	// Gate-specific
	minAccess?: number;
	freeAccess?: number;
	/** Toll fee stored as string (bigint serialised for IndexedDB) */
	tollFee?: string;
	tollRecipient?: string;
	permitDurationMs?: number;
	// SSU-specific
	minDeposit?: number;
	minWithdraw?: number;
	marketId?: string;
	// Turret-specific
	standingWeights?: Record<number, number>;
	aggressorBonus?: number;
}

// ── Permission Group Types (deprecated -- replaced by StandingsRegistry) ────

/** @deprecated Use StandingsRegistry + contacts instead. Kept for DB migration. */
export interface PermissionGroup extends SyncMeta {
	id: string;
	name: string;
	color: string;
	isBuiltin: boolean;
	description?: string;
	createdAt: string;
	updatedAt: string;
}

/** @deprecated Use StandingsRegistry + contacts instead. */
export type MemberKind = "character" | "tribe";

/** @deprecated Use StandingsRegistry + contacts instead. Kept for DB migration. */
export interface GroupMember extends SyncMeta {
	id: string;
	groupId: string;
	kind: MemberKind;
	characterName?: string;
	characterId?: number;
	suiAddress?: string;
	tribeId?: number;
	tribeName?: string;
	createdAt: string;
}

// ── Betrayal Alert Types (deprecated -- removed in v29) ─────────────────────

/** @deprecated Removed in v29. Kept for type reference during migration. */
export type AlertStatus = "pending" | "acted" | "dismissed";

/** @deprecated Removed in v29. Kept for type reference during migration. */
export interface BetrayalAlert extends SyncMeta {
	id: string;
	attackerCharacterId?: number;
	attackerAddress?: string;
	attackerName?: string;
	attackerTribeId?: number;
	victimAssemblyId?: string;
	source: "killmail" | "manual";
	killmailId?: string;
	foundInGroups: string[];
	status: AlertStatus;
	actionTaken?: string;
	createdAt: string;
	updatedAt: string;
}

/** @deprecated Replaced by StandingsRegistry. */
export type PolicyMode = "allowlist" | "denylist";
/** @deprecated Replaced by StandingsRegistry. */
export type SyncStatus = "draft" | "dirty" | "syncing" | "synced" | "error";

/** @deprecated Replaced by StructureExtensionConfig. Kept for DB migration. */
export interface AssemblyPolicy extends SyncMeta {
	id: string;
	assemblyId: string;
	assemblyType:
		| "turret"
		| "gate"
		| "storage_unit"
		| "smart_storage_unit"
		| "network_node"
		| "protocol_depot";
	mode: PolicyMode;
	groupIds: string[];
	permitDurationMs?: number;
	defaultPriority?: number;
	friendlyPriority?: number;
	hostilePriority?: number;
	syncStatus: SyncStatus;
	lastSyncedAt?: string;
	syncError?: string;
	syncTxDigest?: string;
	extensionTemplateId?: string;
	createdAt: string;
	updatedAt: string;
}

// ── Log Analyzer Types ──────────────────────────────────────────────────────

export type LogEventType =
	| "mining"
	| "combat_dealt"
	| "combat_received"
	| "miss_dealt"
	| "miss_received"
	| "structure_departed"
	| "gate_offline"
	| "build_fail"
	| "dismantle"
	| "notify"
	| "info"
	| "hint"
	| "question"
	| "system_change"
	| "chat";

export interface LogEvent {
	id?: number;
	sessionId: string;
	timestamp: string;
	type: LogEventType;
	// Mining
	ore?: string;
	amount?: number;
	// Combat
	target?: string;
	damage?: number;
	weapon?: string;
	hitQuality?: string;
	// Travel / Structures
	systemName?: string;
	structureName?: string;
	// Chat
	speaker?: string;
	channel?: string;
	// Notify/other
	message?: string;
	// Raw log line
	raw: string;
}

export interface LogSession {
	id: string;
	characterName: string;
	characterId?: string;
	startedAt: string;
	fileSize: number;
	eventCount: number;
}

// ── Manifest (Local Chain Cache) ───────────────────────────────────────────

export interface ManifestCharacter {
	/** Sui object ID of the Character */
	id: string;
	/** In-game character ID (item_id from TenantItemId) */
	characterItemId: string;
	/** Character name from metadata */
	name: string;
	/** Sui address (character_address field) */
	suiAddress: string;
	/** Tribe ID */
	tribeId: number;
	/** Tenant (stillness/utopia) */
	tenant: string;
	/** OwnerCap object ID */
	ownerCapId?: string;
	/** When this character was created on-chain (from tx timestamp) */
	createdOnChain?: string;
	/** X25519 public key derived from wallet, hex-encoded. Used for private map encryption. */
	mapKeyPublicHex?: string;
	/** X25519 secret key derived from wallet, hex-encoded. Used for private map decryption. */
	mapKeySecretHex?: string;
	/** When this entry was last fetched from chain */
	cachedAt: string;
	/** Set when the character object no longer exists on-chain (deleted/destroyed) */
	deletedAt?: string;
}

export interface ManifestTribe {
	/** Tribe ID */
	id: number;
	name: string;
	nameShort: string;
	description: string;
	taxRate: number;
	tribeUrl: string;
	/** Tenant this was fetched from */
	tenant: string;
	/** When this tribe was created (from API or first seen) */
	createdOnChain?: string;
	/** When this entry was last fetched */
	cachedAt: string;
}

export interface ManifestLocation {
	/** Assembly (structure) object ID -- primary key (from event.assembly_id) */
	id: string;
	/** In-game item ID from TenantItemId.item_id (from event.assembly_key.item_id) */
	assemblyItemId: string;
	/** Assembly type ID (u64, maps to ASSEMBLY_TYPE_IDS in config.ts) */
	typeId: number;
	/** Owner cap object ID */
	ownerCapId: string;
	/** Solar system ID */
	solarsystem: number;
	/** Raw X coordinate (string, supports negatives -- matches on-chain String type) */
	x: string;
	/** Raw Y coordinate */
	y: string;
	/** Raw Z coordinate */
	z: string;
	/** Resolved L-point label (e.g. "P2-L3") -- computed from coords + celestials */
	lPoint?: string;
	/** Tenant (stillness/utopia -- extracted from event.assembly_key.tenant) */
	tenant: string;
	/** When this location was revealed on-chain (from event tx timestamp) */
	revealedAt: string;
	/** Data source: "public" for LocationRevealedEvent, "private-map" for private map merge */
	source?: "public" | "private-map";
	/** When this entry was last cached */
	cachedAt: string;
}

export interface ManifestMarket {
	/** Market<T> object ID */
	id: string;
	/** Package that defined this Market<T> */
	packageId: string;
	/** Creator Sui address */
	creator: string;
	/** Authorized minter addresses */
	authorized: string[];
	feeBps: number;
	feeRecipient: string;
	nextSellId: number;
	nextBuyId: number;
	/** Full coin type string */
	coinType: string;
	totalSupply?: number;
	/** When this entry was last cached */
	cachedAt: string;
	// No tenant -- market packageId is shared across tenants
}

export interface ManifestRegistry {
	/** StandingsRegistry object ID */
	id: string;
	/** Owner Sui address */
	owner: string;
	admins: string[];
	name: string;
	ticker: string;
	/** Raw u8 standing (0-6) */
	defaultStanding: number;
	/** When this entry was last cached */
	cachedAt: string;
	// No tenant -- standingsRegistry packageId is shared across tenants
}

export interface ManifestPrivateMapIndex {
	/** Map object ID */
	id: string;
	/** V1 or V2 */
	version: 1 | 2;
	name: string;
	creator: string;
	/** 0=encrypted, 1=cleartext standings (V2 only; V1 always 0) */
	mode: number;
	/** StandingsRegistry ID (V2 mode=1 only) */
	registryId?: string;
	tenant: string;
	/** When this entry was last cached */
	cachedAt: string;
}

// ── Private Map Types ───────────────────────────────────────────────────────

export interface ManifestPrivateMap {
	/** PrivateMap object ID (primary key) */
	id: string;
	/** Map name */
	name: string;
	/** Creator address */
	creator: string;
	/** Hex-encoded X25519 public key */
	publicKey: string;
	/** Hex-encoded decrypted map secret key (populated on-demand when key is available) */
	decryptedMapKey?: string;
	/** Hex-encoded encrypted map key from the MapInvite (for later decryption) */
	encryptedMapKey?: string;
	/** The user's MapInvite object ID */
	inviteId: string;
	/** "stillness" or "utopia" */
	tenant: string;
	/** ISO timestamp */
	cachedAt: string;
}

export interface ManifestMapLocation {
	/** Composite key: "{mapId}:{locationId}" */
	id: string;
	/** PrivateMap object ID */
	mapId: string;
	/** Location ID within the map */
	locationId: number;
	/** Optional structure link */
	structureId: string | null;
	/** Decrypted solar system ID */
	solarSystemId: number;
	/** Decrypted planet number */
	planet: number;
	/** Decrypted L-point number */
	lPoint: number;
	/** Decrypted description (empty if none) */
	description: string;
	/** Address that added this location */
	addedBy: string;
	/** Timestamp ms */
	addedAtMs: number;
	/** "stillness" or "utopia" */
	tenant: string;
	/** ISO timestamp */
	cachedAt: string;
}

// ── Private Map V2 Types ────────────────────────────────────────────────────

export interface ManifestPrivateMapV2 {
	/** PrivateMapV2 object ID (primary key) */
	id: string;
	/** Map name */
	name: string;
	/** Creator address */
	creator: string;
	/** Editor addresses */
	editors: string[];
	/** 0 = encrypted (invite-only), 1 = cleartext standings */
	mode: number;
	/** Hex-encoded X25519 public key (mode=0 only) */
	publicKey?: string;
	/** Hex-encoded decrypted map secret key (mode=0, populated on-demand) */
	decryptedMapKey?: string;
	/** Hex-encoded encrypted map key from the MapInviteV2 (mode=0) */
	encryptedMapKey?: string;
	/** The user's MapInviteV2 object ID (mode=0) */
	inviteId?: string;
	/** StandingsRegistry object ID (mode=1) */
	registryId?: string;
	/** Minimum standing to view locations (mode=1, client-enforced) */
	minReadStanding?: number;
	/** Minimum standing to add locations (mode=1) */
	minWriteStanding?: number;
	/** "stillness" or "utopia" */
	tenant: string;
	/** ISO timestamp */
	cachedAt: string;
}

// ── Standings Types ─────────────────────────────────────────────────────────

export interface ManifestStandingsList {
	/** StandingsList object ID (primary key) */
	id: string;
	/** List name */
	name: string;
	/** List description */
	description: string;
	/** Creator address */
	creator: string;
	/** Hex-encoded X25519 public key */
	publicKey: string;
	/** Hex-encoded decrypted list secret key (populated after decryption) */
	decryptedListKey?: string;
	/** Hex-encoded encrypted list key from the StandingsInvite */
	encryptedListKey?: string;
	/** The user's StandingsInvite object ID */
	inviteId: string;
	/** Editor addresses authorized to modify standings */
	editors: string[];
	/** Whether the current user is an editor */
	isEditor: boolean;
	/** "stillness" or "utopia" */
	tenant: string;
	/** ISO timestamp */
	cachedAt: string;
}

export interface ManifestStandingEntry {
	/** Composite key: "{listId}:{entryId}" */
	id: string;
	/** StandingsList object ID */
	listId: string;
	/** Entry ID within the list */
	entryId: number;
	/** Entry kind */
	kind: "character" | "tribe";
	/** Character ID (when kind=character) */
	characterId?: number;
	/** Tribe ID (when kind=tribe) */
	tribeId?: number;
	/** Standing value (-3 to +3) */
	standing: number;
	/** Human-readable standing label */
	label: string;
	/** Description / notes */
	description: string;
	/** Address that added this entry */
	addedBy: string;
	/** Last updated timestamp (ms) */
	updatedAtMs: number;
	/** "stillness" or "utopia" */
	tenant: string;
	/** ISO timestamp */
	cachedAt: string;
}

// ── Contacts Types (local-only, not on-chain) ──────────────────────────────

export interface Contact {
	/** UUID */
	id: string;
	kind: "character" | "tribe";
	characterId?: number;
	characterName?: string;
	tribeId?: number;
	tribeName?: string;
	/** Standing value (-3 to +3) */
	standing: number;
	/** Human-readable standing label */
	label: string;
	/** Free-text private notes */
	notes: string;
	createdAt: string;
	updatedAt: string;
}

// ── Registry Subscription Types ─────────────────────────────────────────────

export interface SubscribedRegistry {
	/** StandingsRegistry object ID */
	id: string;
	name: string;
	ticker: string;
	/** Creator Sui address */
	creator: string;
	/** Resolved character name for creator */
	creatorName?: string;
	defaultStanding: number;
	subscribedAt: string;
	lastSyncedAt?: string;
	/** "stillness" or "utopia" */
	tenant: string;
}

export interface RegistryStanding {
	/** Composite key: "{registryId}:{kind}:{entityId}" */
	id: string;
	registryId: string;
	kind: "character" | "tribe";
	characterId?: number;
	tribeId?: number;
	/** Standing value (0-6, raw u8) */
	standing: number;
	/** ISO timestamp */
	cachedAt: string;
}

// ── Governance Types ────────────────────────────────────────────────────────

export type OrgTier = "stakeholder" | "member" | "serf" | "opposition";

export interface OrganizationRecord extends SyncMeta {
	id: string;
	name: string;
	chainObjectId?: string;
	orgMarketId?: string;
	creator: string;
	createdAt: string;
	updatedAt: string;
}

// ── Trade Node Types ────────────────────────────────────────────────────────

export interface TradeNodeRecord {
	id: string; // SSU objectId
	name: string;
	marketConfigId?: string;
	enabledAt: string; // ISO timestamp
}

export interface OrgTierMember extends SyncMeta {
	id: string;
	orgId: string;
	tier: OrgTier;
	kind: MemberKind;
	characterName?: string;
	characterId?: number;
	suiAddress?: string;
	tribeId?: number;
	tribeName?: string;
	createdAt: string;
}

export type ClaimStatus = "active" | "contested" | "removed";

export interface SystemClaimRecord extends SyncMeta {
	id: string;
	orgId: string;
	systemId: number;
	name: string;
	status: ClaimStatus;
	weight: number;
	createdAt: string;
	updatedAt: string;
}

export interface SystemNickname {
	id: string;
	systemId: number;
	name: string;
}

export interface CurrencyRecord extends SyncMeta {
	id: string;
	/** @deprecated orgId removed -- currencies are standalone via Market<T> */
	orgId?: string;
	symbol: string;
	name: string;
	description?: string;
	moduleName?: string;
	coinType: string;
	packageId: string;
	/** Market<T> shared object ID (TreasuryCap auto-locked inside on publish) */
	marketId?: string;
	/** @deprecated treasuryCapId removed -- TreasuryCap locked in Market */
	treasuryCapId?: string;
	/** @deprecated orgTreasuryId removed -- replaced by marketId */
	orgTreasuryId?: string;
	decimals: number;
	createdAt: string;
	updatedAt: string;
}

// ── Sonar Types ─────────────────────────────────────────────────────────────

export type SonarSource = "local" | "chain";

export type SonarEventType =
	// ── Log events ──────────────────────────────────────────────────────────
	| "system_change"
	| "chat"
	// ── Inventory ───────────────────────────────────────────────────────────
	| "item_deposited"
	| "item_withdrawn"
	| "item_minted"
	| "item_burned"
	| "item_destroyed"
	// ── Combat / intel ──────────────────────────────────────────────────────
	| "killmail"
	| "bounty_posted"
	| "bounty_claimed"
	| "bounty_cancelled"
	// ── Navigation ──────────────────────────────────────────────────────────
	| "jump"
	| "gate_linked"
	| "jump_permit_issued"
	// ── Fuel / energy ───────────────────────────────────────────────────────
	| "fuel"
	| "energy_start"
	| "energy_stop"
	| "energy_reserved"
	| "energy_released"
	// ── Structure lifecycle ─────────────────────────────────────────────────
	| "assembly_created"
	| "gate_created"
	| "storage_unit_created"
	| "turret_created"
	| "network_node_created"
	| "status_changed"
	| "metadata_changed"
	| "location_revealed"
	// ── Market (token market) ───────────────────────────────────────────────
	| "market_sell_posted"
	| "market_buy_posted"
	| "market_buy_filled"
	| "market_buy_cancelled"
	| "market_sell_cancelled"
	// ── SSU Market ──────────────────────────────────────────────────────────
	| "ssu_market_buy_filled"
	| "ssu_market_transfer"
	| "ssu_market_sell_cancelled"
	// ── Extension authorization ─────────────────────────────────────────────
	| "extension_authorized"
	| "extension_removed"
	| "extension_revoked"
	// ── Gate extensions ─────────────────────────────────────────────────────
	| "toll_collected"
	| "access_granted"
	// ── Lease ───────────────────────────────────────────────────────────────
	| "lease_created"
	| "rent_collected"
	| "lease_cancelled"
	// ── Exchange ────────────────────────────────────────────────────────────
	| "exchange_order_placed"
	| "exchange_order_cancelled";

export interface SonarEvent {
	id?: number;
	timestamp: string;
	source: SonarSource;
	eventType: SonarEventType;
	characterName?: string;
	characterId?: string;
	assemblyId?: string;
	assemblyName?: string;
	typeId?: number;
	typeName?: string;
	quantity?: number;
	systemName?: string;
	details?: string;
	sessionId?: string;
	txDigest?: string;
	sender?: string;
	tribeId?: number;
}

export type SonarChannelStatus = "active" | "off" | "error";

export interface SonarChannelState {
	channel: SonarSource;
	enabled: boolean;
	status: SonarChannelStatus;
	lastError?: string;
	lastProcessedLogId?: number;
	cursors?: Record<string, string>;
	lastPollAt?: string;
}

export type SonarWatchKind = "character" | "tribe";

export interface SonarWatchItem {
	id: string;
	kind: SonarWatchKind;
	/** Character item ID (for kind=character) */
	characterId?: string;
	characterName?: string;
	/** Sui address (for kind=character) */
	suiAddress?: string;
	/** Tribe ID (for kind=tribe or kind=character with tribe) */
	tribeId?: number;
	tribeName?: string;
	/** Whether pings are enabled for this watch item */
	pingEnabled: boolean;
	/** Per-item ping event type overrides (undefined = use global defaults) */
	pingEventTypes?: SonarEventType[];
	/** User notes */
	notes?: string;
	createdAt: string;
	updatedAt: string;
}
