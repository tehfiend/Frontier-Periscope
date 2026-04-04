import { db } from "@/db";
import type { LogEvent, SonarEvent } from "@/db/types";
import { useSonarStore } from "@/stores/sonarStore";
import { useCallback, useEffect, useRef } from "react";

/** Extract character ID from a sessionId (game log filename without .txt).
 * Format: YYYYMMDD_HHMMSS_CHARACTERID or channel_YYYYMMDD_HHMMSS_CHARACTERID */
function extractCharacterIdFromSession(sessionId: string): string | undefined {
	const match = sessionId.match(/_(\d{10,})$/);
	return match?.[1];
}

// ── Activity tracking types ─────────────────────────────────────────────────

const POLL_INTERVAL = 5_000;

/** Monotonic counter incremented by clearAndReimport to signal a reset. */
let resetGeneration = 0;
/** When true, poll() returns immediately without processing. */
let localSonarPaused = false;

/** Called by useLogWatcher.clearAndReimport BEFORE clearing tables. */
export function signalLocalSonarReset() {
	resetGeneration++;
	localSonarPaused = true;
}

/** Called by useLogWatcher.clearAndReimport AFTER clearing is done and watching resumes. */
export function resumeLocalSonar() {
	localSonarPaused = false;
}
const MINING_GAP_MS = 30_000;
const COMBAT_GAP_MS = 60_000;

const COMBAT_TYPES = new Set(["combat_dealt", "combat_received", "miss_dealt", "miss_received"]);
const ALERT_TYPES = new Set(["asteroid_depleted", "cargo_full"]);

interface MiningTracker {
	active: boolean;
	startTimestamp: string;
	lastEventTimestamp: string;
	ore: string;
	totalAmount: number;
	cycles: number;
	characterName?: string;
	characterId?: string;
}

interface CombatTracker {
	active: boolean;
	startTimestamp: string;
	lastEventTimestamp: string;
	targets: Set<string>;
	weapons: Set<string>;
	totalDamageDealt: number;
	totalDamageRecv: number;
	hitsDealt: number;
	hitsRecv: number;
	characterName?: string;
	characterId?: string;
}

interface ActivityState {
	mining: Map<string, MiningTracker>;
	combat: Map<string, CombatTracker>;
}

