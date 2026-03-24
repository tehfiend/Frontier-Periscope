/**
 * Manifest — local chain data cache.
 *
 * Fetches and caches blockchain data locally in IndexedDB for fast
 * offline-capable lookups. Each entry has a `cachedAt` timestamp
 * so consumers can decide whether to refresh stale data.
 */

import { db } from "@/db";
import type {
	ManifestCharacter,
	ManifestLocation,
	ManifestMapLocation,
	ManifestPrivateMap,
	ManifestStandingEntry,
	ManifestStandingsList,
	ManifestTribe,
} from "@/db/types";
import { ensureCelestialsLoaded } from "@/lib/celestials";
import { resolveNearestLPoint } from "@/lib/lpoints";
import type { TaskContext } from "@/lib/taskWorker";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
	ENCRYPTION_KEY_MESSAGE,
	bytesToHex,
	decodeLocationData,
	decodeStandingData,
	deriveMapKeyFromSignature,
	getContractAddresses,
	getObjectJson,
	hexToBytes,
	queryEventsGql,
	queryMapInvitesForUser,
	queryMapLocations,
	queryPrivateMap,
	queryStandingEntries,
	queryStandingsList,
	queryStandingsInvitesForUser,
	queryTransactionsByObject,
	unsealWithKey,
} from "@tehfrontier/chain-shared";
import { TENANTS, type TenantId, moveType } from "./config";

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
			} catch {
				/* non-fatal */
			}
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
 * Ensure the map key is populated on a manifest character.
 *
 * Strategy:
 * 1. If already stored, return it immediately.
 * 2. If a wallet signPersonalMessage function is provided, sign the
 *    deterministic message and derive the key. Store permanently.
 * 3. Otherwise, extract the Ed25519 public key from any on-chain
 *    transaction and convert to X25519. This gives us the PUBLIC key
 *    only (enough for encrypting TO this address, but not for decryption).
 *
 * Returns the keypair (public always, secret only if wallet signed).
 */
export async function ensureMapKeyForCharacter(
	client: SuiGraphQLClient,
	characterId: string,
	signPersonalMessage?: (msg: Uint8Array) => Promise<{ signature: string }>,
): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array } | null> {
	const character = await db.manifestCharacters.get(characterId);
	if (!character) return null;

	// Already stored
	if (character.mapKeyPublicHex && character.mapKeySecretHex) {
		return {
			publicKey: hexToBytes(character.mapKeyPublicHex),
			secretKey: hexToBytes(character.mapKeySecretHex),
		};
	}

	// Try wallet signing to derive full keypair
	if (signPersonalMessage) {
		try {
			const { signature } = await signPersonalMessage(
				new TextEncoder().encode(ENCRYPTION_KEY_MESSAGE),
			);
			const derived = deriveMapKeyFromSignature(signature);

			await db.manifestCharacters.update(characterId, {
				mapKeyPublicHex: bytesToHex(derived.publicKey),
				mapKeySecretHex: bytesToHex(derived.secretKey),
			});

			return derived;
		} catch {
			// User rejected or signing failed
		}
	}

	// Fallback: extract public key from on-chain transactions (no secret key)
	if (character.suiAddress && !character.mapKeyPublicHex) {
		try {
			const QUERY_TX_SIGS = `
				query($addr: SuiAddress!, $first: Int) {
					address(address: $addr) {
						transactionBlocks(first: $first) {
							nodes { signatures }
						}
					}
				}
			`;
			const result = await client.query<
				{ address: { transactionBlocks: { nodes: Array<{ signatures: string[] }> } } | null },
				{ addr: string; first: number }
			>({
				query: QUERY_TX_SIGS,
				variables: { addr: character.suiAddress, first: 5 },
			});

			const txBlocks = result.data?.address?.transactionBlocks?.nodes ?? [];
			for (const tx of txBlocks) {
				for (const sigBase64 of tx.signatures ?? []) {
					try {
						const parsed = parseSerializedSignature(sigBase64);
						if (parsed.signatureScheme === "ED25519") {
							const x25519PubKey = ed25519.utils.toMontgomery(parsed.publicKey);
							await db.manifestCharacters.update(characterId, {
								mapKeyPublicHex: bytesToHex(x25519PubKey),
							});
							return { publicKey: x25519PubKey, secretKey: new Uint8Array(0) };
						}
					} catch {}
				}
			}
		} catch {}
	}

	return null;
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
export async function searchCachedCharacters(
	query: string,
	limit = 20,
	includeDeleted = false,
): Promise<ManifestCharacter[]> {
	if (!query || query.length < 2) return [];
	const q = query.toLowerCase();
	return db.manifestCharacters
		.filter(
			(c) =>
				(includeDeleted || !c.deletedAt) &&
				(c.name.toLowerCase().includes(q) ||
					c.characterItemId.includes(q) ||
					c.suiAddress.toLowerCase().includes(q)),
		)
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
	tenant: TenantId,
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
		ctx?.setProgress(
			isIncremental
				? "Fetching new characters since last sync..."
				: "Fetching all characters (first run)...",
		);
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
					tenant: String(keyObj?.tenant ?? tenant),
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

		// Phase 2: Resolve names for unnamed characters in this tenant
		if (!ctx?.isCancelled()) {
			await resolveUnnamedCharacters(client, tenant, undefined, ctx);
		}

		ctx?.setProgress(`Done: ${newCount} characters discovered`);
	} catch (err) {
		ctx?.setProgress(`Error: ${err instanceof Error ? err.message : String(err)}`);
	}

	return newCount;
}

