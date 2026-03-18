// ── Tenant Configuration ─────────────────────────────────────────────────────

export interface TenantConfig {
	name: string;
	worldPackageId: string;
	evePackageId: string;
	datahubUrl: string;
	dappUrl: string;
	/** Gas station URL for sponsored transactions + turret build service */
	gasStationUrl?: string;
}

export const TENANTS = {
	stillness: {
		name: "Stillness",
		worldPackageId: "0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c",
		evePackageId: "0x2a66a89b5a735738ffa4423ac024d23571326163f324f9051557617319e59d60",
		datahubUrl: "world-api-stillness.live.tech.evefrontier.com",
		dappUrl: "https://dapps.evefrontier.com/?tenant=stillness",
		gasStationUrl: "http://localhost:3100",
	},
	utopia: {
		name: "Utopia",
		worldPackageId: "0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75",
		evePackageId: "0xf0446b93345c1118f21239d7ac58fb82d005219b2016e100f074e4d17162a465",
		datahubUrl: "world-api-utopia.uat.pub.evefrontier.com",
		dappUrl: "https://uat.dapps.evefrontier.com/?tenant=utopia",
		gasStationUrl: undefined,
	},
} as const;

export type TenantId = keyof typeof TENANTS;

// ── Move Type Patterns ──────────────────────────────────────────────────────

