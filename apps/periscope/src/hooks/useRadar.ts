import { useEffect, useRef, useCallback, useState } from "react";
import { useSuiClient } from "@/hooks/useSuiClient";
import { queryEventsGql } from "@tehfrontier/chain-shared";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { TENANTS } from "@/chain/config";
import type { RadarWatch, RadarEvent, RadarEventKind } from "@/db/types";

// ── Event Types ─────────────────────────────────────────────────────────────

function getEventTypes(worldPkg: string) {
	return {
		KillmailCreated: `${worldPkg}::killmail::KillmailCreatedEvent`,
		FuelEvent: `${worldPkg}::fuel::FuelEvent`,
		StatusChanged: `${worldPkg}::status::StatusChangedEvent`,
		AssemblyCreated: `${worldPkg}::assembly::AssemblyCreatedEvent`,
		JumpEvent: `${worldPkg}::gate::JumpEvent`,
	};
}

// Parsed event shape from queryEventsGql
interface ParsedEvent {
	parsedJson: Record<string, unknown>;
	sender: string;
	timestampMs: string;
}

// ── Radar Hook ──────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 15_000; // Poll every 15 seconds

export function useRadar() {
	const client = useSuiClient();
	const tenant = useActiveTenant();
	const worldPkg = TENANTS[tenant].worldPackageId;
	const watches = useLiveQuery(() => db.radarWatches.toArray()) ?? [];
	const [connected, setConnected] = useState(false);
	const cursorsRef = useRef<Map<string, string | null>>(new Map());

	// Match an event against our watch list
	const matchEvent = useCallback(
		(event: ParsedEvent, kind: RadarEventKind): RadarWatch | null => {
			const parsed = event.parsedJson;
			if (!parsed) return null;

			for (const watch of watches) {
				// Match by system
				if (watch.kind === "system") {
					const sysObj = parsed.solar_system_id as { item_id?: string } | undefined;
					const sysId = sysObj?.item_id ?? (parsed.system_id as string);
					if (sysId && sysId === watch.targetId) return watch;
				}

				// Match by character
				if (watch.kind === "character") {
					const victimObj = parsed.victim_id as { item_id?: string } | undefined;
					const killerObj = parsed.killer_id as { item_id?: string } | undefined;
					const charObj = parsed.character_id as { item_id?: string } | undefined;
					const ownerObj = parsed.owner_id as { item_id?: string } | undefined;

					const charIds = [
						victimObj?.item_id, killerObj?.item_id,
						charObj?.item_id, ownerObj?.item_id,
						parsed.victim as string, parsed.killer as string,
						parsed.character as string,
					].filter(Boolean);

					if (charIds.includes(watch.targetId)) return watch;
				}

				// Match by tribe
				if (watch.kind === "tribe") {
					const tribeId = parsed.tribe_id as string | undefined;
					if (tribeId && tribeId === watch.targetId) return watch;
				}
			}

			return null;
		},
		[watches],
	);

	// Create radar event from a matched event
	const processEvent = useCallback(
		async (event: ParsedEvent, kind: RadarEventKind, watch: RadarWatch) => {
			const parsed = event.parsedJson;
			let summary = "";

			switch (kind) {
				case "killmail": {
					const victim = (parsed.victim_id as { item_id?: string })?.item_id ?? "?";
					const killer = (parsed.killer_id as { item_id?: string })?.item_id ?? "?";
					summary = `Kill: ${killer} destroyed ${victim}`;
					break;
				}
				case "fuel":
					summary = `Fuel event: ${parsed.action ?? "update"}`;
					break;
				case "status_change":
					summary = `Status changed to ${(parsed.new_status as { variant?: string })?.variant ?? "unknown"}`;
					break;
				case "assembly_created":
					summary = "New assembly deployed";
					break;
				case "jump":
					summary = `Jump: character ${(parsed.character_id as { item_id?: string })?.item_id ?? "?"} used gate`;
					break;
				default:
					summary = `${kind} event detected`;
			}

			const radarEvent: RadarEvent = {
				watchId: watch.id,
				kind,
				timestamp: new Date(Number(event.timestampMs)).toISOString(),
				summary,
				details: JSON.stringify(parsed),
				txDigest: `poll-${event.timestampMs}`,
				acknowledged: false,
			};

			await db.radarEvents.add(radarEvent);

			// Alerts
			if (watch.alertEnabled) {
				if (watch.alertNotification && "Notification" in window && Notification.permission === "granted") {
					new Notification(`Radar: ${watch.label}`, { body: summary, icon: "/radar.svg" });
				}
				if (watch.alertSound) {
					try {
						const audio = new Audio("/alert.mp3");
						audio.volume = 0.3;
						audio.play().catch(() => {});
					} catch {}
				}
			}
		},
		[],
	);

	// Poll for events instead of subscribing (GraphQL client doesn't support subscriptions)
	useEffect(() => {
		if (watches.length === 0) {
			setConnected(false);
			return;
		}

		const eventTypes = getEventTypes(worldPkg);
		const eventMap: Array<{ type: string; kind: RadarEventKind }> = [
			{ type: eventTypes.KillmailCreated, kind: "killmail" },
			{ type: eventTypes.FuelEvent, kind: "fuel" },
			{ type: eventTypes.StatusChanged, kind: "status_change" },
			{ type: eventTypes.AssemblyCreated, kind: "assembly_created" },
			{ type: eventTypes.JumpEvent, kind: "jump" },
		];

		let cancelled = false;

		async function poll() {
			if (cancelled) return;

			for (const { type, kind } of eventMap) {
				if (cancelled) break;
				try {
					const cursor = cursorsRef.current.get(type) ?? null;
					const result = await queryEventsGql(client, type, {
						cursor,
						limit: 10,
					});

					for (const event of result.data) {
						if (cancelled) break;
						const match = matchEvent(event, kind);
						if (match) {
							await processEvent(event, kind, match);
						}
					}

					if (result.nextCursor) {
						cursorsRef.current.set(type, result.nextCursor);
					}
				} catch {
					// Polling failure — will retry next interval
				}
			}
		}

		// Initial poll
		poll().then(() => {
			if (!cancelled) setConnected(true);
		});

		// Set up interval
		const intervalId = setInterval(poll, POLL_INTERVAL_MS);

		return () => {
			cancelled = true;
			clearInterval(intervalId);
			setConnected(false);
		};
	}, [client, worldPkg, watches.length, matchEvent, processEvent]);

	// CRUD operations
	const addWatch = useCallback(
		async (kind: RadarWatch["kind"], targetId: string, label: string) => {
			await db.radarWatches.add({
				id: crypto.randomUUID(),
				kind,
				targetId,
				label,
				alertEnabled: true,
				alertSound: false,
				alertNotification: true,
				createdAt: new Date().toISOString(),
			});
		},
		[],
	);

	const removeWatch = useCallback(async (id: string) => {
		await db.radarWatches.delete(id);
		// Clean up events for this watch
		await db.radarEvents.where("watchId").equals(id).delete();
	}, []);

	const toggleAlert = useCallback(async (id: string, field: "alertEnabled" | "alertSound" | "alertNotification") => {
		const watch = await db.radarWatches.get(id);
		if (watch) {
			await db.radarWatches.update(id, { [field]: !watch[field] });
		}
	}, []);

	const clearEvents = useCallback(async (watchId?: string) => {
		if (watchId) {
			await db.radarEvents.where("watchId").equals(watchId).delete();
		} else {
			await db.radarEvents.clear();
		}
	}, []);

	const acknowledgeAll = useCallback(async () => {
		await db.radarEvents.where("acknowledged").equals(0).modify({ acknowledged: true });
	}, []);

	return {
		watches,
		connected,
		addWatch,
		removeWatch,
		toggleAlert,
		clearEvents,
		acknowledgeAll,
	};
}
