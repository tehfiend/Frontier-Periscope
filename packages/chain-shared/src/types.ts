// ── Permission Types ────────────────────────────────────────────────────────

export interface AclConfig {
	isAllowlist: boolean;
	tribeIds: number[];
	characterIds: number[];
	permitDurationMs: number;
}

export interface AdminConfig {
	owner: string;
	admins: string[];
	adminTribes: number[];
}

// ── Exchange Types ──────────────────────────────────────────────────────────

export interface OrderBookInfo {
	objectId: string;
	coinTypeA: string;
	coinTypeB: string;
	bidCount: number;
	askCount: number;
	feeBps: number;
}

export interface OrderInfo {
	orderId: number;
	owner: string;
	price: number;
	amount: number;
	isBid: boolean;
}

// ── Market Types ───────────────────────────────────────────────────────────

export interface MarketInfo {
	objectId: string;
	/** Package ID that defined this Market<T> (from type repr, always the original). */
	packageId: string;
	creator: string;
	authorized: string[];
	feeBps: number;
	feeRecipient: string;
	nextSellId: number;
	nextBuyId: number;
	coinType: string;
	totalSupply?: number;
}

export interface MarketSellListing {
	listingId: number;
	seller: string;
	ssuId: string;
	typeId: number;
	pricePerUnit: bigint;
	quantity: number;
	postedAtMs: number;
}

export interface MarketBuyOrder {
	orderId: number;
	buyer: string;
	typeId: number;
	pricePerUnit: bigint;
	quantity: number;
	originalQuantity: number;
	postedAtMs: number;
}

// ── SSU Config Types ───────────────────────────────────────────────────────

export interface SsuConfigInfo {
	objectId: string;
	owner: string;
	ssuId: string;
	delegates: string[];
	marketId: string | null;
	isPublic: boolean;
}

export interface CrossMarketListing extends MarketSellListing {
	marketId: string;
	coinType: string;
	ssuConfigId: string;
}

// ── Toll Types ──────────────────────────────────────────────────────────────

export interface TollInfo {
	fee: number;
	feeRecipient: string;
	permitDurationMs: number;
	freeTribes: number[];
	freeCharacters: number[];
}

// ── Bounty Types ────────────────────────────────────────────────────────────

export interface BountyInfo {
	bountyId: number;
	poster: string;
	targetCharacterId: number;
	rewardAmount: number;
	expiresAt: number;
}

// ── Lease Types ─────────────────────────────────────────────────────────────

export interface LeaseInfo {
	tenant: string;
	tenantTribe: number;
	ratePerDay: number;
	lastChargedAt: number;
	landlord: string;
	balanceAmount: number;
}

// ── Token Factory Types ─────────────────────────────────────────────────────

export interface TokenInfo {
	packageId: string;
	moduleName: string;
	symbol: string;
	name: string;
	description: string;
	decimals: number;
	treasuryCapId: string;
	coinType: string;
}

// ── Turret Priority Types ──────────────────────────────────────────────────

export interface TurretPriorityDeployment {
	packageId: string;
	turretObjectId: string;
	config: {
		friendlyTribes: number[];
		friendlyCharacters: number[];
		kosTribes: number[];
		kosCharacters: number[];
		defaultWeight: number;
		kosWeight: number;
		aggressorBonus: number;
		betrayalBonus: number;
		lowHpBonus: number;
		lowHpThreshold: number;
		classBonus: number;
		effectiveClasses: number[];
	};
	publishedAt: string;
}

// ── Shared ACL Types ───────────────────────────────────────────────────────

export interface SharedAclInfo {
	objectId: string;
	name: string;
	creator: string;
	admins: string[];
	isAllowlist: boolean;
	allowedTribes: number[];
	allowedCharacters: number[];
}

// ── Private Map Types ───────────────────────────────────────────────────────

export interface PrivateMapInfo {
	objectId: string;
	name: string;
	creator: string;
	publicKey: string; // hex-encoded X25519 public key
	nextLocationId: number;
}

export interface MapInviteInfo {
	objectId: string;
	mapId: string;
	sender: string;
	encryptedMapKey: string; // hex-encoded
}

export interface MapLocationInfo {
	locationId: number;
	structureId: string | null;
	encryptedData: string; // hex-encoded
	addedBy: string;
	addedAtMs: number;
}

// ── Standings Types ─────────────────────────────────────────────────────────

export interface StandingsListInfo {
	objectId: string;
	name: string;
	description: string;
	creator: string;
	publicKey: string; // hex
	editors: string[];
	nextEntryId: number;
}

export interface StandingsInviteInfo {
	objectId: string;
	listId: string;
	sender: string;
	encryptedListKey: string; // hex
}

export interface StandingEntryInfo {
	entryId: number;
	encryptedData: string; // hex
	addedBy: string;
	updatedAtMs: number;
}

export interface StandingData {
	kind: "character" | "tribe";
	characterId?: number;
	tribeId?: number;
	standing: number; // -3 to 3
	label: string;
	description: string;
}

// ── Contract Addresses ──────────────────────────────────────────────────────

export interface ContractAddresses {
	gateUnified?: { packageId: string; configObjectId: string };
	turretShootAll?: { packageId: string };
	turretPriority?: { packageId: string };
	gateAcl?: { packageId: string; configObjectId: string };
	gateTribe?: { packageId: string; configObjectId: string };
	gateToll?: { packageId: string; configObjectId: string };
	exchange?: { packageId: string };
	ssuMarket?: {
		packageId: string;
		originalPackageId?: string;
		previousOriginalPackageIds?: string[];
	};
	bountyBoard?: { packageId: string; boardObjectId: string };
	lease?: { packageId: string; registryObjectId: string };
	tokenTemplate?: { packageId: string };
	governance?: { packageId: string; claimsRegistryObjectId: string };
	aclRegistry?: { packageId: string };
	market?: { packageId: string };
	privateMap?: { packageId: string };
	standings?: { packageId: string };
}
