/**
 * Currency Market -- Transaction builders and query helpers for the
 * currency_market::currency_market Move module.
 *
 * Each currency has exactly one CurrencyMarket<T> shared object. Anyone can
 * post sell listings (advertisements pointing to SSU markets) and buy orders
 * (with Coin<T> escrow). Markets are created by the currency creator via
 * TreasuryCap or OrgTreasury proof.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { getDynamicFieldJson, getObjectJson, listDynamicFieldsGql } from "./graphql-queries";
import type {
	CurrencyMarketBuyOrder,
	CurrencyMarketInfo,
	CurrencyMarketSellListing,
} from "./types";

// ── Market Creation ─────────────────────────────────────────────────────────

export interface CreateCurrencyMarketParams {
	packageId: string;
	treasuryCapId: string;
	coinType: string;
	feeBps: number;
	senderAddress: string;
}

/**
 * Build a transaction to create a CurrencyMarket<T> by proving currency
 * ownership via TreasuryCap.
 */
export function buildCreateCurrencyMarket(params: CreateCurrencyMarketParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::currency_market::create_market`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.treasuryCapId), tx.pure.u64(params.feeBps)],
	});

	return tx;
}

export interface CreateCurrencyMarketFromTreasuryParams {
	packageId: string;
	orgTreasuryId: string;
	orgObjectId: string;
	coinType: string;
	feeBps: number;
	senderAddress: string;
}

/**
 * Build a transaction to create a CurrencyMarket<T> from an OrgTreasury
 * (TreasuryCap locked in org). Requires org stakeholder authorization.
 */
export function buildCreateCurrencyMarketFromTreasury(
	params: CreateCurrencyMarketFromTreasuryParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::currency_market::create_market_from_treasury`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgTreasuryId),
			tx.object(params.orgObjectId),
			tx.pure.u64(params.feeBps),
		],
	});

	return tx;
}

// ── Sell Listings (Advertisements) ──────────────────────────────────────────

export interface PostSellListingParams {
	packageId: string;
	marketId: string;
	coinType: string;
	ssuId: string;
	marketConfigId: string;
	typeId: number;
	pricePerUnit: number;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a transaction to post a sell listing advertisement.
 * Items stay in the SSU -- this is a directory entry for discovery.
 */
export function buildPostSellListing(params: PostSellListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::currency_market::post_sell_listing`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.pure.id(params.ssuId),
			tx.pure.id(params.marketConfigId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.u64(params.quantity),
			tx.object("0x6"), // Clock shared object
		],
	});

	return tx;
}

export interface UpdateSellListingParams {
	packageId: string;
	marketId: string;
	coinType: string;
	listingId: number;
	pricePerUnit: number;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a transaction to update price and quantity on a sell listing. Seller only.
 */
export function buildUpdateSellListing(params: UpdateSellListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::currency_market::update_sell_listing`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.pure.u64(params.listingId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.u64(params.quantity),
		],
	});

	return tx;
}

export interface CancelSellListingParams {
	packageId: string;
	marketId: string;
	coinType: string;
	listingId: number;
	senderAddress: string;
}

/**
 * Build a transaction to cancel a sell listing. Seller only.
 */
export function buildCancelSellListing(params: CancelSellListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::currency_market::cancel_sell_listing`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.marketId), tx.pure.u64(params.listingId)],
	});

	return tx;
}

// ── Buy Orders (Coin Escrow) ────────────────────────────────────────────────

export interface PostBuyOrderParams {
	packageId: string;
	marketId: string;
	coinType: string;
	paymentObjectId: string;
	typeId: number;
	pricePerUnit: number;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a transaction to post a buy order with escrowed Coin<T>.
 */
export function buildPostBuyOrder(params: PostBuyOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::currency_market::post_buy_order`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.object(params.paymentObjectId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.u64(params.quantity),
		],
	});

	return tx;
}

export interface FillBuyOrderParams {
	packageId: string;
	marketId: string;
	coinType: string;
	orderId: number;
	sellerAddress: string;
	fillQuantity: number;
	senderAddress: string;
}

/**
 * Build a transaction to fill a buy order. Buyer confirms delivery,
 * releases escrowed payment to seller. Supports partial fills.
 */
export function buildFillBuyOrder(params: FillBuyOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::currency_market::fill_buy_order`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.pure.u64(params.orderId),
			tx.pure.address(params.sellerAddress),
			tx.pure.u64(params.fillQuantity),
		],
	});

	return tx;
}

export interface CancelCurrencyMarketBuyOrderParams {
	packageId: string;
	marketId: string;
	coinType: string;
	orderId: number;
	senderAddress: string;
}

/**
 * Build a transaction to cancel a buy order. Returns escrowed coins to buyer.
 */
export function buildCancelCurrencyMarketBuyOrder(
	params: CancelCurrencyMarketBuyOrderParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::currency_market::cancel_buy_order`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.marketId), tx.pure.u64(params.orderId)],
	});

	return tx;
}

// ── Query Functions ─────────────────────────────────────────────────────────

