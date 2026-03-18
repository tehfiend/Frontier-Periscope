// ── Sui Chain Client ────────────────────────────────────────────────────────
// Browser-compatible Sui GraphQL client for querying on-chain game data.
// Uses SuiGraphQLClient via @tehfrontier/sui-client and GraphQL query helpers
// from @tehfrontier/chain-shared.

import { createSuiClient } from "@tehfrontier/sui-client";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	getObjectJson,
	queryEventsGql,
} from "@tehfrontier/chain-shared";
import { TENANTS, getMoveTypes, getEventTypes, type TenantId } from "./config";
import { cacheCharacterFromLookup, ensureTribeName, getTribeName } from "./manifest";
import { db } from "@/db";

let client: SuiGraphQLClient | null = null;

export function getSuiClient(): SuiGraphQLClient {
	if (!client) {
		client = createSuiClient("testnet");
	}
	return client;
}

// ── Shared types ────────────────────────────────────────────────────────────

// Normalized object shape used throughout periscope chain layer.
// Matches the output of getObjectJson() from chain-shared.
export interface SuiObjectData {
	objectId: string;
	json: Record<string, unknown> | null;
	type?: string;
}

export interface SuiEvent {
	parsedJson: Record<string, unknown>;
	sender: string;
	timestampMs: string;
}

// ── Object Queries ──────────────────────────────────────────────────────────

/** Get all objects of a specific Move type owned by an address. */
export async function getOwnedObjectsByType(
	address: string,
	moveType: string,
): Promise<SuiObjectData[]> {
	const c = getSuiClient();
	const results: SuiObjectData[] = [];
	let cursor: string | null = null;
	let hasNext = true;

	while (hasNext) {
		const page: { objects: Array<{ objectId: string; json?: Record<string, unknown> | null; type?: string }>; hasNextPage: boolean; cursor: string | null } = await c.listOwnedObjects({
			owner: address,
			type: moveType,
			include: { json: true },
			cursor: cursor ?? undefined,
			limit: 50,
		});

		for (const obj of page.objects) {
			results.push({
				objectId: obj.objectId,
				json: obj.json ?? null,
				type: obj.type,
			});
		}
		cursor = page.cursor ?? null;
		hasNext = page.hasNextPage;
	}

	return results;
}

/** Get a single object by ID with full content. */
export async function getObjectDetails(objectId: string): Promise<SuiObjectData> {
	return getObjectJson(getSuiClient(), objectId);
}

/** Batch get multiple objects by ID. */
export async function multiGetObjects(objectIds: string[]): Promise<SuiObjectData[]> {
	if (objectIds.length === 0) return [];
	const c = getSuiClient();

	// GraphQL batch limit — process in chunks of 50
	const results: SuiObjectData[] = [];
	for (let i = 0; i < objectIds.length; i += 50) {
		const batch = objectIds.slice(i, i + 50);
		const { objects } = await c.getObjects({
			objectIds: batch,
			include: { json: true },
		});
		for (const obj of objects) {
			if ("objectId" in obj) {
				results.push({
					objectId: obj.objectId,
					json: obj.json ?? null,
					type: obj.type,
				});
			}
		}
	}
	return results;
}

// ── Character Queries ───────────────────────────────────────────────────────

/** Find Character objects owned by an address. */
export async function getCharacters(
	address: string,
	tenant: TenantId = "stillness",
): Promise<SuiObjectData[]> {
	return getOwnedObjectsByType(address, getMoveTypes(tenant).Character);
}

export interface CharacterLookupResult {
	suiAddress: string;
	characterName: string;
	tribeId: number;
	tribeName?: string;
	characterObjectId?: string;
	tenant?: TenantId;
}

// biome-ignore lint/suspicious/noExplicitAny: GraphQL response shape is dynamic
type GqlJson = Record<string, any>;

