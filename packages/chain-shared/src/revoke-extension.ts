/**
 * Revoke Extension Authorization -- Transaction builder for revoking
 * extension authorization on assemblies (gates, turrets, storage units).
 *
 * Uses the borrow_owner_cap -> revoke -> return_owner_cap PTB pattern
 * from character module.
 */

import { Transaction } from "@mysten/sui/transactions";

// ── Assembly Module Map ─────────────────────────────────────────────────────

/**
 * Maps assembly kind strings to their Move module and type names.
 * Used to construct the correct type parameter for borrow_owner_cap/return_owner_cap.
 */
export const ASSEMBLY_MODULE_MAP: Record<string, { module: string; type: string }> = {
	turret: { module: "turret", type: "Turret" },
	gate: { module: "gate", type: "Gate" },
	storage_unit: { module: "storage_unit", type: "StorageUnit" },
	smart_storage_unit: { module: "storage_unit", type: "StorageUnit" },
	network_node: { module: "network_node", type: "NetworkNode" },
	protocol_depot: { module: "storage_unit", type: "StorageUnit" },
};

// ── Params ──────────────────────────────────────────────────────────────────

export interface RevokeExtensionParams {
	/** World package ID (published-at address for moveCall targets). */
	worldPackageId: string;
	/** Move module name for the assembly (e.g. "gate", "turret", "storage_unit"). */
	assemblyModule: string;
	/** Move type name for the assembly (e.g. "Gate", "Turret", "StorageUnit"). */
	assemblyMoveType: string;
	/** On-chain object ID of the assembly to revoke from. */
	assemblyId: string;
	/** On-chain object ID of the Character that owns the assembly. */
	characterObjectId: string;
	/** OwnerCap receiving ref ID (sent to the Character object). */
	ownerCapId: string;
	/** Sender address for the transaction. */
	senderAddress: string;
}

// ── TX Builder ──────────────────────────────────────────────────────────────

/**
 * Build a PTB to revoke extension authorization on an assembly.
 *
 * Flow:
 *   1. borrow_owner_cap<{worldPkg}::{module}::{Type}> from Character
 *   2. {module}::revoke_extension_authorization(assembly, ownerCap)
 *   3. return_owner_cap<{worldPkg}::{module}::{Type}> to Character
 */
export function buildRevokeExtensionAuthorization(params: RevokeExtensionParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const typeArg = `${params.worldPackageId}::${params.assemblyModule}::${params.assemblyMoveType}`;

	// Step 1: Borrow OwnerCap from Character
	const [ownerCap, receipt] = tx.moveCall({
		target: `${params.worldPackageId}::character::borrow_owner_cap`,
		typeArguments: [typeArg],
		arguments: [tx.object(params.characterObjectId), tx.object(params.ownerCapId)],
	});

	// Step 2: Revoke extension authorization (no type parameters)
	tx.moveCall({
		target: `${params.worldPackageId}::${params.assemblyModule}::revoke_extension_authorization`,
		arguments: [tx.object(params.assemblyId), ownerCap],
	});

	// Step 3: Return OwnerCap to Character
	tx.moveCall({
		target: `${params.worldPackageId}::character::return_owner_cap`,
		typeArguments: [typeArg],
		arguments: [tx.object(params.characterObjectId), ownerCap, receipt],
	});

	return tx;
}