/**
 * Resolve names for unnamed characters in the manifest for a given tenant.
 * Uses getObjectJson per-character (reliable, no batch format issues).
 * Also updates suiAddress, tribeId, and soft-deletes missing objects.
 */
export async function resolveUnnamedCharacters(
	client: SuiGraphQLClient,
	tenant: TenantId,
	limit?: number,
	ctx?: TaskContext,
): Promise<number> {
	const unnamed = await db.manifestCharacters
		.where("tenant")
		.equals(tenant)
		.filter((c) => !c.name && !c.deletedAt)
		.toArray();

	const chars = limit != null ? unnamed.slice(0, limit) : unnamed;
	const total = chars.length;
	if (total === 0) return 0;

	ctx?.setProgress(`Resolving ${total} character names...`);
	ctx?.setItems(0, total);

	const PARALLEL = 5;
	let resolved = 0;

	for (let i = 0; i < chars.length; i += PARALLEL) {
		if (ctx?.isCancelled()) break;

		const batch = chars.slice(i, i + PARALLEL);
		await Promise.allSettled(
			batch.map(async (char) => {
				try {
					const result = await getObjectJson(client, char.id);
					if (!result.json) {
						if (!char.deletedAt) {
							await db.manifestCharacters.update(char.id, {
								deletedAt: new Date().toISOString(),
							});
						}
						return;
					}
					const fields = result.json;
					const metadata = asRecord(fields.metadata);
					const name = String(metadata.name ?? "");
					const updates: Partial<ManifestCharacter> = {
						cachedAt: new Date().toISOString(),
					};
					if (name) updates.name = name;
					if (char.deletedAt) updates.deletedAt = undefined;
					if (fields.character_address) {
						updates.suiAddress = String(fields.character_address);
					}
					if (fields.tribe_id != null) {
						updates.tribeId = Number(fields.tribe_id);
					}
					await db.manifestCharacters.update(char.id, updates);
				} catch {
					// Will retry on next sync cycle
				}
			}),
		);

		resolved += batch.length;
		ctx?.setItems(resolved, total);
		ctx?.setProgress(`Resolved ${resolved} / ${total} names`);
	}

	return resolved;
}

