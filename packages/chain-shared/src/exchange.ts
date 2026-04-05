import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { getObjectJson } from "./graphql-queries";
import type { OrderBookInfo, OrderInfo } from "./types";

export interface CreatePairParams {
	packageId: string;
	coinTypeA: string;
	coinTypeB: string;
	feeBps: number;
	senderAddress: string;
}

export function buildCreatePair(params: CreatePairParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::exchange::create_pair`,
		typeArguments: [params.coinTypeA, params.coinTypeB],
		arguments: [tx.pure.u64(params.feeBps)],
	});

	return tx;
}

export interface PlaceOrderParams {
	packageId: string;
	coinTypeA: string;
	coinTypeB: string;
	bookObjectId: string;
	coinObjectIds: string[];
	totalAmount: bigint;
	price: bigint;
	amount: number;
	senderAddress: string;
}

/**
 * Build a TX to place a bid order on an exchange OrderBook.
 * Bids deposit coinTypeB (totalAmount = price * amount).
 * Uses merge+split pattern for multiple coin objects.
 */
export function buildPlaceBid(params: PlaceOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	if (params.coinObjectIds.length === 0) {
		throw new Error("No coin objects provided for bid payment");
	}

	let paymentCoin: ReturnType<typeof tx.splitCoins>[0];
	if (params.coinObjectIds.length === 1) {
		[paymentCoin] = tx.splitCoins(tx.object(params.coinObjectIds[0]), [
			tx.pure.u64(params.totalAmount),
		]);
	} else {
		const [baseCoin, ...rest] = params.coinObjectIds;
		tx.mergeCoins(
			tx.object(baseCoin),
			rest.map((id) => tx.object(id)),
		);
		[paymentCoin] = tx.splitCoins(tx.object(baseCoin), [
			tx.pure.u64(params.totalAmount),
		]);
	}

	tx.moveCall({
		target: `${params.packageId}::exchange::place_bid`,
		typeArguments: [params.coinTypeA, params.coinTypeB],
		arguments: [
			tx.object(params.bookObjectId),
			paymentCoin,
			tx.pure.u64(params.price),
			tx.pure.u64(params.amount),
		],
	});

	return tx;
}

/**
 * Build a TX to place an ask order on an exchange OrderBook.
 * Asks deposit coinTypeA (totalAmount = amount).
 * Uses merge+split pattern for multiple coin objects.
 */
export function buildPlaceAsk(params: PlaceOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	if (params.coinObjectIds.length === 0) {
		throw new Error("No coin objects provided for ask deposit");
	}

	let paymentCoin: ReturnType<typeof tx.splitCoins>[0];
	if (params.coinObjectIds.length === 1) {
		[paymentCoin] = tx.splitCoins(tx.object(params.coinObjectIds[0]), [
			tx.pure.u64(params.totalAmount),
		]);
	} else {
		const [baseCoin, ...rest] = params.coinObjectIds;
		tx.mergeCoins(
			tx.object(baseCoin),
			rest.map((id) => tx.object(id)),
		);
		[paymentCoin] = tx.splitCoins(tx.object(baseCoin), [
			tx.pure.u64(params.totalAmount),
		]);
	}

	tx.moveCall({
		target: `${params.packageId}::exchange::place_ask`,
		typeArguments: [params.coinTypeA, params.coinTypeB],
		arguments: [
			tx.object(params.bookObjectId),
			paymentCoin,
			tx.pure.u64(params.price),
			tx.pure.u64(params.amount),
		],
	});

	return tx;
}

export interface CancelOrderParams {
	packageId: string;
	coinTypeA: string;
	coinTypeB: string;
	bookObjectId: string;
	orderId: number;
	senderAddress: string;
}

export function buildCancelBid(params: CancelOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::exchange::cancel_bid`,
		typeArguments: [params.coinTypeA, params.coinTypeB],
		arguments: [
			tx.object(params.bookObjectId),
			tx.pure.u64(params.orderId),
		],
	});

	return tx;
}

export function buildCancelAsk(params: CancelOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::exchange::cancel_ask`,
		typeArguments: [params.coinTypeA, params.coinTypeB],
		arguments: [
			tx.object(params.bookObjectId),
			tx.pure.u64(params.orderId),
		],
	});

	return tx;
}

// ── Query Functions ────────────────────────────────────────────────────────

/**
 * Fetch an order book's details by object ID.
 * Parses coin type parameters from the on-chain type repr and reads
 * fee_bps, bid_count, ask_count from the object fields.
 */
export async function queryOrderBook(
	client: SuiGraphQLClient,
	bookObjectId: string,
): Promise<OrderBookInfo | null> {
	try {
		const obj = await getObjectJson(client, bookObjectId);
		if (!obj.json) return null;

		const fields = obj.json;
		const typeRepr = obj.type ?? "";

		// Extract coin types from "PKG::exchange::OrderBook<CoinTypeA, CoinTypeB>"
		const match = typeRepr.match(/::exchange::OrderBook<(.+),\s*(.+)>$/);
		const coinTypeA = match ? match[1].trim() : "";
		const coinTypeB = match ? match[2].trim() : "";

		return {
			objectId: bookObjectId,
			coinTypeA,
			coinTypeB,
			bidCount: Number(fields.bid_count ?? 0),
			askCount: Number(fields.ask_count ?? 0),
			feeBps: Number(fields.fee_bps ?? 0),
		};
	} catch {
		return null;
	}
}

/**
 * Fetch all bid and ask orders from an order book.
 * Orders are stored as `bids` and `asks` vectors directly on the OrderBook object.
 */
export async function queryOrders(
	client: SuiGraphQLClient,
	bookObjectId: string,
): Promise<OrderInfo[]> {
	try {
		const obj = await getObjectJson(client, bookObjectId);
		if (!obj.json) return [];

		const fields = obj.json;
		const orders: OrderInfo[] = [];

		const bids = fields.bids as Array<Record<string, unknown>> | undefined;
		if (bids) {
			for (const b of bids) {
				orders.push({
					orderId: Number(b.order_id ?? 0),
					owner: String(b.owner ?? ""),
					price: Number(b.price ?? 0),
					amount: Number(b.amount ?? 0),
					isBid: true,
				});
			}
		}

		const asks = fields.asks as Array<Record<string, unknown>> | undefined;
		if (asks) {
			for (const a of asks) {
				orders.push({
					orderId: Number(a.order_id ?? 0),
					owner: String(a.owner ?? ""),
					price: Number(a.price ?? 0),
					amount: Number(a.amount ?? 0),
					isBid: false,
				});
			}
		}

		return orders;
	} catch {
		return [];
	}
}
