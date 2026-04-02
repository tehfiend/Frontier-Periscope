import { getEventTypes, getExtensionEventTypes } from "@/chain/config";
import { pollCharacterEvents } from "@/chain/manifest";
import { EVENT_HANDLER_REGISTRY, type HandlerContext } from "@/chain/sonarEventHandlers";
import { db } from "@/db";
import type { SonarEvent } from "@/db/types";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useSonarStore } from "@/stores/sonarStore";
import { queryEventsGql } from "@tehfrontier/chain-shared";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL = 15_000; // 15 seconds
const CONCURRENCY = 5; // max parallel event queries

/** Module-level cache of recently-inserted txDigest values to prevent duplicates
 *  across polls without needing an indexed DB query. Capped at 5000 entries. */
const knownDigests = new Set<string>();
const KNOWN_DIGESTS_MAX = 5000;

/** Cached handler context to avoid rebuilding on every poll (PERF-04).
 *  Invalidated when underlying table counts change. */
let cachedCtx: HandlerContext | null = null;
let cachedCtxKey = "";

/**
 * Polls for on-chain events every 15s:
 * - CharacterCreated: discovers new characters, populates manifest
 * - All world + extension events: via handler registry with ownership filters
 *
 * Uses parallel batching (5 concurrent) with Promise.allSettled.
 * Persists cursors to sonarState for resume across page reloads.
 */
