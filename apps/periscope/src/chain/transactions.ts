import { Transaction } from "@mysten/sui/transactions";
import { ASSEMBLY_MODULE_MAP } from "@tehfrontier/chain-shared";
export { ASSEMBLY_MODULE_MAP };
import {
	type AssemblyKind,
	type ExtensionTemplate,
	TENANTS,
	type TenantId,
	getWorldTarget,
} from "./config";

// ── Rename Types ─────────────────────────────────────────────────────────────

interface RenameAssemblyParams {
	tenant: TenantId;
	/** Move module for this assembly: "turret" | "assembly" | "network_node" */
	assemblyModule: string;
	assemblyId: string;
	characterId: string;
	ownerCapId: string;
	newName: string;
	senderAddress: string;
}

/** Modules that support `update_metadata_name`. Gate and storage_unit do NOT. */
const RENAMABLE_MODULES: Record<string, { module: string; type: string }> = {
	turret: { module: "turret", type: "Turret" },
	assembly: { module: "assembly", type: "Assembly" },
	network_node: { module: "network_node", type: "NetworkNode" },
};

// ── Types ───────────────────────────────────────────────────────────────────

interface AuthorizeExtensionParams {
	tenant: TenantId;
	template: ExtensionTemplate;
	assemblyType: AssemblyKind;
	assemblyId: string;
	characterId: string;
	ownerCapId: string;
	senderAddress: string;
}

interface ConfigureTribeGateParams {
	tenant: TenantId;
	template: ExtensionTemplate;
	gateId: string;
	allowedTribes: number[];
	permitDurationMs: number;
	senderAddress: string;
}

// ── Transaction Builders ────────────────────────────────────────────────────

/**
 * Build a PTB to authorize an extension on an assembly.
 *
 * Flow:
 *   1. character::borrow_owner_cap<T>() → (ownerCap, receipt)
 *   2. turret/gate/storage_unit::authorize_extension<Auth>(assembly, ownerCap)
 *   3. character::return_owner_cap<T>() → consume receipt
 */

export function buildAuthorizeExtension(params: AuthorizeExtensionParams): Transaction {
	const { tenant, template, assemblyType, assemblyId, characterId, ownerCapId, senderAddress } =
		params;
	const worldPkg = TENANTS[tenant].worldPackageId;
	const worldTarget = getWorldTarget(tenant);
	const extensionPkg = template.packageIds[tenant];

	if (!extensionPkg) {
		throw new Error(`Extension "${template.id}" not published on ${tenant}`);
	}

	const tx = new Transaction();
	tx.setSender(senderAddress);

	const { module: assemblyModule, type: assemblyMoveType } = ASSEMBLY_MODULE_MAP[assemblyType];
	// Type arguments use original package ID (for type string construction)
	const fullAssemblyType = `${worldPkg}::${assemblyModule}::${assemblyMoveType}`;

	// Parse witness type: "module::Struct" -> full path
	const fullWitnessType = `${extensionPkg}::${template.witnessType}`;

	// Step 1: Borrow OwnerCap from Character
	const [ownerCap, receipt] = tx.moveCall({
		target: `${worldTarget}::character::borrow_owner_cap`,
		typeArguments: [fullAssemblyType],
		arguments: [tx.object(characterId), tx.object(ownerCapId)],
	});

	// Step 2: Authorize extension
	tx.moveCall({
		target: `${worldTarget}::${assemblyModule}::authorize_extension`,
		typeArguments: [fullWitnessType],
		arguments: [tx.object(assemblyId), ownerCap],
	});

	// Step 2b: For ssu_market extensions, also create SsuConfig (enables escrow transfers)
	if (template.id === "ssu_market") {
		tx.moveCall({
			target: `${extensionPkg}::ssu_market::create_ssu_config`,
			arguments: [tx.pure.id(assemblyId)],
		});
	}

	// Step 3: Return OwnerCap
	tx.moveCall({
		target: `${worldTarget}::character::return_owner_cap`,
		typeArguments: [fullAssemblyType],
		arguments: [tx.object(characterId), ownerCap, receipt],
	});

	return tx;
}

/**
 * Build a PTB to configure a tribe gate extension.
 */
export function buildConfigureTribeGate(params: ConfigureTribeGateParams): Transaction {
	const { tenant, template, gateId, allowedTribes, permitDurationMs, senderAddress } = params;
	const extensionPkg = template.packageIds[tenant];
	const configObjectId = template.configObjectIds[tenant];

	if (!extensionPkg) {
		throw new Error(`Extension "${template.id}" not published on ${tenant}`);
	}
	if (!configObjectId) {
		throw new Error(`Config object for "${template.id}" not set on ${tenant}`);
	}

	const tx = new Transaction();
	tx.setSender(senderAddress);

	tx.moveCall({
		target: `${extensionPkg}::config::set_gate_config`,
		arguments: [
			tx.object(configObjectId),
			tx.pure.id(gateId),
			tx.pure.vector("u32", allowedTribes),
			tx.pure.u64(permitDurationMs),
		],
	});

	return tx;
}

