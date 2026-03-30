import { getContractAddresses } from "@tehfrontier/chain-shared";

// ── Tenant Configuration ─────────────────────────────────────────────────────

export interface TenantConfig {
	name: string;
	worldPackageId: string;
	/** Published-at address for upgraded packages (moveCall targets). Falls back to worldPackageId. */
	worldPublishedAt?: string;
	evePackageId: string;
	datahubUrl: string;
	/** Periscope dApp base URL */
	dappUrl: string;
	/** CCP default smart deployable dApp base URL */
	ccpDappUrl: string;
}

export const TENANTS = {
	stillness: {
		name: "Stillness",
		worldPackageId: "0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c",
		evePackageId: "0x2a66a89b5a735738ffa4423ac024d23571326163f324f9051557617319e59d60",
		datahubUrl: "world-api-stillness.live.tech.evefrontier.com",
		dappUrl: "https://dapp.frontierperiscope.com/?tenant=stillness",
		ccpDappUrl: "https://dapps.evefrontier.com",
	},
	utopia: {
		name: "Utopia",
		worldPackageId: "0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75",
		worldPublishedAt: "0x07e6b810c2dff6df56ea7fbad9ff32f4d84cbee53e496267515887b712924bd1",
		evePackageId: "0xf0446b93345c1118f21239d7ac58fb82d005219b2016e100f074e4d17162a465",
		datahubUrl: "world-api-utopia.uat.pub.evefrontier.com",
		dappUrl: "https://dapp.frontierperiscope.com/?tenant=utopia",
		ccpDappUrl: "https://dapps.evefrontier.com",
	},
} as const satisfies Record<string, TenantConfig>;

export type TenantId = keyof typeof TENANTS;

// ── Move Type Patterns ──────────────────────────────────────────────────────

export function moveType(tenant: TenantId, module: string, type: string): string {
	return `${TENANTS[tenant].worldPackageId}::${module}::${type}`;
}

/** Get the published-at address for moveCall targets (handles upgraded packages). */
export function getWorldTarget(tenant: TenantId): string {
	const t: TenantConfig = TENANTS[tenant];
	return t.worldPublishedAt ?? t.worldPackageId;
}

/** Get Move type strings for a specific tenant. */
export function getMoveTypes(tenant: TenantId) {
	const pkg = TENANTS[tenant].worldPackageId;
	return {
		Assembly: `${pkg}::assembly::Assembly`,
		Gate: `${pkg}::gate::Gate`,
		StorageUnit: `${pkg}::storage_unit::StorageUnit`,
		Turret: `${pkg}::turret::Turret`,
		NetworkNode: `${pkg}::network_node::NetworkNode`,
		Manufacturing: `${pkg}::manufacturing::Manufacturing`,
		Refinery: `${pkg}::refinery::Refinery`,
		Character: `${pkg}::character::Character`,
	};
}

