/**
 * SSU Market Standings -- Transaction builders and query helpers for the
 * ssu_market_standings::ssu_market Move module.
 *
 * Mirrors ssu-market.ts but targets the standings-based market contract.
 * Trade functions that touch Market<T> standings add a registryId param
 * for the standings check. Non-standings functions (cancel, fill_buy_order,
 * transfers) update the package target only.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Inputs, Transaction } from "@mysten/sui/transactions";
import { getObjectJson } from "./graphql-queries";
import type { SsuConfigInfo } from "./types";

/** Immutable shared Clock object ref (0x6, genesis version 1). */
const CLOCK_REF = Inputs.SharedObjectRef({
	objectId: "0x0000000000000000000000000000000000000000000000000000000000000006",
	initialSharedVersion: 1,
	mutable: false,
});

// ── SsuConfig Management ───────────────────────────────────────────────────
// Identical to ssu-market.ts -- same SsuConfig pattern, different package target.

export interface CreateSsuConfigStandingsParams {
	packageId: string;
	ssuId: string;
	senderAddress: string;
}

/** Build a TX to create an SsuConfig for an SSU (standings variant). */
export function buildCreateSsuConfigStandings(
	params: CreateSsuConfigStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::create_ssu_config`,
		arguments: [tx.pure.id(params.ssuId)],
	});

	return tx;
}

export interface AddDelegateStandingsParams {
	packageId: string;
	ssuConfigId: string;
	delegate: string;
	senderAddress: string;
}

/** Build a TX to add a delegate to an SsuConfig. Owner only. */
export function buildAddDelegateStandings(
	params: AddDelegateStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::add_delegate`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.address(params.delegate)],
	});

	return tx;
}

export interface RemoveDelegateStandingsParams {
	packageId: string;
	ssuConfigId: string;
	delegate: string;
	senderAddress: string;
}

/** Build a TX to remove a delegate from an SsuConfig. Owner only. */
export function buildRemoveDelegateStandings(
	params: RemoveDelegateStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::remove_delegate`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.address(params.delegate)],
	});

	return tx;
}

export interface SetMarketStandingsParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	senderAddress: string;
}

/** Build a TX to link an SsuConfig to a standings-based Market. Owner only. */
export function buildSetMarketStandings(
	params: SetMarketStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::set_market`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.id(params.marketId)],
	});

	return tx;
}

export interface RemoveMarketStandingsParams {
	packageId: string;
	ssuConfigId: string;
	senderAddress: string;
}