// ── Rename Transaction ──────────────────────────────────────────────────────

/**
 * Check whether a Move module supports `update_metadata_name`.
 * Gate and storage_unit do NOT have this function in world-contracts v0.0.18.
 */
export function isRenamableModule(assemblyModule: string): boolean {
	return assemblyModule in RENAMABLE_MODULES;
}

/**
 * Build a PTB to rename an assembly on-chain.
 *
 * Flow:
 *   1. character::borrow_owner_cap<T>() -> (ownerCap, receipt)
 *   2. {module}::update_metadata_name(assembly, ownerCap, name)
 *   3. character::return_owner_cap<T>() -> consume receipt
 */
export function buildRenameTx(params: RenameAssemblyParams): Transaction {
	const { tenant, assemblyModule, assemblyId, characterId, ownerCapId, newName, senderAddress } =
		params;
	const worldPkg = TENANTS[tenant].worldPackageId;
	const worldTarget = getWorldTarget(tenant);

	const entry = RENAMABLE_MODULES[assemblyModule];
	if (!entry) {
		throw new Error(
			`Module "${assemblyModule}" does not support update_metadata_name. ` +
				`Only ${Object.keys(RENAMABLE_MODULES).join(", ")} are supported.`,
		);
	}

	const fullAssemblyType = `${worldPkg}::${entry.module}::${entry.type}`;

	const tx = new Transaction();
	tx.setSender(senderAddress);

	// Step 1: Borrow OwnerCap from Character
	const [ownerCap, receipt] = tx.moveCall({
		target: `${worldTarget}::character::borrow_owner_cap`,
		typeArguments: [fullAssemblyType],
		arguments: [tx.object(characterId), tx.object(ownerCapId)],
	});

	// Step 2: Rename
	tx.moveCall({
		target: `${worldTarget}::${entry.module}::update_metadata_name`,
		arguments: [tx.object(assemblyId), ownerCap, tx.pure.string(newName)],
	});

	// Step 3: Return OwnerCap
	tx.moveCall({
		target: `${worldTarget}::character::return_owner_cap`,
		typeArguments: [fullAssemblyType],
		arguments: [tx.object(characterId), ownerCap, receipt],
	});

	return tx;
}

// ── Remove Extension Transaction ────────────────────────────────────────────

interface RemoveExtensionParams {
	tenant: TenantId;
	assemblyType: AssemblyKind;
	assemblyId: string;
	characterId: string;
	ownerCapId: string;
	senderAddress: string;
}

/**
 * Build a PTB to remove (revoke) the current extension from an assembly.
 *
 * Flow:
 *   1. character::borrow_owner_cap<T>() -> (ownerCap, receipt)
 *   2. {module}::remove_extension(assembly, ownerCap)
 *   3. character::return_owner_cap<T>() -> consume receipt
 */
export function buildRemoveExtension(params: RemoveExtensionParams): Transaction {
	const { tenant, assemblyType, assemblyId, characterId, ownerCapId, senderAddress } = params;
	const worldPkg = TENANTS[tenant].worldPackageId;
	const worldTarget = getWorldTarget(tenant);

	const entry = ASSEMBLY_MODULE_MAP[assemblyType];
	if (!entry) {
		throw new Error(`Assembly type "${assemblyType}" not supported for extension removal`);
	}

	const fullAssemblyType = `${worldPkg}::${entry.module}::${entry.type}`;

	const tx = new Transaction();
	tx.setSender(senderAddress);

	// Step 1: Borrow OwnerCap from Character
	const [ownerCap, receipt] = tx.moveCall({
		target: `${worldTarget}::character::borrow_owner_cap`,
		typeArguments: [fullAssemblyType],
		arguments: [tx.object(characterId), tx.object(ownerCapId)],
	});

	// Step 2: Remove extension
	tx.moveCall({
		target: `${worldTarget}::${entry.module}::remove_extension`,
		arguments: [tx.object(assemblyId), ownerCap],
	});

	// Step 3: Return OwnerCap
	tx.moveCall({
		target: `${worldTarget}::character::return_owner_cap`,
		typeArguments: [fullAssemblyType],
		arguments: [tx.object(characterId), ownerCap, receipt],
	});

	return tx;
}