function formatDuration(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	if (totalSec < 60) return `${totalSec}s`;
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

function tsMs(ts: string): number {
	return new Date(ts).getTime();
}

// ── Mining gap detection ────────────────────────────────────────────────────

function processMiningEvents(
	events: LogEvent[],
	tracker: MiningTracker | undefined,
	sessionId: string,
	charName: string | undefined,
	charId: string | undefined,
): { tracker: MiningTracker | undefined; sonarEvents: Omit<SonarEvent, "id">[] } {
	const sonar: Omit<SonarEvent, "id">[] = [];
	const sorted = events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

	let t = tracker
		? { ...tracker }
		: undefined;

	for (const e of sorted) {
		const oreType = e.ore ?? "Unknown";
		const amount = e.amount ?? 0;

		if (!t || !t.active) {
			// Check gap from previous inactive tracker
			if (t && tsMs(e.timestamp) - tsMs(t.lastEventTimestamp) <= MINING_GAP_MS) {
				// Resume -- gap too short, this is a continuation (shouldn't happen if we
				// properly ended it, but guard)
				t.active = true;
			} else {
				// Start new run
				t = {
					active: true,
					startTimestamp: e.timestamp,
					lastEventTimestamp: e.timestamp,
					ore: oreType,
					totalAmount: 0,
					cycles: 0,
					characterName: charName,
					characterId: charId,
				};
				sonar.push({
					timestamp: e.timestamp,
					source: "local",
					eventType: "mining_started",
					characterName: charName,
					characterId: charId,
					sessionId,
					typeName: oreType,
					details: `Started mining ${oreType}`,
				});
			}
		} else {
			// Active tracker -- check for gap within batch
			const gap = tsMs(e.timestamp) - tsMs(t.lastEventTimestamp);
			if (gap > MINING_GAP_MS) {
				// End previous run
				const duration = tsMs(t.lastEventTimestamp) - tsMs(t.startTimestamp);
				sonar.push({
					timestamp: t.lastEventTimestamp,
					source: "local",
					eventType: "mining_ended",
					characterName: t.characterName,
					characterId: t.characterId,
					sessionId,
					typeName: t.ore,
					quantity: t.totalAmount,
					details: `Mined ${t.totalAmount.toLocaleString("en-US")} ${t.ore} in ${t.cycles} cycles (${formatDuration(duration)})`,
				});
				// Start new run
				t = {
					active: true,
					startTimestamp: e.timestamp,
					lastEventTimestamp: e.timestamp,
					ore: oreType,
					totalAmount: 0,
					cycles: 0,
					characterName: charName,
					characterId: charId,
				};
				sonar.push({
					timestamp: e.timestamp,
					source: "local",
					eventType: "mining_started",
					characterName: charName,
					characterId: charId,
					sessionId,
					typeName: oreType,
					details: `Started mining ${oreType}`,
				});
			}
		}

		// Accumulate
		t.totalAmount += amount;
		t.cycles += 1;
		t.lastEventTimestamp = e.timestamp;
		t.ore = oreType; // track latest ore
	}

	return { tracker: t, sonarEvents: sonar };
}

function combatEndedDetails(t: CombatTracker): string {
	const duration = tsMs(t.lastEventTimestamp) - tsMs(t.startTimestamp);
	const durationSec = Math.max(duration / 1000, 1);
	const targetList = Array.from(t.targets);
	const targetSummary =
		targetList.length <= 2
			? targetList.join(", ")
			: `${targetList[0]} (+${targetList.length - 1} more)`;
	const dpsDealt = Math.round(t.totalDamageDealt / durationSec);
	const dpsRecv = Math.round(t.totalDamageRecv / durationSec);
	return `Dealt ${t.totalDamageDealt.toLocaleString("en-US")} (${dpsDealt.toLocaleString("en-US")} DPS) / Recv ${t.totalDamageRecv.toLocaleString("en-US")} (${dpsRecv.toLocaleString("en-US")} DPS) vs ${targetSummary} (${formatDuration(duration)})`;
}

// ── Combat gap detection ────────────────────────────────────────────────────

function processCombatEvents(
	events: LogEvent[],
	tracker: CombatTracker | undefined,
	sessionId: string,
	charName: string | undefined,
	charId: string | undefined,
): { tracker: CombatTracker | undefined; sonarEvents: Omit<SonarEvent, "id">[] } {
	const sonar: Omit<SonarEvent, "id">[] = [];
	const sorted = events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

	let t = tracker ? { ...tracker, targets: new Set(tracker.targets), weapons: new Set(tracker.weapons) } : undefined;

	for (const e of sorted) {
		const target = e.target ?? "Unknown";

		if (!t || !t.active) {
			if (t && tsMs(e.timestamp) - tsMs(t.lastEventTimestamp) <= COMBAT_GAP_MS) {
				t.active = true;
			} else {
				// Start new engagement
				t = {
					active: true,
					startTimestamp: e.timestamp,
					lastEventTimestamp: e.timestamp,
					targets: new Set<string>(),
					weapons: new Set<string>(),
					totalDamageDealt: 0,
					totalDamageRecv: 0,
					hitsDealt: 0,
					hitsRecv: 0,
					characterName: charName,
					characterId: charId,
				};
				if (target !== "Unknown") t.targets.add(target);
				sonar.push({
					timestamp: e.timestamp,
					source: "local",
					eventType: "combat_started",
					characterName: charName,
					characterId: charId,
					sessionId,
					typeName: target,
					details: `Engaged ${target}`,
				});
			}
		} else {
			// Active tracker -- check for gap within batch
			const gap = tsMs(e.timestamp) - tsMs(t.lastEventTimestamp);
			if (gap > COMBAT_GAP_MS) {
				// End previous engagement
				const targetList = Array.from(t.targets);
				sonar.push({
					timestamp: t.lastEventTimestamp,
					source: "local",
					eventType: "combat_ended",
					characterName: t.characterName,
					characterId: t.characterId,
					sessionId,
					typeName: targetList[0],
					quantity: t.totalDamageDealt,
					details: combatEndedDetails(t),
				});
				// Start new engagement
				t = {
					active: true,
					startTimestamp: e.timestamp,
					lastEventTimestamp: e.timestamp,
					targets: new Set<string>(),
					weapons: new Set<string>(),
					totalDamageDealt: 0,
					totalDamageRecv: 0,
					hitsDealt: 0,
					hitsRecv: 0,
					characterName: charName,
					characterId: charId,
				};
				if (target !== "Unknown") t.targets.add(target);
				sonar.push({
					timestamp: e.timestamp,
					source: "local",
					eventType: "combat_started",
					characterName: charName,
					characterId: charId,
					sessionId,
					typeName: target,
					details: `Engaged ${target}`,
				});
			}
		}

		// Accumulate
		if (target !== "Unknown") t.targets.add(target);
		if (e.weapon) t.weapons.add(e.weapon);
		if (e.type === "combat_dealt") {
			t.totalDamageDealt += e.damage ?? 0;
			t.hitsDealt += 1;
		} else if (e.type === "combat_received") {
			t.totalDamageRecv += e.damage ?? 0;
			t.hitsRecv += 1;
		}
		t.lastEventTimestamp = e.timestamp;
	}

	return { tracker: t, sonarEvents: sonar };
}

// ── Stale check helpers ─────────────────────────────────────────────────────

function checkStaleMining(
	state: ActivityState,
	now: number,
): Omit<SonarEvent, "id">[] {
	const sonar: Omit<SonarEvent, "id">[] = [];
	for (const [sessionId, t] of state.mining) {
		if (!t.active) continue;
		if (now - tsMs(t.lastEventTimestamp) > MINING_GAP_MS) {
			const duration = tsMs(t.lastEventTimestamp) - tsMs(t.startTimestamp);
			sonar.push({
				timestamp: t.lastEventTimestamp,
				source: "local",
				eventType: "mining_ended",
				characterName: t.characterName,
				characterId: t.characterId,
				sessionId,
				typeName: t.ore,
				quantity: t.totalAmount,
				details: `Mined ${t.totalAmount.toLocaleString("en-US")} ${t.ore} in ${t.cycles} cycles (${formatDuration(duration)})`,
			});
			t.active = false;
		}
	}
	return sonar;
}

function checkStaleCombat(
	state: ActivityState,
	now: number,
): Omit<SonarEvent, "id">[] {
	const sonar: Omit<SonarEvent, "id">[] = [];
	for (const [sessionId, t] of state.combat) {
		if (!t.active) continue;
		if (now - tsMs(t.lastEventTimestamp) > COMBAT_GAP_MS) {
			const targetList = Array.from(t.targets);
			sonar.push({
				timestamp: t.lastEventTimestamp,
				source: "local",
				eventType: "combat_ended",
				characterName: t.characterName,
				characterId: t.characterId,
				sessionId,
				typeName: targetList[0],
				quantity: t.totalDamageDealt,
				details: combatEndedDetails(t),
			});
			t.active = false;
		}
	}
	return sonar;
}

// ── Hook ────────────────────────────────────────────────────────────────────

/** Singleton guard -- only one poller instance at a time */
let activePoller = false;
/** Prevent concurrent poll execution */
let pollRunning = false;

/**
 * Polls the logEvents table for new entries and copies system_change events
 * to sonarEvents, while detecting mining run and combat engagement boundaries
 * to emit start/end sonar events.
 */
export function useLocalSonar() {
	const localEnabled = useSonarStore((s) => s.localEnabled);
	const setLocalStatus = useSonarStore((s) => s.setLocalStatus);
	const pingLocal = useSonarStore((s) => s.pingLocal);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const isPollerRef = useRef(false);
	const hwmRef = useRef<number>(0);
	const hwmInitialized = useRef(false);
	const lastResetGen = useRef(resetGeneration);
	/** Whether a nameless backfill pass is needed (first poll or when new events found) */
	const needsBackfill = useRef(true);
	const activityRef = useRef<ActivityState>({
		mining: new Map(),
		combat: new Map(),
	});

	const poll = useCallback(async () => {
		if (pollRunning) return;
		pollRunning = true;
		try {
			// Skip processing entirely while clear/reimport is in progress
			if (localSonarPaused) return;

			// Detect external reset (clear/reimport) via generation counter
			if (resetGeneration !== lastResetGen.current) {
				lastResetGen.current = resetGeneration;
				hwmRef.current = 0;
				hwmInitialized.current = false;
				activityRef.current = { mining: new Map(), combat: new Map() };
				needsBackfill.current = true;
			}

			// Initialize HWM from DB on first poll.
			// Stored in settings table (not sonarState) to avoid being wiped by
			// sonarStore's put() calls which replace the entire sonarState record.
			if (!hwmInitialized.current) {
				const entry = await db.settings.get("localSonarHWM");
				hwmRef.current = typeof entry?.value === "number" ? entry.value : 0;
				hwmInitialized.current = true;
			}

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
					const nlSessionMap = new Map<
						string,
						{ characterName?: string; characterId?: string }
					>();
					for (const s of nlSessions) {
						if (s)
							nlSessionMap.set(s.id, {
								characterName: s.characterName,
								characterId: s.characterId,
							});
					}
					for (const e of nameless) {
						const session = nlSessionMap.get(e.sessionId!);
						const charId =
							extractCharacterIdFromSession(e.sessionId!) ?? session?.characterId;
						const name =
							(charId ? charNameById.get(charId) : undefined) ?? session?.characterName;
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

			// Query ALL new logEvents above HWM in one efficient query
			const newLogEvents = await db.logEvents.where("id").above(hwmRef.current).toArray();

			if (newLogEvents.length === 0) {
				// No new events -- check for stale active runs/engagements
				const now = Date.now();
				const staleSonar = [
					...checkStaleMining(activityRef.current, now),
					...checkStaleCombat(activityRef.current, now),
				];
				if (staleSonar.length > 0) {
					await db.sonarEvents.bulkAdd(staleSonar);
				}
				setLocalStatus("active");
				pingLocal();
				return;
			}

			// Partition by type
			const systemChanges: LogEvent[] = [];
			const miningEvents: LogEvent[] = [];
			const combatEvents: LogEvent[] = [];
			const alertEvents: LogEvent[] = [];
			for (const e of newLogEvents) {
				if (e.type === "system_change") systemChanges.push(e);
				else if (e.type === "mining") miningEvents.push(e);
				else if (COMBAT_TYPES.has(e.type)) combatEvents.push(e);
				else if (ALERT_TYPES.has(e.type)) alertEvents.push(e);
			}

			// Build session lookup
			const allSessionIds = Array.from(new Set(newLogEvents.map((e) => e.sessionId)));
			const sessions = await db.logSessions.bulkGet(allSessionIds);
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

			function resolveChar(sessionId: string) {
				const session = sessionMap.get(sessionId);
				const characterId =
					extractCharacterIdFromSession(sessionId) ?? session?.characterId;
				const characterName =
					(characterId ? charNameById.get(characterId) : undefined) ??
					session?.characterName;
				return { characterId, characterName };
			}

			const allSonarEvents: Omit<SonarEvent, "id">[] = [];

			// ── System change events (existing logic) ───────────────────────────
			for (const e of systemChanges) {
				const { characterId, characterName } = resolveChar(e.sessionId);
				allSonarEvents.push({
					timestamp: e.timestamp,
					source: "local",
					eventType: "system_change",
					characterName,
					characterId,
					systemName: e.systemName,
					details: e.systemName ? `Entered ${e.systemName}` : undefined,
					sessionId: e.sessionId,
				});
			}

			// ── Mining activity detection ───────────────────────────────────────
			const miningBySession = new Map<string, LogEvent[]>();
			for (const e of miningEvents) {
				const list = miningBySession.get(e.sessionId) ?? [];
				list.push(e);
				miningBySession.set(e.sessionId, list);
			}
			const activeMiningSessionsThisPoll = new Set<string>();
			for (const [sessionId, events] of miningBySession) {
				activeMiningSessionsThisPoll.add(sessionId);
				const { characterId, characterName } = resolveChar(sessionId);
				const existing = activityRef.current.mining.get(sessionId);
				const result = processMiningEvents(
					events,
					existing,
					sessionId,
					characterName,
					characterId,
				);
				if (result.tracker) {
					activityRef.current.mining.set(sessionId, result.tracker);
				}
				allSonarEvents.push(...result.sonarEvents);
			}

			// ── Combat activity detection ───────────────────────────────────────
			const combatBySession = new Map<string, LogEvent[]>();
			for (const e of combatEvents) {
				const list = combatBySession.get(e.sessionId) ?? [];
				list.push(e);
				combatBySession.set(e.sessionId, list);
			}
			const activeCombatSessionsThisPoll = new Set<string>();
			for (const [sessionId, events] of combatBySession) {
				activeCombatSessionsThisPoll.add(sessionId);
				const { characterId, characterName } = resolveChar(sessionId);
				const existing = activityRef.current.combat.get(sessionId);
				const result = processCombatEvents(
					events,
					existing,
					sessionId,
					characterName,
					characterId,
				);
				if (result.tracker) {
					activityRef.current.combat.set(sessionId, result.tracker);
				}
				allSonarEvents.push(...result.sonarEvents);
			}

			// ── Alert events (asteroid depleted, cargo full) ───────────────────
			for (const e of alertEvents) {
				const { characterId, characterName } = resolveChar(e.sessionId);
				allSonarEvents.push({
					timestamp: e.timestamp,
					source: "local",
					eventType: e.type as "asteroid_depleted" | "cargo_full",
					characterName,
					characterId,
					sessionId: e.sessionId,
					details: e.message,
				});
			}

			// ── Stale checks for sessions with no new events this poll ──────────
			const now = Date.now();
			for (const [sessionId, t] of activityRef.current.mining) {
				if (!t.active || activeMiningSessionsThisPoll.has(sessionId)) continue;
				if (now - tsMs(t.lastEventTimestamp) > MINING_GAP_MS) {
					const duration = tsMs(t.lastEventTimestamp) - tsMs(t.startTimestamp);
					allSonarEvents.push({
						timestamp: t.lastEventTimestamp,
						source: "local",
						eventType: "mining_ended",
						characterName: t.characterName,
						characterId: t.characterId,
						sessionId,
						typeName: t.ore,
						quantity: t.totalAmount,
						details: `Mined ${t.totalAmount.toLocaleString("en-US")} ${t.ore} in ${t.cycles} cycles (${formatDuration(duration)})`,
					});
					t.active = false;
				}
			}
			for (const [sessionId, t] of activityRef.current.combat) {
				if (!t.active || activeCombatSessionsThisPoll.has(sessionId)) continue;
				if (now - tsMs(t.lastEventTimestamp) > COMBAT_GAP_MS) {
					const targetList = Array.from(t.targets);
					allSonarEvents.push({
						timestamp: t.lastEventTimestamp,
						source: "local",
						eventType: "combat_ended",
						characterName: t.characterName,
						characterId: t.characterId,
						sessionId,
						typeName: targetList[0],
						quantity: t.totalDamageDealt,
						details: combatEndedDetails(t),
					});
					t.active = false;
				}
			}

			// ── Persist sonar events ────────────────────────────────────────────
			if (allSonarEvents.length > 0) {
				await db.sonarEvents.bulkAdd(allSonarEvents);
			}

			// Update HWM to max logEvent id in this batch.
			// Persisted in settings table to avoid sonarStore put() conflicts.
			const maxLogId = Math.max(...newLogEvents.map((e) => e.id ?? 0));
			hwmRef.current = maxLogId;
			await db.settings.put({ key: "localSonarHWM", value: maxLogId });

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
		} finally {
			pollRunning = false;
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

		// Singleton guard -- only one poller instance across mounts
		if (activePoller && !isPollerRef.current) return;
		if (!isPollerRef.current) {
			activePoller = true;
			isPollerRef.current = true;
		}

		poll().catch((e) => console.error("[LocalSonar] Failed to persist error:", e));
		intervalRef.current = setInterval(poll, POLL_INTERVAL);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			if (isPollerRef.current) {
				activePoller = false;
				isPollerRef.current = false;
			}
		};
	}, [localEnabled, poll, setLocalStatus]);
}
