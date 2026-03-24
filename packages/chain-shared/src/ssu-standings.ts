/**
 * SSU Standings -- Transaction builders for the
 * ssu_standings extension contract.
 *
 * SsuStandingsConfig is a shared config object with per-SSU rules
 * stored as dynamic fields. Each rule references a StandingsRegistry
 * and defines standing thresholds for deposit and withdraw.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import { Transaction } from "@mysten/sui/transactions";

// ── SSU Config Management (admin only) ──────────────────────────────────────

export interface SetSsuStandingsConfigParams {
	packageId: string;
	configObjectId: string;
	ssuId: string;
	registryId: string;
	minDeposit: number;
	minWithdraw: number;
	senderAddress: string;
}

/**
 * Build a TX to set standings-based config for an SSU.
 * Defines which registry to check and the standing thresholds.
 * Admin only.
 */
export function buildSetSsuStandingsConfig(params: SetSsuStandingsConfigParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::set_ssu_config`,
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.id(params.ssuId),
			tx.pure.id(params.registryId),
			tx.pure.u8(params.minDeposit),
			tx.pure.u8(params.minWithdraw),
		],
	});

	return tx;
}

export interface RemoveSsuStandingsConfigParams {
	packageId: string;
	configObjectId: string;
	ssuId: string;
	senderAddress: string;
}

/** Build a TX to remove standings config from an SSU. Admin only. */
export function buildRemoveSsuStandingsConfig(params: RemoveSsuStandingsConfigParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::remove_ssu_config`,
		arguments: [tx.object(params.configObjectId), tx.pure.id(params.ssuId)],
	});

	return tx;
}

// ── Deposit / Withdraw with Standings Check ─────────────────────────────────

export interface DepositWithStandingsParams {
	packageId: string;
	configObjectId: string;
	registryId: string;
	worldPackageId: string;
	ssuObjectId: string;
	characterObjectId: string;
	/** The Item object to deposit (result of a prior withdraw/transfer) */
	itemObjectId: string;
	senderAddress: string;
}

/**
 * Build a TX to deposit an item into an SSU with standings check.
 * The character's standing in the registry must be >= the SSU's min_deposit.
 */
export function buildDepositWithStandings(params: DepositWithStandingsParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_standings::deposit_item`,
		arguments: [
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.object(params.itemObjectId),
			tx.object(params.configObjectId),
			tx.object(params.registryId),
		],
	});

	return tx;
}

export interface WithdrawWithStandingsParams {
	packageId: string;
	configObjectId: string;
	registryId: string;
	worldPackageId: string;
	ssuObjectId: string;
	characterObjectId: string;
	typeId: number;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a TX to withdraw items from an SSU with standings check.
 * The character's standing in the registry must be >= the SSU's min_withdraw.
 * Returns the withdrawn Item.
 */
export function buildWithdrawWithStandings(params: WithdrawWithStandingsParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_standings::withdraw_item`,
		arguments: [
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.object(params.configObjectId),
			tx.object(params.registryId),
			tx.pure.u64(params.typeId),
			tx.pure.u32(params.quantity),
		],
	});

	return tx;
}

// ── Admin Management (owner only) ───────────────────────────────────────────

export function buildAddSsuStandingsAdmin(params: {
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

export function buildRemoveSsuStandingsAdmin(params: {
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
