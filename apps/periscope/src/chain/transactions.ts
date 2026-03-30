import { Transaction } from "@mysten/sui/transactions";
import {
	ASSEMBLY_MODULE_MAP,
	buildCreateSsuUnifiedConfig,
	buildSetGateStandingsConfig,
	buildSetGateTollCustomConfig,
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
	/** If set, update the structure's on-chain name during authorization. */
	newName?: string;
	/** If set, update the structure's on-chain dApp URL during authorization. */
	newUrl?: string;
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

	// Step 3: Update metadata name + dApp URL (while OwnerCap is borrowed)
	if (params.newName) {
		tx.moveCall({
			target: `${worldTarget}::${assemblyModule}::update_metadata_name`,
			arguments: [tx.object(assemblyId), ownerCap, tx.pure.string(params.newName)],
		});
	}
	if (params.newUrl) {
		tx.moveCall({
			target: `${worldTarget}::${assemblyModule}::update_metadata_url`,
			arguments: [tx.object(assemblyId), ownerCap, tx.pure.string(params.newUrl)],
		});
	}

	// Step 4: Return OwnerCap
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
	/** Custom toll currency coin type. If set, uses gate-toll-custom extension instead of gate-standings. */
	tollCoinType?: string;
}

/**
 * Build a TX to configure standings-based access for a gate.
 *
 * Branches on tollCoinType:
 * - undefined/empty: uses existing gate-standings extension (SUI tolls)
 * - custom coin type: uses gate-toll-custom extension (Coin<T> tolls)
 *
 * Note on treasury integration: the treasury destination is a *traveler-side*
 * concern. The gate config always sets a tollRecipient address. When treasury
 * is the revenue destination, the traveler's PTB uses
 * buildRequestGateTollCustomAccessToTreasury to deposit directly into the
 * treasury, rather than using the tollRecipient address.
 */
export function buildConfigureGateStandings(params: ConfigureGateStandingsParams): Transaction {
	if (params.tollCoinType) {
		// Custom currency toll via gate-toll-custom extension
		const addrs = getContractAddresses(params.tenant);
		if (!addrs.gateTollCustom?.packageId || !addrs.gateTollCustom?.configObjectId) {
			throw new Error(`Gate toll custom contract not deployed on ${params.tenant}`);
		}

		return buildSetGateTollCustomConfig({
			packageId: addrs.gateTollCustom.packageId,
			configObjectId: addrs.gateTollCustom.configObjectId,
			gateId: params.gateId,
			registryId: params.registryId,
			coinType: params.tollCoinType,
			minAccess: params.minAccess,
			freeAccess: params.freeAccess,
			tollAmount: params.tollFee,
			tollRecipient: params.tollRecipient,
			permitDurationMs: params.permitDurationMs,
			senderAddress: params.senderAddress,
		});
	}

	// SUI toll via existing gate-standings extension
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

interface ConfigureSsuStandingsParams {
	tenant: TenantId;
	ssuId: string;
	registryId: string;
	minDeposit: number;
	minWithdraw: number;
	senderAddress: string;
	/** Existing SsuUnifiedConfig object ID (for reconfiguration). */
	ssuConfigId?: string;
	/** Optional market ID to link at creation time. */
	marketId?: string;
}

/**
 * Build a TX to configure standings-based access for an SSU.
 * Uses the ssu_unified contract with per-user owned SsuUnifiedConfig objects.
 * If ssuConfigId is provided, updates the existing config; otherwise creates a new one.
 */
export function buildConfigureSsuStandings(params: ConfigureSsuStandingsParams): Transaction {
	const addrs = getContractAddresses(params.tenant);
	const ssuUnified = addrs.ssuUnified;
	if (!ssuUnified?.packageId) {
		throw new Error(`SSU unified not deployed on ${params.tenant}`);
	}

	if (params.ssuConfigId) {
		// Reconfigure existing SsuUnifiedConfig
		return buildSetSsuUnifiedConfig({
			packageId: ssuUnified.packageId,
			ssuConfigId: params.ssuConfigId,
			registryId: params.registryId,
			minDeposit: params.minDeposit,
			minWithdraw: params.minWithdraw,
			senderAddress: params.senderAddress,
		});
	}

	// Create new SsuUnifiedConfig
	return buildCreateSsuUnifiedConfig({
		packageId: ssuUnified.packageId,
		ssuId: params.ssuId,
		registryId: params.registryId,
		minDeposit: params.minDeposit,
		minWithdraw: params.minWithdraw,
		marketId: params.marketId,
		senderAddress: params.senderAddress,
	});
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
 *   2. {module}::revoke_extension_authorization(assembly, ownerCap)
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
		target: `${worldTarget}::${entry.module}::revoke_extension_authorization`,
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