/**
 * Poll for new CharacterCreatedEvent events and cache any new characters.
 * Used by Chain Sonar for real-time monitoring. Resolves names inline
 * since poll batches are small (0-5 new characters typically).
 */
export async function pollCharacterEvents(
	client: SuiGraphQLClient,
	tenant: TenantId,
	cursor: string | null,
): Promise<{ newCount: number; nextCursor: string | null }> {
	const worldPkg = TENANTS[tenant].worldPackageId;
	const eventType = `${worldPkg}::character::CharacterCreatedEvent`;

	const result = await queryEventsGql(client, eventType, {
		cursor,
		limit: 50,
	});

	let newCount = 0;
	for (const event of result.data) {
		const parsed = event.parsedJson;
		const charId = parsed.character_id as string;
		if (!charId) continue;

		const exists = await db.manifestCharacters.get(charId);
		if (exists) continue;

		const keyObj = parsed.key as { item_id?: string; tenant?: string } | undefined;
		await db.manifestCharacters.put({
			id: charId,
			characterItemId: String(keyObj?.item_id ?? ""),
			name: "",
			suiAddress: String(parsed.character_address ?? ""),
			tribeId: Number(parsed.tribe_id ?? 0),
			tenant: String(keyObj?.tenant ?? tenant),
			createdOnChain: new Date(Number(event.timestampMs)).toISOString(),
			cachedAt: new Date().toISOString(),
		});
		newCount++;
	}

	// Resolve names for newly discovered characters
	if (newCount > 0) {
		await resolveUnnamedCharacters(client, tenant, newCount + 10);
	}

	return {
		newCount,
		nextCursor: result.nextCursor,
	};
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

			const res = await fetch(`https://${datahubUrl}/v2/tribes?limit=${limit}&offset=${offset}`);
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
export async function ensureTribeName(tribeId: number, tenant: TenantId): Promise<string | null> {
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

// ── Location Cache ──────────────────────────────────────────────────────────

/**
 * Bulk discover locations from LocationRevealedEvent events.
 * Follows the same incremental cursor pattern as discoverCharactersFromEvents().
 *
 * After event discovery, resolves L-point labels and cross-references with deployables.
 */
export async function discoverLocationsFromEvents(
	client: SuiGraphQLClient,
	tenant: TenantId,
	worldPkg: string,
	limit = 5000,
	ctx?: TaskContext,
): Promise<number> {
	const eventType = `${worldPkg}::location::LocationRevealedEvent`;
	const cursorKey = `manifestLocCursor:${worldPkg}`;
	let newCount = 0;
	let fetched = 0;
	const discoveredIds: string[] = [];

	// Load saved cursor from last run
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
			console.warn("[manifest] Discarding old JSON-RPC cursor format for locations, re-syncing...");
			await db.settings.delete(cursorKey);
			cursor = null;
			isIncremental = false;
		}
	}

	try {
		ctx?.setProgress(
			isIncremental
				? "Fetching new locations since last sync..."
				: "Fetching all locations (first run)...",
		);
		let latestCursor: string | null = null;

		do {
			if (ctx?.isCancelled()) return newCount;

			const result = await queryEventsGql(client, eventType, {
				limit: Math.min(50, limit - fetched),
				cursor,
			});

			for (const event of result.data) {
				const parsed = event.parsedJson;
				if (!parsed) continue;

				const assemblyId = parsed.assembly_id as string;
				if (!assemblyId) continue;

				const keyObj = parsed.assembly_key as { item_id?: string; tenant?: string } | undefined;
				const revealedAt = new Date(Number(event.timestampMs)).toISOString();

				// On re-reveal, clear lPoint so it gets recomputed
				const entry: ManifestLocation = {
					id: assemblyId,
					assemblyItemId: String(keyObj?.item_id ?? ""),
					typeId: Number(parsed.type_id ?? 0),
					ownerCapId: String(parsed.owner_cap_id ?? ""),
					solarsystem: Number(parsed.solarsystem ?? 0),
					x: String(parsed.x ?? "0"),
					y: String(parsed.y ?? "0"),
					z: String(parsed.z ?? "0"),
					tenant: String(keyObj?.tenant ?? tenant),
					revealedAt,
					cachedAt: new Date().toISOString(),
				};

				await db.manifestLocations.put(entry);
				discoveredIds.push(assemblyId);
				newCount++;
			}

			fetched += result.data.length;
			if (result.nextCursor) {
				latestCursor = result.nextCursor;
			}
			ctx?.setItems(newCount);
			ctx?.setProgress(`Fetched ${fetched} events, ${newCount} locations`);
			cursor = result.hasNextPage ? result.nextCursor : null;
		} while (cursor && fetched < limit);

		// Save cursor for next incremental run
		if (latestCursor) {
			await db.settings.put({ key: cursorKey, value: latestCursor });
		}

		// Phase 2: Resolve L-point labels
		if (!ctx?.isCancelled() && discoveredIds.length > 0) {
			ctx?.setProgress("Resolving L-point labels...");
			await resolveManifestLocationLPoints();
		}

		// Phase 3: Cross-reference with deployables
		if (!ctx?.isCancelled() && discoveredIds.length > 0) {
			ctx?.setProgress("Cross-referencing with deployables...");
			await crossReferenceManifestLocations(discoveredIds);
		}

		ctx?.setProgress(`Done: ${newCount} locations discovered`);
	} catch (err) {
		ctx?.setProgress(`Error: ${err instanceof Error ? err.message : String(err)}`);
	}

	return newCount;
}

