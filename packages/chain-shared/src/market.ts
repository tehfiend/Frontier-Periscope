/**
 * Market -- Transaction builders and query helpers for the market::market
 * Move module.
 *
 * Market<T> is a unified object containing the TreasuryCap, order book (sell
 * listings + buy orders), authorized-minters list, and fee configuration.
 * Dynamic field keys are typed structs (SellKey, BuyKey, BuyCoinKey).
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { getDynamicFieldJson, getObjectJson, listDynamicFieldsGql } from "./graphql-queries";
import type { MarketBuyOrder, MarketInfo, MarketSellListing } from "./types";

// ── Mint/Burn (authorized access) ──────────────────────────────────────────

export interface MintParams {
	packageId: string;
	marketId: string;
	coinType: string;
	amount: number;
	recipient: string;
	senderAddress: string;
}

/** Build a TX to mint tokens from Market<T>. Authorized addresses only. */
export function buildMint(params: MintParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::mint`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.pure.u64(params.amount),
			tx.pure.address(params.recipient),
		],
	});

	return tx;
}

export interface BurnParams {
	packageId: string;
	marketId: string;
	coinType: string;
	coinObjectId: string;
	senderAddress: string;
}

/** Build a TX to burn tokens via Market<T>. Any holder can burn. */
export function buildBurn(params: BurnParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::burn`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.marketId), tx.object(params.coinObjectId)],
	});

	return tx;
}

// ── Authorization management (creator only) ────────────────────────────────

export interface AddAuthorizedParams {
	packageId: string;
	marketId: string;
	coinType: string;
	addr: string;
	senderAddress: string;
}

/** Build a TX to add an address to the authorized list. Creator only. */
export function buildAddAuthorized(params: AddAuthorizedParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::add_authorized`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.marketId), tx.pure.address(params.addr)],
	});

	return tx;
}

export interface RemoveAuthorizedParams {
	packageId: string;
	marketId: string;
	coinType: string;
	addr: string;
	senderAddress: string;
}

/** Build a TX to remove an address from the authorized list. Creator only. */
export function buildRemoveAuthorized(params: RemoveAuthorizedParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::remove_authorized`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.marketId), tx.pure.address(params.addr)],
	});

	return tx;
}

// ── Fee management (creator only) ──────────────────────────────────────────

export interface UpdateFeeParams {
	packageId: string;
	marketId: string;
	coinType: string;
	feeBps: number;
	feeRecipient: string;
	senderAddress: string;
}

/** Build a TX to update fee configuration. Creator only. */
export function buildUpdateFee(params: UpdateFeeParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::update_fee`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.pure.u64(params.feeBps),
			tx.pure.address(params.feeRecipient),
		],
	});

	return tx;
}

// ── Sell listings (anyone can post) ────────────────────────────────────────

export interface PostSellListingParams {
	packageId: string;
	marketId: string;
	coinType: string;
	ssuId: string;
	typeId: number;
	pricePerUnit: number;
	quantity: number;
	senderAddress: string;
}

/** Build a TX to post a sell listing on Market<T>. */
export function buildPostSellListing(params: PostSellListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::post_sell_listing`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.pure.id(params.ssuId),
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

/** Build a TX to update price and quantity on a sell listing. Seller only. */
export function buildUpdateSellListing(params: UpdateSellListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::update_sell_listing`,
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

/** Build a TX to cancel a sell listing. Seller only. */
export function buildCancelSellListing(params: CancelSellListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::cancel_sell_listing`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.marketId), tx.pure.u64(params.listingId)],
	});

	return tx;
}

// ── Buy orders (anyone can post, with coin escrow) ─────────────────────────

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

/** Build a TX to post a buy order with escrowed Coin<T>. */
export function buildPostBuyOrder(params: PostBuyOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::post_buy_order`,
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

export interface CancelBuyOrderParams {
	packageId: string;
	marketId: string;
	coinType: string;
	orderId: number;
	senderAddress: string;
}

/** Build a TX to cancel a buy order. Returns escrowed coins to buyer. */
export function buildCancelBuyOrder(params: CancelBuyOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::cancel_buy_order`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.marketId), tx.pure.u64(params.orderId)],
	});

	return tx;
}

// ── Query Functions ────────────────────────────────────────────────────────