/** Build a TX to unlink the Market from an SsuConfig. Owner only. */
export function buildRemoveMarketStandings(
	params: RemoveMarketStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::remove_market`,
		arguments: [tx.object(params.ssuConfigId)],
	});

	return tx;
}

// ── Trade Execution Builders (standings-gated) ──────────────────────────────

export interface EscrowAndListStandingsParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	coinType: string;
	registryId: string;
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
 * Build a PTB to escrow items and create a sell listing on the standings Market.
 * Registry is passed for the min_trade standings check.
 * Flow: borrow_owner_cap -> withdraw_by_owner -> escrow_and_list -> return_owner_cap
 */
export function buildEscrowAndListStandings(
	params: EscrowAndListStandingsParams,
): Transaction {
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

	// Step 3: Escrow and list on standings Market (adds registry param)
	tx.moveCall({
		target: `${params.packageId}::ssu_market::escrow_and_list`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.marketId),
			tx.object(params.registryId),
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

export interface PlayerEscrowAndListStandingsParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	coinType: string;
	registryId: string;
	worldPackageId: string;
	ssuObjectId: string;
	characterObjectId: string;
	ownerCapReceivingId: string;
	ownerCapVersion: string;
	ownerCapDigest: string;
	ownerCapTypeArg: string;
	typeId: number;
	quantity: number;
	pricePerUnit: bigint;
	senderAddress: string;
}

/**
 * Build a PTB for a player to escrow items from their storage and create
 * a sell listing on the standings Market. Adds registry param for min_trade check.
 */
export function buildPlayerEscrowAndListStandings(
	params: PlayerEscrowAndListStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Step 1: Borrow player's OwnerCap from Character
	const [ownerCap, receipt] = tx.moveCall({
		target: `${params.worldPackageId}::character::borrow_owner_cap`,
		typeArguments: [params.ownerCapTypeArg],
		arguments: [
			tx.object(params.characterObjectId),
			tx.receivingRef({
				objectId: params.ownerCapReceivingId,
				version: params.ownerCapVersion,
				digest: params.ownerCapDigest,
			}),
		],
	});

	// Step 2: Withdraw items from player's inventory
	const [item] = tx.moveCall({
		target: `${params.worldPackageId}::storage_unit::withdraw_by_owner`,
		typeArguments: [params.ownerCapTypeArg],
		arguments: [
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			ownerCap,
			tx.pure.u64(params.typeId),
			tx.pure.u32(params.quantity),
		],
	});

	// Step 3: Return OwnerCap
	tx.moveCall({
		target: `${params.worldPackageId}::character::return_owner_cap`,
		typeArguments: [params.ownerCapTypeArg],
		arguments: [tx.object(params.characterObjectId), ownerCap, receipt],
	});

	// Step 4: Player escrow and list on standings Market (adds registry param)
	tx.moveCall({
		target: `${params.packageId}::ssu_market::player_escrow_and_list`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.marketId),
			tx.object(params.registryId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			item,
			tx.pure.u64(params.pricePerUnit),
			tx.object(CLOCK_REF),
		],
	});

	return tx;
}

export interface CancelListingStandingsParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	coinType: string;
	ssuObjectId: string;
	characterObjectId: string;
	listingId: number;
	senderAddress: string;
}

/** Build a TX to cancel a sell listing (no standings check on cancel). */
export function buildCancelListingStandings(
	params: CancelListingStandingsParams,
): Transaction {
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

/** Build a TX for a player to cancel their own sell listing. */
export function buildPlayerCancelListingStandings(
	params: CancelListingStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::player_cancel_listing`,
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

export interface BuyFromListingStandingsParams {
	packageId: string;
	ssuConfigId: string;
	marketId: string;
	coinType: string;
	registryId: string;
	ssuObjectId: string;
	characterObjectId: string;
	listingId: number;
	quantity: number;
	coinObjectIds: string[];
	senderAddress: string;
}

/**
 * Build a TX to buy items from a sell listing on a standings Market.
 * Adds registry param for min_buy standings check.
 * Merges all provided coins into one before passing to the contract.
 */
export function buildBuyFromListingStandings(
	params: BuyFromListingStandingsParams,
): Transaction {
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
			tx.object(params.registryId),
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

export interface PlayerFillBuyOrderStandingsParams {
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
 * No standings check needed -- buyer already passed min_buy when posting.
 */
export function buildPlayerFillBuyOrderStandings(
	params: PlayerFillBuyOrderStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const capType = `${params.worldPackageId}::character::Character`;

	// Step 1: Borrow OwnerCap<Character> from Character
	const [ownerCap, receipt] = tx.moveCall({
		target: `${params.worldPackageId}::character::borrow_owner_cap`,
		typeArguments: [capType],
		arguments: [
			tx.object(params.characterObjectId),
			tx.object(params.ownerCapReceivingId),
		],
	});

	// Step 2: Withdraw items from player's inventory
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

export interface FillBuyOrderStandingsParams {
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
 * No standings check -- buyer passed min_buy when posting the order.
 */
export function buildFillBuyOrderStandings(
	params: FillBuyOrderStandingsParams,
): Transaction {
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

// ── Visibility Management ──────────────────────────────────────────────────

export interface SetVisibilityStandingsParams {
	packageId: string;
	ssuConfigId: string;
	isPublic: boolean;
	senderAddress: string;
}

/** Build a TX to set the visibility of an SsuConfig. Owner only. */
export function buildSetVisibilityStandings(
	params: SetVisibilityStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::set_visibility`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.bool(params.isPublic)],
	});

	return tx;
}

// ── SsuConfig Query Functions ──────────────────────────────────────────────

/**
 * Fetch an SsuConfig by its object ID. Returns SsuConfigInfo or null.
 */
export async function querySsuConfigStandings(
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
 */
function parseOptionId(raw: unknown): string | null {
	if (!raw) return null;
	if (typeof raw === "string") return raw || null;
	if (Array.isArray(raw)) return raw.length > 0 ? String(raw[0]) : null;
	if (typeof raw === "object" && raw !== null) {
		const obj = raw as Record<string, unknown>;
		const some = obj.Some ?? obj.some;
		if (some) return typeof some === "string" ? some : String(some);
		if ("vec" in obj) {
			const vec = obj.vec;
			if (Array.isArray(vec)) return vec.length > 0 ? String(vec[0]) : null;
		}
	}
	return String(raw) || null;
}

/**
 * Discover an SsuConfig for a given SSU (standings variant).
 * Accepts an optional list of previous original package IDs to search as fallback.
 */
export async function discoverSsuConfigStandings(
	client: SuiGraphQLClient,
	ssuMarketPackageId: string,
	ssuId: string,
	previousPackageIds?: string[],
): Promise<string | null> {
	const pkgIds = [ssuMarketPackageId, ...(previousPackageIds ?? [])];

	for (const pkgId of pkgIds) {
		const result = await discoverSsuConfigByTypeStandings(client, pkgId, ssuId);
		if (result) return result;
	}

	return null;
}

async function discoverSsuConfigByTypeStandings(
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
