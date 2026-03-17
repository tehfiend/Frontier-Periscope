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

// ── SSU Market Types ────────────────────────────────────────────────────────

/** @deprecated Use SellOrderInfo instead */
export interface MarketListing {
	typeId: number;
	pricePerUnit: number;
	available: boolean;
}

export interface SellOrderInfo {
	typeId: number;
	pricePerUnit: number;
	quantity: number;
}

export interface MarketInfo {
	objectId: string;
	admin: string;
	ssuId: string;
}

// ── OrgMarket Types ────────────────────────────────────────────────────────

export interface OrgMarketInfo {
	objectId: string;
	orgId: string;
	admin: string;
	authorizedSsus: string[];
	nextOrderId: number;
}

export interface BuyOrderInfo {
	orderId: number;
	ssuId: string;
	typeId: number;
	pricePerUnit: number;
	quantity: number;
	poster: string;
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

// ── Governance Types ───────────────────────────────────────────────────────

export type OrgTier = "stakeholder" | "member" | "serf" | "opposition";

export interface OrgTierData {
	tribes: number[];
	characters: number[];
	addresses: string[];
}

export interface OrganizationInfo {
	objectId: string;
	name: string;
	creator: string;
	stakeholders: OrgTierData;
	members: OrgTierData;
	serfs: OrgTierData;
	opposition: OrgTierData;
}

export interface OnChainClaim {
	orgId: string;
	systemId: number;
	name: string;
	claimedAt: number;
	weight: number;
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
	ssuMarket?: { packageId: string; originalPackageId?: string };
	bountyBoard?: { packageId: string; boardObjectId: string };
	lease?: { packageId: string; registryObjectId: string };
	tokenTemplate?: { packageId: string };
	governance?: { packageId: string; claimsRegistryObjectId: string };
	governanceExt?: { packageId: string };
}
