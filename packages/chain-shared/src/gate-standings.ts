/**
 * Gate Standings -- Transaction builders for the
 * gate_standings extension contract.
 *
 * GateStandingsConfig is a shared config object with per-gate rules
 * stored as dynamic fields. Each gate rule references a StandingsRegistry
 * and defines standing thresholds for access and toll.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import { Transaction } from "@mysten/sui/transactions";

// ── Gate Config Management (admin only) ─────────────────────────────────────

export interface SetGateStandingsConfigParams {
	packageId: string;
	configObjectId: string;
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
 * Build a TX to set standings-based config for a gate.
 * Defines which registry to check and the standing thresholds.
 * Admin only.
 */
export function buildSetGateStandingsConfig(params: SetGateStandingsConfigParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::set_gate_config`,
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.id(params.gateId),
			tx.pure.id(params.registryId),
			tx.pure.u8(params.minAccess),
			tx.pure.u8(params.freeAccess),
			tx.pure.u64(params.tollFee),
			tx.pure.address(params.tollRecipient),
			tx.pure.u64(params.permitDurationMs),
		],
	});

	return tx;
}

export interface RemoveGateStandingsConfigParams {
	packageId: string;
	configObjectId: string;
	gateId: string;
	senderAddress: string;
}

/** Build a TX to remove standings config from a gate. Admin only. */
export function buildRemoveGateStandingsConfig(
	params: RemoveGateStandingsConfigParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::remove_gate_config`,
		arguments: [tx.object(params.configObjectId), tx.pure.id(params.gateId)],
	});

	return tx;
}

// ── Admin Management (owner only) ───────────────────────────────────────────

export function buildAddGateStandingsAdmin(params: {
	packageId: string;
	configObjectId: string;
	adminAddress: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::add_admin`,
		arguments: [tx.object(params.configObjectId), tx.pure.address(params.adminAddress)],
	});

	return tx;
}

export function buildRemoveGateStandingsAdmin(params: {
	packageId: string;
	configObjectId: string;
	adminAddress: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::remove_admin`,
		arguments: [tx.object(params.configObjectId), tx.pure.address(params.adminAddress)],
	});

	return tx;
}
