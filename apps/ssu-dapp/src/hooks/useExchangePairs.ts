import { getTenant } from "@/lib/constants";
import { useSuiClient } from "./useSuiClient";
import {
	type OrderBookInfo,
	type TenantId,
	getContractAddresses,
} from "@tehfrontier/chain-shared";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { useQuery } from "@tanstack/react-query";

interface GqlResponse {
	objects: {
		nodes: Array<{
			address: string;
			asMoveObject?: {
				contents?: {
					json: Record<string, unknown>;
					type: { repr: string };
				};
			};
		}>;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

async function fetchExchangePairs(client: SuiGraphQLClient): Promise<OrderBookInfo[]> {
	const tenant = getTenant() as TenantId;
	const exchangePkg = getContractAddresses(tenant).exchange?.packageId;
	if (!exchangePkg) return [];

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

	const searchType = `${exchangePkg}::exchange::OrderBook`;
	let cursor: string | null = null;
	let hasMore = true;
	const pairs: OrderBookInfo[] = [];

	while (hasMore) {
		const result: { data?: GqlResponse } = await client.query({
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

			pairs.push({
				objectId: node.address,
				coinTypeA: match[1].trim(),
				coinTypeB: match[2].trim(),
				bidCount: Number(json.bid_count ?? 0),
				askCount: Number(json.ask_count ?? 0),
				feeBps: Number(json.fee_bps ?? 0),
			});
		}

		hasMore = objects.pageInfo.hasNextPage;
		cursor = objects.pageInfo.endCursor;
	}

	return pairs;
}

/**
 * Fetch all exchange OrderBook pairs on-chain.
 * Queries by `{exchangePkg}::exchange::OrderBook` type, paginates,
 * and extracts coinTypeA/coinTypeB from the type repr string.
 */
export function useExchangePairs() {
	const client = useSuiClient();

	return useQuery({
		queryKey: ["exchangePairs"],
		queryFn: () => fetchExchangePairs(client),
		staleTime: 60_000,
	});
}
