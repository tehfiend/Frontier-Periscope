import { useEffect, useRef, useCallback } from "react";
import { db } from "@/db";
import { useSonarStore } from "@/stores/sonarStore";
import type { SonarEvent } from "@/db/types";

/** Extract character ID from a sessionId (game log filename without .txt).
 * Format: YYYYMMDD_HHMMSS_CHARACTERID or channel_YYYYMMDD_HHMMSS_CHARACTERID */
function extractCharacterIdFromSession(sessionId: string): string | undefined {
	const match = sessionId.match(/_(\d{10,})$/);
	return match?.[1];
}

const POLL_INTERVAL = 5_000;

/**
 * Polls the logEvents table for system_change entries and copies new ones
 * to the sonarEvents table. Uses timestamp-based deduplication instead of
 * a high-water-mark — checks which system_change logEvents don't yet have
 * a matching sonarEvent.
 */
export function useLocalSonar() {
	const localEnabled = useSonarStore((s) => s.localEnabled);
	const setLocalStatus = useSonarStore((s) => s.setLocalStatus);
	const pingLocal = useSonarStore((s) => s.pingLocal);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const poll = useCallback(async () => {
		try {
			// Get all system_change events from logEvents
			const logSystemChanges = await db.logEvents
				.where("type")
				.equals("system_change")
				.toArray();

			if (logSystemChanges.length === 0) {
				setLocalStatus("active");
				pingLocal();
				return;
			}

			// Get all existing local sonar event timestamps to deduplicate
			const existingSonar = await db.sonarEvents
				.where("[source+eventType]")
				.equals(["local", "system_change"])
				.toArray();

			const existingKeys = new Set(
				existingSonar.map((e) => `${e.timestamp}|${e.systemName}`),
			);

			// Find logEvents not yet in sonarEvents
			const missing = logSystemChanges.filter(
				(e) => !existingKeys.has(`${e.timestamp}|${e.systemName}`),
			);

			// Build character name lookup (keyed by both record ID and numeric characterId)
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

			// Backfill existing sonar events that have missing character names
			const nameless = existingSonar.filter((e) => !e.characterName && e.sessionId);
			if (nameless.length > 0) {
				const nlSessionIds = Array.from(new Set(nameless.map((e) => e.sessionId!)));
				const nlSessions = await db.logSessions.bulkGet(nlSessionIds);
				const nlSessionMap = new Map<string, { characterName?: string; characterId?: string }>();
				for (const s of nlSessions) {
					if (s) nlSessionMap.set(s.id, { characterName: s.characterName, characterId: s.characterId });
				}
				for (const e of nameless) {
					const session = nlSessionMap.get(e.sessionId!);
					const charId = extractCharacterIdFromSession(e.sessionId!) ?? session?.characterId;
					const name = (charId ? charNameById.get(charId) : undefined) ?? session?.characterName;
					if (name && e.id != null) {
						await db.sonarEvents.update(e.id, { characterName: name, characterId: charId });
					}
				}
			}

			if (missing.length === 0) {
				setLocalStatus("active");
				pingLocal();
				return;
			}

			// Build session lookup for new entries
			const sessionIds = Array.from(new Set(missing.map((e) => e.sessionId)));
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
			const sonarEntries: Omit<SonarEvent, "id">[] = missing.map((e) => {
				const session = sessionMap.get(e.sessionId);
				const characterId =
					extractCharacterIdFromSession(e.sessionId) ?? session?.characterId;
				const characterName =
					(characterId ? charNameById.get(characterId) : undefined) ??
					session?.characterName;
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
				.catch(() => {});
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

		poll().catch(() => {});
		intervalRef.current = setInterval(poll, POLL_INTERVAL);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [localEnabled, poll, setLocalStatus]);
}
