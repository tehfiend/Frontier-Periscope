import { useEffect, useRef, useCallback } from "react";
import { db } from "@/db";
import { useSonarStore } from "@/stores/sonarStore";
import type { SonarEvent } from "@/db/types";

const POLL_INTERVAL = 5_000; // 5 seconds, matching log watcher cadence

/**
 * Polls the logEvents table for new system_change entries and copies them
 * to the sonarEvents table. Uses a high-water-mark (lastProcessedLogId)
 * persisted in sonarState to avoid re-processing.
 *
 * Does NOT modify or replace useLogWatcher -- reads from the same logEvents
 * table that useLogWatcher writes to.
 */
export function useLocalSonar() {
	const localEnabled = useSonarStore((s) => s.localEnabled);
	const setLocalStatus = useSonarStore((s) => s.setLocalStatus);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const poll = useCallback(async () => {
		try {
			// Get high-water-mark from DB
			const state = await db.sonarState.get("local");
			const lastProcessedLogId = state?.lastProcessedLogId ?? 0;

			// Query for system_change events with id > lastProcessedLogId
			const newEvents = await db.logEvents
				.where("id")
				.above(lastProcessedLogId)
				.filter((e) => e.type === "system_change")
				.toArray();

			if (newEvents.length === 0) return;

			// Build a session lookup for characterName/characterId resolution
			const sessionIds = Array.from(new Set(newEvents.map((e) => e.sessionId)));
			const sessions = await db.logSessions.bulkGet(sessionIds);
			const sessionMap = new Map<
				string,
				{ characterName?: string; characterId?: string }
			>();
			for (const s of sessions) {
				if (s) {
					sessionMap.set(s.id, {
						characterName: s.characterName,
						characterId: s.characterId,
					});
				}
			}

			// Convert to SonarEvent format
			const sonarEntries: Omit<SonarEvent, "id">[] = newEvents.map((e) => {
				const session = sessionMap.get(e.sessionId);
				return {
					timestamp: e.timestamp,
					source: "local" as const,
					eventType: "system_change",
					characterName: session?.characterName,
					characterId: session?.characterId,
					systemName: e.systemName,
					details: e.systemName ? `Entered ${e.systemName}` : undefined,
					sessionId: e.sessionId,
				};
			});

			// Write to sonarEvents
			await db.sonarEvents.bulkAdd(sonarEntries);

			// Update high-water-mark
			const maxId = newEvents.reduce(
				(max, e) => Math.max(max, e.id ?? 0),
				0,
			);
			await db.sonarState.update("local", {
				lastProcessedLogId: maxId,
				status: "active",
			});

			setLocalStatus("active");
		} catch (err) {
			console.error("[LocalSonar] Poll error:", err);
			setLocalStatus("error");
			await db.sonarState
				.update("local", {
					status: "error",
					lastError: err instanceof Error ? err.message : String(err),
				})
				.catch(() => {});
		}
	}, [setLocalStatus]);

	useEffect(() => {
		if (!localEnabled) {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			setLocalStatus("off");
			return;
		}

		// Initial poll
		poll();

		// Set up polling interval
		intervalRef.current = setInterval(poll, POLL_INTERVAL);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [localEnabled, poll, setLocalStatus]);
}