/**
 * Resolve L-point labels for manifest locations that don't have one yet.
 * Loads celestial data and computes nearest L-point for each unresolved location.
 */
export async function resolveManifestLocationLPoints(): Promise<void> {
	const unresolved = await db.manifestLocations.filter((loc) => !loc.lPoint).toArray();
	if (unresolved.length === 0) return;

	// Group by solar system
	const bySystem = new Map<number, ManifestLocation[]>();
	for (const loc of unresolved) {
		const group = bySystem.get(loc.solarsystem);
		if (group) {
			group.push(loc);
		} else {
			bySystem.set(loc.solarsystem, [loc]);
		}
	}

	// Ensure celestial data is loaded
	await ensureCelestialsLoaded();

	for (const [systemId, locations] of bySystem) {
		const planets = await db.celestials.where("systemId").equals(systemId).toArray();
		if (planets.length === 0) continue;

		for (const loc of locations) {
			const lPoint = resolveNearestLPoint(Number(loc.x), Number(loc.y), Number(loc.z), planets);
			if (lPoint) {
				await db.manifestLocations.update(loc.id, { lPoint });
			}
		}
	}
}

/**
 * Cross-reference manifest locations with deployables and assemblies.
 * When a manifest location matches a deployable/assembly by object ID,
 * populate systemId and lPoint on the deployable/assembly.
 */
export async function crossReferenceManifestLocations(locationIds: string[]): Promise<void> {
	for (const locId of locationIds) {
		const loc = await db.manifestLocations.get(locId);
		if (!loc) continue;

		// Check deployables
		const dep = await db.deployables.where("objectId").equals(loc.id).first();
		if (dep && (!dep.systemId || !dep.lPoint)) {
			await db.deployables.update(dep.id, {
				...(dep.systemId ? {} : { systemId: loc.solarsystem }),
				...(!dep.lPoint && loc.lPoint ? { lPoint: loc.lPoint } : {}),
				updatedAt: new Date().toISOString(),
			});
		}

		// Check assemblies
		const asm = await db.assemblies.where("objectId").equals(loc.id).first();
		if (asm && (!asm.systemId || !asm.lPoint)) {
			await db.assemblies.update(asm.id, {
				...(asm.systemId ? {} : { systemId: loc.solarsystem }),
				...(!asm.lPoint && loc.lPoint ? { lPoint: loc.lPoint } : {}),
				updatedAt: new Date().toISOString(),
			});
		}
	}
}

