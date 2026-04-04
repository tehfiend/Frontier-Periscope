/**
 * Market Standings -- Transaction builders and query helpers for the
 * market_standings::market_standings Move module.
 *
 * Market<T> uses standings-based authorization instead of address allowlists.
 * Three configurable thresholds: min_mint, min_trade, min_buy.
 * References a StandingsRegistry for standing lookups.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Inputs, Transaction } from "@mysten/sui/transactions";
import { getObjectJson, listDynamicFieldsGql } from "./graphql-queries";
import type { MarketBuyOrder, MarketSellListing, MarketStandingsInfo } from "./types";

/** Immutable shared Clock object ref (0x6, genesis version 1). */
const CLOCK_REF = Inputs.SharedObjectRef({
	objectId: "0x0000000000000000000000000000000000000000000000000000000000000006",
	initialSharedVersion: 1,
	mutable: false,
});

// ── Market Creation ─────────────────────────────────────────────────────────

export interface CreateMarketStandingsParams {
	packageId: string;
	coinType: string;
	treasuryCapId: string;
	registryId: string;
	minMint: number;
	minTrade: number;
	minBuy: number;
	senderAddress: string;
}

/**
 * Build a TX to create a standings-based Market<T> by consuming TreasuryCap.
 * The sender becomes the creator. Registry ID is stored (not verified at creation).
 */
export function buildCreateMarketStandings(
	params: CreateMarketStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market_standings::create_market`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.treasuryCapId),
			tx.pure.id(params.registryId),
			tx.pure.u8(params.minMint),
			tx.pure.u8(params.minTrade),
			tx.pure.u8(params.minBuy),
		],
	});

	return tx;
}

// ── Mint/Burn (standings-gated) ─────────────────────────────────────────────

export interface MintWithStandingsParams {
	packageId: string;
	marketId: string;
	coinType: string;
	registryId: string;
	tribeId: number;
	charId: number;
	amount: number;
	recipient: string;
	senderAddress: string;
}

/**
 * Build a TX to mint tokens from a standings-based Market<T>.
 * Requires standing >= min_mint in the referenced StandingsRegistry.
 */
export function buildMintWithStandings(params: MintWithStandingsParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market_standings::mint`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.object(params.registryId),
			tx.pure.u32(params.tribeId),
			tx.pure.u64(params.charId),
			tx.pure.u64(params.amount),
			tx.pure.address(params.recipient),
		],
	});

	return tx;
}

export interface BurnStandingsParams {
	packageId: string;
	marketId: string;
	coinType: string;
	coinObjectId: string;
	senderAddress: string;
}

/** Build a TX to burn tokens via standings-based Market<T>. Any holder can burn. */
export function buildBurnStandings(params: BurnStandingsParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market_standings::burn`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.marketId), tx.object(params.coinObjectId)],
	});

	return tx;
}

// ── Sell Listings (standings-gated) ─────────────────────────────────────────

export interface PostSellListingStandingsParams {
	packageId: string;
	marketId: string;
	coinType: string;
	registryId: string;
	tribeId: number;
	charId: number;
	ssuId: string;
	typeId: number;
	pricePerUnit: bigint;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a TX to post a sell listing on a standings-based Market<T>.
 * Requires standing >= min_trade.
 */
export function buildPostSellListingStandings(
	params: PostSellListingStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market_standings::post_sell_listing`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.object(params.registryId),
			tx.pure.u32(params.tribeId),
			tx.pure.u64(params.charId),
			tx.pure.id(params.ssuId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.u64(params.quantity),
			tx.object(CLOCK_REF),
		],
	});

	return tx;
}

export interface UpdateSellListingStandingsParams {
	packageId: string;
	marketId: string;
	coinType: string;
	listingId: number;
	pricePerUnit: bigint;
	quantity: number;
	senderAddress: string;
}

/** Build a TX to update price and quantity on a sell listing. Seller only. */
export function buildUpdateSellListingStandings(
	params: UpdateSellListingStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market_standings::update_sell_listing`,
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

export interface CancelSellListingStandingsParams {
	packageId: string;
	marketId: string;
	coinType: string;
	listingId: number;
	senderAddress: string;
}

/** Build a TX to cancel a sell listing. Seller only, no standings re-check. */
export function buildCancelSellListingStandings(
	params: CancelSellListingStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market_standings::cancel_sell_listing`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.marketId), tx.pure.u64(params.listingId)],
	});

	return tx;
}

