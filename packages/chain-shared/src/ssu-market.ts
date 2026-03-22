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
	pricePerUnit: bigint;
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
	coinObjectIds: string[];
	senderAddress: string;
}

/**
 * Build a TX to buy items from a sell listing. Returns change coin.
 * Any buyer can call -- no authorization required (only SSU/market link validated).
 * Merges all provided coins into one before passing to the contract.
 */
export function buildBuyFromListing(params: BuyFromListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Merge coins into a single payment object
	let paymentCoin: ReturnType<typeof tx.object>;
	if (params.coinObjectIds.length === 0) {
		throw new Error("No coin objects provided for payment");
	}
	if (params.coinObjectIds.length === 1) {
		paymentCoin = tx.object(params.coinObjectIds[0]);
	} else {
		const [baseCoin, ...restCoins] = params.coinObjectIds;
		tx.mergeCoins(
			tx.object(baseCoin),
			restCoins.map((id) => tx.object(id)),
		);
		paymentCoin = tx.object(baseCoin);
	}

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
			paymentCoin,
		],
	});

	// Transfer change back to sender
	tx.transferObjects([change], params.senderAddress);

	return tx;
}

export interface PlayerFillBuyOrderParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	coinType: string;
	worldPackageId: string;
	ssuObjectId: string;
	characterObjectId: string;
	ownerCapReceivingId: string;
	orderId: number;
	typeId: number;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a PTB for any player to fill a buy order from their own inventory.
 * Flow: borrow_owner_cap<Character> -> withdraw_by_owner -> player_fill_buy_order -> return_owner_cap
 *
 * Players have OwnerCap<Character> (not OwnerCap<StorageUnit> which is SSU-owner only).
 */
export function buildPlayerFillBuyOrder(params: PlayerFillBuyOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const capType = `${params.worldPackageId}::character::Character`;

	// Step 1: Borrow OwnerCap<Character> from Character
	const [ownerCap, receipt] = tx.moveCall({
		target: `${params.worldPackageId}::character::borrow_owner_cap`,
		typeArguments: [capType],
		arguments: [tx.object(params.characterObjectId), tx.object(params.ownerCapReceivingId)],
	});

	// Step 2: Withdraw items from player's inventory (keyed by OwnerCap<Character> ID)
	const [item] = tx.moveCall({
		target: `${params.worldPackageId}::storage_unit::withdraw_by_owner`,
		typeArguments: [capType],
		arguments: [
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			ownerCap,
			tx.pure.u64(params.typeId),
			tx.pure.u32(params.quantity),
		],
	});

	// Step 3: Fill the buy order with withdrawn items
	tx.moveCall({
		target: `${params.packageId}::ssu_market::player_fill_buy_order`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.marketId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			item,
			tx.pure.u64(params.orderId),
		],
	});

	// Step 4: Return OwnerCap<Character>
	tx.moveCall({
		target: `${params.worldPackageId}::character::return_owner_cap`,
		typeArguments: [capType],
		arguments: [tx.object(params.characterObjectId), ownerCap, receipt],
	});

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
		const marketId = parseOptionId(fields.market_id);
		return {
			objectId: ssuConfigId,
			owner: String(fields.owner ?? ""),
			ssuId: String(fields.ssu_id ?? ""),
			delegates: ((fields.delegates as unknown[]) ?? []).map(String),
			marketId,
			isPublic: fields.is_public === true,
		};
	} catch {
		return null;
	}
}

/**
 * Parse an Option<ID> field from Sui GraphQL contents.json.
 * Option<T> in Move is `{ vec: vector<T> }`, serialized as:
 * - Unwrapped: "0xABC" (Some) or null (None)
 * - Array form: ["0xABC"] (Some) or [] (None)
 * - Object form: { vec: ["0xABC"] } or { Some: "0xABC" } (Some)
 *                { vec: [] } or {} (None)
 */
function parseOptionId(raw: unknown): string | null {
	if (!raw) return null;
	if (typeof raw === "string") return raw || null;
	if (Array.isArray(raw)) return raw.length > 0 ? String(raw[0]) : null;
	if (typeof raw === "object" && raw !== null) {
		const obj = raw as Record<string, unknown>;
		// { Some: value } wrapper
		const some = obj.Some ?? obj.some;
		if (some) return typeof some === "string" ? some : String(some);
		// { vec: [value] } Move internal
		if ("vec" in obj) {
			const vec = obj.vec;
			if (Array.isArray(vec)) return vec.length > 0 ? String(vec[0]) : null;
		}
	}
	return String(raw) || null;
}

// ── Visibility Management ──────────────────────────────────────────────────

export interface SetVisibilityParams {
	packageId: string;
	ssuConfigId: string;
	isPublic: boolean;
	senderAddress: string;
}

/** Build a TX to set the visibility (public/private) of an SsuConfig. Owner only. */
export function buildSetVisibility(params: SetVisibilityParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::set_visibility`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.bool(params.isPublic)],
	});

	return tx;
}

/**
 * Discover an SsuConfig for a given SSU by searching on-chain.
 * Returns the SsuConfig object ID if found, null otherwise.
 *
 * Accepts an optional list of previous original package IDs to search
 * as fallback -- SsuConfig objects retain their original type name
 * permanently, so after a contract republish the old type must be searched.
 */
export async function discoverSsuConfig(
	client: SuiGraphQLClient,
	ssuMarketPackageId: string,
	ssuId: string,
	previousPackageIds?: string[],
): Promise<string | null> {
	const pkgIds = [ssuMarketPackageId, ...(previousPackageIds ?? [])];

	for (const pkgId of pkgIds) {
		const result = await discoverSsuConfigByType(client, pkgId, ssuId);
		if (result) return result;
	}

	return null;
}

async function discoverSsuConfigByType(
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
