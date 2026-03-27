/**
 * SSU Unified -- Combined SSU standings + market TX builders and query helpers.
 *
 * Replaces ssu-market.ts + ssu-standings.ts + ssu-market-standings.ts with a
 * single module. SsuUnifiedConfig combines the SsuConfig (owner, delegates,
 * market link, visibility) with standings thresholds (registryId, minDeposit,
 * minWithdraw) in one on-chain object.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Inputs, Transaction } from "@mysten/sui/transactions";
import { getObjectJson } from "./graphql-queries";
import type { SsuUnifiedConfigInfo } from "./types";

/** Immutable shared Clock object ref (0x6, genesis version 1). */
const CLOCK_REF = Inputs.SharedObjectRef({
	objectId: "0x0000000000000000000000000000000000000000000000000000000000000006",
	initialSharedVersion: 1,
	mutable: false,
});

// ── SsuUnifiedConfig Management ─────────────────────────────────────────────

export interface CreateSsuUnifiedConfigParams {
	packageId: string;
	ssuId: string;
	registryId: string;
	minDeposit: number;
	minWithdraw: number;
	/** Optional market ID to link at creation time. */
	marketId?: string;
	senderAddress: string;
}

/**
 * Build a TX to create an SsuUnifiedConfig for an SSU.
 * Combines SsuConfig creation with standings registry binding.
 */
export function buildCreateSsuUnifiedConfig(params: CreateSsuUnifiedConfigParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const args = [
		tx.pure.id(params.ssuId),
		tx.pure.id(params.registryId),
		tx.pure.u8(params.minDeposit),
		tx.pure.u8(params.minWithdraw),
	];

	if (params.marketId) {
		tx.moveCall({
			target: `${params.packageId}::ssu_unified::create_config_with_market`,
			arguments: [...args, tx.pure.id(params.marketId)],
		});
	} else {
		tx.moveCall({
			target: `${params.packageId}::ssu_unified::create_config`,
			arguments: args,
		});
	}

	return tx;
}

// ── Standings Config Updates ────────────────────────────────────────────────

export interface SetSsuUnifiedConfigParams {
	packageId: string;
	ssuConfigId: string;
	registryId: string;
	minDeposit: number;
	minWithdraw: number;
	senderAddress: string;
}

/**
 * Build a TX to update standings thresholds on an SsuUnifiedConfig.
 * Owner only.
 */
export function buildSetSsuUnifiedConfig(params: SetSsuUnifiedConfigParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_unified::set_standings_config`,
		arguments: [
			tx.object(params.ssuConfigId),
			tx.pure.id(params.registryId),
			tx.pure.u8(params.minDeposit),
			tx.pure.u8(params.minWithdraw),
		],
	});

	return tx;
}

// ── Market Link Management ──────────────────────────────────────────────────

export interface SetSsuMarketLinkParams {
	packageId: string;
	ssuConfigId: string;
	/** Market ID to link, or null to unlink. */
	marketId: string | null;
	senderAddress: string;
}

/**
 * Build a TX to link or unlink a Market from an SsuUnifiedConfig.
 * Pass marketId to link, null to unlink. Owner only.
 */
export function buildSetSsuMarketLink(params: SetSsuMarketLinkParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	if (params.marketId) {
		tx.moveCall({
			target: `${params.packageId}::ssu_unified::set_market`,
			arguments: [tx.object(params.ssuConfigId), tx.pure.id(params.marketId)],
		});
	} else {
		tx.moveCall({
			target: `${params.packageId}::ssu_unified::remove_market`,
			arguments: [tx.object(params.ssuConfigId)],
		});
	}

	return tx;
}

// ── Delegate Management ─────────────────────────────────────────────────────

export interface AddSsuDelegateParams {
	packageId: string;
	ssuConfigId: string;
	delegate: string;
	senderAddress: string;
}

/** Build a TX to add a delegate to an SsuUnifiedConfig. Owner only. */
export function buildAddSsuDelegate(params: AddSsuDelegateParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_unified::add_delegate`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.address(params.delegate)],
	});

	return tx;
}

export interface RemoveSsuDelegateParams {
	packageId: string;
	ssuConfigId: string;
	delegate: string;
	senderAddress: string;
}

/** Build a TX to remove a delegate from an SsuUnifiedConfig. Owner only. */
export function buildRemoveSsuDelegate(params: RemoveSsuDelegateParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_unified::remove_delegate`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.address(params.delegate)],
	});

	return tx;
}

// ── Visibility Management ───────────────────────────────────────────────────

export interface SetSsuVisibilityParams {
	packageId: string;
	ssuConfigId: string;
	isPublic: boolean;
	senderAddress: string;
}

/** Build a TX to set the visibility of an SsuUnifiedConfig. Owner only. */
export function buildSetSsuVisibility(params: SetSsuVisibilityParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_unified::set_visibility`,
		arguments: [tx.object(params.ssuConfigId), tx.pure.bool(params.isPublic)],
	});

	return tx;
}

// ── Deposit / Withdraw with Standings Check ─────────────────────────────────

export interface UnifiedDepositWithStandingsParams {
	packageId: string;
	ssuConfigId: string;
	registryId: string;
	ssuObjectId: string;
	characterObjectId: string;
	/** The Item object to deposit (result of a prior withdraw/transfer). */
	itemObjectId: string;
	senderAddress: string;
}