/**
 * Cross-reference private map locations with deployables and assemblies.
 * When a manifestMapLocation has a non-null structureId that matches a
 * deployable/assembly objectId, populate systemId and lPoint if missing.
 * Complements crossReferenceManifestLocations() which handles public locations.
 */
export async function crossReferencePrivateMapLocations(): Promise<void> {
	const mapLocations = await db.manifestMapLocations
		.filter((loc) => loc.structureId != null)
		.toArray();

	for (const loc of mapLocations) {
		if (!loc.structureId) continue;

		const lPointStr = `P${loc.planet}-L${loc.lPoint}`;

		// Check deployables
		const dep = await db.deployables.where("objectId").equals(loc.structureId).first();
		if (dep && (!dep.systemId || !dep.lPoint)) {
			await db.deployables.update(dep.id, {
				...(dep.systemId ? {} : { systemId: loc.solarSystemId }),
				...(!dep.lPoint ? { lPoint: lPointStr } : {}),
				updatedAt: new Date().toISOString(),
			});
		}

		// Check assemblies
		const asm = await db.assemblies.where("objectId").equals(loc.structureId).first();
		if (asm && (!asm.systemId || !asm.lPoint)) {
			await db.assemblies.update(asm.id, {
				...(asm.systemId ? {} : { systemId: loc.solarSystemId }),
				...(!asm.lPoint ? { lPoint: lPointStr } : {}),
				updatedAt: new Date().toISOString(),
			});
		}
	}
}

// ── Private Map Cache ───────────────────────────────────────────────────────

/**
 * Sync private maps for a specific user address.
 * Queries MapInvite objects, fetches PrivateMap details for each,
 * decrypts the map key using the wallet-derived X25519 keypair,
 * and caches everything in manifestPrivateMaps.
 *
 * Skips maps that were cached less than 1 hour ago.
 */
/**
 * Discover and cache private maps for a user. No decryption key needed --
 * just finds MapInvite objects and fetches map metadata.
 * Call decryptMapKeys() separately when the wallet key is available.
 */
export async function syncPrivateMapsForUser(
	client: SuiGraphQLClient,
	tenant: TenantId,
	userAddress: string,
	ctx?: TaskContext,
): Promise<number> {
	const addresses = getContractAddresses(tenant);
	const packageId = addresses.privateMap?.packageId;
	console.log("[syncPrivateMaps] tenant:", tenant, "packageId:", packageId, "user:", userAddress);
	if (!packageId) return 0;

	let newCount = 0;

	try {
		ctx?.setProgress("Discovering map invites...");
		const invites = await queryMapInvitesForUser(client, packageId, userAddress);
		console.log("[syncPrivateMaps] found", invites.length, "invites:", invites);

		for (const invite of invites) {
			if (ctx?.isCancelled()) break;

			const existing = await db.manifestPrivateMaps.get(invite.mapId);

			// Fetch map details
			const mapInfo = await queryPrivateMap(client, invite.mapId);
			console.log("[syncPrivateMaps] map info for", invite.mapId, ":", mapInfo);
			if (!mapInfo) continue;

			const entry: ManifestPrivateMap = {
				id: invite.mapId,
				name: mapInfo.name,
				creator: mapInfo.creator,
				publicKey: mapInfo.publicKey,
				encryptedMapKey: invite.encryptedMapKey,
				decryptedMapKey: existing?.decryptedMapKey, // preserve if already decrypted
				inviteId: invite.objectId,
				tenant,
				cachedAt: new Date().toISOString(),
			};

			await db.manifestPrivateMaps.put(entry);
			newCount++;
			console.log("[syncPrivateMaps] cached map:", entry.name, entry.id, "tenant:", tenant);
		}

		console.log("[syncPrivateMaps] synced", newCount, "maps");
	} catch (err) {
		console.error("[syncPrivateMaps] error:", err);
		ctx?.setProgress(`Error: ${err instanceof Error ? err.message : String(err)}`);
	}

	return newCount;
}