/**
 * Discover CurrencyMarket<T> objects on-chain.
 * Since CurrencyMarket is generic, we search for all objects matching
 * the pattern `packageId::currency_market::CurrencyMarket<*>`.
 */
export async function queryCurrencyMarkets(
	client: SuiGraphQLClient,
	packageId: string,
	coinType?: string,
): Promise<CurrencyMarketInfo[]> {
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

	const markets: CurrencyMarketInfo[] = [];
	const searchType = coinType
		? `${packageId}::currency_market::CurrencyMarket<${coinType}>`
		: `${packageId}::currency_market::CurrencyMarket`;
	let cursor: string | null = null;
	let hasMore = true;

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

			// Extract coin type from CurrencyMarket<CoinType> repr
			const match = typeRepr.match(/CurrencyMarket<(.+)>$/);
			const resolvedCoinType = match ? match[1] : (coinType ?? "");

			markets.push({
				objectId: node.address,
				creator: String(json.creator ?? ""),
				feeBps: Number(json.fee_bps ?? 0),
				feeRecipient: String(json.fee_recipient ?? ""),
				nextSellId: Number(json.next_sell_id ?? 0),
				nextBuyId: Number(json.next_buy_id ?? 0),
				coinType: resolvedCoinType,
			});
		}

		hasMore = objects.pageInfo.hasNextPage;
		cursor = objects.pageInfo.endCursor;
	}

	return markets;
}

/**
 * Fetch a single CurrencyMarket's details by object ID.
 */
export async function queryCurrencyMarketDetails(
	client: SuiGraphQLClient,
	marketId: string,
): Promise<CurrencyMarketInfo | null> {
	try {
		const obj = await getObjectJson(client, marketId);
		if (!obj.json) return null;

		const fields = obj.json;
		const typeRepr = obj.type ?? "";
		const match = typeRepr.match(/CurrencyMarket<(.+)>$/);

		return {
			objectId: marketId,
			creator: String(fields.creator ?? ""),
			feeBps: Number(fields.fee_bps ?? 0),
			feeRecipient: String(fields.fee_recipient ?? ""),
			nextSellId: Number(fields.next_sell_id ?? 0),
			nextBuyId: Number(fields.next_buy_id ?? 0),
			coinType: match ? match[1] : "",
		};
	} catch {
		return null;
	}
}

/**
 * Fetch all sell listings from a CurrencyMarket.
 * Listings are stored as dynamic fields keyed by u64 listing_id.
 * Buy orders use the same key space, so we distinguish by field structure.
 */
export async function queryCurrencyMarketListings(
	client: SuiGraphQLClient,
	marketId: string,
): Promise<CurrencyMarketSellListing[]> {
	const listings: CurrencyMarketSellListing[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, marketId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				if (df.nameType !== "u64") continue;
				const key = Number(df.nameJson);

				try {
					const fields = await getDynamicFieldJson(client, marketId, {
						type: "u64",
						value: String(key),
					});
					if (!fields) continue;

					// SellListing has ssu_id field; BuyOrder does not
					if ("ssu_id" in fields) {
						listings.push({
							listingId: Number(fields.listing_id ?? key),
							seller: String(fields.seller ?? ""),
							ssuId: String(fields.ssu_id ?? ""),
							marketConfigId: String(fields.market_config_id ?? ""),
							typeId: Number(fields.type_id ?? 0),
							pricePerUnit: Number(fields.price_per_unit ?? 0),
							quantity: Number(fields.quantity ?? 0),
							postedAtMs: Number(fields.posted_at_ms ?? 0),
						});
					}
				} catch {
					// Skip individual field read errors
				}
			}

			hasMore = page.hasNextPage;
			cursor = page.cursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return listings;
}

/**
 * Fetch all buy orders from a CurrencyMarket.
 * Buy order records have u64 keys. Coin escrows use keys offset by
 * 1_000_000_000 and are skipped.
 */
export async function queryCurrencyMarketBuyOrders(
	client: SuiGraphQLClient,
	marketId: string,
): Promise<CurrencyMarketBuyOrder[]> {
	const orders: CurrencyMarketBuyOrder[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, marketId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				if (df.nameType !== "u64") continue;
				const key = Number(df.nameJson);
				// Skip coin escrow keys (offset by 1_000_000_000)
				if (key >= 1_000_000_000) continue;

				try {
					const fields = await getDynamicFieldJson(client, marketId, {
						type: "u64",
						value: String(key),
					});
					if (!fields) continue;

					// BuyOrder has buyer field but NOT ssu_id (distinguishes from SellListing)
					if ("buyer" in fields && !("ssu_id" in fields)) {
						orders.push({
							orderId: Number(fields.order_id ?? key),
							buyer: String(fields.buyer ?? ""),
							typeId: Number(fields.type_id ?? 0),
							pricePerUnit: Number(fields.price_per_unit ?? 0),
							quantity: Number(fields.quantity ?? 0),
						});
					}
				} catch {
					// Skip individual field read errors
				}
			}

			hasMore = page.hasNextPage;
			cursor = page.cursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return orders;
}
