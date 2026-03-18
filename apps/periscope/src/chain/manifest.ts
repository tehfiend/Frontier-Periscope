/**
 * Manifest — local chain data cache.
 *
 * Fetches and caches blockchain data locally in IndexedDB for fast
 * offline-capable lookups. Each entry has a `cachedAt` timestamp
 * so consumers can decide whether to refresh stale data.
 */

import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	getObjectJson,
	queryEventsGql,
	queryTransactionsByObject,
} from "@tehfrontier/chain-shared";
import { db } from "@/db";
import type { ManifestCharacter, ManifestTribe } from "@/db/types";
import { type TenantId, TENANTS, moveType } from "./config";
import type { TaskContext } from "@/lib/taskWorker";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Safely cast unknown to a record — used for nested JSON objects from GraphQL.
 */
function asRecord(obj: unknown): Record<string, unknown> {
	if (obj && typeof obj === "object" && !Array.isArray(obj)) {
		return obj as Record<string, unknown>;
	}
	return {};
}

// ── Character Cache ─────────────────────────────────────────────────────────

/**
 * Fetch a single character by Sui object ID and cache it.
 */
export async function fetchAndCacheCharacter(
	client: SuiGraphQLClient,
	characterObjectId: string,
): Promise<ManifestCharacter | null> {
	try {
		const result = await getObjectJson(client, characterObjectId);
		if (!result.json) return null;

		const fields = result.json;
		const metadata = asRecord(fields.metadata);
		const key = asRecord(fields.key);

		// Preserve existing createdOnChain if we already have it
		const existing = await db.manifestCharacters.get(characterObjectId);
		let createdOnChain = existing?.createdOnChain;

		// If we don't have the creation date yet, look up the object's creation tx
		if (!createdOnChain) {
			try {
				const txs = await queryTransactionsByObject(client, characterObjectId, {
					limit: 1,
				});
				if (txs.data.length > 0) {
					createdOnChain = new Date(Number(txs.data[0].timestampMs)).toISOString();
				}
			} catch { /* non-fatal */ }
		}

		const entry: ManifestCharacter = {
			id: characterObjectId,
			characterItemId: String(key.item_id ?? ""),
			name: String(metadata.name ?? ""),
			suiAddress: String(fields.character_address ?? ""),
			tribeId: Number(fields.tribe_id ?? 0),
			tenant: String(key.tenant ?? ""),
			ownerCapId: fields.owner_cap_id ? String(fields.owner_cap_id) : undefined,
			createdOnChain,
			cachedAt: new Date().toISOString(),
		};

		await db.manifestCharacters.put(entry);
		return entry;
	} catch {
		return null;
	}
}

/**
 * Resolve a character by Sui address — find their PlayerProfile, then cache the Character.
 */
export async function fetchCharacterByAddress(
	client: SuiGraphQLClient,
	address: string,
	tenant: TenantId,
): Promise<ManifestCharacter | null> {
	// Check cache first
	const cached = await db.manifestCharacters.where("suiAddress").equals(address).first();
	if (cached) return cached;

	try {
		const profileType = moveType(tenant, "character", "PlayerProfile");
		const profiles = await client.listOwnedObjects({
			owner: address,
			type: profileType,
			include: { json: true },
		});

		if (profiles.objects.length === 0) return null;

		const profileFields = profiles.objects[0].json ?? {};
		const characterId = profileFields.character_id as string | undefined;
		if (!characterId) return null;

		return fetchAndCacheCharacter(client, characterId);
	} catch {
		return null;
	}
}

/**
 * Look up a character from the local cache by name (partial match).
 */
export async function searchCachedCharacters(query: string, limit = 20): Promise<ManifestCharacter[]> {
	if (!query || query.length < 2) return [];
	const q = query.toLowerCase();
	return db.manifestCharacters
		.filter((c) => c.name.toLowerCase().includes(q) || c.characterItemId.includes(q) || c.suiAddress.toLowerCase().includes(q))
		.limit(limit)
		.toArray();
}

/**
 * Bulk discover characters from CharacterCreatedEvent events.
 * This is the most efficient method — each event contains character_id,
 * character_address, item_id, and tribe_id. We only fetch the Character
 * object for the name (metadata.name).
 *
 * Cursor migration: old cursors were { txDigest, eventSeq } objects (JSON-RPC).
 * GraphQL cursors are opaque strings. Detect old format and discard (re-sync).
 */
