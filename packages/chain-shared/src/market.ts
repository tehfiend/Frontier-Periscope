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
import type { CrossMarketListing, MarketBuyOrder, MarketInfo, MarketSellListing } from "./types";

// ── Market Creation ─────────────────────────────────────────────────────────

export interface CreateMarketParams {
	packageId: string;
	coinType: string;
	treasuryCapId: string;
	senderAddress: string;
}

/** Build a TX to create a Market<T> by consuming TreasuryCap. */
export function buildCreateMarket(params: CreateMarketParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market::create_market`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.treasuryCapId)],
	});

	return tx;
}

/**
 * Find a TreasuryCap<T> owned by the given address.
 * Returns the object ID if found, null otherwise.
 */
export async function queryTreasuryCap(
	client: SuiGraphQLClient,
	coinType: string,
	ownerAddress: string,
): Promise<string | null> {
	const QUERY = `
		query($type: String!, $owner: SuiAddress!, $first: Int) {
			objects(filter: { type: $type, owner: $owner }, first: $first) {
				nodes { address }
			}
		}
	`;

	const treasuryType = `0x2::coin::TreasuryCap<${coinType}>`;

	try {
		const result: {
			data?: {
				objects: { nodes: Array<{ address: string }> };
			};
		} = await client.query({
			query: QUERY,
			variables: { type: treasuryType, owner: ownerAddress, first: 1 },
		});

		const nodes = result.data?.objects?.nodes ?? [];
		return nodes.length > 0 ? nodes[0].address : null;
	} catch {
		return null;
	}
}

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
	pricePerUnit: bigint;
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
	pricePerUnit: bigint;
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
	coinObjectIds: string[];
	totalAmount: bigint;
	typeId: number;
	pricePerUnit: bigint;
	quantity: number;
	senderAddress: string;
}

/** Build a TX to post a buy order with escrowed Coin<T>. Uses merge+split for coin objects. */
export function buildPostBuyOrder(params: PostBuyOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Merge+split coin objects into exact payment amount
	let paymentCoin: ReturnType<typeof tx.splitCoins>[0];
	if (params.coinObjectIds.length === 0) {
		throw new Error("No coin objects provided for buy order payment");
	}
	if (params.coinObjectIds.length === 1) {
		// Single coin -- split the exact amount
		[paymentCoin] = tx.splitCoins(tx.object(params.coinObjectIds[0]), [
			tx.pure.u64(params.totalAmount),
		]);
	} else {
		// Multiple coins -- merge into first, then split
		const [baseCoin, ...restCoins] = params.coinObjectIds;
		tx.mergeCoins(
			tx.object(baseCoin),
			restCoins.map((id) => tx.object(id)),
		);
		[paymentCoin] = tx.splitCoins(tx.object(baseCoin), [
			tx.pure.u64(params.totalAmount),
		]);
	}

	tx.moveCall({
		target: `${params.packageId}::market::post_buy_order`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			paymentCoin,
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.u64(params.quantity),
			tx.object("0x6"), // Clock shared object
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
	_marketPackageId: string,
): Promise<MarketSellListing[]> {
	const listings: MarketSellListing[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, marketId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				if (!df.nameType.includes("SellKey")) continue;

				// Use inline value from the list response
				const fields = df.valueJson as Record<string, unknown> | undefined;
				if (!fields) continue;

				const nameObj = df.nameJson as Record<string, unknown> | null;
				const listingId = nameObj ? Number(nameObj.listing_id ?? 0) : 0;

				listings.push({
					listingId: Number(fields.listing_id ?? listingId),
					seller: String(fields.seller ?? ""),
					ssuId: String(fields.ssu_id ?? ""),
					typeId: Number(fields.type_id ?? 0),
					pricePerUnit: BigInt(String(fields.price_per_unit ?? 0)),
					quantity: Number(fields.quantity ?? 0),
					postedAtMs: Number(fields.posted_at_ms ?? 0),
				});
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
	_marketPackageId: string,
): Promise<MarketBuyOrder[]> {
	const orders: MarketBuyOrder[] = [];

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

				// Use inline value from the list response
				const fields = df.valueJson as Record<string, unknown> | undefined;
				if (!fields) continue;

				const nameObj = df.nameJson as Record<string, unknown> | null;
				const orderId = nameObj ? Number(nameObj.order_id ?? 0) : 0;

				orders.push({
					orderId: Number(fields.order_id ?? orderId),
					buyer: String(fields.buyer ?? ""),
					typeId: Number(fields.type_id ?? 0),
					pricePerUnit: BigInt(String(fields.price_per_unit ?? 0)),
					quantity: Number(fields.quantity ?? 0),
					originalQuantity: Number(fields.original_quantity ?? fields.quantity ?? 0),
					postedAtMs: Number(fields.posted_at_ms ?? 0),
				});
			}

			hasMore = page.hasNextPage;
			cursor = page.cursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return orders;
}

/**
 * Query all sell listings across all Market<coinType> objects.
 * Discovers markets via GraphQL type filtering, queries listings on each,
 * and returns only listings at public SSUs (isPublic = true).
 */
export async function queryAllListingsForCurrency(
	client: SuiGraphQLClient,
	marketPackageId: string,
	_ssuMarketPackageId: string,
	coinType: string,
): Promise<CrossMarketListing[]> {
	// Step 1: Discover all Market<coinType> objects
	const markets = await queryMarkets(client, marketPackageId, coinType);
	if (markets.length === 0) return [];

	// Step 2: Query listings on each market
	const allListings: CrossMarketListing[] = [];

	for (const market of markets) {
		const listings = await queryMarketListings(client, market.objectId, marketPackageId);
		for (const listing of listings) {
			allListings.push({
				...listing,
				marketId: market.objectId,
				coinType: market.coinType,
				ssuConfigId: "", // Populated below if SSU is public
			});
		}
	}

	return allListings;
}
