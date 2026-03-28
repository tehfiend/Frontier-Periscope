/**
 * Currency sync -- shared logic for syncing CurrencyRecord entries
 * from manifest cache (ManifestMarket objects).
 *
 * Replaces the duplicated syncMarkets callbacks that existed in
 * both Market.tsx and Treasury.tsx.
 */

import { discoverMarkets } from "@/chain/manifest";
import { db, notDeleted } from "@/db";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { getCoinMetadata } from "@tehfrontier/chain-shared";

/**
 * Sync CurrencyRecord entries from the manifest cache.
 *
 * 1. Refreshes the ManifestMarket cache via discoverMarkets.
 * 2. Upserts CurrencyRecord entries for markets the user has access to.
 * 3. Removes stale CurrencyRecord entries whose Market is gone.
 *
 * @param client - SuiGraphQLClient instance
 * @param suiAddress - Active character's Sui address
 * @param walletAddress - Connected wallet address (optional)
 */
export async function syncCurrenciesFromManifest(
	client: SuiGraphQLClient,
	suiAddress: string,
	walletAddress?: string,
): Promise<void> {
	try {
		// Refresh manifest cache first
		await discoverMarkets(client);

		// Read from cached manifest
		const markets = await db.manifestMarkets.toArray();
		const validMarketIds = new Set<string>();

		for (const market of markets) {
			if (
				market.creator !== suiAddress &&
				!market.authorized.includes(suiAddress) &&
				(!walletAddress ||
					(market.creator !== walletAddress && !market.authorized.includes(walletAddress)))
			) {
				continue;
			}

			validMarketIds.add(market.id);

			const existing = await db.currencies.where("coinType").equals(market.coinType).first();
			if (existing) {
				if (!existing.marketId) {
					await db.currencies.update(existing.id, {
						marketId: market.id,
					});
				}
				continue;
			}

			const parts = market.coinType.split("::");
			const packageId = parts[0] ?? "";
			const moduleName = parts.length >= 2 ? parts[1] : "";
			const structName = parts.length >= 3 ? parts[2] : moduleName;
			const sym = structName.replace(/_TOKEN$/, "");

			let coinDecimals = 9;
			try {
				const meta = await getCoinMetadata(client, market.coinType);
				if (meta) coinDecimals = meta.decimals;
			} catch {
				// Fall back to 9 if metadata unavailable
			}

			const now = new Date().toISOString();
			await db.currencies.add({
				id: crypto.randomUUID(),
				symbol: sym,
				name: `${sym} Token`,
				description: "",
				moduleName,
				coinType: market.coinType,
				packageId,
				marketId: market.id,
				decimals: coinDecimals,
				createdAt: now,
				updatedAt: now,
			});
		}

		// Remove currencies whose Market is on an old/incompatible package
		const allCurrencies = await db.currencies.filter(notDeleted).toArray();
		for (const c of allCurrencies) {
			if (c.marketId && !validMarketIds.has(c.marketId)) {
				await db.currencies.delete(c.id);
			}
		}
	} catch {
		// Silent -- sync is best-effort
	}
}
