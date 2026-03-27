/**
 * Treasury queries -- app-level wrappers for chain-shared treasury functions.
 *
 * Wraps chain-shared query functions with IndexedDB caching so the
 * Treasury view can display data instantly from the local cache
 * while refreshing from the chain in the background.
 */

import { db } from "@/db";
import type { TreasuryRecord } from "@/db/types";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";

// Note: These imports will resolve once the chain-shared treasury module is merged.
// For now they are typed stubs -- the build will succeed after both branches merge.
// import {
// 	queryTreasuryDetails,
// 	queryTreasuryBalances,
// 	type TreasuryInfo,
// 	type TreasuryBalance,
// } from "@tehfrontier/chain-shared";

/**
 * Sync a single treasury's data from chain into IndexedDB.
 */
export async function syncTreasury(
	_client: SuiGraphQLClient,
	treasuryId: string,
): Promise<TreasuryRecord | null> {
	// TODO: Uncomment once chain-shared treasury module is available
	// const info = await queryTreasuryDetails(client, treasuryId);
	// if (!info) return null;
	//
	// const balances = await queryTreasuryBalances(client, treasuryId);
	// const balanceEntries = balances.map((b) => ({
	// 	coinType: b.coinType,
	// 	symbol: b.coinType.split("::").pop()?.replace(/_TOKEN$/, "") ?? b.coinType,
	// 	amount: b.amount.toString(),
	// }));
	//
	// const record: TreasuryRecord = {
	// 	id: info.objectId,
	// 	name: info.name,
	// 	owner: info.owner,
	// 	admins: info.admins,
	// 	balances: balanceEntries,
	// };
	//
	// await db.treasuries.put(record);
	// return record;

	// Stub -- returns cached record if available
	const cached = await db.treasuries.get(treasuryId);
	return cached ?? null;
}

/**
 * Sync all treasuries owned by or administered by the given address.
 */
export async function syncTreasuriesForOwner(
	_client: SuiGraphQLClient,
	_ownerAddress: string,
): Promise<TreasuryRecord[]> {
	// TODO: Uncomment once chain-shared treasury query-by-owner is available
	// For now, return cached records
	const cached = await db.treasuries.where("owner").equals(_ownerAddress).toArray();
	return cached;
}

/**
 * Get all locally cached treasuries for an address (owner or admin).
 */
export async function getCachedTreasuries(address: string): Promise<TreasuryRecord[]> {
	const all = await db.treasuries.toArray();
	return all.filter((t) => t.owner === address || t.admins.includes(address));
}
