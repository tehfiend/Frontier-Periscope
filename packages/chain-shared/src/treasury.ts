/**
 * Treasury -- Transaction builders and query helpers for the
 * treasury::treasury Move module.
 *
 * Treasury is a shared multi-user wallet object with an owner + admins
 * access control list (same pattern as StandingsRegistry). It holds
 * balances of one or more Coin<T> types as dynamic fields keyed by
 * phantom-typed BalanceKey<T>.
 *
 * Deposits are open to anyone (gate extensions can deposit toll revenue).
 * Withdrawals require owner or admin authorization.
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { getObjectJson, listDynamicFieldsGql } from "./graphql-queries";
import type { TreasuryBalance, TreasuryInfo } from "./types";

// ── Treasury Creation ────────────────────────────────────────────────────────

export interface CreateTreasuryParams {
	packageId: string;
	name: string;
	senderAddress: string;
}

/**
 * Build a TX to create a new Treasury shared object.
 * The sender becomes the owner.
 */
export function buildCreateTreasury(params: CreateTreasuryParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::treasury::create_treasury`,
		arguments: [
			tx.pure.vector("u8", Array.from(new TextEncoder().encode(params.name))),
		],
	});

	return tx;
}

// ── Admin Management (owner only) ────────────────────────────────────────────

export interface AddTreasuryAdminParams {
	packageId: string;
	treasuryId: string;
	adminAddress: string;
	senderAddress: string;
}

/** Build a TX to add an admin to a Treasury. Owner only. */
export function buildAddTreasuryAdmin(params: AddTreasuryAdminParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::treasury::add_admin`,
		arguments: [tx.object(params.treasuryId), tx.pure.address(params.adminAddress)],
	});

	return tx;
}

export interface RemoveTreasuryAdminParams {
	packageId: string;
	treasuryId: string;
	adminAddress: string;
	senderAddress: string;
}

/** Build a TX to remove an admin from a Treasury. Owner only. */
export function buildRemoveTreasuryAdmin(params: RemoveTreasuryAdminParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::treasury::remove_admin`,
		arguments: [tx.object(params.treasuryId), tx.pure.address(params.adminAddress)],
	});

	return tx;
}

// ── Deposit (open to anyone) ─────────────────────────────────────────────────

export interface TreasuryDepositParams {
	packageId: string;
	treasuryId: string;
	coinType: string;
	coinObjectIds: string[];
	amount: bigint;
	senderAddress: string;
}

/**
 * Build a TX to deposit Coin<T> into a Treasury.
 * Open to anyone -- gate extensions can deposit toll revenue without being admins.
 * Uses merge+split pattern for exact deposit amount.
 */
export function buildTreasuryDeposit(params: TreasuryDepositParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Merge+split coin objects into exact deposit amount
	if (params.coinObjectIds.length === 0) {
		throw new Error("No coin objects provided for treasury deposit");
	}

	let depositCoin: ReturnType<typeof tx.splitCoins>[0];
	if (params.coinObjectIds.length === 1) {
		// Single coin -- split the exact amount
		[depositCoin] = tx.splitCoins(tx.object(params.coinObjectIds[0]), [
			tx.pure.u64(params.amount),
		]);
	} else {
		// Multiple coins -- merge into first, then split
		const [baseCoin, ...restCoins] = params.coinObjectIds;
		tx.mergeCoins(
			tx.object(baseCoin),
			restCoins.map((id) => tx.object(id)),
		);
		[depositCoin] = tx.splitCoins(tx.object(baseCoin), [tx.pure.u64(params.amount)]);
	}

	tx.moveCall({
		target: `${params.packageId}::treasury::deposit`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.treasuryId), depositCoin],
	});

	return tx;
}

// ── Withdraw (owner/admin only) ──────────────────────────────────────────────

export interface TreasuryWithdrawParams {
	packageId: string;
	treasuryId: string;
	coinType: string;
	amount: bigint;
	senderAddress: string;
}

/**
 * Build a TX to withdraw Coin<T> from a Treasury.
 * Owner or admin only. Splits the requested amount from the treasury's
 * Balance<T> and transfers the resulting Coin<T> to the sender.
 */
export function buildTreasuryWithdraw(params: TreasuryWithdrawParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::treasury::withdraw`,
		typeArguments: [params.coinType],
		arguments: [tx.object(params.treasuryId), tx.pure.u64(params.amount)],
	});

	return tx;
}

// ── Query Functions ──────────────────────────────────────────────────────────

/**
 * Fetch full details of a Treasury by its object ID.
 * Uses the getObjectJson pattern from ssu-unified.ts.
 */
