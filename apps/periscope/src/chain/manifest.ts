/**
 * Manifest — local chain data cache.
 *
 * Fetches and caches blockchain data locally in IndexedDB for fast
 * offline-capable lookups. Each entry has a `cachedAt` timestamp
 * so consumers can decide whether to refresh stale data.
 */

import type { SuiClient } from "@mysten/sui/client";
import { db } from "@/db";
import type { ManifestCharacter, ManifestTribe } from "@/db/types";
import { type TenantId, TENANTS, moveType } from "./config";
import type { TaskContext } from "@/lib/taskWorker";

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractFields(content: unknown): Record<string, unknown> {
	const c = content as { fields?: Record<string, unknown> };
	return c?.fields ?? {};
}

// ── Character Cache ─────────────────────────────────────────────────────────

/**
 * Fetch a single character by Sui object ID and cache it.
 */
export async function fetchAndCacheCharacter(
	client: SuiClient,
	characterObjectId: string,
): Promise<ManifestCharacter | null> {
	try {
		const obj = await client.getObject({
			id: characterObjectId,
			options: { showContent: true, showType: true, showPreviousTransaction: true },
		});

		if (!obj.data?.content || !("fields" in obj.data.content)) return null;

		const fields = obj.data.content.fields as Record<string, unknown>;
		const metadata = extractFields(fields.metadata);
		const key = extractFields(fields.key);

		// Preserve existing createdOnChain if we already have it
		const existing = await db.manifestCharacters.get(characterObjectId);
		let createdOnChain = existing?.createdOnChain;

		// If we don't have the creation date yet, look up the object's creation tx
		if (!createdOnChain) {
			try {
				const txs = await client.queryTransactionBlocks({
					filter: { ChangedObject: characterObjectId },
					limit: 1,
					order: "ascending",
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
	client: SuiClient,
	address: string,
	tenant: TenantId,
): Promise<ManifestCharacter | null> {
	// Check cache first
	const cached = await db.manifestCharacters.where("suiAddress").equals(address).first();
	if (cached) return cached;

	try {
		const profileType = moveType(tenant, "character", "PlayerProfile");
		const profiles = await client.getOwnedObjects({
			owner: address,
			filter: { StructType: profileType },
			options: { showContent: true },
		});

		if (profiles.data.length === 0) return null;

		const profileFields = extractFields(profiles.data[0].data?.content);
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
 */
export async function discoverCharactersFromEvents(
	client: SuiClient,
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
	let cursor = (savedCursor?.value as { txDigest: string; eventSeq: string } | null) ?? null;
	const isIncremental = !!cursor;

	try {
		ctx?.setProgress(isIncremental ? "Fetching new characters since last sync..." : "Fetching all characters (first run)...");
		let firstCursor: { txDigest: string; eventSeq: string } | null = null;
		let consecutiveExisting = 0;

		do {
			if (ctx?.isCancelled()) return newCount;

			const result = await client.queryEvents({
				query: { MoveEventType: eventType },
				limit: Math.min(50, limit - fetched),
				cursor: cursor ?? undefined,
				order: isIncremental ? "descending" : "ascending",
			});

			// Save the first page cursor so we can resume from here next time
			if (fetched === 0 && result.data.length > 0 && !isIncremental) {
				// For first full run, we'll save the cursor after processing all
			}

			for (const event of result.data) {
				const parsed = event.parsedJson as Record<string, unknown> | undefined;
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
			if (result.data.length > 0) {
				firstCursor = result.nextCursor as typeof firstCursor;
			}
			ctx?.setItems(newCount);
			ctx?.setProgress(`Fetched ${fetched} events, ${newCount} new characters`);
			cursor = result.hasNextPage ? (result.nextCursor as typeof cursor) : null;
		} while (cursor && fetched < limit);

		// Save cursor for next incremental run
		// For ascending (first run): save the last page cursor so next run starts after it
		// For descending (incremental): we don't need to update since we query from newest
		if (!isIncremental && firstCursor) {
			await db.settings.put({ key: cursorKey, value: firstCursor });
		}
		// For incremental runs, save a marker so we know to use descending next time
		if (!isIncremental) {
			await db.settings.put({ key: cursorKey, value: { txDigest: "__done__", eventSeq: "0" } });
		}

		// Phase 2: Resolve names in batches using multiGetObjects
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
					const objects = await client.multiGetObjects({
						ids: batch.map((e) => e.id),
						options: { showContent: true },
					});

					for (let j = 0; j < objects.length; j++) {
						const obj = objects[j];
						if (obj.data?.content && "fields" in obj.data.content) {
							const fields = obj.data.content.fields as Record<string, unknown>;
							const metadata = extractFields(fields.metadata);
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
	client: SuiClient,
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
