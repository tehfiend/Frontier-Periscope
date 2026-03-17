import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import type { BuyOrderInfo, MarketInfo, OrgMarketInfo, SellOrderInfo } from "./types";
import {
	getDynamicFieldJson,
	getObjectJson,
	listDynamicFieldsGql,
	queryEventsGql,
} from "./graphql-queries";

// ── Market Config Query ─────────────────────────────────────────────────────

export async function queryMarketConfig(
	client: SuiGraphQLClient,
	configObjectId: string,
): Promise<MarketInfo | null> {
	try {
		const obj = await getObjectJson(client, configObjectId);
		const fields = obj.json ?? {};
		return {
			objectId: configObjectId,
			admin: (fields.admin as string) ?? "",
			ssuId: (fields.ssu_id as string) ?? "",
		};
	} catch {
		return null;
	}
}

/**
 * Discover a MarketConfig for a given SSU by searching on-chain.
 * Returns the MarketConfig object ID if found, null otherwise.
 */
export async function discoverMarketConfig(
	client: SuiGraphQLClient,
	ssuMarketPackageId: string,
	ssuId: string,
): Promise<string | null> {
	const QUERY = `
		query($type: String!, $first: Int, $after: String) {
			objects(filter: { type: $type }, first: $first, after: $after) {
				nodes {
					address
					asMoveObject { contents { json } }
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	`;

	interface Response {
		objects: {
			nodes: Array<{
				address: string;
				asMoveObject?: { contents?: { json: Record<string, unknown> } };
			}>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	}

	// MarketConfig type uses the original (v1) package ID in its type name
	// Try both the provided package ID and common published-at IDs
	const configType = `${ssuMarketPackageId}::ssu_market::MarketConfig`;
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		const result: { data?: Response } = await client.query({
			query: QUERY,
			variables: { type: configType, first: 50, after: cursor },
		});

		const objects = result.data?.objects;
		if (!objects) break;

		for (const node of objects.nodes) {
			const json = node.asMoveObject?.contents?.json;
			if (!json) continue;

			if (String(json.ssu_id) === ssuId) {
				return node.address;
			}
		}

		hasMore = objects.pageInfo.hasNextPage;
		cursor = objects.pageInfo.endCursor;
	}

	return null;
}

// ── Sell Order Queries ──────────────────────────────────────────────────────

export async function querySellOrder(
	client: SuiGraphQLClient,
	configObjectId: string,
	typeId: number,
): Promise<SellOrderInfo | null> {
	try {
		const fields = await getDynamicFieldJson(client, configObjectId, {
			type: "u64",
			value: String(typeId),
		});
		if (!fields) return null;

		// Distinguish SellOrder (has quantity) from legacy Listing (has available)
		if (!("quantity" in fields) || "available" in fields) return null;

		return {
			typeId: Number(fields.type_id ?? typeId),
			pricePerUnit: Number(fields.price_per_unit ?? 0),
			quantity: Number(fields.quantity ?? 0),
		};
	} catch {
		return null;
	}
}

