/**
 * Shared GraphQL query helpers that replace JSON-RPC methods with custom
 * GraphQL queries via SuiGraphQLClient.query().
 *
 * These work with both @mysten/sui v1 (where SuiGraphQLClient only has query/execute)
 * and v2 (which adds unified TransportMethods). By using raw GraphQL throughout,
 * we avoid version-dependent API surface issues.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { bcs } from "@mysten/sui/bcs";

// ── Object Query ────────────────────────────────────────────────────────────

const GET_OBJECT = `
	query($id: SuiAddress!) {
		object(address: $id) {
			objectId: address
			version
			digest
			asMoveObject {
				contents { json type { repr } }
			}
		}
	}
`;

interface GqlObjectResponse {
	object: {
		objectId: string;
		version: number;
		digest: string;
		asMoveObject?: {
			contents?: { json: Record<string, unknown>; type: { repr: string } };
		};
	} | null;
}

/**
 * Fetch a Move object and return its parsed JSON fields,
 * replacing `client.getObject({ id, options: { showContent: true } })`.
 */
export async function getObjectJson(
	client: SuiGraphQLClient,
	objectId: string,
): Promise<{ objectId: string; json: Record<string, unknown> | null; type?: string }> {
	const result = await client.query<GqlObjectResponse, { id: string }>({
		query: GET_OBJECT,
		variables: { id: objectId },
	});

	const obj = result.data?.object;
	if (!obj) {
		return { objectId, json: null };
	}

	return {
		objectId: obj.objectId,
		json: obj.asMoveObject?.contents?.json ?? null,
		type: obj.asMoveObject?.contents?.type?.repr,
	};
}

// ── Dynamic Field List Query ────────────────────────────────────────────────

const LIST_DYNAMIC_FIELDS = `
	query($parentId: SuiAddress!, $first: Int, $after: String) {
		object(address: $parentId) {
			dynamicFields(first: $first, after: $after) {
				nodes {
					name { json type { repr } }
					value {
						... on MoveObject { address }
						... on MoveValue { json type { repr } }
					}
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	}
`;