/**
 * Build a TX to deposit an item into an SSU with standings check (unified contract).
 * The character's standing in the registry must be >= the config's minDeposit.
 */
export function buildUnifiedDepositWithStandings(
	params: UnifiedDepositWithStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_unified::deposit_item`,
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.registryId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.object(params.itemObjectId),
		],
	});

	return tx;
}

export interface UnifiedWithdrawWithStandingsParams {
	packageId: string;
	ssuConfigId: string;
	registryId: string;
	ssuObjectId: string;
	characterObjectId: string;
	typeId: number;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a TX to withdraw items from an SSU with standings check (unified contract).
 * The character's standing in the registry must be >= the config's minWithdraw.
 */
export function buildUnifiedWithdrawWithStandings(
	params: UnifiedWithdrawWithStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_unified::withdraw_item`,
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.registryId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.pure.u64(params.typeId),
			tx.pure.u32(params.quantity),
		],
	});

	return tx;
}

// ── Trade Execution Builders (standings-gated) ──────────────────────────────

export interface EscrowAndListWithStandingsParams {
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
export function buildEscrowAndListWithStandings(
	params: EscrowAndListWithStandingsParams,
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

	// Step 3: Escrow and list on unified Market (adds registry param)
	tx.moveCall({
		target: `${params.packageId}::ssu_unified::escrow_and_list`,
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

	// Step 4: Return OwnerCap
	tx.moveCall({
		target: `${params.worldPackageId}::character::return_owner_cap`,
		typeArguments: [`${params.worldPackageId}::storage_unit::StorageUnit`],
		arguments: [tx.object(params.characterObjectId), ownerCap, receipt],
	});

	return tx;
}

export interface PlayerEscrowAndListWithStandingsParams {
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
export function buildPlayerEscrowAndListWithStandings(
	params: PlayerEscrowAndListWithStandingsParams,
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

	// Step 4: Player escrow and list on unified Market (adds registry param)
	tx.moveCall({
		target: `${params.packageId}::ssu_unified::player_escrow_and_list`,
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

export interface BuyFromListingWithStandingsParams {
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
export function buildBuyFromListingWithStandings(
	params: BuyFromListingWithStandingsParams,
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
		target: `${params.packageId}::ssu_unified::buy_from_listing`,
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

export interface CancelListingWithStandingsParams {
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
 * Build a TX to cancel a sell listing (owner/delegate).
 * No standings check on cancel -- the listing was already validated at creation.
 */
export function buildCancelListingWithStandings(
	params: CancelListingWithStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_unified::cancel_listing`,
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

/**
 * Build a TX for a player to cancel their own sell listing.
 */
export function buildPlayerCancelListingWithStandings(
	params: CancelListingWithStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_unified::player_cancel_listing`,
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

export interface PlayerFillBuyOrderWithStandingsParams {
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
export function buildPlayerFillBuyOrderWithStandings(
	params: PlayerFillBuyOrderWithStandingsParams,
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
		target: `${params.packageId}::ssu_unified::player_fill_buy_order`,
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

export interface FillBuyOrderWithStandingsParams {
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
 * Build a TX to fill a buy order by providing items from the SSU (owner/delegate).
 * No standings check -- buyer passed min_buy when posting the order.
 */
export function buildFillBuyOrderWithStandings(
	params: FillBuyOrderWithStandingsParams,
): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_unified::fill_buy_order`,
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

// ── SsuUnifiedConfig Query Functions ────────────────────────────────────────

/**
 * Fetch an SsuUnifiedConfig by its object ID. Returns SsuUnifiedConfigInfo or null.
 */
export async function querySsuUnifiedConfig(
	client: SuiGraphQLClient,
	ssuConfigId: string,
): Promise<SsuUnifiedConfigInfo | null> {
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
			registryId: String(fields.registry_id ?? ""),
			minDeposit: Number(fields.min_deposit ?? 0),
			minWithdraw: Number(fields.min_withdraw ?? 0),
		};
	} catch {
		return null;
	}
}

/**
 * Discover an SsuUnifiedConfig for a given SSU by searching on-chain.
 * Returns the config object ID if found, null otherwise.
 *
 * Accepts an optional list of previous original package IDs to search
 * as fallback -- config objects retain their original type name
 * permanently, so after a contract republish the old type must be searched.
 */
export async function discoverSsuUnifiedConfig(
	client: SuiGraphQLClient,
	ssuUnifiedPackageId: string,
	ssuId: string,
	previousPackageIds?: string[],
): Promise<string | null> {
	const pkgIds = [ssuUnifiedPackageId, ...(previousPackageIds ?? [])];

	for (const pkgId of pkgIds) {
		const result = await discoverSsuUnifiedConfigByType(client, pkgId, ssuId);
		if (result) return result;
	}

	return null;
}

async function discoverSsuUnifiedConfigByType(
	client: SuiGraphQLClient,
	ssuUnifiedPackageId: string,
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

	const configType = `${ssuUnifiedPackageId}::ssu_unified::SsuUnifiedConfig`;
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

// ── Helpers ─────────────────────────────────────────────────────────────────

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
		const some = obj.Some ?? obj.some;
		if (some) return typeof some === "string" ? some : String(some);
		if ("vec" in obj) {
			const vec = obj.vec;
			if (Array.isArray(vec)) return vec.length > 0 ? String(vec[0]) : null;
		}
	}
	return null;
}
