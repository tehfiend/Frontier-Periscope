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

// ── Market Standings Types ──────────────────────────────────────────────────

export interface MarketStandingsInfo {
	objectId: string;
	/** Package ID that defined this Market<T> (from type repr, always the original). */
	packageId: string;
	creator: string;
	/** StandingsRegistry object ID referenced by this market. */
	registryId: string;
	/** Minimum standing to mint tokens (0-6). */
	minMint: number;
	/** Minimum standing to post sell listings (0-6). */
	minTrade: number;
	/** Minimum standing to buy from listings or post buy orders (0-6). */
	minBuy: number;
	feeBps: number;
	feeRecipient: string;
	nextSellId: number;
	nextBuyId: number;
	coinType: string;
	totalSupply?: number;
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

// ── Private Map V2 Types ────────────────────────────────────────────────────

export interface PrivateMapV2Info {
	objectId: string;
	name: string;
	creator: string;
	editors: string[];
	/** 0 = encrypted (invite-only), 1 = cleartext standings */
	mode: number;
	/** Hex-encoded X25519 public key (mode=0 only) */
	publicKey?: string;
	/** StandingsRegistry object ID (mode=1 only) */
	registryId?: string;
	/** Minimum standing to view locations (mode=1, client-enforced) */
	minReadStanding?: number;
	/** Minimum standing to add locations (mode=1) */
	minWriteStanding?: number;
	nextLocationId: number;
}

export interface MapLocationV2Info {
	locationId: number;
	structureId: string | null;
	/** Hex-encoded data (encrypted for mode=0, plaintext JSON for mode=1) */
	data: string;
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

// ── Standings Registry Types ────────────────────────────────────────────────

export interface StandingsRegistryInfo {
	objectId: string;
	owner: string;
	admins: string[];
	name: string;
	ticker: string;
	defaultStanding: number;
}

export interface RegistryStandingEntry {
	kind: "character" | "tribe";
	tribeId?: number;
	characterId?: number;
	standing: number;
}

// ── SSU Unified Config Types ──────────────────────────────────────────────

export interface SsuUnifiedConfigInfo {
	objectId: string;
	owner: string;
	ssuId: string;
	delegates: string[];
	marketId: string | null;
	isPublic: boolean;
	/** StandingsRegistry object ID for standings-gated access. */
	registryId: string;
	/** Minimum standing to deposit items (0-6). */
	minDeposit: number;
	/** Minimum standing to withdraw items (0-6). */
	minWithdraw: number;
}

// ── Turret Standings Types ────────────────────────────────────────────────

export interface TurretStandingsConfig {
	/** Module name for the published package (default: "turret_priority") */
	moduleName?: string;
	/** Base weight for unlisted targets (default: 30) */
	defaultWeight: number;
	/** Weight for KOS targets (default: 100) */
	kosWeight: number;
	/** Bonus weight when target is actively attacking (default: 40) */
	aggressorBonus: number;
	/** Bonus for a "friendly" who is attacking -- traitor/spy gets maximum priority (default: 50) */
	betrayalBonus: number;
	/** Bonus weight when target HP is below threshold (default: 20) */
	lowHpBonus: number;
	/** HP threshold (0-100) for low HP bonus (default: 40) */
	lowHpThreshold: number;
	/** Bonus weight for effective ship class match (default: 25) */
	classBonus: number;
	/** Ship class group IDs this turret is effective against */
	effectiveClasses: number[];
	/** StandingsRegistry object ID used to derive friend/foe lists. */
	registryId: string;
	/** Mapping of standing thresholds to friendly/KOS classification.
	 *  Standing >= friendlyThreshold -> friendly, standing <= kosThreshold -> KOS. */
	standingThresholds: {
		/** Minimum raw standing (0-6) to be classified as friendly. */
		friendlyThreshold: number;
		/** Maximum raw standing (0-6) to be classified as KOS. */
		kosThreshold: number;
	};
}

// ── Contract Addresses ──────────────────────────────────────────────────────

export interface ContractAddresses {
	gateUnified?: { packageId: string; configObjectId: string };
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
	market?: { packageId: string };
	privateMap?: { packageId: string };
	standings?: { packageId: string };
	standingsRegistry?: { packageId: string };
	gateStandings?: { packageId: string; configObjectId: string };
	ssuStandings?: { packageId: string; configObjectId: string };
	marketStandings?: { packageId: string };
	tokenTemplateStandings?: { packageId: string };
	ssuMarketStandings?: {
		packageId: string;
		originalPackageId?: string;
		previousOriginalPackageIds?: string[];
	};
	privateMapStandings?: { packageId: string };
	ssuUnified?: {
		packageId: string;
		originalPackageId?: string;
		previousOriginalPackageIds?: string[];
	};
}