interface GqlDynamicFieldsResponse {
	object: {
		dynamicFields: {
			nodes: Array<{
				name: { json: unknown; type: { repr: string } };
				value:
					| { __typename: "MoveObject"; address: string }
					| { __typename: "MoveValue"; json: unknown; type: { repr: string } };
			}>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	} | null;
}

export interface DynamicFieldEntry {
	nameType: string;
	nameJson: unknown;
	/** Value JSON (available for MoveValue dynamic fields inline) */
	valueJson?: unknown;
	valueType?: string;
	/** Object address (available for MoveObject dynamic fields -- wrapped objects) */
	valueAddress?: string;
}

/**
 * List dynamic field names on an object,
 * replacing `client.getDynamicFields({ parentId })`.
 */
export async function listDynamicFieldsGql(
	client: SuiGraphQLClient,
	parentId: string,
	opts?: { cursor?: string | null; limit?: number },
): Promise<{
	entries: DynamicFieldEntry[];
	hasNextPage: boolean;
	cursor: string | null;
}> {
	const result = await client.query<
		GqlDynamicFieldsResponse,
		{ parentId: string; first: number; after: string | null }
	>({
		query: LIST_DYNAMIC_FIELDS,
		variables: {
			parentId,
			first: opts?.limit ?? 50,
			after: opts?.cursor ?? null,
		},
	});

	const dfs = result.data?.object?.dynamicFields;
	if (!dfs) {
		return { entries: [], hasNextPage: false, cursor: null };
	}

	return {
		entries: dfs.nodes.map((node) => {
			const val = node.value;
			// MoveValue has json+type inline; MoveObject only has address
			const valueJson = val && "json" in val ? val.json : undefined;
			const valueType = val && "type" in val ? val.type?.repr : undefined;
			const valueAddress = val && "address" in val ? (val.address as string) : undefined;
			return {
				nameType: node.name.type.repr,
				nameJson: node.name.json,
				valueJson,
				valueType,
				valueAddress,
			};
		}),
		hasNextPage: dfs.pageInfo.hasNextPage,
		cursor: dfs.pageInfo.endCursor ?? null,
	};
}

// ── Coin List Query ─────────────────────────────────────────────────────────

/** Normalize a short Sui address to the full 64-hex-char canonical form. */
function normalizeAddress(addr: string): string {
	const hex = addr.startsWith("0x") ? addr.slice(2) : addr;
	return `0x${hex.padStart(64, "0")}`;
}

const LIST_COINS = `
	query($owner: SuiAddress!, $coinObjectType: String!, $first: Int, $after: String) {
		address(address: $owner) {
			objects(filter: { type: $coinObjectType }, first: $first, after: $after) {
				nodes {
					address
					contents { json }
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	}
`;

interface GqlCoinsResponse {
	address: {
		objects: {
			nodes: Array<{
				address: string;
				contents?: { json: Record<string, unknown> };
			}>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	} | null;
}

/**
 * List coins owned by an address via objects query.
 * The type filter requires the full canonical address form (64 hex chars)
 * for the 0x2::coin::Coin wrapper, so we normalize it.
 */
export async function listCoinsGql(
	client: SuiGraphQLClient,
	owner: string,
	coinType: string,
	opts?: { cursor?: string | null; limit?: number },
): Promise<{
	coins: Array<{ objectId: string; balance: string }>;
	hasNextPage: boolean;
	cursor: string | null;
}> {
	// Normalize all addresses in the type string to canonical form.
	// The coinType from type.repr already uses canonical addresses,
	// but the 0x2 Coin wrapper needs normalization too.
	const normalizedCoinType = coinType.replace(/0x[0-9a-fA-F]+(?=::)/g, (m) => normalizeAddress(m));
	const coinObjectType = `${normalizeAddress("0x2")}::coin::Coin<${normalizedCoinType}>`;

	const result = await client.query<
		GqlCoinsResponse,
		{ owner: string; coinObjectType: string; first: number; after: string | null }
	>({
		query: LIST_COINS,
		variables: {
			owner,
			coinObjectType,
			first: opts?.limit ?? 50,
			after: opts?.cursor ?? null,
		},
	});

	const objectsData = result.data?.address?.objects;
	if (!objectsData) {
		return { coins: [], hasNextPage: false, cursor: null };
	}

	return {
		coins: objectsData.nodes.map((node) => ({
			objectId: node.address,
			balance: String(node.contents?.json?.balance ?? "0"),
		})),
		hasNextPage: objectsData.pageInfo.hasNextPage,
		cursor: objectsData.pageInfo.endCursor ?? null,
	};
}

// ── Event Queries ───────────────────────────────────────────────────────────

const QUERY_EVENTS = `
	query($type: String!, $first: Int, $after: String) {
		events(filter: { type: $type }, first: $first, after: $after) {
			nodes {
				sender { address }
				contents { json type { repr } }
				timestamp
			}
			pageInfo { hasNextPage endCursor }
		}
	}
`;

interface GqlEventNode {
	sender: { address: string };
	contents: { json: Record<string, unknown>; type: { repr: string } };
	timestamp: string;
}

interface GqlEventsResponse {
	events: {
		nodes: GqlEventNode[];
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

/**
 * Query events by Move event type, replacing `client.queryEvents({ query: { MoveEventType } })`.
 * Returns a shape compatible with the old JSON-RPC response.
 */
export async function queryEventsGql(
	client: SuiGraphQLClient,
	eventType: string,
	opts?: { cursor?: string | null; limit?: number },
): Promise<{
	data: Array<{
		parsedJson: Record<string, unknown>;
		sender: string;
		timestampMs: string;
	}>;
	hasNextPage: boolean;
	nextCursor: string | null;
}> {
	const result = await client.query<
		GqlEventsResponse,
		{ type: string; first: number; after: string | null }
	>({
		query: QUERY_EVENTS,
		variables: {
			type: eventType,
			first: opts?.limit ?? 50,
			after: opts?.cursor ?? null,
		},
	});

	const events = result.data?.events;
	if (!events) {
		return { data: [], hasNextPage: false, nextCursor: null };
	}

	return {
		data: events.nodes.map((node) => ({
			parsedJson: node.contents.json,
			sender: node.sender.address,
			timestampMs: String(new Date(node.timestamp).getTime()),
		})),
		hasNextPage: events.pageInfo.hasNextPage,
		nextCursor: events.pageInfo.endCursor ?? null,
	};
}

// ── Dynamic Field JSON Query ────────────────────────────────────────────────

const GET_DYNAMIC_FIELD_JSON = `
	query($parentId: SuiAddress!, $nameType: String!, $nameBcs: Base64!) {
		object(address: $parentId) {
			dynamicField(name: { type: $nameType, bcs: $nameBcs }) {
				value {
					... on MoveObject {
						contents { json type { repr } }
					}
					... on MoveValue {
						json type { repr }
					}
				}
			}
		}
	}
`;

interface GqlDynamicFieldResponse {
	object: {
		dynamicField: {
			value:
				| { __typename: "MoveObject"; contents: { json: Record<string, unknown> } }
				| { __typename: "MoveValue"; json: Record<string, unknown> };
		} | null;
	} | null;
}

/**
 * BCS-encode a dynamic field name value based on its type.
 * Returns a base64-encoded string suitable for the GraphQL `bcs` parameter.
 */
function bcsEncodeName(type: string, value: string): string {
	if (type === "u64") {
		return bcs.U64.serialize(BigInt(value)).toBase64();
	}
	if (type === "0x2::object::ID" || type === "address") {
		return bcs.Address.serialize(value).toBase64();
	}
	if (type === "u32") {
		return bcs.U32.serialize(Number(value)).toBase64();
	}
	// Fallback: treat as address
	return bcs.Address.serialize(value).toBase64();
}

/**
 * Fetch a dynamic field's JSON value, replacing `client.getDynamicFieldObject()`.
 * Returns the parsed JSON fields, or null if not found.
 */
export async function getDynamicFieldJson(
	client: SuiGraphQLClient,
	parentId: string,
	name: { type: string; value: string },
): Promise<Record<string, unknown> | null> {
	const nameBcs = bcsEncodeName(name.type, name.value);

	const result = await client.query<
		GqlDynamicFieldResponse,
		{ parentId: string; nameType: string; nameBcs: string }
	>({
		query: GET_DYNAMIC_FIELD_JSON,
		variables: {
			parentId,
			nameType: name.type,
			nameBcs,
		},
	});

	const df = result.data?.object?.dynamicField;
	if (!df?.value) return null;

	// MoveObject wraps in contents.json, MoveValue has json directly
	const val = df.value as Record<string, unknown>;
	if ("contents" in val && val.contents) {
		return (val.contents as { json: Record<string, unknown> }).json;
	}
	if ("json" in val) {
		return val.json as Record<string, unknown>;
	}

	return null;
}

// ── Wallet Transaction Queries ──────────────────────────────────────────────

const QUERY_WALLET_TRANSACTIONS = `
	query($addr: SuiAddress!, $last: Int, $before: String) {
		transactions(last: $last, before: $before, filter: { affectedAddress: $addr }) {
			nodes {
				digest
				effects {
					timestamp
					balanceChanges {
						nodes {
							owner { address }
							coinType { repr }
							amount
						}
					}
				}
			}
			pageInfo { hasPreviousPage startCursor }
		}
	}
`;

interface GqlBalanceChangeNode {
	owner: { address: string } | null;
	coinType: { repr: string };
	amount: string;
}

interface GqlWalletTxResponse {
	transactions: {
		nodes: Array<{
			digest: string;
			effects: {
				timestamp: string;
				balanceChanges: { nodes: GqlBalanceChangeNode[] };
			};
		}>;
		pageInfo: { hasPreviousPage: boolean; startCursor: string | null };
	};
}

export interface WalletBalanceChange {
	coinType: string;
	amount: string;
}

export interface WalletTransaction {
	digest: string;
	timestampMs: number;
	balanceChanges: WalletBalanceChange[];
}

/**
 * Query a wallet's recent transactions with per-transaction balance changes.
 * Uses the top-level transactions query with affectedAddress filter.
 * Filters balance changes to only include those affecting the queried address.
 */
export async function queryWalletTransactions(
	client: SuiGraphQLClient,
	address: string,
	opts?: { cursor?: string | null; limit?: number },
): Promise<{
	data: WalletTransaction[];
	hasMore: boolean;
	nextCursor: string | null;
}> {
	const result = await client.query<
		GqlWalletTxResponse,
		{ addr: string; last: number; before: string | null }
	>({
		query: QUERY_WALLET_TRANSACTIONS,
		variables: {
			addr: address,
			last: opts?.limit ?? 50,
			before: opts?.cursor ?? null,
		},
	});

	const txs = result.data?.transactions;
	if (!txs) {
		return { data: [], hasMore: false, nextCursor: null };
	}

	return {
		data: txs.nodes.map((node) => ({
			digest: node.digest,
			timestampMs: new Date(node.effects.timestamp).getTime(),
			balanceChanges: node.effects.balanceChanges.nodes
				.filter((bc) => bc.owner?.address)
				.map((bc) => ({
					coinType: bc.coinType.repr,
					amount: bc.amount,
				})),
		})),
		hasMore: txs.pageInfo.hasPreviousPage,
		nextCursor: txs.pageInfo.startCursor ?? null,
	};
}

// ── Transaction Queries ─────────────────────────────────────────────────────

const QUERY_TRANSACTIONS_BY_ADDRESS = `
	query($addr: SuiAddress!, $first: Int, $after: String) {
		address(address: $addr) {
			transactionBlocks(first: $first, after: $after) {
				nodes {
					digest
					effects {
						objectChanges {
							nodes {
								address
								outputState { asMoveObject { contents { type { repr } } } }
							}
						}
						timestamp
					}
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	}
`;

interface GqlTxByAddressResponse {
	address: {
		transactionBlocks: {
			nodes: Array<{
				digest: string;
				effects: {
					objectChanges: {
						nodes: Array<{
							address: string;
							outputState?: { asMoveObject?: { contents?: { type?: { repr: string } } } };
						}>;
					};
					timestamp: string;
				};
			}>;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	} | null;
}

/**
 * Query transactions associated with an address,
 * replacing `client.queryTransactionBlocks({ filter: { FromAddress } })`.
 */
export async function queryTransactionsByAddress(
	client: SuiGraphQLClient,
	address: string,
	opts?: { cursor?: string | null; limit?: number },
): Promise<{
	data: Array<{
		digest: string;
		objectChanges: Array<{ objectId: string; objectType?: string }>;
		timestampMs: string;
	}>;
	hasNextPage: boolean;
	nextCursor: string | null;
}> {
	const result = await client.query<
		GqlTxByAddressResponse,
		{ addr: string; first: number; after: string | null }
	>({
		query: QUERY_TRANSACTIONS_BY_ADDRESS,
		variables: {
			addr: address,
			first: opts?.limit ?? 50,
			after: opts?.cursor ?? null,
		},
	});

	const txBlocks = result.data?.address?.transactionBlocks;
	if (!txBlocks) {
		return { data: [], hasNextPage: false, nextCursor: null };
	}

	return {
		data: txBlocks.nodes.map((node) => ({
			digest: node.digest,
			objectChanges: node.effects.objectChanges.nodes.map((oc) => ({
				objectId: oc.address,
				objectType: oc.outputState?.asMoveObject?.contents?.type?.repr,
			})),
			timestampMs: String(new Date(node.effects.timestamp).getTime()),
		})),
		hasNextPage: txBlocks.pageInfo.hasNextPage,
		nextCursor: txBlocks.pageInfo.endCursor ?? null,
	};
}

// ── Transaction by Object Query ─────────────────────────────────────────────

const QUERY_TRANSACTIONS_BY_OBJECT = `
	query($objectId: SuiAddress!, $first: Int, $after: String) {
		transactionBlocks(filter: { changedObject: $objectId }, first: $first, after: $after) {
			nodes {
				digest
				effects {
					timestamp
				}
			}
			pageInfo { hasNextPage endCursor }
		}
	}
`;

interface GqlTxByObjectResponse {
	transactionBlocks: {
		nodes: Array<{
			digest: string;
			effects: { timestamp: string };
		}>;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

/**
 * Query transactions that affected an object,
 * replacing `client.queryTransactionBlocks({ filter: { ChangedObject } })`.
 */
export async function queryTransactionsByObject(
	client: SuiGraphQLClient,
	objectId: string,
	opts?: { cursor?: string | null; limit?: number },
): Promise<{
	data: Array<{ digest: string; timestampMs: string }>;
	hasNextPage: boolean;
	nextCursor: string | null;
}> {
	const result = await client.query<
		GqlTxByObjectResponse,
		{ objectId: string; first: number; after: string | null }
	>({
		query: QUERY_TRANSACTIONS_BY_OBJECT,
		variables: {
			objectId,
			first: opts?.limit ?? 50,
			after: opts?.cursor ?? null,
		},
	});

	const txBlocks = result.data?.transactionBlocks;
	if (!txBlocks) {
		return { data: [], hasNextPage: false, nextCursor: null };
	}

	return {
		data: txBlocks.nodes.map((node) => ({
			digest: node.digest,
			timestampMs: String(new Date(node.effects.timestamp).getTime()),
		})),
		hasNextPage: txBlocks.pageInfo.hasNextPage,
		nextCursor: txBlocks.pageInfo.endCursor ?? null,
	};
}

// ── Coin Supply Query ───────────────────────────────────────────────────────

const GET_COIN_SUPPLY = `
	query($coinType: String!) {
		coinMetadata(coinType: $coinType) {
			supply
		}
	}
`;

interface GqlCoinSupplyResponse {
	coinMetadata: { supply: string } | null;
}

/**
 * Query total supply for a coin type,
 * replacing `client.getTotalSupply({ coinType })`.
 */
export async function getCoinSupply(
	client: SuiGraphQLClient,
	coinType: string,
): Promise<{ value: string }> {
	const result = await client.query<GqlCoinSupplyResponse, { coinType: string }>({
		query: GET_COIN_SUPPLY,
		variables: { coinType },
	});

	const supply = result.data?.coinMetadata?.supply;
	return { value: supply ?? "0" };
}

// ── Coin Metadata Query ─────────────────────────────────────────────────────

const GET_COIN_METADATA = `
	query($coinType: String!) {
		coinMetadata(coinType: $coinType) {
			decimals
			symbol
			name
		}
	}
`;

interface GqlCoinMetadataResponse {
	coinMetadata: { decimals: number; symbol: string; name: string } | null;
}

export interface CoinMetadata {
	decimals: number;
	symbol: string;
	name: string;
}

/**
 * Query coin metadata (decimals, symbol, name) for a coin type.
 * Returns null if no metadata is found.
 */
export async function getCoinMetadata(
	client: SuiGraphQLClient,
	coinType: string,
): Promise<CoinMetadata | null> {
	const result = await client.query<GqlCoinMetadataResponse, { coinType: string }>({
		query: GET_COIN_METADATA,
		variables: { coinType },
	});

	const meta = result.data?.coinMetadata;
	if (!meta) return null;

	return {
		decimals: meta.decimals,
		symbol: meta.symbol,
		name: meta.name,
	};
}