export async function queryTreasuryDetails(
	client: SuiGraphQLClient,
	treasuryId: string,
): Promise<TreasuryInfo | null> {
	try {
		const obj = await getObjectJson(client, treasuryId);
		if (!obj.json) return null;

		const fields = obj.json;
		return {
			objectId: treasuryId,
			owner: String(fields.owner ?? ""),
			admins: ((fields.admins as unknown[]) ?? []).map(String),
			name: decodeTreasuryName(fields.name),
		};
	} catch {
		return null;
	}
}

/**
 * Enumerate coin balances stored in a Treasury's dynamic fields.
 * Balance<T> fields are keyed by phantom-typed BalanceKey<T> structs.
 * Returns an array of TreasuryBalance entries.
 */
export async function queryTreasuryBalances(
	client: SuiGraphQLClient,
	treasuryId: string,
): Promise<TreasuryBalance[]> {
	const balances: TreasuryBalance[] = [];

	try {
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const page = await listDynamicFieldsGql(client, treasuryId, {
				cursor,
				limit: 50,
			});

			for (const df of page.entries) {
				// BalanceKey<T> dynamic fields store Balance<T> values.
				// The key type includes the coin type: "PKG::treasury::BalanceKey<COIN_TYPE>"
				if (!df.nameType.includes("BalanceKey")) continue;

				// Extract coin type from the key type repr
				const coinTypeMatch = df.nameType.match(/BalanceKey<(.+)>$/);
				if (!coinTypeMatch) continue;

				let amount = BigInt(0);

				if (df.valueJson != null) {
					// MoveValue case: json is inline.
					// Balance<T> may serialize as { value: u64 } or as a raw number.
					const v = df.valueJson;
					if (typeof v === "number" || typeof v === "string") {
						amount = BigInt(v);
					} else if (typeof v === "object" && v !== null) {
						const fields = v as Record<string, unknown>;
						if (fields.value != null) amount = BigInt(String(fields.value));
					}
				} else if (df.valueAddress) {
					// MoveObject case: wrapped object, fetch by address
					try {
						const obj = await getObjectJson(client, df.valueAddress);
						if (obj.json?.value != null) {
							amount = BigInt(String(obj.json.value));
						}
					} catch {
						// non-fatal
					}
				}

				balances.push({
					coinType: coinTypeMatch[1],
					amount,
				});
			}

			hasMore = page.hasNextPage;
			cursor = page.cursor;
		}
	} catch {
		// Return whatever we've collected so far
	}

	return balances;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode a Move vector<u8> name field. Sui GraphQL returns vector<u8>
 * as base64-encoded strings. Also handles number arrays as a fallback.
 * Same pattern as decodeRegistryName in standings-registry.ts.
 */
function decodeTreasuryName(nameField: unknown): string {
	if (typeof nameField === "string") {
		try {
			return new TextDecoder().decode(
				Uint8Array.from(atob(nameField), (c) => c.charCodeAt(0)),
			);
		} catch {
			return nameField;
		}
	}
	if (Array.isArray(nameField)) {
		try {
			return new TextDecoder().decode(new Uint8Array(nameField.map(Number)));
		} catch {
			return "";
		}
	}
	return "";
}

// ── Treasury Discovery ──────────────────────────────────────────────────────

/**
 * Discover Treasury object IDs created by a given owner address.
 * Queries TreasuryCreatedEvent and returns a map of treasury_id -> name.
 */
export async function discoverTreasuries(
	client: SuiGraphQLClient,
	treasuryPackageId: string,
	ownerAddress: string,
): Promise<Array<{ treasuryId: string; name: string }>> {
	const QUERY = `
		query($eventType: String!, $first: Int, $after: String) {
			events(filter: { eventType: $eventType }, first: $first, after: $after) {
				nodes {
					json
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	`;

	interface Resp {
		events: {
			nodes: Array<{ json: Record<string, unknown> }>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	}

	const eventType = `${treasuryPackageId}::treasury::TreasuryCreatedEvent`;
	const results: Array<{ treasuryId: string; name: string }> = [];
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		try {
			const resp: { data?: Resp } = await client.query({
				query: QUERY,
				variables: { eventType, first: 50, after: cursor },
			});
			const events = resp.data?.events;
			if (!events) break;

			for (const node of events.nodes) {
				const j = node.json;
				if (String(j.owner ?? "") === ownerAddress) {
					const nameBytes = j.name;
					let name = "";
					if (Array.isArray(nameBytes)) {
						try {
							name = new TextDecoder().decode(new Uint8Array(nameBytes.map(Number)));
						} catch { /* ignore */ }
					} else if (typeof nameBytes === "string") {
						name = nameBytes;
					}
					results.push({ treasuryId: String(j.treasury_id ?? ""), name });
				}
			}

			hasMore = events.pageInfo.hasNextPage;
			cursor = events.pageInfo.endCursor;
		} catch {
			break;
		}
	}

	return results;
}
