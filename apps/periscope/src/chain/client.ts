// ── Sui Chain Client ────────────────────────────────────────────────────────
// Browser-compatible Sui RPC client for querying on-chain game data.
// Types are inferred from the @tehfrontier/sui-client package to avoid
// direct @mysten/sui dependency in the periscope app.

import { createSuiClient } from "@tehfrontier/sui-client";
import { MOVE_TYPES, EVENT_TYPES } from "./config";

type SuiClient = ReturnType<typeof createSuiClient>;

let client: SuiClient | null = null;

export function getSuiClient(): SuiClient {
	if (!client) {
		client = createSuiClient("testnet");
	}
	return client;
}

// ── Shared types ────────────────────────────────────────────────────────────

// Minimal type definitions matching Sui SDK responses
export interface SuiObjectData {
	objectId: string;
	version: string;
	digest: string;
	type?: string;
	content?: {
		dataType: string;
		type?: string;
		fields?: Record<string, unknown>;
	};
	owner?:
		| string
		| { AddressOwner: string }
		| { ObjectOwner: string }
		| { Shared: { initial_shared_version: number } };
}

export interface SuiObjectResponse {
	data?: SuiObjectData;
	error?: unknown;
}

export interface SuiEvent {
	id: { txDigest: string; eventSeq: string };
	packageId: string;
	transactionModule: string;
	sender: string;
	type: string;
	parsedJson?: Record<string, unknown>;
	timestampMs?: string;
}

// ── Object Queries ──────────────────────────────────────────────────────────

/** Get all objects of a specific Move type owned by an address. */
export async function getOwnedObjectsByType(
	address: string,
	moveType: string,
): Promise<SuiObjectResponse[]> {
	const c = getSuiClient();
	const results: SuiObjectResponse[] = [];
	let cursor: string | null | undefined = undefined;
	let hasNext = true;

	while (hasNext) {
		const page = await c.getOwnedObjects({
			owner: address,
			filter: { StructType: moveType },
			options: { showContent: true, showType: true },
			cursor: cursor ?? undefined,
			limit: 50,
		});

		results.push(...(page.data as SuiObjectResponse[]));
		cursor = page.nextCursor;
		hasNext = page.hasNextPage;
	}

	return results;
}

/** Get a single object by ID with full content. */
export async function getObjectDetails(objectId: string): Promise<SuiObjectResponse> {
	const c = getSuiClient();
	return c.getObject({
		id: objectId,
		options: { showContent: true, showType: true, showOwner: true },
	}) as Promise<SuiObjectResponse>;
}

/** Batch get multiple objects by ID. */
export async function multiGetObjects(objectIds: string[]): Promise<SuiObjectResponse[]> {
	if (objectIds.length === 0) return [];
	const c = getSuiClient();

	// Sui limits to 50 per batch
	const results: SuiObjectResponse[] = [];
	for (let i = 0; i < objectIds.length; i += 50) {
		const batch = objectIds.slice(i, i + 50);
		const page = await c.multiGetObjects({
			ids: batch,
			options: { showContent: true, showType: true, showOwner: true },
		});
		results.push(...(page as SuiObjectResponse[]));
	}
	return results;
}

// ── Character Queries ───────────────────────────────────────────────────────

/** Find Character objects owned by an address. */
export async function getCharacters(address: string): Promise<SuiObjectResponse[]> {
	return getOwnedObjectsByType(address, MOVE_TYPES.Character);
}

const GRAPHQL_URL = "https://graphql.testnet.sui.io/graphql";
const CHARACTER_TYPE = MOVE_TYPES.Character;

interface CharacterLookupResult {
	suiAddress: string;
	characterName: string;
	tribeId: number;
}

// biome-ignore lint/suspicious/noExplicitAny: GraphQL response shape is dynamic
type GqlJson = Record<string, any>;

/** Look up a character's Sui address by in-game character ID (from log filenames).
 *  Uses Sui GraphQL to search Character objects by key.item_id. */