/**
 * Decrypt map keys for all cached maps that don't have a decryptedMapKey yet.
 * Requires the wallet's X25519 keypair.
 */
export async function decryptMapKeys(
	walletKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array },
	tenant: TenantId,
): Promise<number> {
	let count = 0;
	const maps = await db.manifestPrivateMaps.where("tenant").equals(tenant).toArray();

	for (const map of maps) {
		console.log(
			"[decryptMapKeys]",
			map.name,
			"hasDecrypted:",
			!!map.decryptedMapKey,
			"hasEncrypted:",
			!!map.encryptedMapKey,
		);
		if (map.decryptedMapKey || !map.encryptedMapKey) continue;

		try {
			const encryptedKeyBytes = hexToBytes(map.encryptedMapKey);
			console.log(
				"[decryptMapKeys] decrypting",
				map.name,
				"encryptedLen:",
				encryptedKeyBytes.length,
			);
			const decryptedKey = unsealWithKey(
				encryptedKeyBytes,
				walletKeyPair.publicKey,
				walletKeyPair.secretKey,
			);
			console.log("[decryptMapKeys] success:", map.name);

			await db.manifestPrivateMaps.update(map.id, {
				decryptedMapKey: bytesToHex(decryptedKey),
			});
			count++;
		} catch (err) {
			console.error("[decryptMapKeys] failed for", map.name, err);
		}
	}

	return count;
}

/**
 * Sync all locations for a specific private map.
 * Fetches MapLocation dynamic fields, decrypts each with the map key,
 * and caches in manifestMapLocations.
 */
export async function syncMapLocations(
	client: SuiGraphQLClient,
	mapId: string,
	decryptedMapKey: string,
	tenant: TenantId,
	ctx?: TaskContext,
): Promise<number> {
	let newCount = 0;

	try {
		ctx?.setProgress("Fetching map locations...");

		// Get the map's public key for decryption
		const mapInfo = await queryPrivateMap(client, mapId);
		if (!mapInfo) return 0;

		const mapPublicKey = hexToBytes(mapInfo.publicKey);
		const mapSecretKey = hexToBytes(decryptedMapKey);
		console.log(
			"[syncMapLocations] mapId:",
			mapId,
			"pubKeyLen:",
			mapPublicKey.length,
			"secKeyLen:",
			mapSecretKey.length,
		);

		const rawLocations = await queryMapLocations(client, mapId);
		console.log("[syncMapLocations] found", rawLocations.length, "raw locations");

		for (const loc of rawLocations) {
			if (ctx?.isCancelled()) break;

			const compositeId = `${mapId}:${loc.locationId}`;

			// Check if already cached
			const existing = await db.manifestMapLocations.get(compositeId);
			if (existing) continue;

			try {
				const encryptedBytes = hexToBytes(loc.encryptedData);
				console.log(
					"[syncMapLocations] decrypting loc",
					loc.locationId,
					"encryptedLen:",
					encryptedBytes.length,
					"encryptedData:",
					loc.encryptedData.slice(0, 40),
				);
				const plaintext = unsealWithKey(encryptedBytes, mapPublicKey, mapSecretKey);
				const data = decodeLocationData(plaintext);
				console.log("[syncMapLocations] decrypted:", data);

				const entry: ManifestMapLocation = {
					id: compositeId,
					mapId,
					locationId: loc.locationId,
					structureId: loc.structureId,
					solarSystemId: data.solarSystemId,
					planet: data.planet,
					lPoint: data.lPoint,
					description: data.description ?? "",
					addedBy: loc.addedBy,
					addedAtMs: loc.addedAtMs,
					tenant,
					cachedAt: new Date().toISOString(),
				};

				await db.manifestMapLocations.put(entry);
				newCount++;
			} catch (err) {
				console.error("[syncMapLocations] decrypt failed for loc", loc.locationId, err);
			}
		}

		ctx?.setProgress(`Decrypted ${newCount} locations`);

		// Cross-reference any newly decrypted locations with structures
		if (newCount > 0) {
			await crossReferencePrivateMapLocations();
		}
	} catch (err) {
		ctx?.setProgress(`Error: ${err instanceof Error ? err.message : String(err)}`);
	}

	return newCount;
}

