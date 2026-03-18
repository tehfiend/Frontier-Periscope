import { useEffect, useRef, useCallback } from "react";
import { db } from "@/db";
import { useLogStore } from "@/stores/logStore";
import {
	parseHeader,
	parseEntries,
	parseLogFilename,
	parseChatEntries,
	parseChatLogFilename,
	decodeChatLog,
} from "@/lib/logParser";
import { getStoredHandle, verifyPermission } from "@/lib/logFileAccess";
import type { LogEvent } from "@/db/types";

const POLL_INTERVAL = 5000;

/** Module-level singleton — ensures only one poller runs even if hook is mounted multiple times */
let activePollerCount = 0;

export function useLogWatcher() {
	const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const isPollerRef = useRef(false);
	const {
		setHasAccess,
		setIsWatching,
		setActiveSessionId,
		setLiveStats,
	} = useLogStore();

	const stopWatching = useCallback(() => {
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
		setIsWatching(false);
	}, [setIsWatching]);

	const computeLiveStats = useCallback(
		async (sessionId: string) => {
			const now = Date.now();
			const miningWindowMs = 60_000;
			const combatWindowMs = 30_000;
			const miningCutoff = new Date(now - miningWindowMs).toISOString();
			const combatCutoff = new Date(now - combatWindowMs).toISOString();

			const recentMining = await db.logEvents
				.where("[sessionId+type]")
				.equals([sessionId, "mining"])
				.filter((e) => e.timestamp >= miningCutoff)
				.toArray();

			const totalOre = recentMining.reduce((sum, e) => sum + (e.amount ?? 0), 0);
			const miningRate = recentMining.length > 0 ? (totalOre / miningWindowMs) * 60_000 : 0;
			const miningOre =
				recentMining.length > 0 ? (recentMining[recentMining.length - 1].ore ?? null) : null;

			const recentDealt = await db.logEvents
				.where("[sessionId+type]")
				.equals([sessionId, "combat_dealt"])
				.filter((e) => e.timestamp >= combatCutoff)
				.toArray();
			const totalDealt = recentDealt.reduce((sum, e) => sum + (e.damage ?? 0), 0);
			const dpsDealt = recentDealt.length > 0 ? totalDealt / (combatWindowMs / 1000) : 0;

			const recentRecv = await db.logEvents
				.where("[sessionId+type]")
				.equals([sessionId, "combat_received"])
				.filter((e) => e.timestamp >= combatCutoff)
				.toArray();
			const totalRecv = recentRecv.reduce((sum, e) => sum + (e.damage ?? 0), 0);
			const dpsReceived = recentRecv.length > 0 ? totalRecv / (combatWindowMs / 1000) : 0;

			setLiveStats({ miningRate, miningOre, dpsDealt, dpsReceived });
		},
		[setLiveStats],
	);

	// Resolve gamelogs/chatlogs subdirectory handles.
	// Supports both: user selects `logs/` parent (has Gamelogs/ subdir)
	// or user selects `Gamelogs/` directly (backward compat).
	async function resolveSubdirs(handle: FileSystemDirectoryHandle): Promise<{
		gamelogs: FileSystemDirectoryHandle;
		chatlogs: FileSystemDirectoryHandle | null;
	}> {
		try {
			const gamelogs = await handle.getDirectoryHandle("Gamelogs");
			let chatlogs: FileSystemDirectoryHandle | null = null;
			try {
				chatlogs = await handle.getDirectoryHandle("Chatlogs");
			} catch {
				// No Chatlogs subdir
			}
			return { gamelogs, chatlogs };
		} catch {
			// No Gamelogs subdir — user pointed directly at Gamelogs
			return { gamelogs: handle, chatlogs: null };
		}
	}

	// Find ALL files in a directory matching a filter
	async function findActiveFiles(
		dir: FileSystemDirectoryHandle,
		filter: (name: string) => boolean,
	): Promise<Array<{ name: string; handle: FileSystemFileHandle }>> {
		const results: Array<{ name: string; handle: FileSystemFileHandle }> = [];

		for await (const [name, entry] of dir.entries()) {
			if (entry.kind !== "file" || !name.endsWith(".txt")) continue;
			if (!filter(name)) continue;
			results.push({ name, handle: entry as FileSystemFileHandle });
		}

		return results;
	}

	// Update activity for known characters, but do NOT auto-register new ones.
	// Characters are added manually via the Add Character dialog.
	async function ensureCharacter(characterName: string, characterId?: string) {
		if (!characterId) return;

		const existing = await db.characters.get(characterId);
		if (!existing) return; // Not registered — user must add manually

		const now = new Date().toISOString();
		await db.characters.update(characterId, {
			isActive: true,
			lastSeenAt: now,
			updatedAt: now,
		});
	}

	// Process new bytes from a game log file
	async function processGameLog(
		fileName: string,
		fileHandle: FileSystemFileHandle,
	): Promise<{ sessionId: string; newEvents: number } | null> {
		const sessionId = fileName.replace(".txt", "");
		const file = await fileHandle.getFile();
		const offset = await db.logOffsets.get(fileName);
		const lastOffset = offset?.byteOffset ?? 0;

		if (file.size <= lastOffset) return null;

		const blob = file.slice(lastOffset);
		const text = await blob.text();

		if (lastOffset === 0) {
			const header = parseHeader(text);
			if (header) {
				const parsed = parseLogFilename(fileName);
				await db.logSessions.put({
					id: sessionId,
					characterName: header.characterName,
					characterId: parsed?.characterId,
					startedAt: header.sessionStarted,
					fileSize: file.size,
					eventCount: 0,
				});

				// Auto-register character
				await ensureCharacter(header.characterName, parsed?.characterId);
			}
		}

		const events = parseEntries(text);
		if (events.length > 0) {
			const logEvents: LogEvent[] = events.map((e) => ({
				sessionId,
				timestamp: e.timestamp,
				type: e.type,
				ore: "ore" in e ? e.ore : undefined,
				amount: "amount" in e ? e.amount : undefined,
				target: "target" in e ? e.target : undefined,
				damage: "damage" in e ? e.damage : undefined,
				weapon: "weapon" in e ? e.weapon : undefined,
				hitQuality: "hitQuality" in e ? e.hitQuality : undefined,
				message: "message" in e ? e.message : undefined,
				systemName: "systemName" in e ? e.systemName : undefined,
				structureName: "structureName" in e ? e.structureName : undefined,
				raw: e.raw,
			}));
			await db.logEvents.bulkAdd(logEvents);

			const totalCount = await db.logEvents.where("sessionId").equals(sessionId).count();
			await db.logSessions.update(sessionId, {
				eventCount: totalCount,
				fileSize: file.size,
			});
		}

		await db.logOffsets.put({
			fileName,
			byteOffset: file.size,
			lastModified: file.lastModified,
		});

		return { sessionId, newEvents: events.length };
	}

	// Process new bytes from a chat log file (UTF-16LE)
	async function processChatLog(
		fileName: string,
		fileHandle: FileSystemFileHandle,
		gameSessionId: string,
		channel: string,
	): Promise<number> {
		const file = await fileHandle.getFile();
		const offsetKey = `chat:${fileName}`;
		const offset = await db.logOffsets.get(offsetKey);
		const lastOffset = offset?.byteOffset ?? 0;

		if (file.size <= lastOffset) return 0;

		const blob = file.slice(lastOffset);
		const buffer = await blob.arrayBuffer();
		const text = decodeChatLog(buffer);

		const events = parseChatEntries(text, channel);
		if (events.length > 0) {
			const logEvents: LogEvent[] = events.map((e) => ({
				sessionId: gameSessionId,
				timestamp: e.timestamp,
				type: e.type,
				systemName: "systemName" in e ? e.systemName : undefined,
				speaker: "speaker" in e ? e.speaker : undefined,
				channel: "channel" in e ? e.channel : undefined,
				message: "message" in e ? e.message : undefined,
				raw: e.raw,
			}));
			await db.logEvents.bulkAdd(logEvents);
		}

		await db.logOffsets.put({
			fileName: offsetKey,
			byteOffset: file.size,
			lastModified: file.lastModified,
		});

		return events.length;
	}

	const pollLogs = useCallback(async () => {
		const handle = dirHandleRef.current;
		if (!handle) return;

		try {
			const { gamelogs, chatlogs } = await resolveSubdirs(handle);

			// Find ALL game log files with valid character IDs (Cycle 5+ only)
			const gameFiles = await findActiveFiles(gamelogs, (name) => {
				const parsed = parseLogFilename(name);
				if (!parsed?.characterId) return false;
				if (parsed.date < "20260311") return false;
				return true;
			});

			let latestSessionId: string | null = null;
			let latestTimestamp = "";
			let hadNewEvents = false;

			// Process each game log file
			for (const gameFile of gameFiles) {
				const sessionId = gameFile.name.replace(".txt", "");

				// If offsets exist but no events in DB, reset offset to reprocess
				const existingOffset = await db.logOffsets.get(gameFile.name);
				if (existingOffset && existingOffset.byteOffset > 0) {
					const eventCount = await db.logEvents
						.where("sessionId")
						.equals(sessionId)
						.count();
					if (eventCount === 0) {
						await db.logOffsets.delete(gameFile.name);
					}
				}

				const result = await processGameLog(gameFile.name, gameFile.handle);

				// Track the most recently modified file for live stats
				if (gameFile.name > latestTimestamp) {
					latestTimestamp = gameFile.name;
					latestSessionId = sessionId;
				}

				if (result && result.newEvents > 0) {
					hadNewEvents = true;
				}
			}

			// Set the most recent session as active (for Live tab)
			if (latestSessionId) {
				setActiveSessionId(latestSessionId);
			}

			// Poll all chat log files
			if (chatlogs && latestSessionId) {
				for await (const [name, entry] of chatlogs.entries()) {
					if (entry.kind !== "file" || !name.endsWith(".txt")) continue;
					const parsed = parseChatLogFilename(name);
					if (!parsed) continue;
					// Only process Cycle 5+ chat logs (started 2026-03-11)
					if (parsed.date < "20260311") continue;

					// Find the game session for this character's chat
					const matchingGameFile = gameFiles.find((gf) => {
						const gp = parseLogFilename(gf.name);
						return gp?.characterId === parsed.characterId;
					});
					const sessionId = matchingGameFile
						? matchingGameFile.name.replace(".txt", "")
						: latestSessionId;

					await processChatLog(
						name,
						entry as FileSystemFileHandle,
						sessionId,
						parsed.channel,
					);
				}
			}

			if (hadNewEvents && latestSessionId) {
				computeLiveStats(latestSessionId);
			}
		} catch (err) {
			console.error("[LogWatcher] Poll error:", err);
		}
	}, [setActiveSessionId, computeLiveStats]);

	const startWatching = useCallback(() => {
		if (intervalRef.current) return;
		// Only one instance should poll at a time
		if (activePollerCount > 0 && !isPollerRef.current) return;
		activePollerCount++;
		isPollerRef.current = true;
		setIsWatching(true);
		pollLogs();
		intervalRef.current = setInterval(pollLogs, POLL_INTERVAL);
	}, [setIsWatching, pollLogs]);

	useEffect(() => {
		(async () => {
			const handle = await getStoredHandle();
			if (handle && (await verifyPermission(handle))) {
				dirHandleRef.current = handle;
				setHasAccess(true);
				startWatching();
			}
		})();
		return () => {
			stopWatching();
			if (isPollerRef.current) {
				activePollerCount--;
				isPollerRef.current = false;
			}
		};
	}, [setHasAccess, startWatching, stopWatching]);

	const grantAccess = useCallback(
		async (handle: FileSystemDirectoryHandle) => {
			dirHandleRef.current = handle;
			setHasAccess(true);
			startWatching();
		},
		[setHasAccess, startWatching],
	);

	const clearAndReimport = useCallback(async () => {
		stopWatching();
		await db.logEvents.clear();
		await db.logSessions.clear();
		await db.logOffsets.clear();
		setActiveSessionId(null);
		setLiveStats({ miningRate: 0, miningOre: null, dpsDealt: 0, dpsReceived: 0 });
		startWatching();
	}, [stopWatching, startWatching, setActiveSessionId, setLiveStats]);

	// Register callbacks on the store so other components (e.g. Logs view) can use them
	// without needing to call this hook themselves
	useEffect(() => {
		useLogStore.getState().setGrantAccess(grantAccess);
		useLogStore.getState().setClearAndReimport(clearAndReimport);
		return () => {
			useLogStore.getState().setGrantAccess(null);
			useLogStore.getState().setClearAndReimport(null);
		};
	}, [grantAccess, clearAndReimport]);
}