export async function discoverCharactersFromEvents(
	client: SuiGraphQLClient,
	_tenant: TenantId,
	worldPkg: string,
	limit = 5000,
	ctx?: TaskContext,
): Promise<number> {
	const eventType = `${worldPkg}::character::CharacterCreatedEvent`;
	const cursorKey = `manifestCharCursor:${worldPkg}`;
	let newCount = 0;
	let fetched = 0;

	// Load saved cursor from last run — only fetch newer events
	const savedCursor = await db.settings.get(cursorKey);
	let cursor: string | null = null;
	let isIncremental = false;

	// Cursor migration: detect old { txDigest, eventSeq } format and discard
	if (savedCursor?.value) {
		if (typeof savedCursor.value === "string") {
			cursor = savedCursor.value;
			isIncremental = true;
		} else if (
			typeof savedCursor.value === "object" &&
			"txDigest" in (savedCursor.value as Record<string, unknown>)
		) {
			// Old JSON-RPC cursor format — discard and re-sync from scratch
			console.warn("[manifest] Discarding old JSON-RPC cursor format, re-syncing...");
			await db.settings.delete(cursorKey);
			cursor = null;
			isIncremental = false;
		}
	}

	try {
		ctx?.setProgress(isIncremental ? "Fetching new characters since last sync..." : "Fetching all characters (first run)...");
		let latestCursor: string | null = null;
		let consecutiveExisting = 0;

		do {
			if (ctx?.isCancelled()) return newCount;

			const result = await queryEventsGql(client, eventType, {
				limit: Math.min(50, limit - fetched),
				cursor,
			});

			for (const event of result.data) {
				const parsed = event.parsedJson;
				if (!parsed) continue;

				const charId = parsed.character_id as string;
				if (!charId) continue;

				const exists = await db.manifestCharacters.get(charId);
				if (exists) {
					consecutiveExisting++;
					// For incremental: if we hit 10 consecutive existing, we've caught up
					if (isIncremental && consecutiveExisting >= 10) {
						fetched = limit; // break outer loop
						break;
					}
					continue;
				}
				consecutiveExisting = 0;

				const keyObj = parsed.key as { item_id?: string; tenant?: string } | undefined;
				const createdAt = new Date(Number(event.timestampMs)).toISOString();

				const entry: ManifestCharacter = {
					id: charId,
					characterItemId: String(keyObj?.item_id ?? ""),
					name: "",
					suiAddress: String(parsed.character_address ?? ""),
					tribeId: Number(parsed.tribe_id ?? 0),
					tenant: String(keyObj?.tenant ?? ""),
					createdOnChain: createdAt,
					cachedAt: new Date().toISOString(),
				};

				await db.manifestCharacters.put(entry);
				newCount++;
			}

			fetched += result.data.length;
			// Track the latest cursor for next incremental run
			if (result.nextCursor) {
				latestCursor = result.nextCursor;
			}
			ctx?.setItems(newCount);
			ctx?.setProgress(`Fetched ${fetched} events, ${newCount} new characters`);
			cursor = result.hasNextPage ? result.nextCursor : null;
		} while (cursor && fetched < limit);

		// Save cursor for next incremental run
		if (latestCursor) {
			await db.settings.put({ key: cursorKey, value: latestCursor });
		}

		// Phase 2: Resolve names in batches using getObjects
		if (!ctx?.isCancelled()) {
			const unnamed = await db.manifestCharacters.filter((c) => !c.name).toArray();
			const total = unnamed.length;
			ctx?.setProgress(`Resolving ${total} character names...`);
			ctx?.setItems(0, total);

			const BATCH_SIZE = 50;
			let resolved = 0;

			for (let i = 0; i < unnamed.length; i += BATCH_SIZE) {
				if (ctx?.isCancelled()) break;

				const batch = unnamed.slice(i, i + BATCH_SIZE);
				try {
					const { objects } = await client.getObjects({
						objectIds: batch.map((e) => e.id),
						include: { json: true },
					});

					for (let j = 0; j < objects.length; j++) {
						const obj = objects[j];
						if ("objectId" in obj && obj.json) {
							const fields = obj.json as Record<string, unknown>;
							const metadata = asRecord(fields.metadata);
							const name = String(metadata.name ?? "");
							if (name) {
								await db.manifestCharacters.update(batch[j].id, { name });
							}
						}
					}
				} catch {
					// Batch failed — skip, will retry on next refresh
				}

				resolved += batch.length;
				ctx?.setItems(resolved, total);
				ctx?.setProgress(`Resolved ${resolved} / ${total} names`);
			}
		}

		ctx?.setProgress(`Done: ${newCount} characters discovered`);
	} catch (err) {
		ctx?.setProgress(`Error: ${err instanceof Error ? err.message : String(err)}`);
	}

	return newCount;
}