export async function queryAllSellOrders(
	client: SuiGraphQLClient,
	configObjectId: string,
): Promise<SellOrderInfo[]> {
	const orders: SellOrderInfo[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, configObjectId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				if (df.nameType !== "u64") continue;

				try {
					const fields = await getDynamicFieldJson(client, configObjectId, {
						type: "u64",
						value: String(df.nameJson),
					});
					if (!fields) continue;

					// SellOrder has quantity field; legacy Listing has available field
					if ("quantity" in fields && !("available" in fields)) {
						orders.push({
							typeId: Number(fields.type_id ?? df.nameJson),
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

// ── Create Market ───────────────────────────────────────────────────────────

export interface CreateMarketParams {
	packageId: string;
	ssuId: string;
	senderAddress: string;
}

export function buildCreateMarket(params: CreateMarketParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::create_market`,
		arguments: [tx.pure.id(params.ssuId)],
	});

	return tx;
}

// ── Sell Order Builders ─────────────────────────────────────────────────────

export interface CreateSellOrderParams {
	packageId: string;
	worldPackageId: string;
	configObjectId: string;
	ssuObjectId: string;
	characterObjectId: string;
	ownerCapReceivingId: string;
	typeId: number;
	quantity: number;
	pricePerUnit: number;
	senderAddress: string;
}

/**
 * Build a PTB to create a sell order with escrow.
 * Flow: borrow_owner_cap -> withdraw_by_owner -> create_sell_order -> return_owner_cap
 */
export function buildCreateSellOrder(params: CreateSellOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Step 1: Borrow OwnerCap from Character
	const [ownerCap, receipt] = tx.moveCall({
		target: `${params.worldPackageId}::character::borrow_owner_cap`,
		typeArguments: [`${params.worldPackageId}::storage_unit::StorageUnit`],
		arguments: [
			tx.object(params.characterObjectId),
			tx.object(params.ownerCapReceivingId),
		],
	});

	// Step 2: Withdraw items from owner inventory
	const [item] = tx.moveCall({
		target: `${params.worldPackageId}::storage_unit::withdraw_by_owner`,
		typeArguments: [`${params.worldPackageId}::storage_unit::StorageUnit`],
		arguments: [
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			ownerCap,
			tx.pure.u64(params.typeId),
			tx.pure.u32(params.quantity),
		],
	});

	// Step 3: Create sell order (escrows item into extension inventory)
	tx.moveCall({
		target: `${params.packageId}::ssu_market::create_sell_order`,
		arguments: [
			tx.object(params.configObjectId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			item,
			tx.pure.u64(params.pricePerUnit),
		],
	});

	// Step 4: Return OwnerCap
	tx.moveCall({
		target: `${params.worldPackageId}::character::return_owner_cap`,
		typeArguments: [`${params.worldPackageId}::storage_unit::StorageUnit`],
		arguments: [tx.object(params.characterObjectId), ownerCap, receipt],
	});

	return tx;
}

export interface CancelSellOrderParams {
	packageId: string;
	configObjectId: string;
	ssuObjectId: string;
	characterObjectId: string;
	typeId: number;
	quantity: number;
	senderAddress: string;
}

export function buildCancelSellOrder(params: CancelSellOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::cancel_sell_order`,
		arguments: [
			tx.object(params.configObjectId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.pure.u64(params.typeId),
			tx.pure.u32(params.quantity),
		],
	});

	return tx;
}

export interface BuySellOrderParams {
	packageId: string;
	configObjectId: string;
	ssuObjectId: string;
	characterObjectId: string;
	coinType: string;
	paymentObjectId: string;
	typeId: number;
	quantity: number;
	senderAddress: string;
}

export function buildBuySellOrder(params: BuySellOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const [change] = tx.moveCall({
		target: `${params.packageId}::ssu_market::buy_sell_order`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.configObjectId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.object(params.paymentObjectId),
			tx.pure.u64(params.typeId),
			tx.pure.u32(params.quantity),
		],
	});

	// Transfer change back to sender
	tx.transferObjects([change], params.senderAddress);

	return tx;
}

export interface UpdateSellPriceParams {
	packageId: string;
	configObjectId: string;
	typeId: number;
	pricePerUnit: number;
	senderAddress: string;
}

export function buildUpdateSellPrice(params: UpdateSellPriceParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::update_sell_price`,
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
		],
	});

	return tx;
}

// ── OrgMarket Management ────────────────────────────────────────────────────

export interface CreateOrgMarketParams {
	packageId: string;
	orgObjectId: string;
	senderAddress: string;
}

export function buildCreateOrgMarket(params: CreateOrgMarketParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::create_org_market`,
		arguments: [tx.object(params.orgObjectId)],
	});

	return tx;
}

export interface AddAuthorizedSsuParams {
	packageId: string;
	orgMarketId: string;
	orgObjectId: string;
	ssuId: string;
	senderAddress: string;
}

export function buildAddAuthorizedSsu(params: AddAuthorizedSsuParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::add_authorized_ssu`,
		arguments: [
			tx.object(params.orgMarketId),
			tx.object(params.orgObjectId),
			tx.pure.id(params.ssuId),
		],
	});

	return tx;
}

export interface RemoveAuthorizedSsuParams {
	packageId: string;
	orgMarketId: string;
	orgObjectId: string;
	ssuId: string;
	senderAddress: string;
}

export function buildRemoveAuthorizedSsu(params: RemoveAuthorizedSsuParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::remove_authorized_ssu`,
		arguments: [
			tx.object(params.orgMarketId),
			tx.object(params.orgObjectId),
			tx.pure.id(params.ssuId),
		],
	});

	return tx;
}

// ── Buy Orders (on OrgMarket) ───────────────────────────────────────────────

