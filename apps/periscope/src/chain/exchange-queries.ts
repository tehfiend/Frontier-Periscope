/**
 * Exchange pair discovery and order queries.
 *
 * Discovers all OrderBook shared objects on-chain and caches them in
 * db.manifestExchangePairs. Uses queryOrders from chain-shared for
 * on-demand order fetching.
 */

import type { TenantId } from "@/chain/config";
import { db } from "@/db";
import type { ManifestExchangePair } from "@/db/types";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import type { OrderInfo } from "@tehfrontier/chain-shared";
import { getContractAddresses, queryOrders } from "@tehfrontier/chain-shared";

// ── Discover Exchange Pairs ──────────────────────────────────────────────────

/**
 * Discover all OrderBook shared objects by querying for
 * `{exchangePkg}::exchange::OrderBook` type. Cache results in
 * db.manifestExchangePairs.
 */
export async function discoverExchangePairs(
	client: SuiGraphQLClient,
	tenant: TenantId,
): Promise<void> {
	const addresses = getContractAddresses(tenant);
	const exchangePkg = addresses.exchange?.packageId;
	if (!exchangePkg) return;

	const QUERY = `
		query($type: String!, $first: Int, $after: String) {
			objects(filter: { type: $type }, first: $first, after: $after) {
				nodes {
					address
					asMoveObject { contents { json type { repr } } }
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	`;

	interface Response {
		objects: {
			nodes: Array<{
				address: string;
				asMoveObject?: {
					contents?: { json: Record<string, unknown>; type: { repr: string } };
				};
			}>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	}

	const searchType = `${exchangePkg}::exchange::OrderBook`;
	let cursor: string | null = null;
	let hasMore = true;
	const now = new Date().toISOString();

	while (hasMore) {
		const result: { data?: Response } = await client.query({
			query: QUERY,
			variables: { type: searchType, first: 50, after: cursor },
		});

		const objects = result.data?.objects;
		if (!objects) break;

		for (const node of objects.nodes) {
			const json = node.asMoveObject?.contents?.json;
			const typeRepr = node.asMoveObject?.contents?.type?.repr ?? "";
			if (!json) continue;

			// Extract coin types from "PKG::exchange::OrderBook<CoinA, CoinB>"
			const match = typeRepr.match(/::exchange::OrderBook<(.+),\s*(.+)>$/);
			if (!match) continue;

			const entry: ManifestExchangePair = {
				id: node.address,
				coinTypeA: match[1].trim(),
				coinTypeB: match[2].trim(),
				feeBps: Number(json.fee_bps ?? 0),
				cachedAt: now,
			};
			await db.manifestExchangePairs.put(entry);
		}

		hasMore = objects.pageInfo.hasNextPage;
		cursor = objects.pageInfo.endCursor;
	}
}

// ── Fetch Orders for a Specific OrderBook ────────────────────────────────────

/**
 * Fetch orders for a specific OrderBook on demand.
 * Delegates to queryOrders from chain-shared which enumerates
 * bid/ask dynamic fields with full pagination.
 */
export async function fetchExchangeOrders(
	client: SuiGraphQLClient,
	bookObjectId: string,
): Promise<OrderInfo[]> {
	return queryOrders(client, bookObjectId);
}
