/**
 * Gate Toll Custom Currency -- Transaction builders and query helpers for the
 * gate_toll_custom extension contract.
 *
 * GateTollCustomConfig is a shared config object with per-gate rules stored
 * as phantom-typed dynamic fields: GateKey<phantom T> { gate_id: ID } -> GateConfig.
 * This allows different Coin<T> toll currencies per gate, and even multiple
 * currency configs on a single gate (each as a separate dynamic field).
 *
 * The contract provides three access paths:
 * - request_access<T>: toll-paying, transfers Coin<T> to tollRecipient address
 * - request_access_to_treasury<T>: toll-paying, deposits Coin<T> into a Treasury
 * - request_free_access<T>: free passage for high-standing characters
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Inputs, Transaction } from "@mysten/sui/transactions";
import { listDynamicFieldsGql } from "./graphql-queries";
import type { GateTollCustomConfigInfo } from "./types";

/** Immutable shared Clock object ref (0x6, genesis version 1). */
const CLOCK_REF = Inputs.SharedObjectRef({
	objectId: "0x0000000000000000000000000000000000000000000000000000000000000006",
	initialSharedVersion: 1,
	mutable: false,
});

// ── Gate Config Management (admin only) ──────────────────────────────────────

export interface SetGateTollCustomConfigParams {
	packageId: string;
	configObjectId: string;
	gateId: string;
	registryId: string;
	coinType: string;
	minAccess: number;
	freeAccess: number;
	tollAmount: bigint;
	tollRecipient: string;
	permitDurationMs: bigint;
	senderAddress: string;
}

/**
 * Build a TX to set custom currency toll config for a gate.
 * Creates or updates a phantom-typed GateKey<T> dynamic field.
 * Admin only.
 */
export function buildSetGateTollCustomConfig(
	params: SetGateTollCustomConfigParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::set_gate_config`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.id(params.gateId),
			tx.pure.id(params.registryId),
			tx.pure.u8(params.minAccess),
			tx.pure.u8(params.freeAccess),
			tx.pure.u64(params.tollAmount),
			tx.pure.address(params.tollRecipient),
			tx.pure.u64(params.permitDurationMs),
		],
	});

	return tx;
}

// ── Access Requests ──────────────────────────────────────────────────────────

export interface RequestGateTollCustomAccessParams {
	packageId: string;
	configObjectId: string;
	gateId: string;
	coinType: string;
	coinObjectIds: string[];
	tollAmount: bigint;
	characterId: string;
	senderAddress: string;
}

/**
 * Build a TX to request gate access by paying a toll in Coin<T>.
 * The toll is transferred to the configured tollRecipient address.
 * Uses merge+split pattern for exact toll payment.
 */
export function buildRequestGateTollCustomAccess(
	params: RequestGateTollCustomAccessParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Merge+split coin objects into exact toll amount
	if (params.coinObjectIds.length === 0) {
		throw new Error("No coin objects provided for toll payment");
	}

	let tollCoin: ReturnType<typeof tx.splitCoins>[0];
	if (params.coinObjectIds.length === 1) {
		[tollCoin] = tx.splitCoins(tx.object(params.coinObjectIds[0]), [
			tx.pure.u64(params.tollAmount),
		]);
	} else {
		const [baseCoin, ...restCoins] = params.coinObjectIds;
		tx.mergeCoins(
			tx.object(baseCoin),
			restCoins.map((id) => tx.object(id)),
		);
		[tollCoin] = tx.splitCoins(tx.object(baseCoin), [tx.pure.u64(params.tollAmount)]);
	}

	tx.moveCall({
		target: `${params.packageId}::config::request_access`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.id(params.gateId),
			tx.object(params.characterId),
			tollCoin,
			tx.object(CLOCK_REF),
		],
	});

	return tx;
}

export interface RequestGateTollCustomAccessToTreasuryParams {
	packageId: string;
	treasuryPackageId: string;
	configObjectId: string;
	gateId: string;
	coinType: string;
	coinObjectIds: string[];
	tollAmount: bigint;
	treasuryId: string;
	characterId: string;
	senderAddress: string;
}

/**
 * Build a TX to request gate access by paying a toll in Coin<T>,
 * depositing the toll directly into a Treasury shared object.
 * Uses merge+split pattern for exact toll payment.
 */
export function buildRequestGateTollCustomAccessToTreasury(
	params: RequestGateTollCustomAccessToTreasuryParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Merge+split coin objects into exact toll amount
	if (params.coinObjectIds.length === 0) {
		throw new Error("No coin objects provided for toll payment");
	}

	let tollCoin: ReturnType<typeof tx.splitCoins>[0];
	if (params.coinObjectIds.length === 1) {
		[tollCoin] = tx.splitCoins(tx.object(params.coinObjectIds[0]), [
			tx.pure.u64(params.tollAmount),
		]);
	} else {
		const [baseCoin, ...restCoins] = params.coinObjectIds;
		tx.mergeCoins(
			tx.object(baseCoin),
			restCoins.map((id) => tx.object(id)),
		);
		[tollCoin] = tx.splitCoins(tx.object(baseCoin), [tx.pure.u64(params.tollAmount)]);
	}

	tx.moveCall({
		target: `${params.packageId}::config::request_access_to_treasury`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.id(params.gateId),
			tx.object(params.characterId),
			tollCoin,
			tx.object(params.treasuryId),
			tx.object(CLOCK_REF),
		],
	});

	return tx;
}

export interface RequestGateTollCustomFreeAccessParams {
	packageId: string;
	configObjectId: string;
	gateId: string;
	coinType: string;
	characterId: string;
	senderAddress: string;
}

/**
 * Build a TX to request free gate access (no toll payment).
 * Requires the character's standing >= freeAccess threshold.
 * The coinType is needed to look up the correct phantom-typed dynamic field.
 */
export function buildRequestGateTollCustomFreeAccess(
	params: RequestGateTollCustomFreeAccessParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::config::request_free_access`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.id(params.gateId),
			tx.object(params.characterId),
			tx.object(CLOCK_REF),
		],
	});

	return tx;
}