type EventQueryResult = {
	events: {
		nodes: Array<{ contents?: { json: GqlJson } }>;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
};

/** Look up a character's Sui address by in-game character ID (from log filenames).
 *  Checks the local manifest cache first (instant). Falls back to searching
 *  CharacterCreatedEvent on chain, caching all results along the way. */
export async function lookupCharacterByItemId(
	itemId: string,
	tenant: TenantId = "stillness",
): Promise<CharacterLookupResult | null> {
	// Fast path: check manifest cache first
	const cached = await db.manifestCharacters
		.where("characterItemId")
		.equals(itemId)
		.first();
	if (cached?.suiAddress) {
		const tribeName = cached.tribeId
			? (await getTribeName(cached.tribeId)) ?? undefined
			: undefined;
		return {
			suiAddress: cached.suiAddress,
			characterName: cached.name ?? "",
			tribeId: cached.tribeId ?? 0,
			tribeName,
			characterObjectId: cached.id,
			tenant: (cached.tenant as TenantId) ?? tenant,
		};
	}

	// Slow path: search chain events (caches everything it finds)
	const tenants: TenantId[] = [tenant, ...(Object.keys(TENANTS) as TenantId[]).filter((t) => t !== tenant)];
	for (const t of tenants) {
		const result = await searchCharacterEvents(itemId, t);
		if (result) return result;
	}
	return null;
}

async function searchCharacterEvents(
	itemId: string,
	tenant: TenantId,
): Promise<CharacterLookupResult | null> {
	const c = getSuiClient();
	const eventType = getEventTypes(tenant).CharacterCreated;
	let cursor: string | null = null;
	let match: CharacterLookupResult | null = null;

	// Collect unique tribe IDs to batch-cache after search
	const seenTribes = new Set<number>();

	for (let page = 0; page < 100; page++) {
		const gqlQuery = `{
			events(filter: { type: "${eventType}" }, first: 50${cursor ? `, after: "${cursor}"` : ""}) {
				nodes {
					contents { json }
				}
				pageInfo { hasNextPage endCursor }
			}
		}`;

		let result: { data?: EventQueryResult | null };
		try {
			result = await c.query<EventQueryResult>({
				query: gqlQuery,
				variables: {},
			});
		} catch {
			break;
		}

		const nodes = result.data?.events?.nodes;
		if (!nodes) break;

		// Cache every character from this page of events
		const batch: Array<{
			charObjId: string;
			charItemId: string;
			suiAddress: string;
			tribeId: number;
		}> = [];

		for (const node of nodes) {
			const json = node?.contents?.json;
			if (!json?.key?.item_id) continue;

			const charObjId = (json.character_id as string) ?? "";
			const charItemId = json.key.item_id as string;
			const suiAddress = json.character_address as string;
			const tribeId = json.tribe_id as number;

			if (tribeId) seenTribes.add(tribeId);

			if (charObjId && suiAddress) {
				batch.push({ charObjId, charItemId, suiAddress, tribeId });
			}

			// Check for our target
			if (charItemId === itemId) {
				// Fetch the Character object for the name
				let characterName = "";
				if (charObjId) {
					try {
						const obj = await getObjectDetails(charObjId);
						const fields = obj.json as GqlJson | null;
						characterName = (fields?.metadata?.name as string) ?? "";
					} catch {
						// Object fetch failed
					}
				}

				match = {
					suiAddress,
					characterName,
					tribeId,
					characterObjectId: charObjId || undefined,
					tenant,
				};
			}
		}

		// Bulk cache all characters from this page (fire-and-forget)
		for (const entry of batch) {
			cacheCharacterFromLookup(
				entry.charObjId,
				entry.charItemId,
				entry.suiAddress,
				"", // Name resolved separately for the target only
				entry.tribeId,
				tenant,
			).catch(() => {});
		}

		// If we found the target, resolve its tribe and return
		if (match) {
			try {
				match.tribeName =
					(await ensureTribeName(match.tribeId, tenant)) ?? undefined;
			} catch {
				// non-critical
			}
			return match;
		}

		const pageInfo = result.data?.events?.pageInfo;
		if (!pageInfo?.hasNextPage) break;
		cursor = pageInfo.endCursor ?? null;
	}

	// Didn't find the target, but we cached everything we saw.
	// Also trigger a tribe cache for all seen tribe IDs (fire-and-forget).
	for (const tribeId of seenTribes) {
		ensureTribeName(tribeId, tenant).catch(() => {});
	}

	return null;
}

// ── Assembly Discovery ──────────────────────────────────────────────────────

/** Discover all assemblies owned by an address.
 *  Assemblies are shared objects — we find them via OwnerCap objects. */
export async function getOwnedAssemblies(
	address: string,
	tenant: TenantId = "stillness",
): Promise<SuiObjectData[]> {
	const types = getMoveTypes(tenant);
	// First try direct Assembly type query
	const assemblies = await getOwnedObjectsByType(address, types.Assembly);
	if (assemblies.length > 0) return assemblies;

	// Assemblies might be shared objects found via events or other mechanisms.
	// Query all subtypes in parallel
	const subtypes = [
		types.StorageUnit,
		types.Gate,
		types.Turret,
		types.NetworkNode,
		types.Manufacturing,
		types.Refinery,
	];

	const batches = await Promise.all(subtypes.map((type) => getOwnedObjectsByType(address, type)));
	return batches.flat();
}

// ── Event Queries ───────────────────────────────────────────────────────────

interface EventQueryOptions {
	eventType: string;
	cursor?: string | null;
	limit?: number;
	order?: "ascending" | "descending";
}

interface EventQueryResult {
	events: SuiEvent[];
	nextCursor: string | null;
	hasNextPage: boolean;
}

/** Query Move events by type. */
export async function queryEvents(options: EventQueryOptions): Promise<EventQueryResult> {
	const c = getSuiClient();
	const result = await queryEventsGql(c, options.eventType, {
		cursor: options.cursor,
		limit: options.limit ?? 50,
	});

	return {
		events: result.data,
		nextCursor: result.nextCursor,
		hasNextPage: result.hasNextPage,
	};
}

/** Query recent killmail events. */
export async function getRecentKillmails(
	limit = 50,
	tenant: TenantId = "stillness",
) {
	return queryEvents({
		eventType: getEventTypes(tenant).KillmailCreated,
		limit,
	});
}

// ── Object Field Extraction ─────────────────────────────────────────────────

/** Extract typed fields from a normalized SuiObjectData.
 *  With GraphQL, json is already at the top level. */
export function extractFields(obj: SuiObjectData): Record<string, unknown> | null {
	return obj.json ?? null;
}

/** Extract the Move type string from an object. */
export function extractType(obj: SuiObjectData): string | null {
	return obj.type ?? null;
}

/** Extract the object ID from an object. */
export function extractObjectId(obj: SuiObjectData): string | null {
	return obj.objectId ?? null;
}
