import { Transaction } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";
import type { MarketListing, MarketInfo, BuyOrderInfo, OrgMarketInfo } from "./types";

function extractFields(content: unknown): Record<string, unknown> {
	const c = content as { fields?: Record<string, unknown> };
	return c?.fields ?? {};
}

export async function queryMarketConfig(
	client: SuiClient,
	configObjectId: string,
): Promise<MarketInfo | null> {
	try {
		const obj = await client.getObject({
			id: configObjectId,
			options: { showContent: true },
		});
		const fields = extractFields(obj.data?.content);
		return {
			objectId: configObjectId,
			admin: (fields.admin as string) ?? "",
			ssuId: (fields.ssu_id as string) ?? "",
		};
	} catch {
		return null;
	}
}

export async function queryListing(
	client: SuiClient,
	configObjectId: string,
	typeId: number,
): Promise<MarketListing | null> {
	try {
		const df = await client.getDynamicFieldObject({
			parentId: configObjectId,
			name: { type: "u64", value: String(typeId) },
		});
		if (!df.data?.content) return null;

		const fields = extractFields(df.data.content);
		return {
			typeId: Number(fields.type_id ?? typeId),
			pricePerUnit: Number(fields.price_per_unit ?? 0),
			available: (fields.available as boolean) ?? false,
		};
	} catch {
		return null;
	}
}

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

export interface SetListingParams {
	packageId: string;
	configObjectId: string;
	typeId: number;
	pricePerUnit: number;
	available: boolean;
	senderAddress: string;
}

export function buildSetListing(params: SetListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::set_listing`,
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.bool(params.available),
		],
	});

	return tx;
}

export interface BuyItemParams {
	packageId: string;
	configObjectId: string;
	coinType: string;
	paymentObjectId: string;
	typeId: number;
	quantity: number;
	senderAddress: string;
}

export function buildBuyItem(params: BuyItemParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const [change] = tx.moveCall({
		target: `${params.packageId}::ssu_market::buy_item`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.configObjectId),
			tx.object(params.paymentObjectId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.quantity),
		],
	});

	// Transfer change back to sender
	tx.transferObjects([change], params.senderAddress);

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

export function buildConfirmBuyOrderFill(
	params: ConfirmBuyOrderFillParams,
): Transaction {
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

// ── Sell Orders (stock + atomic purchase) ───────────────────────────────────

export interface StockItemsParams {
	packageId: string;
	configObjectId: string;
	ssuObjectId: string;
	characterObjectId: string;
	ownerCapReceivingId: string;
	typeId: number;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a PTB to stock items into the SSU extension inventory for sell orders.
 * Flow: borrow_owner_cap -> withdraw_by_owner -> stock_items -> return_owner_cap
 */
export function buildStockItems(params: StockItemsParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Step 1: Borrow OwnerCap from Character
	const [ownerCap, receipt] = tx.moveCall({
		target: "0x2bc0a986b4eb20965bd34a6f2de52f2516395e59::character::borrow_owner_cap",
		typeArguments: [
			"0x2bc0a986b4eb20965bd34a6f2de52f2516395e59::storage_unit::StorageUnit",
		],
		arguments: [
			tx.object(params.characterObjectId),
			tx.object(params.ownerCapReceivingId),
		],
	});

	// Step 2: Withdraw items from owner inventory
	const [item] = tx.moveCall({
		target: "0x2bc0a986b4eb20965bd34a6f2de52f2516395e59::storage_unit::withdraw_by_owner",
		arguments: [
			tx.object(params.ssuObjectId),
			ownerCap,
			tx.pure.u64(params.typeId),
			tx.pure.u32(params.quantity),
		],
	});

	// Step 3: Stock items into extension inventory
	tx.moveCall({
		target: `${params.packageId}::ssu_market::stock_items`,
		arguments: [
			tx.object(params.configObjectId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			item,
		],
	});

	// Step 4: Return OwnerCap
	tx.moveCall({
		target: "0x2bc0a986b4eb20965bd34a6f2de52f2516395e59::character::return_owner_cap",
		typeArguments: [
			"0x2bc0a986b4eb20965bd34a6f2de52f2516395e59::storage_unit::StorageUnit",
		],
		arguments: [
			tx.object(params.characterObjectId),
			ownerCap,
			receipt,
		],
	});

	return tx;
}

export interface BuyAndWithdrawParams {
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

/**
 * Build a TX to atomically buy items from a sell listing:
 * pay Coin<T>, receive items from SSU extension inventory.
 */
export function buildBuyAndWithdraw(params: BuyAndWithdrawParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const [item, change] = tx.moveCall({
		target: `${params.packageId}::ssu_market::buy_and_withdraw`,
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

	// Transfer item and change back to sender
	tx.transferObjects([item], params.senderAddress);
	tx.transferObjects([change], params.senderAddress);

	return tx;
}

// ── OrgMarket Query Helpers ─────────────────────────────────────────────────

/**
 * Query an OrgMarket shared object for its state.
 */
export async function queryOrgMarket(
	client: SuiClient,
	orgMarketId: string,
): Promise<OrgMarketInfo | null> {
	try {
		const obj = await client.getObject({
			id: orgMarketId,
			options: { showContent: true },
		});

		if (!obj.data?.content || obj.data.content.dataType !== "moveObject") {
			return null;
		}

		const fields = obj.data.content.fields as Record<string, unknown>;

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

/**
 * Query all active buy orders on an OrgMarket.
 * Iterates dynamic fields keyed by order_id (u64 < 1_000_000_000).
 */
export async function queryBuyOrders(
	client: SuiClient,
	orgMarketId: string,
): Promise<BuyOrderInfo[]> {
	const orders: BuyOrderInfo[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await client.getDynamicFields({
				parentId: orgMarketId,
				cursor: cursor ?? undefined,
				limit: 50,
			});

			for (const df of page.data) {
				// Buy order records have u64 keys < 1_000_000_000
				// Coin escrows have keys >= 1_000_000_000
				const key = Number(df.name.value);
				if (key >= 1_000_000_000) continue;

				try {
					const dfObj = await client.getDynamicFieldObject({
						parentId: orgMarketId,
						name: df.name,
					});
					if (!dfObj.data?.content) continue;

					const fields = extractFields(dfObj.data.content);
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
			cursor = page.nextCursor ?? null;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return orders;
}