/**
 * Discover Market<T> objects on-chain.
 * If coinType is provided, searches for Market<coinType>; otherwise searches
 * for all Market<*> objects.
 */
export async function queryMarkets(
	client: SuiGraphQLClient,
	packageId: string,
	coinType?: string,
): Promise<MarketInfo[]> {
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

	const markets: MarketInfo[] = [];
	const searchType = coinType
		? `${packageId}::market::Market<${coinType}>`
		: `${packageId}::market::Market`;
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

			// Extract coin type from Market<CoinType> repr
			const match = typeRepr.match(/Market<(.+)>$/);
			const resolvedCoinType = match ? match[1] : (coinType ?? "");

			markets.push({
				objectId: node.address,
				creator: String(json.creator ?? ""),
				authorized: ((json.authorized as unknown[]) ?? []).map(String),
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
 * Fetch a single Market's details by object ID. Returns MarketInfo | null.
 */
export async function queryMarketDetails(
	client: SuiGraphQLClient,
	marketId: string,
): Promise<MarketInfo | null> {
	try {
		const obj = await getObjectJson(client, marketId);
		if (!obj.json) return null;

		const fields = obj.json;
		const typeRepr = obj.type ?? "";
		const match = typeRepr.match(/Market<(.+)>$/);

		return {
			objectId: marketId,
			creator: String(fields.creator ?? ""),
			authorized: ((fields.authorized as unknown[]) ?? []).map(String),
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
 * Fetch all sell listings from a Market.
 * Listings are stored as dynamic fields keyed by SellKey { listing_id }.
 * We filter by the SellKey type name in dynamic field listings.
 */
export async function queryMarketListings(
	client: SuiGraphQLClient,
	marketId: string,
	marketPackageId: string,
): Promise<MarketSellListing[]> {
	const listings: MarketSellListing[] = [];
	const sellKeyType = `${marketPackageId}::market::SellKey`;

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, marketId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				// Filter by SellKey type
				if (!df.nameType.includes("SellKey")) continue;

				// Extract listing_id from the key JSON
				const nameObj = df.nameJson as Record<string, unknown> | null;
				const listingId = nameObj ? Number(nameObj.listing_id ?? 0) : 0;

				try {
					const fields = await getDynamicFieldJson(client, marketId, {
						type: sellKeyType,
						value: JSON.stringify({ listing_id: String(listingId) }),
					});
					if (!fields) continue;

					listings.push({
						listingId: Number(fields.listing_id ?? listingId),
						seller: String(fields.seller ?? ""),
						ssuId: String(fields.ssu_id ?? ""),
						typeId: Number(fields.type_id ?? 0),
						pricePerUnit: Number(fields.price_per_unit ?? 0),
						quantity: Number(fields.quantity ?? 0),
						postedAtMs: Number(fields.posted_at_ms ?? 0),
					});
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
 * Fetch all buy orders from a Market.
 * Buy orders are stored as dynamic fields keyed by BuyKey { order_id }.
 * We filter by the BuyKey type name in dynamic field listings.
 */
export async function queryMarketBuyOrders(
	client: SuiGraphQLClient,
	marketId: string,
	marketPackageId: string,
): Promise<MarketBuyOrder[]> {
	const orders: MarketBuyOrder[] = [];
	const buyKeyType = `${marketPackageId}::market::BuyKey`;

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, marketId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				// Filter by BuyKey type (exclude BuyCoinKey)
				if (!df.nameType.includes("BuyKey") || df.nameType.includes("BuyCoinKey")) continue;

				// Extract order_id from the key JSON
				const nameObj = df.nameJson as Record<string, unknown> | null;
				const orderId = nameObj ? Number(nameObj.order_id ?? 0) : 0;

				try {
					const fields = await getDynamicFieldJson(client, marketId, {
						type: buyKeyType,
						value: JSON.stringify({ order_id: String(orderId) }),
					});
					if (!fields) continue;

					orders.push({
						orderId: Number(fields.order_id ?? orderId),
						buyer: String(fields.buyer ?? ""),
						typeId: Number(fields.type_id ?? 0),
						pricePerUnit: Number(fields.price_per_unit ?? 0),
						quantity: Number(fields.quantity ?? 0),
					});
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
