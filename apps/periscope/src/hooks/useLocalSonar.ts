import { db } from "@/db";
import type { SonarEvent } from "@/db/types";
import { useSonarStore } from "@/stores/sonarStore";
import { useCallback, useEffect, useRef } from "react";

/** Extract character ID from a sessionId (game log filename without .txt).
 * Format: YYYYMMDD_HHMMSS_CHARACTERID or channel_YYYYMMDD_HHMMSS_CHARACTERID */
function extractCharacterIdFromSession(sessionId: string): string | undefined {
	const match = sessionId.match(/_(\d{10,})$/);
	return match?.[1];
}

const POLL_INTERVAL = 5_000;

/**
 * Polls the logEvents table for system_change entries and copies new ones
 * to the sonarEvents table. Uses a high-water-mark (lastProcessedLogId)
 * from SonarChannelState to only query new logEvents since the last poll.
 */
export function useLocalSonar() {
	const localEnabled = useSonarStore((s) => s.localEnabled);
	const setLocalStatus = useSonarStore((s) => s.setLocalStatus);
	const pingLocal = useSonarStore((s) => s.pingLocal);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const hwmRef = useRef<number>(0);
	const hwmInitialized = useRef(false);
	/** Whether a nameless backfill pass is needed (first poll or when new events found) */
	const needsBackfill = useRef(true);

	const poll = useCallback(async () => {
		try {
			// Initialize HWM from DB on first poll
			if (!hwmInitialized.current) {
				const state = await db.sonarState.get("local");
				hwmRef.current = state?.lastProcessedLogId ?? 0;
				hwmInitialized.current = true;
			}

			// Only query logEvents with id > lastProcessedLogId
			const logSystemChanges = await db.logEvents
				.where("type")
				.equals("system_change")
				.filter((e) => (e.id ?? 0) > hwmRef.current)
				.toArray();

			// Build character name lookup
			const allCharacters = await db.characters.toArray();
			const charNameById = new Map<string, string>();
			for (const c of allCharacters) {
				if (c.characterName) {
					charNameById.set(c.id, c.characterName);
					if (c.characterId) {
						charNameById.set(c.characterId, c.characterName);
					}
				}
			}

			// PERF-05: Only run nameless backfill on first poll or when new events found
			if (needsBackfill.current) {
				const nameless = await db.sonarEvents
					.where("[source+eventType]")
					.equals(["local", "system_change"])
					.filter((e) => !e.characterName && !!e.sessionId)
					.toArray();
				if (nameless.length > 0) {
					const nlSessionIds = Array.from(new Set(nameless.map((e) => e.sessionId!)));
					const nlSessions = await db.logSessions.bulkGet(nlSessionIds);
					const nlSessionMap = new Map<string, { characterName?: string; characterId?: string }>();
					for (const s of nlSessions) {
						if (s)
							nlSessionMap.set(s.id, {
								characterName: s.characterName,
								characterId: s.characterId,
							});
					}
					for (const e of nameless) {
						const session = nlSessionMap.get(e.sessionId!);
						const charId = extractCharacterIdFromSession(e.sessionId!) ?? session?.characterId;
						const name = (charId ? charNameById.get(charId) : undefined) ?? session?.characterName;
						if (name && e.id != null) {
							await db.sonarEvents.update(e.id, {
								characterName: name,
								characterId: charId,
							});
						}
					}
				}
				needsBackfill.current = false;
			}

			if (logSystemChanges.length === 0) {
				setLocalStatus("active");
				pingLocal();
				return;
			}

			// Build session lookup for new entries
			const sessionIds = Array.from(new Set(logSystemChanges.map((e) => e.sessionId)));
			const sessions = await db.logSessions.bulkGet(sessionIds);
			const sessionMap = new Map<string, { characterName?: string; characterId?: string }>();
			for (const s of sessions) {
				if (s) {
					sessionMap.set(s.id, {
						characterName: s.characterName,
						characterId: s.characterId,
					});
				}
			}

			// Convert to SonarEvent format
			const sonarEntries: Omit<SonarEvent, "id">[] = logSystemChanges.map((e) => {
				const session = sessionMap.get(e.sessionId);
				const characterId = extractCharacterIdFromSession(e.sessionId) ?? session?.characterId;
				const characterName =
					(characterId ? charNameById.get(characterId) : undefined) ?? session?.characterName;
				return {
					timestamp: e.timestamp,
					source: "local" as const,
					eventType: "system_change",
					characterName,
					characterId,
					systemName: e.systemName,
					details: e.systemName ? `Entered ${e.systemName}` : undefined,
					sessionId: e.sessionId,
				};
			});

			await db.sonarEvents.bulkAdd(sonarEntries);

			// Update HWM to max logEvent id in this batch
			const maxLogId = Math.max(...logSystemChanges.map((e) => e.id ?? 0));
			hwmRef.current = maxLogId;
			await db.sonarState.update("local", {
				lastProcessedLogId: maxLogId,
			});

			// Trigger backfill check on next poll since we added new events
			needsBackfill.current = true;

			setLocalStatus("active");
			pingLocal();
		} catch (err) {
			console.error("[LocalSonar] Poll error:", err);
			setLocalStatus("error");
			await db.sonarState
				.update("local", {
					status: "error",
					lastError: err instanceof Error ? err.message : String(err),
				})
				.catch((e) => console.error("[LocalSonar] Failed to persist error:", e));
		}
	}, [setLocalStatus, pingLocal]);

	useEffect(() => {
		if (!localEnabled) {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			setLocalStatus("off");
			return;
		}

		poll().catch((e) => console.error("[LocalSonar] Failed to persist error:", e));
		intervalRef.current = setInterval(poll, POLL_INTERVAL);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [localEnabled, poll, setLocalStatus]);
}