export function useChainSonar() {
	const client = useSuiClient();
	const tenant = useActiveTenant();
	const chainEnabled = useSonarStore((s) => s.chainEnabled);
	const setChainStatus = useSonarStore((s) => s.setChainStatus);
	const pingChain = useSonarStore((s) => s.pingChain);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const cursorsRef = useRef<Record<string, string | null>>({});
	const [cursorsReady, setCursorsReady] = useState(false);

	const poll = useCallback(async () => {
		try {
			// ── Manifest: CharacterCreated events (no ownership filter) ──
			try {
				const charCursorKey = `CharacterCreated:${tenant}`;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dual @mysten/sui versions
				const charResult = await pollCharacterEvents(
					client as any,
					tenant,
					cursorsRef.current[charCursorKey] ?? null,
				);
				if (charResult.nextCursor) {
					cursorsRef.current[charCursorKey] = charResult.nextCursor;
				}
				if (charResult.newCount > 0) {
					console.log(`[ChainSonar] ${charResult.newCount} new characters discovered`);
				}
			} catch (err) {
				console.error("[ChainSonar] Error polling CharacterCreated:", err);
			}

			// ── Build handler context (PERF-04: cached, invalidated by count) ──
			const [charCount, deplCount, gtCount, mcCount, curCount] = await Promise.all([
				db.characters.count(),
				db.deployables.count(),
				db.gameTypes.count(),
				db.manifestCharacters.count(),
				db.currencies.count(),
			]);
			const ctxKey = `${charCount}:${deplCount}:${gtCount}:${mcCount}:${curCount}`;

			let handlerCtx: HandlerContext;
			if (cachedCtx && cachedCtxKey === ctxKey) {
				handlerCtx = cachedCtx;
			} else {
				const characters = await db.characters.toArray();
				const ownedAddresses = new Set(
					characters.filter((c) => c.suiAddress && !c._deleted).map((c) => c.suiAddress as string),
				);

				const allDeployables = await db.deployables
					.filter((d) => d.owner != null && ownedAddresses.has(d.owner as string))
					.toArray();

				const ssuTypes = new Set(["storage_unit", "smart_storage_unit", "protocol_depot"]);
				const ssuObjectIds = new Set(
					allDeployables.filter((d) => ssuTypes.has(d.assemblyType)).map((d) => d.objectId),
				);

				const ownedAssemblyIds = new Set(allDeployables.map((d) => d.objectId));

				const assemblyNameMap = new Map<string, string>();
				for (const d of allDeployables) {
					if (d.label) assemblyNameMap.set(d.objectId, d.label);
				}

				const gameTypes = await db.gameTypes.toArray();
				const typeNameMap = new Map<number, string>();
				for (const t of gameTypes) {
					typeNameMap.set(t.id, t.name);
				}

				const charNameMap = new Map<string, string>();
				for (const c of characters) {
					if (c.characterId && c.characterName) {
						charNameMap.set(c.characterId, c.characterName);
					}
				}

				const manifestChars = await db.manifestCharacters.toArray();
				for (const mc of manifestChars) {
					if (mc.characterItemId && mc.name) {
						charNameMap.set(mc.characterItemId, mc.name);
					}
				}

				const charTribeMap = new Map<string, number>();
				for (const mc of manifestChars) {
					if (mc.characterItemId && mc.tribeId) {
						charTribeMap.set(mc.characterItemId, mc.tribeId);
					}
				}

				const currencySymbolMap = new Map<string, string>();
				const currencies = await db.currencies.toArray();
				for (const c of currencies) {
					if (c.coinType && c.symbol) {
						currencySymbolMap.set(c.coinType, c.symbol);
					}
				}

				handlerCtx = {
					ssuObjectIds,
					ownedAssemblyIds,
					ownedAddresses,
					assemblyNameMap,
					typeNameMap,
					charNameMap,
					charTribeMap,
					currencySymbolMap,
				};
				cachedCtx = handlerCtx;
				cachedCtxKey = ctxKey;
			}

			// ── Build event type map: key -> moveEventType string ────────
			const worldEvents = getEventTypes(tenant);
			const extensionEvents = getExtensionEventTypes(tenant);
			const allEventTypes: Record<string, string> = {
				...worldEvents,
				...extensionEvents,
			};

			// Remove CharacterCreated -- handled separately above
			delete allEventTypes.CharacterCreated;

			// Build list of {key, moveEventType} pairs that have handlers,
			// skipping categories that can't match any owned entities
			const pollTasks: { key: string; moveEventType: string }[] = [];
			for (const [key, moveEventType] of Object.entries(allEventTypes)) {
				if (!moveEventType) continue;
				const handler = EVENT_HANDLER_REGISTRY[key];
				if (!handler) continue;
				// Skip owned-* handlers when no entities exist for that filter
				if (handler.filter === "owned_ssu" && handlerCtx.ssuObjectIds.size === 0) continue;
				if (handler.filter === "owned_assembly" && handlerCtx.ownedAssemblyIds.size === 0) continue;
				if (handler.filter === "owned_address" && handlerCtx.ownedAddresses.size === 0) continue;
				pollTasks.push({ key, moveEventType });
			}

			// ── Poll in parallel batches of CONCURRENCY ────────────────
			const sonarEntries: Omit<SonarEvent, "id">[] = [];

			for (let i = 0; i < pollTasks.length; i += CONCURRENCY) {
				const batch = pollTasks.slice(i, i + CONCURRENCY);
				const results = await Promise.allSettled(
					batch.map(async ({ key, moveEventType }) => {
						const cursor = cursorsRef.current[key] ?? null;
						const handler = EVENT_HANDLER_REGISTRY[key];

						// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dual @mysten/sui versions
						const result = await queryEventsGql(client as any, moveEventType, {
							cursor,
							limit: 50,
						});

						const entries: Omit<SonarEvent, "id">[] = [];
						for (const event of result.data) {
							const parsed = handler.parse(event, handlerCtx);
							entries.push(...parsed);
						}

						if (result.nextCursor) {
							cursorsRef.current[key] = result.nextCursor;
						}

						return entries;
					}),
				);

				for (let j = 0; j < results.length; j++) {
					const result = results[j];
					if (result.status === "fulfilled") {
						sonarEntries.push(...result.value);
					} else {
						const failedKey = batch[j].key;
						console.error(`[ChainSonar] Error polling ${failedKey}:`, result.reason);
					}
				}
			}

			// Enrich entries with tribeId from charTribeMap
			for (const entry of sonarEntries) {
				if (entry.characterId && !entry.tribeId) {
					const tid = handlerCtx.charTribeMap.get(entry.characterId);
					if (tid) entry.tribeId = tid;
				}
			}

			// Deduplicate using in-memory txDigest cache
			if (sonarEntries.length > 0) {
				const novel = sonarEntries.filter((e) => !e.txDigest || !knownDigests.has(e.txDigest));
				if (novel.length > 0) {
					await db.sonarEvents.bulkAdd(novel);
					for (const e of novel) {
						if (e.txDigest) knownDigests.add(e.txDigest);
					}
					// Reset cache when it grows too large
					if (knownDigests.size > KNOWN_DIGESTS_MAX) {
						knownDigests.clear();
					}
				}
			}

			// Persist cursors to DB
			await persistCursors(cursorsRef, setChainStatus);
			pingChain();
		} catch (err) {
			console.error("[ChainSonar] Poll error:", err);
			setChainStatus("error");
			await db.sonarState
				.update("chain", {
					status: "error",
					lastError: err instanceof Error ? err.message : String(err),
				})
				.catch((e) => console.error("[ChainSonar] Failed to persist error:", e));
		}
	}, [client, tenant, setChainStatus, pingChain]);

	// Initialize cursors from DB on first enable
	useEffect(() => {
		if (!chainEnabled || cursorsReady) return;

		(async () => {
			try {
				const state = await db.sonarState.get("chain");
				if (state?.cursors) {
					cursorsRef.current = { ...state.cursors };
				}
			} catch (err) {
				console.error("[ChainSonar] Failed to load persisted cursors:", err);
				// Continue without persisted cursors -- polling will start fresh
			} finally {
				setCursorsReady(true);
			}
		})();
	}, [chainEnabled, cursorsReady]);

	useEffect(() => {
		if (!chainEnabled || !cursorsReady) {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			if (!chainEnabled) setChainStatus("off");
			return;
		}

		poll();
		intervalRef.current = setInterval(poll, POLL_INTERVAL);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [chainEnabled, cursorsReady, poll, setChainStatus]);
}

/** Persist all cursors to sonarState and mark chain as active. */
async function persistCursors(
	cursorsRef: React.MutableRefObject<Record<string, string | null>>,
	setChainStatus: (s: "active" | "off" | "error") => void,
) {
	await db.sonarState
		.put({
			channel: "chain",
			enabled: true,
			status: "active",
			cursors: cursorsRef.current as Record<string, string>,
			lastPollAt: new Date().toISOString(),
		})
		.catch((e) => console.error("[ChainSonar] Failed to persist cursors:", e));
	setChainStatus("active");
}
