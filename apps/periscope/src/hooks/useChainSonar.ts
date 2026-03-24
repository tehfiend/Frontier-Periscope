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
import { useCallback, useEffect, useRef } from "react";

const POLL_INTERVAL = 15_000; // 15 seconds
const CONCURRENCY = 5; // max parallel event queries

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
	const initializedRef = useRef(false);

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

			// ── Build handler context ───────────────────────────────────
			const characters = await db.characters.toArray();
			const ownedAddresses = new Set(
				characters.filter((c) => c.suiAddress && !c._deleted).map((c) => c.suiAddress as string),
			);

			// Load ALL deployables owned by registered characters
			const allDeployables = await db.deployables
				.filter((d) => d.owner != null && ownedAddresses.has(d.owner as string))
				.toArray();

			// SSU object IDs (for inventory-specific filters)
			const ssuTypes = new Set(["storage_unit", "smart_storage_unit", "protocol_depot"]);
			const ssuObjectIds = new Set(
				allDeployables.filter((d) => ssuTypes.has(d.assemblyType)).map((d) => d.objectId),
			);

			// All owned assembly IDs (SSUs + gates + turrets + nodes)
			const ownedAssemblyIds = new Set(allDeployables.map((d) => d.objectId));

			// Assembly name lookup
			const assemblyNameMap = new Map<string, string>();
			for (const d of allDeployables) {
				if (d.label) assemblyNameMap.set(d.objectId, d.label);
			}

			// Pre-load gameTypes for type_id resolution
			const gameTypes = await db.gameTypes.toArray();
			const typeNameMap = new Map<number, string>();
			for (const t of gameTypes) {
				typeNameMap.set(t.id, t.name);
			}

			// Build character lookup for character_id resolution
			const charNameMap = new Map<string, string>();
			for (const c of characters) {
				if (c.characterId && c.characterName) {
					charNameMap.set(c.characterId, c.characterName);
				}
			}

			// Also populate from manifest characters
			const manifestChars = await db.manifestCharacters.toArray();
			for (const mc of manifestChars) {
				if (mc.characterItemId && mc.name) {
					charNameMap.set(mc.characterItemId, mc.name);
				}
			}

			// Build character -> tribe lookup
			const charTribeMap = new Map<string, number>();
			for (const mc of manifestChars) {
				if (mc.characterItemId && mc.tribeId) {
					charTribeMap.set(mc.characterItemId, mc.tribeId);
				}
			}

			const handlerCtx: HandlerContext = {
				ssuObjectIds,
				ownedAssemblyIds,
				ownedAddresses,
				assemblyNameMap,
				typeNameMap,
				charNameMap,
				charTribeMap,
			};

			// ── Build event type map: key -> moveEventType string ────────
			const worldEvents = getEventTypes(tenant);
			const extensionEvents = getExtensionEventTypes(tenant);
			const allEventTypes: Record<string, string> = {
				...worldEvents,
				...extensionEvents,
			};

			// Remove CharacterCreated -- handled separately above
			allEventTypes.CharacterCreated = undefined;

			// Build list of {key, moveEventType} pairs that have handlers
			const pollTasks: { key: string; moveEventType: string }[] = [];
			for (const [key, moveEventType] of Object.entries(allEventTypes)) {
				if (moveEventType && EVENT_HANDLER_REGISTRY[key]) {
					pollTasks.push({ key, moveEventType });
				}
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

				for (const result of results) {
					if (result.status === "fulfilled") {
						sonarEntries.push(...result.value);
					} else {
						console.error("[ChainSonar] Batch query error:", result.reason);
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

			// Write all collected events
			if (sonarEntries.length > 0) {
				await db.sonarEvents.bulkAdd(sonarEntries);
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
				.catch(() => {});
		}
	}, [client, tenant, setChainStatus, pingChain]);

	// Initialize cursors from DB on first enable
	useEffect(() => {
		if (!chainEnabled || initializedRef.current) return;

		(async () => {
			const state = await db.sonarState.get("chain");
			if (state?.cursors) {
				cursorsRef.current = { ...state.cursors };
			}
			initializedRef.current = true;
		})();
	}, [chainEnabled]);

	useEffect(() => {
		if (!chainEnabled) {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			setChainStatus("off");
			return;
		}

		// Initial poll (after short delay to allow cursor init)
		const initTimeout = setTimeout(() => {
			poll();
			intervalRef.current = setInterval(poll, POLL_INTERVAL);
		}, 500);

		return () => {
			clearTimeout(initTimeout);
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [chainEnabled, poll, setChainStatus]);
}

/** Persist all cursors to sonarState and mark chain as active. */
async function persistCursors(
	cursorsRef: React.MutableRefObject<Record<string, string | null>>,
	setChainStatus: (s: "active" | "off" | "error") => void,
) {
	await db.sonarState.update("chain", {
		status: "active",
		cursors: cursorsRef.current as Record<string, string>,
		lastPollAt: new Date().toISOString(),
	});
	setChainStatus("active");
}
