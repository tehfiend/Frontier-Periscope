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
import { Transaction } from "@mysten/sui/transactions";
import { getDynamicFieldJson, getObjectJson } from "./graphql-queries";
import type { SsuUnifiedConfigInfo } from "./types";

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

// ── Trade Execution Builders (composite ssu_unified entry points) ────────────

export interface EscrowAndListParams {
	ssuUnifiedPackageId: string;
	ssuConfigId: string;
	ssuObjectId: string;
	characterObjectId: string;
	coinType: string;
	marketId: string;
	typeId: number;
	pricePerUnit: bigint;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a TX to escrow items from SSU inventory and post a sell listing.
 * Calls ssu_unified::escrow_and_list which atomically handles both the
 * inventory escrow and the market listing in a single transaction.
 */
export function buildEscrowAndList(params: EscrowAndListParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.ssuUnifiedPackageId}::ssu_unified::escrow_and_list`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.marketId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.u64(params.quantity),
			tx.object("0x6"),
		],
	});

	return tx;
}

/** @deprecated Use buildEscrowAndList instead. */
export const buildEscrowAndListWithStandings = buildEscrowAndList;

export interface BuyAndReceiveParams {
	ssuUnifiedPackageId: string;
	ssuConfigId: string;
	ssuObjectId: string;
	ownerCharacterObjectId: string;
	buyerCharacterObjectId: string;
	coinType: string;
	marketId: string;
	listingId: number;
	quantity: number;
	coinObjectIds: string[];
	senderAddress: string;
}

/**
 * Build a TX to buy items from a sell listing and receive them into SSU
 * inventory. Calls ssu_unified::buy_and_receive which atomically handles
 * the market purchase and inventory deposit.
 * Merges all provided coins into one before passing to the contract.
 * Returns change coin to sender.
 */
export function buildBuyAndReceive(params: BuyAndReceiveParams): Transaction {
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
		target: `${params.ssuUnifiedPackageId}::ssu_unified::buy_and_receive`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.marketId),
			tx.object(params.ssuObjectId),
			tx.object(params.ownerCharacterObjectId),
			tx.object(params.buyerCharacterObjectId),
			tx.pure.u64(params.listingId),
			tx.pure.u64(params.quantity),
			paymentCoin,
			tx.object("0x6"),
		],
	});

	// Transfer change back to sender
	tx.transferObjects([change], params.senderAddress);

	return tx;
}

/** @deprecated Use buildBuyAndReceive instead. */
export const buildBuyFromListingWithStandings = buildBuyAndReceive;

export interface CancelAndUnescrowParams {
	ssuUnifiedPackageId: string;
	ssuConfigId: string;
	ssuObjectId: string;
	characterObjectId: string;
	coinType: string;
	marketId: string;
	listingId: number;
	senderAddress: string;
}

/**
 * Build a TX to cancel a sell listing and return escrowed items to SSU
 * inventory. Calls ssu_unified::cancel_and_unescrow which atomically
 * handles the listing cancellation and inventory return.
 */
export function buildCancelAndUnescrow(params: CancelAndUnescrowParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.ssuUnifiedPackageId}::ssu_unified::cancel_and_unescrow`,
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

/** @deprecated Use buildCancelAndUnescrow instead. */
export const buildCancelListingWithStandings = buildCancelAndUnescrow;

export interface FillAndDeliverParams {
	ssuUnifiedPackageId: string;
	ssuConfigId: string;
	ssuObjectId: string;
	characterObjectId: string;
	buyerCharacterObjectId: string;
	coinType: string;
	marketId: string;
	orderId: number;
	typeId: number;
	quantity: number;
	senderAddress: string;
}

/**
 * Build a TX to fill a buy order and deliver items from SSU inventory.
 * Calls ssu_unified::fill_and_deliver which atomically handles the
 * order fulfillment and inventory transfer.
 */
export function buildFillAndDeliver(params: FillAndDeliverParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.ssuUnifiedPackageId}::ssu_unified::fill_and_deliver`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.ssuConfigId),
			tx.object(params.marketId),
			tx.object(params.ssuObjectId),
			tx.object(params.characterObjectId),
			tx.object(params.buyerCharacterObjectId),
			tx.pure.u64(params.orderId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.quantity),
		],
	});

	return tx;
}

/** @deprecated Use buildFillAndDeliver instead. */
export const buildFillBuyOrderWithStandings = buildFillAndDeliver;

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

// ── SSU Standings Config Query (Dynamic Field) ──────────────────────────────

export interface SsuStandingsEntry {
	configOwner: string;
	registryId: string;
	minDeposit: number;
	minWithdraw: number;
}

/**
 * Query per-SSU standings config from a SsuStandingsConfig shared object.
 *
 * The SsuStandingsConfig stores per-SSU entries as dynamic fields keyed by
 * `SsuKey { ssu_id: address }`. Returns the parsed entry or null if no config
 * is set for the given SSU.
 */
export async function querySsuStandingsEntry(
	client: SuiGraphQLClient,
	configObjectId: string,
	packageId: string,
	ssuId: string,
): Promise<SsuStandingsEntry | null> {
	try {
		const json = await getDynamicFieldJson(client, configObjectId, {
			type: `${packageId}::ssu_standings::SsuKey`,
			value: ssuId,
		});
		if (!json) return null;
		return {
			configOwner: String(json.config_owner ?? ""),
			registryId: String(json.registry_id ?? ""),
			minDeposit: Number(json.min_deposit ?? 0),
			minWithdraw: Number(json.min_withdraw ?? 0),
		};
	} catch {
		return null;
	}
}