export async function lookupCharacterByItemId(
	itemId: string,
): Promise<CharacterLookupResult | null> {
	let cursor: string | null = null;

	for (let page = 0; page < 200; page++) {
		const afterClause: string = cursor ? `, after: "${cursor}"` : "";
		const query: string = `{
			objects(filter: { type: "${CHARACTER_TYPE}" }, first: 50${afterClause}) {
				nodes {
					asMoveObject { contents { json } }
				}
				pageInfo { hasNextPage endCursor }
			}
		}`;

		const res: Response = await fetch(GRAPHQL_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query }),
		});

		if (!res.ok) {
			console.warn(`[lookupCharacter] GraphQL error: ${res.status}`);
			return null;
		}

		const body: GqlJson = await res.json();
		const nodes: GqlJson[] | undefined = body?.data?.objects?.nodes;
		if (!nodes) return null;

		for (const node of nodes) {
			const json: GqlJson | undefined = node?.asMoveObject?.contents?.json;
			if (!json) continue;

			if (json.key?.item_id === itemId) {
				return {
					suiAddress: json.character_address as string,
					characterName: (json.metadata?.name as string) ?? "Unknown",
					tribeId: json.tribe_id as number,
				};
			}
		}

		const pageInfo: GqlJson = body.data.objects.pageInfo;
		if (!pageInfo.hasNextPage) break;
		cursor = pageInfo.endCursor as string;
	}

	return null;
}

// ── Assembly Discovery ──────────────────────────────────────────────────────

/** Discover all assemblies owned by an address.
 *  Assemblies are shared objects — we find them via OwnerCap objects. */
export async function getOwnedAssemblies(address: string): Promise<SuiObjectResponse[]> {
	// First try direct Assembly type query
	const assemblies = await getOwnedObjectsByType(address, MOVE_TYPES.Assembly);
	if (assemblies.length > 0) return assemblies;

	// Assemblies might be shared objects found via events or other mechanisms.
	// Query all subtypes in parallel
	const subtypes = [
		MOVE_TYPES.StorageUnit,
		MOVE_TYPES.Gate,
		MOVE_TYPES.Turret,
		MOVE_TYPES.NetworkNode,
		MOVE_TYPES.Manufacturing,
		MOVE_TYPES.Refinery,
	];

	const batches = await Promise.all(subtypes.map((type) => getOwnedObjectsByType(address, type)));
	return batches.flat();
}

// ── Event Queries ───────────────────────────────────────────────────────────

interface EventQueryOptions {
	eventType: string;
	cursor?: { txDigest: string; eventSeq: string } | null;
	limit?: number;
	order?: "ascending" | "descending";
}

interface EventQueryResult {
	events: SuiEvent[];
	nextCursor: { txDigest: string; eventSeq: string } | null;
	hasNextPage: boolean;
}

/** Query Move events by type. */
export async function queryEvents(options: EventQueryOptions): Promise<EventQueryResult> {
	const c = getSuiClient();
	const result = await c.queryEvents({
		query: { MoveEventType: options.eventType },
		cursor: options.cursor ?? undefined,
		limit: options.limit ?? 50,
		order: options.order ?? "descending",
	});

	return {
		events: result.data as unknown as SuiEvent[],
		nextCursor: result.nextCursor as { txDigest: string; eventSeq: string } | null,
		hasNextPage: result.hasNextPage,
	};
}

/** Query recent killmail events. */
export async function getRecentKillmails(limit = 50) {
	return queryEvents({
		eventType: EVENT_TYPES.KillmailCreated,
		limit,
		order: "descending",
	});
}

// ── Object Field Extraction ─────────────────────────────────────────────────

/** Extract typed fields from a Sui object's Move content. */
export function extractFields(obj: SuiObjectResponse): Record<string, unknown> | null {
	const content = obj.data?.content;
	if (!content || content.dataType !== "moveObject") return null;
	return (content.fields ?? null) as Record<string, unknown> | null;
}

/** Extract the Move type string from an object response. */
export function extractType(obj: SuiObjectResponse): string | null {
	const content = obj.data?.content;
	if (!content || content.dataType !== "moveObject") return null;
	return content.type ?? null;
}

/** Extract the object ID from a response. */
export function extractObjectId(obj: SuiObjectResponse): string | null {
	return obj.data?.objectId ?? null;
}

/** Extract owner address from an object response. */
export function extractOwner(obj: SuiObjectResponse): string | null {
	const owner = obj.data?.owner;
	if (!owner) return null;
	if (typeof owner === "string") return owner;
	if ("AddressOwner" in owner) return owner.AddressOwner;
	if ("ObjectOwner" in owner) return owner.ObjectOwner;
	return null;
}