/** Get event type strings for a specific tenant (world package events). */
export function getEventTypes(tenant: TenantId) {
	const pkg = TENANTS[tenant].worldPackageId;
	return {
		// ── Character ───────────────────────────────────────────────────────
		CharacterCreated: `${pkg}::character::CharacterCreatedEvent`,

		// ── Assembly lifecycle ──────────────────────────────────────────────
		AssemblyCreated: `${pkg}::assembly::AssemblyCreatedEvent`,
		GateCreated: `${pkg}::gate::GateCreatedEvent`,
		StorageUnitCreated: `${pkg}::storage_unit::StorageUnitCreatedEvent`,
		TurretCreated: `${pkg}::turret::TurretCreatedEvent`,
		NetworkNodeCreated: `${pkg}::network_node::NetworkNodeCreatedEvent`,

		// ── Status ──────────────────────────────────────────────────────────
		StatusChanged: `${pkg}::status::StatusChangedEvent`,

		// ── Location ────────────────────────────────────────────────────────
		LocationRevealed: `${pkg}::location::LocationRevealedEvent`,

		// ── Metadata ────────────────────────────────────────────────────────
		MetadataChanged: `${pkg}::metadata::MetadataChangedEvent`,

		// ── Gate ────────────────────────────────────────────────────────────
		JumpEvent: `${pkg}::gate::JumpEvent`,
		GateLinked: `${pkg}::gate::GateLinkedEvent`,
		JumpPermitIssued: `${pkg}::gate::JumpPermitIssuedEvent`,

		// ── Inventory ───────────────────────────────────────────────────────
		ItemDeposited: `${pkg}::inventory::ItemDepositedEvent`,
		ItemWithdrawn: `${pkg}::inventory::ItemWithdrawnEvent`,
		ItemMinted: `${pkg}::inventory::ItemMintedEvent`,
		ItemBurned: `${pkg}::inventory::ItemBurnedEvent`,
		ItemDestroyed: `${pkg}::inventory::ItemDestroyedEvent`,

		// ── Fuel ────────────────────────────────────────────────────────────
		FuelEvent: `${pkg}::fuel::FuelEvent`,

		// ── Energy ──────────────────────────────────────────────────────────
		StartEnergyProduction: `${pkg}::energy::StartEnergyProductionEvent`,
		StopEnergyProduction: `${pkg}::energy::StopEnergyProductionEvent`,
		EnergyReserved: `${pkg}::energy::EnergyReservedEvent`,
		EnergyReleased: `${pkg}::energy::EnergyReleasedEvent`,

		// ── Killmail ────────────────────────────────────────────────────────
		KillmailCreated: `${pkg}::killmail::KillmailCreatedEvent`,

		// ── Extension authorization ─────────────────────────────────────────
		GateExtensionAuthorized: `${pkg}::gate::ExtensionAuthorizedEvent`,
		GateExtensionRemoved: `${pkg}::gate::ExtensionRemovedEvent`,
		GateExtensionRevoked: `${pkg}::gate::ExtensionRevokedEvent`,
		StorageUnitExtensionAuthorized: `${pkg}::storage_unit::ExtensionAuthorizedEvent`,
		StorageUnitExtensionRemoved: `${pkg}::storage_unit::ExtensionRemovedEvent`,
		StorageUnitExtensionRevoked: `${pkg}::storage_unit::ExtensionRevokedEvent`,
		TurretExtensionRevoked: `${pkg}::turret::ExtensionRevokedEvent`,
	};
}

/** Get extension contract event type strings for a specific tenant. */
export function getExtensionEventTypes(tenant: TenantId) {
	const addrs = getContractAddresses(tenant);
	const events: Record<string, string> = {};

	// ── SSU Market (use originalPackageId for event queries) ────────────
	const ssuMarketPkg = addrs.ssuMarket?.originalPackageId;
	if (ssuMarketPkg) {
		events.SsuMarketBuyOrderFilled = `${ssuMarketPkg}::ssu_market::BuyOrderFilledEvent`;
		events.SsuMarketTransfer = `${ssuMarketPkg}::ssu_market::TransferEvent`;
		events.SsuMarketSellListingCancelled = `${ssuMarketPkg}::ssu_market::SellListingCancelledEvent`;
	}

	// ── Bounty Board ───────────────────────────────────────────────────
	const bountyPkg = addrs.bountyBoard?.packageId;
	if (bountyPkg) {
		events.BountyPosted = `${bountyPkg}::bounty_board::BountyPostedEvent`;
		events.BountyClaimed = `${bountyPkg}::bounty_board::BountyClaimedEvent`;
		events.BountyCancelled = `${bountyPkg}::bounty_board::BountyCancelledEvent`;
	}

	// ── Gate Unified (toll + access) ───────────────────────────────────
	const gateUnifiedPkg = addrs.gateUnified?.packageId;
	if (gateUnifiedPkg) {
		events.UnifiedTollCollected = `${gateUnifiedPkg}::gate_unified::TollCollectedEvent`;
		events.UnifiedAccessGranted = `${gateUnifiedPkg}::gate_unified::AccessGrantedEvent`;
	}

	// ── Gate Toll ──────────────────────────────────────────────────────
	const gateTollPkg = addrs.gateToll?.packageId;
	if (gateTollPkg) {
		events.TollCollected = `${gateTollPkg}::gate_toll::TollCollectedEvent`;
	}

	// ── Lease ──────────────────────────────────────────────────────────
	const leasePkg = addrs.lease?.packageId;
	if (leasePkg) {
		events.LeaseCreated = `${leasePkg}::lease::LeaseCreatedEvent`;
		events.RentCollected = `${leasePkg}::lease::RentCollectedEvent`;
		events.LeaseCancelled = `${leasePkg}::lease::LeaseCancelledEvent`;
	}

	// ── Exchange ───────────────────────────────────────────────────────
	const exchangePkg = addrs.exchange?.packageId;
	if (exchangePkg) {
		events.ExchangeOrderPlaced = `${exchangePkg}::exchange::OrderPlacedEvent`;
		events.ExchangeOrderCancelled = `${exchangePkg}::exchange::OrderCancelledEvent`;
	}

	// ── Market ─────────────────────────────────────────────────────────
	const marketPkg = addrs.market?.packageId;
	if (marketPkg) {
		events.MarketSellListingPosted = `${marketPkg}::market::SellListingPostedEvent`;
		events.MarketBuyOrderPosted = `${marketPkg}::market::BuyOrderPostedEvent`;
		events.MarketBuyOrderFilled = `${marketPkg}::market::BuyOrderFilledEvent`;
		events.MarketBuyOrderCancelled = `${marketPkg}::market::BuyOrderCancelledEvent`;
		events.MarketSellListingCancelled = `${marketPkg}::market::SellListingCancelledEvent`;
	}

	return events;
}

