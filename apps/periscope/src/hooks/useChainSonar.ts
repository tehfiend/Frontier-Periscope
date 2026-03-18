import { useEffect, useRef, useCallback } from "react";
import { useSuiClient } from "@/hooks/useSuiClient";
import { queryEventsGql } from "@tehfrontier/chain-shared";
import { db } from "@/db";
import { useSonarStore } from "@/stores/sonarStore";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { getEventTypes } from "@/chain/config";
import type { SonarEvent } from "@/db/types";

const POLL_INTERVAL = 15_000; // 15 seconds

/** Inventory event types we poll for and their sonarEvent eventType names. */
const INVENTORY_EVENT_MAP = [
	{ key: "ItemDeposited", eventType: "item_deposited" },
	{ key: "ItemWithdrawn", eventType: "item_withdrawn" },
	{ key: "ItemMinted", eventType: "item_minted" },
	{ key: "ItemBurned", eventType: "item_burned" },
] as const;

/**
 * Polls for on-chain inventory events (deposits, withdrawals, mints, burns)
 * on owned SSUs. Writes matching events to the sonarEvents table.
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
			// Load all characters with suiAddress for SSU ownership lookup
			const characters = await db.characters.toArray();
			const suiAddresses = new Set(
				characters
					.filter((c) => c.suiAddress && !c._deleted)
					.map((c) => c.suiAddress as string),
			);

			if (suiAddresses.size === 0) {
				// No characters with addresses -- nothing to monitor
				return;
			}

			// Load SSU object IDs owned by any registered character
			const ssuTypes = new Set([
				"storage_unit",
				"smart_storage_unit",
				"protocol_depot",
			]);
			const deployables = await db.deployables
				.filter(
					(d) =>
						d.owner != null &&
						suiAddresses.has(d.owner) &&
						ssuTypes.has(d.assemblyType),
				)
				.toArray();

			const ssuObjectIds = new Set(deployables.map((d) => d.objectId));

			if (ssuObjectIds.size === 0) {
				// No SSUs found -- still mark as active (no error)
				setChainStatus("active");
				return;
			}

			// Build assembly name lookup
			const assemblyNameMap = new Map<string, string>();
			for (const d of deployables) {
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

			const eventTypes = getEventTypes(tenant);
			const sonarEntries: Omit<SonarEvent, "id">[] = [];

			for (const { key, eventType } of INVENTORY_EVENT_MAP) {
				const moveEventType = eventTypes[key as keyof typeof eventTypes];
				if (!moveEventType) continue;

				const cursor = cursorsRef.current[key] ?? null;

				try {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dual @mysten/sui versions
					const result = await queryEventsGql(client as any, moveEventType, {
						cursor,
						limit: 50,
					});

					for (const event of result.data) {
						const parsed = event.parsedJson;

						// Extract assembly_id -- may be nested object or string
						const assemblyIdRaw =
							(parsed.assembly_id as { item_id?: string })?.item_id ??
							(parsed.assembly_key as string) ??
							(parsed.assembly_id as string);

						// Filter: only keep events for our SSUs
						if (!assemblyIdRaw || !ssuObjectIds.has(assemblyIdRaw)) {
							continue;
						}

						// Extract fields
						const typeId = Number(
							(parsed.type_id as { item_id?: string })?.item_id ??
								parsed.type_id,
						);
						const quantity = Number(parsed.quantity ?? 0);
						const charIdRaw =
							(parsed.character_id as { item_id?: string })?.item_id ??
							(parsed.character_key as string) ??
							(parsed.character_id as string);

						sonarEntries.push({
							timestamp: new Date(
								Number(event.timestampMs),
							).toISOString(),
							source: "chain",
							eventType,
							characterName: charIdRaw
								? charNameMap.get(charIdRaw)
								: undefined,
							characterId: charIdRaw || undefined,
							assemblyId: assemblyIdRaw,
							assemblyName: assemblyNameMap.get(assemblyIdRaw),
							typeId: Number.isNaN(typeId) ? undefined : typeId,
							typeName: Number.isNaN(typeId)
								? undefined
								: typeNameMap.get(typeId),
							quantity,
							txDigest: `chain-${event.timestampMs}`,
						});
					}

					// Update cursor
					if (result.nextCursor) {
						cursorsRef.current[key] = result.nextCursor;
					}
				} catch (err) {
					console.error(
						`[ChainSonar] Error polling ${key}:`,
						err,
					);
					// Continue to next event type rather than failing completely
				}
			}

			// Write all collected events
			if (sonarEntries.length > 0) {
				await db.sonarEvents.bulkAdd(sonarEntries);
			}

			// Persist cursors to DB
			await db.sonarState.update("chain", {
				status: "active",
				cursors: cursorsRef.current as Record<string, string>,
				lastPollAt: new Date().toISOString(),
			});

			setChainStatus("active");
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