// ── Query Functions ──────────────────────────────────────────────────────────

/**
 * Read per-gate custom toll config from GateTollCustomConfig dynamic fields.
 *
 * If coinType is provided, attempts to look up the specific phantom-typed
 * GateKey<T> dynamic field for that gate+coinType combination.
 * If coinType is omitted, enumerates all dynamic fields to find one matching
 * the gate ID (returns the first match).
 */
export async function queryGateTollCustomConfig(
	client: SuiGraphQLClient,
	configObjectId: string,
	gateId: string,
	coinType?: string,
): Promise<GateTollCustomConfigInfo | null> {
	return queryGateTollCustomConfigByEnumeration(client, configObjectId, gateId, coinType);
}

/**
 * Enumerate dynamic fields to find gate config(s).
 * Filters by GateKey type name and optionally by coinType.
 * Phantom-typed GateKey<T> keys cannot be looked up directly via getDynamicFieldJson,
 * so we enumerate all dynamic fields and filter by gate ID and optional coin type.
 */
async function queryGateTollCustomConfigByEnumeration(
	client: SuiGraphQLClient,
	configObjectId: string,
	gateId: string,
	coinType?: string,
): Promise<GateTollCustomConfigInfo | null> {
	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, configObjectId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				if (!df.nameType.includes("GateKey")) continue;

				// If coinType filter is specified, check the type parameter
				if (coinType && !df.nameType.includes(coinType)) continue;

				// Check if this entry matches the requested gate ID
				const nameObj = df.nameJson as Record<string, unknown> | null;
				if (!nameObj) continue;
				if (String(nameObj.gate_id ?? "") !== gateId) continue;

				// Extract the coin type from the key type repr: "PKG::config::GateKey<COIN_TYPE>"
				const coinTypeMatch = df.nameType.match(/GateKey<(.+)>$/);
				const resolvedCoinType = coinTypeMatch ? coinTypeMatch[1] : (coinType ?? "");

				// Parse the config value
				const fields = df.valueJson as Record<string, unknown> | undefined;
				if (!fields) continue;

				return {
					gateId,
					registryId: String(fields.registry_id ?? ""),
					minAccess: Number(fields.min_access ?? 0),
					freeAccess: Number(fields.free_access ?? 0),
					tollAmount: BigInt(String(fields.toll_amount ?? 0)),
					tollCoinType: resolvedCoinType,
					tollRecipient: String(fields.toll_recipient ?? ""),
					permitDurationMs: BigInt(String(fields.permit_duration_ms ?? 600000)),
				};
			}

			hasMore = page.hasNextPage;
			cursor = page.cursor;
		}
	} catch {
		// Return null on failure
	}

	return null;
}
