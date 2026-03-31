import { db } from "@/db";
import type { LogEvent } from "@/db/types";
import { getStoredHandle, verifyPermission } from "@/lib/logFileAccess";
import {
	decodeChatLog,
	parseChatEntries,
	parseChatLogFilename,
	parseEntries,
	parseHeader,
	parseLogFilename,
} from "@/lib/logParser";
import { useLogStore } from "@/stores/logStore";
import { useCallback, useEffect, useRef } from "react";

const POLL_INTERVAL = 1000;

/** Module-level singleton — ensures only one poller runs even if hook is mounted multiple times */
let activePollerCount = 0;

/** Pending partial-line buffers keyed by fileName (game logs) or "chat:fileName" (chat logs) */
const pendingLines = new Map<string, string>();

/** Poll counter for periodic diagnostic summaries */
let pollCount = 0;

/** Consecutive poll error counter -- stop polling after too many failures */
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

export function useLogWatcher() {
	const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const isPollerRef = useRef(false);
	const { setHasAccess, setIsWatching, setActiveSessionId, setLiveStats } = useLogStore();

	const stopWatching = useCallback(() => {
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
		pendingLines.clear();
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

		// Truncation detection -- file was rotated or replaced
		if (file.size < lastOffset) {
			console.warn(`[LogWatcher] File truncated: ${fileName} (${lastOffset} -> ${file.size})`);
			await db.logOffsets.put({ fileName, byteOffset: 0, lastModified: file.lastModified });
			pendingLines.delete(fileName);
			return processGameLog(fileName, fileHandle);
		}
		if (file.size === lastOffset) return null;

		// Diagnostic: first open
		if (lastOffset === 0) {
			console.log(`[LogWatcher] Opened: ${fileName} (${file.size} bytes)`);
		}

		const blob = file.slice(lastOffset);
		const text = await blob.text();

		// Partial line buffering: prepend any leftover from previous poll
		const fullText = (pendingLines.get(fileName) ?? "") + text;
		const lastNewline = fullText.lastIndexOf("\n");

		if (lastNewline === -1) {
			// No complete line yet -- buffer everything
			pendingLines.set(fileName, fullText);
			return null;
		}

		const completedText = fullText.substring(0, lastNewline + 1);
		const remainder = fullText.substring(lastNewline + 1);

		if (remainder.length > 0) {
			pendingLines.set(fileName, remainder);
		} else {
			pendingLines.delete(fileName);
		}

		// Calculate how many bytes were actually consumed
		const bytesConsumed = new TextEncoder().encode(completedText).byteLength;
		const newOffset = lastOffset + bytesConsumed;

		if (lastOffset === 0) {
			const header = parseHeader(completedText);
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

		const events = parseEntries(completedText);
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

			console.log(
				`[LogWatcher] ${fileName}: +${events.length} events (${lastOffset} -> ${newOffset})`,
			);
		}

		await db.logOffsets.put({
			fileName,
			byteOffset: newOffset,
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

		// Truncation detection
		if (file.size < lastOffset) {
			console.warn(`[LogWatcher] Chat truncated: ${fileName}`);
			await db.logOffsets.put({
				fileName: offsetKey,
				byteOffset: 0,
				lastModified: file.lastModified,
			});
			pendingLines.delete(offsetKey);
			return processChatLog(fileName, fileHandle, gameSessionId, channel);
		}
		if (file.size === lastOffset) return 0;

		// Diagnostic: first open
		if (lastOffset === 0) {
			console.log(`[LogWatcher] Chat opened: ${fileName} (${file.size} bytes)`);
		}

		// UTF-16 byte alignment -- ensure even byte count
		let readEnd = file.size;
		const bytesToRead = readEnd - lastOffset;
		if (bytesToRead % 2 !== 0) {
			readEnd = lastOffset + bytesToRead - 1;
		}
		if (readEnd <= lastOffset) return 0;

		const blob = file.slice(lastOffset, readEnd);
		const buffer = await blob.arrayBuffer();

		// Scan raw ArrayBuffer for last newline (0x0A 0x00 in UTF-16LE)
		const bytes = new Uint8Array(buffer);
		let lastNewlineBytePos = -1;
		for (let i = bytes.length - 2; i >= 0; i -= 2) {
			if (bytes[i] === 0x0a && bytes[i + 1] === 0x00) {
				lastNewlineBytePos = i;
				break;
			}
		}

		if (lastNewlineBytePos === -1) {
			// No complete line in this chunk -- buffer as text and wait
			const text = decodeChatLog(buffer);
			const pending = pendingLines.get(offsetKey) ?? "";
			pendingLines.set(offsetKey, pending + text);
			return 0;
		}

		// Split buffer at the byte position after the last newline (include the \n)
		const completedBytes = lastNewlineBytePos + 2; // include the 0x0A 0x00
		const completedBuffer = buffer.slice(0, completedBytes);
		const remainderBuffer = buffer.slice(completedBytes);

		const completedText = (pendingLines.get(offsetKey) ?? "") + decodeChatLog(completedBuffer);

		if (remainderBuffer.byteLength > 0) {
			pendingLines.set(offsetKey, decodeChatLog(remainderBuffer));
		} else {
			pendingLines.delete(offsetKey);
		}

		const newOffset = lastOffset + completedBytes;

		const events = parseChatEntries(completedText, channel);
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
			byteOffset: newOffset,
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
					const eventCount = await db.logEvents.where("sessionId").equals(sessionId).count();
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
			let chatFileCount = 0;
			if (chatlogs && latestSessionId) {
				for await (const [name, entry] of chatlogs.entries()) {
					if (entry.kind !== "file" || !name.endsWith(".txt")) continue;
					const parsed = parseChatLogFilename(name);
					if (!parsed) continue;
					// Only process Cycle 5+ chat logs (started 2026-03-11)
					if (parsed.date < "20260311") continue;

					chatFileCount++;

					// Find the game session for this character's chat
					const matchingGameFile = gameFiles.find((gf) => {
						const gp = parseLogFilename(gf.name);
						return gp?.characterId === parsed.characterId;
					});
					const sessionId = matchingGameFile
						? matchingGameFile.name.replace(".txt", "")
						: latestSessionId;

					await processChatLog(name, entry as FileSystemFileHandle, sessionId, parsed.channel);
				}
			}

			// Reset error counter on successful poll
			consecutiveErrors = 0;

			if (hadNewEvents && latestSessionId) {
				computeLiveStats(latestSessionId);
			}

			// Periodic diagnostic summary every 30 polls
			pollCount++;
			if (pollCount % 30 === 0) {
				console.log(
					`[LogWatcher] Watching ${gameFiles.length} game logs, ${chatFileCount} chat logs`,
				);
			}
		} catch (err) {
			consecutiveErrors++;
			console.error(`[LogWatcher] Poll error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err);
			if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
				console.error("[LogWatcher] Too many consecutive errors, stopping poller");
				stopWatching();
			}
		}
	}, [setActiveSessionId, computeLiveStats, stopWatching]);

	const startWatching = useCallback(() => {
		if (intervalRef.current) return;
		// Only one instance should poll at a time
		if (activePollerCount > 0 && !isPollerRef.current) return;
		activePollerCount++;
		isPollerRef.current = true;
		consecutiveErrors = 0;
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
		pendingLines.clear();
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