export interface CreateBuyOrderParams {
	packageId: string;
	orgMarketId: string;
	orgObjectId: string;
	coinType: string;
	paymentObjectId: string;
	ssuId: string;
	typeId: number;
	pricePerUnit: number;
	quantity: number;
	senderAddress: string;
}

export function buildCreateBuyOrder(params: CreateBuyOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::create_buy_order`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgMarketId),
			tx.object(params.orgObjectId),
			tx.object(params.paymentObjectId),
			tx.pure.id(params.ssuId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.u64(params.quantity),
		],
	});

	return tx;
}

export interface ConfirmBuyOrderFillParams {
	packageId: string;
	orgMarketId: string;
	orgObjectId: string;
	coinType: string;
	orderId: number;
	sellerAddress: string;
	quantityFilled: number;
	senderAddress: string;
}

export function buildConfirmBuyOrderFill(params: ConfirmBuyOrderFillParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::confirm_buy_order_fill`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgMarketId),
			tx.object(params.orgObjectId),
			tx.pure.u64(params.orderId),
			tx.pure.address(params.sellerAddress),
			tx.pure.u64(params.quantityFilled),
		],
	});

	return tx;
}

export interface CancelBuyOrderParams {
	packageId: string;
	orgMarketId: string;
	orgObjectId: string;
	coinType: string;
	orderId: number;
	senderAddress: string;
}

export function buildCancelBuyOrder(params: CancelBuyOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::cancel_buy_order`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgMarketId),
			tx.object(params.orgObjectId),
			tx.pure.u64(params.orderId),
		],
	});

	return tx;
}

// ── OrgMarket Query Helpers ─────────────────────────────────────────────────

export async function queryOrgMarket(
	client: SuiGraphQLClient,
	orgMarketId: string,
): Promise<OrgMarketInfo | null> {
	try {
		const obj = await getObjectJson(client, orgMarketId);

		if (!obj.json) {
			return null;
		}

		const fields = obj.json;

		return {
			objectId: orgMarketId,
			orgId: String(fields.org_id ?? ""),
			admin: String(fields.admin ?? ""),
			authorizedSsus: ((fields.authorized_ssus as unknown[]) ?? []).map(String),
			nextOrderId: Number(fields.next_order_id ?? 0),
		};
	} catch {
		return null;
	}
}

export async function discoverOrgMarket(
	client: SuiGraphQLClient,
	ssuMarketPackageId: string,
	orgObjectId: string,
): Promise<string | null> {
	const QUERY = `
		query($type: String!, $first: Int, $after: String) {
			objects(filter: { type: $type }, first: $first, after: $after) {
				nodes {
					address
					asMoveObject { contents { json } }
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	`;

	interface Response {
		objects: {
			nodes: Array<{
				address: string;
				asMoveObject?: { contents?: { json: Record<string, unknown> } };
			}>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	}

	const orgMarketType = `${ssuMarketPackageId}::ssu_market::OrgMarket`;
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		const result: { data?: Response } = await client.query({
			query: QUERY,
			variables: { type: orgMarketType, first: 50, after: cursor },
		});

		const objects = result.data?.objects;
		if (!objects) return null;

		for (const node of objects.nodes) {
			const json = node.asMoveObject?.contents?.json;
			if (!json) continue;

			if (String(json.org_id) === orgObjectId) {
				return node.address;
			}
		}

		hasMore = objects.pageInfo.hasNextPage;
		cursor = objects.pageInfo.endCursor;
	}

	return null;
}

export async function queryBuyOrders(
	client: SuiGraphQLClient,
	orgMarketId: string,
): Promise<BuyOrderInfo[]> {
	const orders: BuyOrderInfo[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, orgMarketId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				// Buy order records have u64 keys < 1_000_000_000
				// Coin escrows have keys >= 1_000_000_000
				if (df.nameType !== "u64") continue;
				const key = Number(df.nameJson);
				if (key >= 1_000_000_000) continue;

				try {
					const fields = await getDynamicFieldJson(client, orgMarketId, {
						type: "u64",
						value: String(key),
					});
					if (!fields) continue;

					orders.push({
						orderId: Number(fields.order_id ?? key),
						ssuId: String(fields.ssu_id ?? ""),
						typeId: Number(fields.type_id ?? 0),
						pricePerUnit: Number(fields.price_per_unit ?? 0),
						quantity: Number(fields.quantity ?? 0),
						poster: String(fields.poster ?? ""),
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