export function moveType(tenant: TenantId, module: string, type: string): string {
	return `${TENANTS[tenant].worldPackageId}::${module}::${type}`;
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

/** Get event type strings for a specific tenant. */
export function getEventTypes(tenant: TenantId) {
	const pkg = TENANTS[tenant].worldPackageId;
	return {
		FuelEvent: `${pkg}::fuel::FuelEvent`,
		JumpEvent: `${pkg}::gate::JumpEvent`,
		KillmailCreated: `${pkg}::killmail::KillmailCreatedEvent`,
		AssemblyCreated: `${pkg}::assembly::AssemblyCreatedEvent`,
		StatusChanged: `${pkg}::status::StatusChangedEvent`,
		CharacterCreated: `${pkg}::character::CharacterCreatedEvent`,
		// Inventory events (Sonar)
		ItemDeposited: `${pkg}::inventory::ItemDepositedEvent`,
		ItemWithdrawn: `${pkg}::inventory::ItemWithdrawnEvent`,
		ItemMinted: `${pkg}::inventory::ItemMintedEvent`,
		ItemBurned: `${pkg}::inventory::ItemBurnedEvent`,
	};
}

/** @deprecated Use getMoveTypes(tenant) instead */
export const MOVE_TYPES = getMoveTypes("stillness");

/** @deprecated Use getEventTypes(tenant) instead */
export const EVENT_TYPES = getEventTypes("stillness");

// ── Game Constants ──────────────────────────────────────────────────────────

export const ASSEMBLY_TYPE_IDS: Record<number, string> = {
	77917: "Smart Storage Unit",
	85249: "Protocol Depot",
	83907: "Gatekeeper",
	88092: "Network Node",
	87161: "Portable Refinery",
	87162: "Portable Printer",
	87566: "Portable Storage",
	87160: "Refuge",
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
	/** Package ID per tenant — populated after publishing contracts */
	packageIds: Partial<Record<TenantId, string>>;
	/** Config object ID per tenant (for templates with shared config) */
	configObjectIds: Partial<Record<TenantId, string>>;
	/** The witness type path within the extension package (module::Struct) */
	witnessType: string;
}

/**
 * Registry of pre-built extension templates.
 * Package IDs are filled in after publishing to each tenant.
 *
 * TODO: After publishing contracts, update packageIds and configObjectIds here.
 */
export const EXTENSION_TEMPLATES: ExtensionTemplate[] = [
	{
		id: "turret_shoot_all",
		name: "Shoot All",
		description:
			"Target all players equally regardless of tribe. Fixes the default starter-corp turret behaviour where same-tribe players are ignored.",
		assemblyTypes: ["turret"],
		hasConfig: false,
		packageIds: {
			stillness: "0x4ad1a19064c1d44dbb6844862f5de4e28fd4a38c3a1bc7531581e39b4f3294b9",
			utopia: "0x4ad1a19064c1d44dbb6844862f5de4e28fd4a38c3a1bc7531581e39b4f3294b9",
		},
		configObjectIds: {},
		witnessType: "turret_shoot_all::ShootAllAuth",
	},
	{
		id: "gate_tribe",
		name: "Tribe Gate",
		description:
			"Only allow characters from specified tribes to use the gate. Configure which tribe IDs are permitted and set the jump permit duration.",
		assemblyTypes: ["gate"],
		hasConfig: true,
		packageIds: {
			stillness: "0x7ce73cdc22d21410794818a31522bc85c25ef97c3685214796f7347d76fd3298",
			utopia: "0x7ce73cdc22d21410794818a31522bc85c25ef97c3685214796f7347d76fd3298",
		},
		configObjectIds: {
			stillness: "0x322baeaa93dab9802fb55d7875551c1e40dad88b402fa36a9f8aa8f1f6399816",
			utopia: "0x322baeaa93dab9802fb55d7875551c1e40dad88b402fa36a9f8aa8f1f6399816",
		},
		witnessType: "tribe_gate::TribeGateAuth",
	},
	{
		id: "gate_acl",
		name: "Gate ACL",
		description:
			"Control gate access by character and tribe. Supports allowlist and denylist modes with multi-admin delegation.",
		assemblyTypes: ["gate"],
		hasConfig: true,
		packageIds: {
			stillness: "0x7e0ad0eff0aef4ea2b068209948c7036f2dbfcf51600029a0d27cd5bbf9ad44c",
			utopia: "0x7e0ad0eff0aef4ea2b068209948c7036f2dbfcf51600029a0d27cd5bbf9ad44c",
		},
		configObjectIds: {
			stillness: "0xa543f9158e517955b90dc864fc4c1fb00cca8f6fe688495f4a609335800f9dd6",
			utopia: "0xa543f9158e517955b90dc864fc4c1fb00cca8f6fe688495f4a609335800f9dd6",
		},
		witnessType: "gate_acl::GateAclAuth",
	},
	{
		id: "turret_priority",
		name: "Turret Priority",
		description:
			"Configurable friend/foe targeting with KOS lists, aggressor focus, low-HP finishing, and ship class bonuses. Config baked at publish time.",
		assemblyTypes: ["turret"],
		hasConfig: false,
		packageIds: {
			stillness: "0xbbca3a051fd616da4ebb34b4f67bf6d7111a32904e7fc4da29acd9a9b2bbb5ef",
			utopia: "0xbbca3a051fd616da4ebb34b4f67bf6d7111a32904e7fc4da29acd9a9b2bbb5ef",
		},
		configObjectIds: {},
		witnessType: "turret_priority::TurretPriorityAuth",
	},
	{
		id: "gate_unified",
		name: "Unified Gate",
		description:
			"Group-based access control with optional toll. Create groups of tribes/characters, set allowlist/denylist per gate, and charge tolls with ally exemptions.",
		assemblyTypes: ["gate"],
		hasConfig: true,
		packageIds: {
			stillness: "0x364f68ad3272d9815f2fce74776a854af1e3cb8de58ad1a1d7a0e67ad436210f",
			utopia: "0x364f68ad3272d9815f2fce74776a854af1e3cb8de58ad1a1d7a0e67ad436210f",
		},
		configObjectIds: {
			stillness: "0x1b5bec5f6346ec165e66b5e5cb75665f4ff44ba9a1df5b318bbf755777daf01a",
			utopia: "0x1b5bec5f6346ec165e66b5e5cb75665f4ff44ba9a1df5b318bbf755777daf01a",
		},
		witnessType: "gate_unified::GateUnifiedAuth",
	},
	{
		id: "gate_toll",
		name: "Toll Gate",
		description:
			"Require Coin<T> payment to jump through the gate. Allies can be configured for free passage.",
		assemblyTypes: ["gate"],
		hasConfig: true,
		packageIds: {
			stillness: "0xcef451bbe80afd7e495d5de87ace2989097731534ac100d0785f91a427e1f6a8",
			utopia: "0xcef451bbe80afd7e495d5de87ace2989097731534ac100d0785f91a427e1f6a8",
		},
		configObjectIds: {
			stillness: "0xb1f7ddda99a315704350b4f0a3d82626a4a62da4102afb20222c8a423657efd5",
			utopia: "0xb1f7ddda99a315704350b4f0a3d82626a4a62da4102afb20222c8a423657efd5",
		},
		witnessType: "gate_toll::TollAuth",
	},
	{
		id: "ssu_market",
		name: "SSU Market",
		description:
			"Enable trading on this SSU. Allows stocking items for sale and receiving buy order deliveries.",
		assemblyTypes: ["storage_unit", "smart_storage_unit", "protocol_depot"],
		hasConfig: false,
		packageIds: {
			stillness: "0xdb9df166063dc60ab0a450a768d4010f3e5939e554910d6aa1dc1b72e5dc8885",
			utopia: "0x53c2bf5e90d12b8a92594ab959f3d883dc2afdaf6031e9640151f82582a17501",
		},
		configObjectIds: {},
		witnessType: "ssu_market::MarketAuth",
	},
];

export function getTemplatesForAssemblyType(kind: AssemblyKind): ExtensionTemplate[] {
	return EXTENSION_TEMPLATES.filter((t) => t.assemblyTypes.includes(kind));
}

export function getTemplate(id: string): ExtensionTemplate | undefined {
	return EXTENSION_TEMPLATES.find((t) => t.id === id);
}