// ── Game Constants ──────────────────────────────────────────────────────────

export const ASSEMBLY_TYPE_IDS: Record<number, string> = {
	77917: "Heavy Storage",
	85249: "Protocol Depot",
	83907: "Gatekeeper",
	88092: "Network Node",
	87161: "Portable Refinery",
	87162: "Portable Printer",
	87566: "Portable Storage",
	87160: "Refuge",
	// Gates
	88086: "Stargate",
	84955: "Jumpgate",
	// Turrets
	92279: "Light Turret",
	92401: "Medium Turret",
	92404: "Heavy Turret",
};

export const FUEL_TYPES: Record<number, { name: string; efficiency: number }> = {
	78437: { name: "EU-90", efficiency: 90 },
	78515: { name: "SOF-80", efficiency: 80 },
	78516: { name: "EU-40", efficiency: 40 },
	84868: { name: "D2-40", efficiency: 40 },
	88319: { name: "D2-15", efficiency: 15 },
	88335: { name: "F-10", efficiency: 10 },
};

// ── Extension Templates ─────────────────────────────────────────────────────

export type AssemblyKind =
	| "turret"
	| "gate"
	| "storage_unit"
	| "smart_storage_unit"
	| "network_node"
	| "protocol_depot";

export interface ExtensionTemplate {
	id: string;
	name: string;
	description: string;
	assemblyTypes: AssemblyKind[];
	hasConfig: boolean;
	/** Package ID per tenant -- populated after publishing contracts */
	packageIds: Partial<Record<TenantId, string>>;
	/** Config object ID per tenant (for templates with shared config) */
	configObjectIds: Partial<Record<TenantId, string>>;
	/** The witness type path within the extension package (module::Struct) */
	witnessType: string;
}

/** Registry of pre-built extension templates (standings-based system). */
export const EXTENSION_TEMPLATES: ExtensionTemplate[] = [
	{
		id: "gate_standings",
		name: "Periscope Gate",
		description:
			"Control gate access via a StandingsRegistry. Block, toll, or grant free passage based on character/tribe standing thresholds.",
		assemblyTypes: ["gate"],
		hasConfig: true,
		packageIds: {
			stillness: "0xef2cd2bc3a93cbb7286ed4bf9ebf7c49c6459f50db0a1d0c94d19810f2a62eb4",
			utopia: "0xef2cd2bc3a93cbb7286ed4bf9ebf7c49c6459f50db0a1d0c94d19810f2a62eb4",
		},
		configObjectIds: {
			stillness: "0x312a3ea9282b1b702da100c288c520aa452eced3dd325e718c06196b1b9db627",
			utopia: "0x312a3ea9282b1b702da100c288c520aa452eced3dd325e718c06196b1b9db627",
		},
		witnessType: "gate_standings::GateStandingsAuth",
	},
	{
		id: "ssu_unified",
		name: "Periscope SSU",
		description:
			"Standings-based SSU access with optional market integration. Set deposit/withdraw thresholds, link a market, and manage delegates -- all via a StandingsRegistry.",
		assemblyTypes: ["storage_unit", "smart_storage_unit", "protocol_depot"],
		hasConfig: true,
		packageIds: {
			stillness: "0x0a6a70355f96e07417aa2e5b59c1e2ea8757c5ade5e8000bfc8daab93bfee2be",
			utopia: "0xd3168c9b6db1ff6671d45b056dccd62acc7fa05835eb3079bce10d70af8950ea",
		},
		configObjectIds: {},
		witnessType: "ssu_unified::SsuUnifiedAuth",
	},
	{
		id: "turret_standings",
		name: "Periscope Turret",
		description:
			"Weights-only turret targeting with configurable priority constants. Each user publishes their own turret package with baked-in weight values via in-browser bytecode patching.",
		assemblyTypes: ["turret"],
		hasConfig: true,
		// Turret uses per-user published packages, so packageIds is empty.
		// The user publishes their own turret package with baked-in config.
		packageIds: {},
		configObjectIds: {},
		witnessType: "turret_priority::TurretPriorityAuth",
	},
];

