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
export type WatchStatus = "active" | "paused" | "archived";
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

export interface NoteIntel extends IntelBase {
	title: string;
	body: string;
	linkedEntities: string[];
}

export interface ActivityIntel extends IntelBase {
	activityType: "mining" | "combat" | "travel" | "other";
	sessionId: string;
	systemId: number;
	metrics?: Record<string, number>;
	rawLog?: string;
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

export interface TargetRecord extends SyncMeta {
	id: string;
	address: string;
	name?: string;
	watchStatus: WatchStatus;
	pollInterval: number;
	lastPolled?: string;
	lastActivity?: string;
	tags: string[];
	notes?: string;
}

export interface TargetEvent extends SyncMeta {
	id: string;
	targetId: string;
	timestamp: string;
	event: string;
	details?: string;
	assemblyId?: string;
}

export interface InventoryDiff extends SyncMeta {
	id: string;
	targetId: string;
	assemblyId: string;
	timestamp: string;
	typeId: number;
	quantityDelta: number;
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

// ── Permission Group Types ─────────────────────────────────────────────────

export interface PermissionGroup extends SyncMeta {
	id: string; // UUID, or "__self__" / "__everyone__" for built-ins
	name: string;
	color: string; // Hex color for UI badges
	isBuiltin: boolean;
	description?: string;
	createdAt: string;
	updatedAt: string;
}

export type MemberKind = "character" | "tribe";

export interface GroupMember extends SyncMeta {
	id: string; // UUID
	groupId: string; // FK → PermissionGroup.id
	kind: MemberKind;
	// Character fields (when kind === "character")
	characterName?: string;
	characterId?: number; // In-game ID (u32/u64 from chain)
	suiAddress?: string; // 0x... wallet address
	// Tribe fields (when kind === "tribe")
	tribeId?: number; // u32 tribe ID
	tribeName?: string;
	createdAt: string;
}

// ── Betrayal Alert Types ──────────────────────────────────────────────────

export type AlertStatus = "pending" | "acted" | "dismissed";

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

export type PolicyMode = "allowlist" | "denylist";
export type SyncStatus = "draft" | "dirty" | "syncing" | "synced" | "error";

export interface AssemblyPolicy extends SyncMeta {
	id: string; // Same as assemblyId (1:1)
	assemblyId: string;
	assemblyType:
		| "turret"
		| "gate"
		| "storage_unit"
		| "smart_storage_unit"
		| "network_node"
		| "protocol_depot";
	mode: PolicyMode;
	groupIds: string[]; // References to PermissionGroup.id
	// Gate-specific
	permitDurationMs?: number;
	// Turret-specific
	defaultPriority?: number;
	friendlyPriority?: number;
	hostilePriority?: number;
	// Sync state
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
	/** When this entry was last fetched from chain */
	cachedAt: string;
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
	orgId: string;
	symbol: string;
	name: string;
	description?: string;
	moduleName?: string;
	coinType: string;
	packageId: string;
	treasuryCapId: string;
	orgTreasuryId?: string;
	decimals: number;
	createdAt: string;
	updatedAt: string;
}

// ── Sonar Types ─────────────────────────────────────────────────────────────

export type SonarSource = "local" | "chain";

export type SonarEventType =
	| "system_change"
	| "chat"
	| "item_deposited"
	| "item_withdrawn"
	| "item_minted"
	| "item_burned";

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