/**
 * Get all decrypted map locations from the cache, sorted by addedAtMs.
 */
export async function getDecryptedMapLocations(mapId: string): Promise<ManifestMapLocation[]> {
	const locations = await db.manifestMapLocations.where("mapId").equals(mapId).toArray();
	return locations.sort((a, b) => a.addedAtMs - b.addedAtMs);
}

/**
 * Invalidate all cached data for a specific map.
 * Used after key rotation or map deletion.
 */
export async function invalidateMapCache(mapId: string): Promise<void> {
	await db.manifestPrivateMaps.delete(mapId);
	const locations = await db.manifestMapLocations.where("mapId").equals(mapId).toArray();
	await db.manifestMapLocations.bulkDelete(locations.map((l) => l.id));
}

// ── Standings Cache ─────────────────────────────────────────────────────────

/**
 * Discover and cache standings lists for a user. No decryption key needed --
 * just finds StandingsInvite objects and fetches list metadata.
 * Call decryptStandingsKeys() separately when the wallet key is available.
 */
export async function syncStandingsListsForUser(
	client: SuiGraphQLClient,
	tenant: TenantId,
	userAddress: string,
	ctx?: TaskContext,
): Promise<number> {
	const addresses = getContractAddresses(tenant);
	const packageId = addresses.standings?.packageId;
	console.log(
		"[syncStandingsLists] tenant:",
		tenant,
		"packageId:",
		packageId,
		"user:",
		userAddress,
	);
	if (!packageId) return 0;

	let newCount = 0;

	try {
		ctx?.setProgress("Discovering standings invites...");
		const invites = await queryStandingsInvitesForUser(client, userAddress, packageId);
		console.log("[syncStandingsLists] found", invites.length, "invites");

		for (const invite of invites) {
			if (ctx?.isCancelled()) break;

			const existing = await db.manifestStandingsLists.get(invite.listId);

			// Fetch list details
			const listInfo = await queryStandingsList(client, invite.listId);
			console.log("[syncStandingsLists] list info for", invite.listId, ":", listInfo);
			if (!listInfo) continue;

			const isEditor =
				listInfo.creator === userAddress || listInfo.editors.includes(userAddress);

			const entry: ManifestStandingsList = {
				id: invite.listId,
				name: listInfo.name,
				description: listInfo.description,
				creator: listInfo.creator,
				publicKey: listInfo.publicKey,
				encryptedListKey: invite.encryptedListKey,
				decryptedListKey: existing?.decryptedListKey, // preserve if already decrypted
				inviteId: invite.objectId,
				editors: listInfo.editors,
				isEditor,
				tenant,
				cachedAt: new Date().toISOString(),
			};

			await db.manifestStandingsLists.put(entry);
			newCount++;
			console.log(
				"[syncStandingsLists] cached list:",
				entry.name,
				entry.id,
				"tenant:",
				tenant,
			);
		}

		console.log("[syncStandingsLists] synced", newCount, "lists");
	} catch (err) {
		console.error("[syncStandingsLists] error:", err);
		ctx?.setProgress(`Error: ${err instanceof Error ? err.message : String(err)}`);
	}

	return newCount;
}

/**
 * Decrypt list keys for all cached standings lists that don't have a
 * decryptedListKey yet. Requires the wallet's X25519 keypair.
 */
