/**
 * Treasury queries -- app-level wrappers around the chain-shared treasury functions.
 *
 * Each wrapper pairs a chain read with an IndexedDB (db.treasuries) upsert so views can render the
 * cached record instantly and refresh from chain in the background. The cache is the 1:1 link
 * between a currency's coinType and its Treasury object.
 */

import { db } from "@/db";
import type { TreasuryBalanceEntry, TreasuryRecord } from "@/db/types";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	type TreasuryBalance,
	type TreasuryInfo,
	discoverTreasuries,
	queryTreasuryBalances,
	queryTreasuryDetails,
} from "@tehfrontier/chain-shared";

/** Map chain balance entries to the cache's string-amount shape. */
function toBalanceEntries(balances: TreasuryBalance[]): TreasuryBalanceEntry[] {
	return balances.map((b) => ({
		coinType: b.coinType,
		symbol: b.coinType.split("::").pop()?.replace(/_TOKEN$/, "") ?? b.coinType,
		amount: String(b.amount),
	}));
}

export interface TreasurySyncResult {
	record: TreasuryRecord;
	info: TreasuryInfo | null;
	balances: TreasuryBalance[];
}

/**
 * Query a treasury's details + balances from chain and upsert the cache. Falls back to the cached
 * record (if any) when the chain reads come back empty, so a transient failure never blanks the row.
 * `coinType` is the owning currency's coin type -- pass it so the 1:1 cache link is preserved.
 */
export async function syncTreasury(
	client: SuiGraphQLClient,
	treasuryId: string,
	coinType?: string,
): Promise<TreasurySyncResult | null> {
	const [info, balances] = await Promise.all([
		queryTreasuryDetails(client, treasuryId),
		queryTreasuryBalances(client, treasuryId),
	]);

	const existing = await db.treasuries.get(treasuryId);
	if (!info && balances.length === 0) {
		return existing ? { record: existing, info: null, balances: [] } : null;
	}

	const record: TreasuryRecord = {
		id: treasuryId,
		name: info?.name ?? existing?.name ?? "",
		owner: info?.owner ?? existing?.owner ?? "",
		admins: info?.admins ?? existing?.admins ?? [],
		balances: balances.length > 0 ? toBalanceEntries(balances) : (existing?.balances ?? []),
		coinType: coinType ?? existing?.coinType ?? "",
	};
	await db.treasuries.put(record);
	return { record, info, balances };
}

/**
 * Discover the treasuries created by an address and cache a skeleton record for any not yet known.
 * Returns the raw discovery list (treasuryId + name) so callers can match by name convention.
 */
export async function syncTreasuriesForOwner(
	client: SuiGraphQLClient,
	treasuryPackageId: string,
	ownerAddress: string,
): Promise<Array<{ treasuryId: string; name: string }>> {
	const discovered = await discoverTreasuries(client, treasuryPackageId, ownerAddress);
	for (const t of discovered) {
		if (!t.treasuryId) continue;
		const existing = await db.treasuries.get(t.treasuryId);
		if (!existing) {
			await db.treasuries.put({
				id: t.treasuryId,
				name: t.name,
				owner: ownerAddress,
				admins: [],
				balances: [],
				coinType: "",
			});
		}
	}
	return discovered;
}

/**
 * Get all locally cached treasuries for an address (owner or admin).
 */
export async function getCachedTreasuries(address: string): Promise<TreasuryRecord[]> {
	const all = await db.treasuries.toArray();
	return all.filter((t) => t.owner === address || t.admins.includes(address));
}