export function getTemplatesForAssemblyType(kind: AssemblyKind): ExtensionTemplate[] {
	return EXTENSION_TEMPLATES.filter((t) => t.assemblyTypes.includes(kind));
}

export function getTemplate(id: string): ExtensionTemplate | undefined {
	return EXTENSION_TEMPLATES.find((t) => t.id === id);
}

// ── Extension Classification ─────────────────────────────────────────────────

export type ExtensionClassification = "default" | "periscope" | "periscope-outdated" | "unknown";

export interface ExtensionInfo {
	status: ExtensionClassification;
	template?: ExtensionTemplate;
}

/** Map template IDs to their contract address key in getContractAddresses(). */
const TEMPLATE_CONTRACT_KEY: Record<string, string> = {
	gate_standings: "gateStandings",
	ssu_unified: "ssuUnified",
	turret_standings: "turretPriority",
};

/** Collect all known package IDs (current, original, previous) for a template on a tenant. */
function getAllPackageIds(template: ExtensionTemplate, tenant: TenantId): Set<string> {
	const ids = new Set<string>();
	const staticId = template.packageIds[tenant];
	if (staticId) ids.add(staticId);

	const contractKey = TEMPLATE_CONTRACT_KEY[template.id];
	if (contractKey) {
		const addrs = getContractAddresses(tenant);
		const entry = addrs[contractKey as keyof typeof addrs] as
			| { packageId?: string; originalPackageId?: string; previousOriginalPackageIds?: string[] }
			| undefined;
		if (entry) {
			if (entry.packageId) ids.add(entry.packageId);
			if (entry.originalPackageId) ids.add(entry.originalPackageId);
			for (const prev of entry.previousOriginalPackageIds ?? []) {
				ids.add(prev);
			}
		}
	}
	return ids;
}

/**
 * Classify an on-chain extension TypeName against known Periscope templates.
 *
 * The on-chain value looks like "0xabc123::gate_standings::GateStandingsAuth".
 * We match the module::Type suffix against each template's witnessType, then
 * check whether the package ID prefix matches any known deployment for this tenant
 * (current, original, or previous original package IDs).
 */
export function classifyExtension(
	extensionType: string | undefined | null,
	tenant: TenantId,
	knownPackageId?: string,
): ExtensionInfo {
	if (!extensionType) return { status: "default" };

	for (const template of EXTENSION_TEMPLATES) {
		// Check if the witness type path matches (e.g. "gate_standings::GateStandingsAuth")
		if (!extensionType.includes(`::${template.witnessType}`)) continue;

		// Check all known package IDs for this template on this tenant
		const allIds = getAllPackageIds(template, tenant);
		for (const pkgId of allIds) {
			if (extensionType.startsWith(pkgId)) {
				return { status: "periscope", template };
			}
		}
		// For templates with no canonical packageId (e.g. turrets -- per-user published),
		// check the caller-supplied knownPackageId from the extension config
		if (allIds.size === 0 && knownPackageId && extensionType.startsWith(knownPackageId)) {
			return { status: "periscope", template };
		}
		// Witness matches but package ID differs -- outdated deployment
		return { status: "periscope-outdated", template };
	}

	return { status: "unknown" };
}