export async function decryptStandingsKeys(
	walletKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array },
	tenant: TenantId,
): Promise<number> {
	let count = 0;
	const lists = await db.manifestStandingsLists.where("tenant").equals(tenant).toArray();

	for (const list of lists) {
		console.log(
			"[decryptStandingsKeys]",
			list.name,
			"hasDecrypted:",
			!!list.decryptedListKey,
			"hasEncrypted:",
			!!list.encryptedListKey,
		);
		if (list.decryptedListKey || !list.encryptedListKey) continue;

		try {
			const encryptedKeyBytes = hexToBytes(list.encryptedListKey);
			console.log(
				"[decryptStandingsKeys] decrypting",
				list.name,
				"encryptedLen:",
				encryptedKeyBytes.length,
			);
			const decryptedKey = unsealWithKey(
				encryptedKeyBytes,
				walletKeyPair.publicKey,
				walletKeyPair.secretKey,
			);
			console.log("[decryptStandingsKeys] success:", list.name);

			await db.manifestStandingsLists.update(list.id, {
				decryptedListKey: bytesToHex(decryptedKey),
			});
			count++;
		} catch (err) {
			console.error("[decryptStandingsKeys] failed for", list.name, err);
		}
	}

	return count;
}

/**
 * Sync all entries for a specific standings list.
 * Fetches StandingEntry dynamic fields, decrypts each with the list key,
 * and caches in manifestStandingEntries.
 */
export async function syncStandingEntries(
	client: SuiGraphQLClient,
	listId: string,
	decryptedListKey: string,
	tenant: TenantId,
	ctx?: TaskContext,
): Promise<number> {
	let newCount = 0;

	try {
		ctx?.setProgress("Fetching standing entries...");

		// Get the list's public key for decryption
		const listInfo = await queryStandingsList(client, listId);
		if (!listInfo) return 0;

		const listPublicKey = hexToBytes(listInfo.publicKey);
		const listSecretKey = hexToBytes(decryptedListKey);
		console.log(
			"[syncStandingEntries] listId:",
			listId,
			"pubKeyLen:",
			listPublicKey.length,
			"secKeyLen:",
			listSecretKey.length,
		);

		const rawEntries = await queryStandingEntries(client, listId);
		console.log("[syncStandingEntries] found", rawEntries.length, "raw entries");

		// Clear existing entries for this list and replace with fresh data
		const existingEntries = await db.manifestStandingEntries
			.where("listId")
			.equals(listId)
			.toArray();
		if (existingEntries.length > 0) {
			await db.manifestStandingEntries.bulkDelete(existingEntries.map((e) => e.id));
		}

		for (const raw of rawEntries) {
			if (ctx?.isCancelled()) break;

			const compositeId = `${listId}:${raw.entryId}`;

			try {
				const encryptedBytes = hexToBytes(raw.encryptedData);
				console.log(
					"[syncStandingEntries] decrypting entry",
					raw.entryId,
					"encryptedLen:",
					encryptedBytes.length,
				);
				const plaintext = unsealWithKey(encryptedBytes, listPublicKey, listSecretKey);
				const data = decodeStandingData(plaintext);
				console.log("[syncStandingEntries] decrypted:", data);

				const entry: ManifestStandingEntry = {
					id: compositeId,
					listId,
					entryId: raw.entryId,
					kind: data.kind,
					characterId: data.characterId,
					tribeId: data.tribeId,
					standing: data.standing,
					label: data.label,
					description: data.description,
					addedBy: raw.addedBy,
					updatedAtMs: raw.updatedAtMs,
					tenant,
					cachedAt: new Date().toISOString(),
				};

				await db.manifestStandingEntries.put(entry);
				newCount++;
			} catch (err) {
				console.error("[syncStandingEntries] decrypt failed for entry", raw.entryId, err);
			}
		}

		ctx?.setProgress(`Decrypted ${newCount} entries`);
	} catch (err) {
		ctx?.setProgress(`Error: ${err instanceof Error ? err.message : String(err)}`);
	}

	return newCount;
}
