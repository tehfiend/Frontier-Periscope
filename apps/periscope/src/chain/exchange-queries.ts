/**
 * Exchange pair discovery and order queries.
 *
 * Discovers all OrderBook shared objects on-chain and caches them in
 * db.manifestExchangePairs. Also provides on-demand order fetching
 * for a specific OrderBook.
 *
 * NOTE: queryOrderBook / queryOrders are being added to chain-shared
 * by another agent. Imports may not resolve until that work merges.
 */

import { db } from "@/db";
import type { ManifestExchangePair } from "@/db/types";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import type { OrderInfo } from "@tehfrontier/chain-shared";
import { getContractAddresses } from "@tehfrontier/chain-shared";

// ── Discover Exchange Pairs ──────────────────────────────────────────────────

/**
 * Discover all OrderBook shared objects by querying for
 * `{exchangePkg}::exchange::OrderBook` type. Cache results in
 * db.manifestExchangePairs.
 */
export async function discoverExchangePairs(client: SuiGraphQLClient): Promise<void> {
	const addresses = getContractAddresses("stillness");
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
 * Uses dynamic field queries to read bid/ask entries.
 *
 * Returns a combined array of OrderInfo with isBid flag.
 */
export async function fetchExchangeOrders(
	client: SuiGraphQLClient,
	bookObjectId: string,
): Promise<OrderInfo[]> {
	// Query dynamic fields of the OrderBook to get orders
	const QUERY = `
		query($parentId: SuiAddress!, $first: Int, $after: String) {
			owner(address: $parentId) {
				dynamicFields(first: $first, after: $after) {
					nodes {
						value {
							... on MoveObject {
								contents { json type { repr } }
							}
						}
					}
					pageInfo { hasNextPage endCursor }
				}
			}
		}
	`;

	interface DFResponse {
		owner?: {
			dynamicFields: {
				nodes: Array<{
					value?: {
						contents?: { json: Record<string, unknown>; type: { repr: string } };
					};
				}>;
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
			};
		};
	}

	const orders: OrderInfo[] = [];
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		const result: { data?: DFResponse } = await client.query({
			query: QUERY,
			variables: { parentId: bookObjectId, first: 50, after: cursor },
		});

		const df = result.data?.owner?.dynamicFields;
		if (!df) break;

		for (const node of df.nodes) {
			const json = node.value?.contents?.json;
			const typeRepr = node.value?.contents?.type?.repr ?? "";
			if (!json) continue;

			// Check if this is a bid or ask order
			const isBid = typeRepr.includes("BidOrder") || typeRepr.includes("bid");
			const isAsk = typeRepr.includes("AskOrder") || typeRepr.includes("ask");
			if (!isBid && !isAsk) continue;

			orders.push({
				orderId: Number(json.order_id ?? json.id ?? 0),
				owner: String(json.owner ?? ""),
				price: Number(json.price ?? 0),
				amount: Number(json.amount ?? 0),
				isBid,
			});
		}

		hasMore = df.pageInfo.hasNextPage;
		cursor = df.pageInfo.endCursor;
	}

	return orders;
}