// ── Buy Orders (standings-gated) ────────────────────────────────────────────

export interface PostBuyOrderStandingsParams {
	packageId: string;
	marketId: string;
	coinType: string;
	registryId: string;
	tribeId: number;
	charId: number;
	coinObjectIds: string[];
	totalAmount: bigint;
	typeId: number;
	pricePerUnit: bigint;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a TX to post a buy order with escrowed Coin<T>.
 * Requires standing >= min_buy. Uses merge+split for coin objects.
 */
export function buildPostBuyOrderStandings(
	params: PostBuyOrderStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Merge+split coin objects into exact payment amount
	let paymentCoin: ReturnType<typeof tx.splitCoins>[0];
	if (params.coinObjectIds.length === 0) {
		throw new Error("No coin objects provided for buy order payment");
	}
	if (params.coinObjectIds.length === 1) {
		[paymentCoin] = tx.splitCoins(tx.object(params.coinObjectIds[0]), [
			tx.pure.u64(params.totalAmount),
		]);
	} else {
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
		target: `${params.packageId}::market_standings::post_buy_order`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.object(params.registryId),
			tx.pure.u32(params.tribeId),
			tx.pure.u64(params.charId),
			paymentCoin,
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.u64(params.quantity),
			tx.object(CLOCK_REF),
		],
	});

	return tx;
}

export interface CancelBuyOrderStandingsParams {
	packageId: string;
	marketId: string;
	coinType: string;
	orderId: number;
	senderAddress: string;
}

/** Build a TX to cancel a buy order. Returns escrowed coins to buyer. */
export function buildCancelBuyOrderStandings(
	params: CancelBuyOrderStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market_standings::cancel_buy_order`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.marketId), tx.pure.u64(params.orderId)],
	});

	return tx;
}

// ── Fee & Config Management (creator only) ──────────────────────────────────

export interface UpdateFeeStandingsParams {
	packageId: string;
	marketId: string;
	coinType: string;
	feeBps: number;
	feeRecipient: string;
	senderAddress: string;
}

/** Build a TX to update fee configuration. Creator only. */
export function buildUpdateFeeStandings(
	params: UpdateFeeStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market_standings::update_fee`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.pure.u64(params.feeBps),
			tx.pure.address(params.feeRecipient),
		],
	});

	return tx;
}

export interface UpdateStandingsConfigParams {
	packageId: string;
	marketId: string;
	coinType: string;
	registryId: string;
	minMint: number;
	minTrade: number;
	minBuy: number;
	senderAddress: string;
}

/**
 * Build a TX to update standings configuration on a Market<T>.
 * Creator only. Allows changing the registry and all three thresholds.
 */