/**
 * Refresh stale entries older than maxAge (ms).
 */
export async function refreshStaleCharacters(
	client: SuiGraphQLClient,
	maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<number> {
	const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
	const stale = await db.manifestCharacters.where("cachedAt").below(cutoff).toArray();
	let refreshed = 0;

	for (const entry of stale) {
		const updated = await fetchAndCacheCharacter(client, entry.id);
		if (updated) refreshed++;
	}

	return refreshed;
}

// ── Tribe Cache ─────────────────────────────────────────────────────────────

interface WorldApiTribe {
	id: number;
	name: string;
	nameShort: string;
	description: string;
	taxRate: number;
	tribeUrl: string;
}

/**
 * Fetch all tribes from the World API and cache them.
 */
export async function discoverTribes(tenant: TenantId, ctx?: TaskContext): Promise<number> {
	const datahubUrl = TENANTS[tenant].datahubUrl;
	if (!datahubUrl) return 0;

	let newCount = 0;
	let offset = 0;
	const limit = 100;
	const now = new Date().toISOString();

	try {
		ctx?.setProgress("Fetching tribes from World API...");
		while (true) {
			if (ctx?.isCancelled()) return newCount;

			const res = await fetch(
				`https://${datahubUrl}/v2/tribes?limit=${limit}&offset=${offset}`,
			);
			if (!res.ok) break;

			const body = await res.json();
			const tribes: WorldApiTribe[] = body.data ?? [];

			for (const tribe of tribes) {
				const existing = await db.manifestTribes.get(tribe.id);
				const entry: ManifestTribe = {
					id: tribe.id,
					name: tribe.name,
					nameShort: tribe.nameShort,
					description: tribe.description,
					taxRate: tribe.taxRate,
					tribeUrl: tribe.tribeUrl,
					tenant,
					createdOnChain: existing?.createdOnChain ?? now,
					cachedAt: now,
				};
				await db.manifestTribes.put(entry);
				newCount++;
			}

			ctx?.setItems(newCount);
			ctx?.setProgress(`Fetched ${newCount} tribes`);

			const total = body.metadata?.total ?? body.meta?.total;
			if (tribes.length < limit || (total != null && offset + tribes.length >= total)) break;
			offset += limit;
		}
	} catch {
		// API request failed
	}

	return newCount;
}

/**
 * Look up a tribe name from the local cache.
 */
export async function getTribeName(tribeId: number): Promise<string | null> {
	const tribe = await db.manifestTribes.get(tribeId);
	return tribe?.name ?? null;
}

/**
 * Get tribe name, fetching from API if not cached.
 * Tries to fetch the specific tribe first, falls back to bulk fetch.
 */
export async function ensureTribeName(
	tribeId: number,
	tenant: TenantId,
): Promise<string | null> {
	// Check cache first
	const cached = await db.manifestTribes.get(tribeId);
	if (cached?.name) return cached.name;

	// Not cached — fetch all tribes for this tenant (they're small, ~200 total)
	const datahubUrl = TENANTS[tenant].datahubUrl;
	if (!datahubUrl) return null;

	try {
		const res = await fetch(`https://${datahubUrl}/v2/tribes/${tribeId}`);
		if (res.ok) {
			const body = await res.json();
			const tribe = body.data ?? body;
			if (tribe?.name) {
				await db.manifestTribes.put({
					id: tribeId,
					name: tribe.name,
					nameShort: tribe.nameShort ?? "",
					description: tribe.description ?? "",
					taxRate: tribe.taxRate ?? 0,
					tribeUrl: tribe.tribeUrl ?? "",
					tenant,
					cachedAt: new Date().toISOString(),
				});
				return tribe.name as string;
			}
		}
	} catch {
		// API unavailable
	}
	return null;
}

/**
 * Cache a character lookup result in manifestCharacters for offline access.
 */
export async function cacheCharacterFromLookup(
	characterObjectId: string,
	itemId: string,
	suiAddress: string,
	characterName: string,
	tribeId: number,
	tenant: string,
): Promise<void> {
	const now = new Date().toISOString();
	await db.manifestCharacters.put({
		id: characterObjectId,
		characterItemId: itemId,
		name: characterName,
		suiAddress,
		tribeId,
		tenant,
		cachedAt: now,
	});
}
