/**
 * Decommission Registry -- TX builders and query helpers for the
 * decommission::decommission Move module.
 *
 * The Registry is a shared object mapping market IDs to decommissioner
 * addresses. Any address can decommission a market; only the original
 * decommissioner can recommission it.
 *
 * Periscope UI restricts the decommission button to the market creator.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";

// ── Decommission ─────────────────────────────────────────────────────────────

export interface DecommissionParams {
	packageId: string;
	registryObjectId: string;
	marketId: string;
	senderAddress: string;
}

/** Build a TX to mark a market as decommissioned. */
export function buildDecommission(params: DecommissionParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::decommission::decommission`,
		arguments: [tx.object(params.registryObjectId), tx.pure.address(params.marketId)],
	});

	return tx;
}

// ── Recommission ─────────────────────────────────────────────────────────────

export interface RecommissionParams {
	packageId: string;
	registryObjectId: string;
	marketId: string;
	senderAddress: string;
}

/** Build a TX to recommission a previously decommissioned market. */
export function buildRecommission(params: RecommissionParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::decommission::recommission`,
		arguments: [tx.object(params.registryObjectId), tx.pure.address(params.marketId)],
	});

	return tx;
}

// ── Query ────────────────────────────────────────────────────────────────────

const DECOMMISSION_EVENTS_QUERY = `
	query($type: String!, $first: Int, $after: String) {
		events(filter: { type: $type }, first: $first, after: $after) {
			nodes {
				contents { json }
			}
			pageInfo { hasNextPage endCursor }
		}
	}
`;

interface EventsResponse {
	events: {
		nodes: Array<{
			contents?: { json: Record<string, unknown> };
		}>;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

/**
 * Query all decommissioned market IDs by replaying on-chain events.
 *
 * Fetches all DecommissionEvent and RecommissionEvent events emitted
 * by the decommission package, then computes the net decommissioned set.
 *
 * Returns a Set of market addresses (0x-prefixed hex strings).
 */
export async function queryDecommissionedMarkets(
	client: SuiGraphQLClient,
	packageId: string,
): Promise<Set<string>> {
	const decommissioned = new Set<string>();

	try {
		// Fetch all DecommissionEvents
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const result: { data?: EventsResponse } = await client.query({
				query: DECOMMISSION_EVENTS_QUERY,
				variables: {
					type: `${packageId}::decommission::DecommissionEvent`,
					first: 50,
					after: cursor,
				},
			});

			const page = result.data?.events;
			if (!page) break;

			for (const node of page.nodes) {
				const marketId = node.contents?.json?.market_id;
				if (marketId) {
					decommissioned.add(String(marketId));
				}
			}

			hasMore = page.pageInfo.hasNextPage;
			cursor = page.pageInfo.endCursor;
		}

		// Remove any that were recommissioned
		cursor = null;
		hasMore = true;

		while (hasMore) {
			const result: { data?: EventsResponse } = await client.query({
				query: DECOMMISSION_EVENTS_QUERY,
				variables: {
					type: `${packageId}::decommission::RecommissionEvent`,
					first: 50,
					after: cursor,
				},
			});

			const page = result.data?.events;
			if (!page) break;

			for (const node of page.nodes) {
				const marketId = node.contents?.json?.market_id;
				if (marketId) {
					decommissioned.delete(String(marketId));
				}
			}

			hasMore = page.pageInfo.hasNextPage;
			cursor = page.pageInfo.endCursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return decommissioned;
}
