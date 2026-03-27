import { Transaction } from "@mysten/sui/transactions";
import {
	ASSEMBLY_MODULE_MAP,
	buildCreateSsuUnifiedConfig,
	buildSetGateStandingsConfig,
	buildSetSsuUnifiedConfig,
	getContractAddresses,
} from "@tehfrontier/chain-shared";
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

	// Step 3: Return OwnerCap
	tx.moveCall({
		target: `${worldTarget}::character::return_owner_cap`,
		typeArguments: [fullAssemblyType],
		arguments: [tx.object(characterId), ownerCap, receipt],
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

// ── Standings-Based Configuration Builders ───────────────────────────────────

interface ConfigureGateStandingsParams {
	tenant: TenantId;
	gateId: string;
	registryId: string;
	minAccess: number;
	freeAccess: number;
	tollFee: bigint;
	tollRecipient: string;
	permitDurationMs: bigint;
	senderAddress: string;
}

/**
 * Build a TX to configure standings-based access for a gate.
 * Wraps chain-shared's buildSetGateStandingsConfig().
 */
export function buildConfigureGateStandings(params: ConfigureGateStandingsParams): Transaction {
	const addrs = getContractAddresses(params.tenant);
	if (!addrs.gateStandings) {
		throw new Error(`Gate standings contract not deployed on ${params.tenant}`);
	}

	return buildSetGateStandingsConfig({
		packageId: addrs.gateStandings.packageId,
		configObjectId: addrs.gateStandings.configObjectId,
		gateId: params.gateId,
		registryId: params.registryId,
		minAccess: params.minAccess,
		freeAccess: params.freeAccess,
		tollFee: params.tollFee,
		tollRecipient: params.tollRecipient,
		permitDurationMs: params.permitDurationMs,
		senderAddress: params.senderAddress,
	});
}

interface ConfigureSsuUnifiedParams {
	tenant: TenantId;
	ssuId: string;
	registryId: string;
	minDeposit: number;
	minWithdraw: number;
	/** Market ID to link (optional). */
	marketId?: string;
	/** Existing per-SSU SsuUnifiedConfig object ID (omit for first-time creation). */
	ssuConfigId?: string;
	senderAddress: string;
}

/**
 * Result of building an SSU unified config transaction.
 * `isCreate` indicates whether this creates a new config (caller should
 * discover the new object ID after TX confirmation and persist it).
 */
export interface ConfigureSsuUnifiedResult {
	tx: Transaction;
	isCreate: boolean;
}

/**
 * Build a TX to configure standings-based access for an SSU via ssu_unified.
 *
 * - First-time (no ssuConfigId): calls buildCreateSsuUnifiedConfig to create
 *   a per-SSU config owned by the caller.
 * - Update (has ssuConfigId): calls buildSetSsuUnifiedConfig to update the
 *   existing config's standings thresholds.
 */
export function buildConfigureSsuUnified(params: ConfigureSsuUnifiedParams): ConfigureSsuUnifiedResult {
	const addrs = getContractAddresses(params.tenant);
	const ssuUnified = addrs.ssuUnified ?? addrs.ssuStandings;
	if (!ssuUnified) {
		throw new Error(`SSU unified contract not deployed on ${params.tenant}`);
	}

	if (params.ssuConfigId) {
		// Update existing per-SSU config
		const tx = buildSetSsuUnifiedConfig({
			packageId: ssuUnified.packageId,
			ssuConfigId: params.ssuConfigId,
			registryId: params.registryId,
			minDeposit: params.minDeposit,
			minWithdraw: params.minWithdraw,
			senderAddress: params.senderAddress,
		});

		// If marketId provided, add market link in the same TX
		if (params.marketId) {
			tx.moveCall({
				target: `${ssuUnified.packageId}::ssu_unified::set_market`,
				arguments: [tx.object(params.ssuConfigId), tx.pure.id(params.marketId)],
			});
		}

		return { tx, isCreate: false };
	}

	// First-time: create a new per-SSU config owned by the caller
	const tx = buildCreateSsuUnifiedConfig({
		packageId: ssuUnified.packageId,
		ssuId: params.ssuId,
		registryId: params.registryId,
		minDeposit: params.minDeposit,
		minWithdraw: params.minWithdraw,
		marketId: params.marketId || undefined,
		senderAddress: params.senderAddress,
	});

	return { tx, isCreate: true };
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