export function buildUpdateStandingsConfig(
	params: UpdateStandingsConfigParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::market_standings::update_standings_config`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.marketId),
			tx.pure.id(params.registryId),
			tx.pure.u8(params.minMint),
			tx.pure.u8(params.minTrade),
			tx.pure.u8(params.minBuy),
		],
	});

	return tx;
}

// ── Query Functions ─────────────────────────────────────────────────────────

/**
 * Fetch a single standings-based Market's details by object ID.
 */
export async function queryMarketStandingsDetails(
	client: SuiGraphQLClient,
	marketId: string,
): Promise<MarketStandingsInfo | null> {
	try {
		const obj = await getObjectJson(client, marketId);
		if (!obj.json) return null;

		const fields = obj.json;
		const typeRepr = obj.type ?? "";
		// Extract package ID and coin type from "PKG::market_standings::Market<COIN_TYPE>"
		const match = typeRepr.match(
			/^(.+?)::market_standings::Market<(.+)>$/,
		);

		// Extract total supply from treasury_cap.total_supply.value
		const treasuryCap = fields.treasury_cap as
			| Record<string, unknown>
			| undefined;
		const supplyObj = treasuryCap?.total_supply as
			| Record<string, unknown>
			| undefined;
		const totalSupply =
			supplyObj?.value != null ? String(supplyObj.value) : undefined;

		return {
			objectId: marketId,
			packageId: match ? match[1] : "",
			creator: String(fields.creator ?? ""),
			registryId: String(fields.registry_id ?? ""),
			minMint: Number(fields.min_mint ?? 0),
			minTrade: Number(fields.min_trade ?? 0),
			minBuy: Number(fields.min_buy ?? 0),
			feeBps: Number(fields.fee_bps ?? 0),
			feeRecipient: String(fields.fee_recipient ?? ""),
			nextSellId: Number(fields.next_sell_id ?? 0),
			nextBuyId: Number(fields.next_buy_id ?? 0),
			coinType: match ? match[2] : "",
			totalSupply,
		};
	} catch {
		return null;
	}
}

/**
 * Discover all standings-based Market<T> objects on-chain.
 * If coinType is provided, searches for Market<coinType>; otherwise searches
 * for all Market<*> objects from the market_standings package.
 */
export async function queryAllMarketsStandings(
	client: SuiGraphQLClient,
	packageId: string,
	coinType?: string,
): Promise<MarketStandingsInfo[]> {
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
					contents?: {
						json: Record<string, unknown>;
						type: { repr: string };
					};
				};
			}>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	}

	const markets: MarketStandingsInfo[] = [];
	const searchType = coinType
		? `${packageId}::market_standings::Market<${coinType}>`
		: `${packageId}::market_standings::Market`;
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
			const typeRepr =
				node.asMoveObject?.contents?.type?.repr ?? "";
			if (!json) continue;

			const match = typeRepr.match(
				/^(.+?)::market_standings::Market<(.+)>$/,
			);
			const resolvedCoinType = match ? match[2] : (coinType ?? "");

			const treasuryCap = json.treasury_cap as
				| Record<string, unknown>
				| undefined;
			const supplyObj = treasuryCap?.total_supply as
				| Record<string, unknown>
				| undefined;
			const totalSupply =
				supplyObj?.value != null
					? String(supplyObj.value)
					: undefined;

			markets.push({
				objectId: node.address,
				packageId: match ? match[1] : "",
				creator: String(json.creator ?? ""),
				registryId: String(json.registry_id ?? ""),
				minMint: Number(json.min_mint ?? 0),
				minTrade: Number(json.min_trade ?? 0),
				minBuy: Number(json.min_buy ?? 0),
				feeBps: Number(json.fee_bps ?? 0),
				feeRecipient: String(json.fee_recipient ?? ""),
				nextSellId: Number(json.next_sell_id ?? 0),
				nextBuyId: Number(json.next_buy_id ?? 0),
				coinType: resolvedCoinType,
				totalSupply,
			});
		}

		hasMore = objects.pageInfo.hasNextPage;
		cursor = objects.pageInfo.endCursor;
	}

	return markets;
}

/**
 * Fetch all sell listings from a standings-based Market.
 * Same dynamic field format as the original market.
 */
export async function queryMarketStandingsListings(
	client: SuiGraphQLClient,
	marketId: string,
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

				const fields = df.valueJson as
					| Record<string, unknown>
					| undefined;
				if (!fields) continue;

				const nameObj = df.nameJson as
					| Record<string, unknown>
					| null;
				const listingId = nameObj
					? Number(nameObj.listing_id ?? 0)
					: 0;

				listings.push({
					listingId: Number(fields.listing_id ?? listingId),
					seller: String(fields.seller ?? ""),
					ssuId: String(fields.ssu_id ?? ""),
					typeId: Number(fields.type_id ?? 0),
					pricePerUnit: BigInt(
						String(fields.price_per_unit ?? 0),
					),
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
 * Fetch all buy orders from a standings-based Market.
 * Same dynamic field format as the original market.
 */
export async function queryMarketStandingsBuyOrders(
	client: SuiGraphQLClient,
	marketId: string,
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
				if (
					!df.nameType.includes("BuyKey") ||
					df.nameType.includes("BuyCoinKey")
				)
					continue;

				const fields = df.valueJson as
					| Record<string, unknown>
					| undefined;
				if (!fields) continue;

				const nameObj = df.nameJson as
					| Record<string, unknown>
					| null;
				const orderId = nameObj
					? Number(nameObj.order_id ?? 0)
					: 0;

				orders.push({
					orderId: Number(fields.order_id ?? orderId),
					buyer: String(fields.buyer ?? ""),
					typeId: Number(fields.type_id ?? 0),
					pricePerUnit: BigInt(
						String(fields.price_per_unit ?? 0),
					),
					quantity: Number(fields.quantity ?? 0),
					originalQuantity: Number(
						fields.original_quantity ?? fields.quantity ?? 0,
					),
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
