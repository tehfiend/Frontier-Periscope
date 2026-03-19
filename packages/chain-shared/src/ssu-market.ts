/**
 * SSU Market -- Transaction builders and query helpers for the
 * ssu_market::ssu_market Move module.
 *
 * SsuConfig is a per-SSU configuration object with owner, delegates, and
 * optional Market<T> link. Transfer functions work without any market link.
 * Trade functions (escrow_and_list, cancel_listing, buy_from_listing,
 * fill_buy_order) require the market_id to be set.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { getObjectJson } from "./graphql-queries";
import type { SsuConfigInfo } from "./types";

// ── SsuConfig Management ───────────────────────────────────────────────────

export interface CreateSsuConfigParams {
	packageId: string;
	ssuId: string;
	senderAddress: string;
}

/** Build a TX to create an SsuConfig for an SSU. */
export function buildCreateSsuConfig(params: CreateSsuConfigParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::create_ssu_config`,
		arguments: [tx.pure.id(params.ssuId)],
	});

	return tx;
}

export interface AddDelegateParams {
	packageId: string;
	ssuConfigId: string;
	delegate: string;
	senderAddress: string;
}

/** Build a TX to add a delegate to an SsuConfig. Owner only. */
export function buildAddDelegate(params: AddDelegateParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::add_delegate`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.address(params.delegate)],
	});

	return tx;
}

export interface RemoveDelegateParams {
	packageId: string;
	ssuConfigId: string;
	delegate: string;
	senderAddress: string;
}

/** Build a TX to remove a delegate from an SsuConfig. Owner only. */
export function buildRemoveDelegate(params: RemoveDelegateParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::remove_delegate`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.address(params.delegate)],
	});

	return tx;
}

export interface SetMarketParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	senderAddress: string;
}

/** Build a TX to link an SsuConfig to a Market. Owner only. */
export function buildSetMarket(params: SetMarketParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::set_market`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.id(params.marketId)],
	});

	return tx;
}

export interface RemoveMarketParams {
	packageId: string;
	ssuConfigId: string;
	senderAddress: string;
}

/** Build a TX to unlink the Market from an SsuConfig. Owner only. */
export function buildRemoveMarket(params: RemoveMarketParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::remove_market`,
		arguments: [tx.object(params.ssuConfigId)],
	});

	return tx;
}

// ── Trade Execution Builders ───────────────────────────────────────────────

export interface EscrowAndListParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	coinType: string;
	worldPackageId: string;
	ssuObjectId: string;
	characterObjectId: string;
	ownerCapReceivingId: string;
	typeId: number;
	quantity: number;
	pricePerUnit: number;
	senderAddress: string;
}

/**
 * Build a PTB to escrow items and create a sell listing on the Market.
 * Flow: borrow_owner_cap -> withdraw_by_owner -> escrow_and_list -> return_owner_cap
 */
export function buildEscrowAndList(params: EscrowAndListParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Step 1: Borrow OwnerCap from Character
	const [ownerCap, receipt] = tx.moveCall({
		target: `${params.worldPackageId}::character::borrow_owner_cap`,
		typeArguments: [`${params.worldPackageId}::storage_unit::StorageUnit`],
		arguments: [tx.object(params.characterObjectId), tx.object(params.ownerCapReceivingId)],
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

	// Step 3: Escrow and list on Market
	tx.moveCall({
		target: `${params.packageId}::ssu_market::escrow_and_list`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.marketId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			item,
			tx.pure.u64(params.pricePerUnit),
			tx.object("0x6"), // Clock shared object
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

export interface CancelListingParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	coinType: string;
	ssuObjectId: string;
	characterObjectId: string;
	listingId: number;
	senderAddress: string;
}

/**
 * Build a TX to cancel a sell listing on Market and return items
 * from extension inventory to owner inventory.
 */
export function buildCancelListing(params: CancelListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::cancel_listing`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.marketId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.pure.u64(params.listingId),
		],
	});

	return tx;
}

export interface BuyFromListingParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	coinType: string;
	ssuObjectId: string;
	characterObjectId: string;
	listingId: number;
	quantity: number;
	paymentObjectId: string;
	senderAddress: string;
}

/**
 * Build a TX to buy items from a sell listing. Returns change coin.
 * Any buyer can call -- no authorization required (only SSU/market link validated).
 */
export function buildBuyFromListing(params: BuyFromListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const [change] = tx.moveCall({
		target: `${params.packageId}::ssu_market::buy_from_listing`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.marketId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.pure.u64(params.listingId),
			tx.pure.u32(params.quantity),
			tx.object(params.paymentObjectId),
		],
	});

	// Transfer change back to sender
	tx.transferObjects([change], params.senderAddress);

	return tx;
}

export interface FillBuyOrderParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	coinType: string;
	ssuObjectId: string;
	characterObjectId: string;
	orderId: number;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a TX to fill a buy order by providing items from the SSU.
 * Items deposited to open inventory (for buyer to claim).
 * Escrowed payment released to seller (minus fee).
 */
export function buildFillBuyOrder(params: FillBuyOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::fill_buy_order`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.marketId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.pure.u64(params.orderId),
			tx.pure.u32(params.quantity),
		],
	});

	return tx;
}

// ── SsuConfig Query Functions ──────────────────────────────────────────────

/**
 * Fetch an SsuConfig by its object ID. Returns SsuConfigInfo or null.
 */
export async function querySsuConfig(
	client: SuiGraphQLClient,
	ssuConfigId: string,
): Promise<SsuConfigInfo | null> {
	try {
		const obj = await getObjectJson(client, ssuConfigId);
		if (!obj.json) return null;

		const fields = obj.json;
		return {
			objectId: ssuConfigId,
			owner: String(fields.owner ?? ""),
			ssuId: String(fields.ssu_id ?? ""),
			delegates: ((fields.delegates as unknown[]) ?? []).map(String),
			marketId: fields.market_id ? String(fields.market_id) : null,
		};
	} catch {
		return null;
	}
}

/**
 * Discover an SsuConfig for a given SSU by searching on-chain.
 * Returns the SsuConfig object ID if found, null otherwise.
 */
export async function discoverSsuConfig(
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

	const configType = `${ssuMarketPackageId}::ssu_market::SsuConfig`;
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
