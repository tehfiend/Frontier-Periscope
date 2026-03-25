import { db } from "@/db";
import type { LogEvent } from "@/db/types";
import { useCharacterSessionIds } from "@/hooks/useCharacterSessionIds";
import { fmtDateTime, formatDuration } from "@/lib/format";
import { useLogStore } from "@/stores/logStore";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight } from "lucide-react";

// ── Helpers ─────────────────────────────────────────────────────────────────

interface DwellTime {
	system: string;
	visits: number;
	totalMs: number;
}

function computeDwellTimes(events: LogEvent[]): DwellTime[] {
	if (events.length === 0) return [];

	const stats = new Map<string, { visits: number; totalMs: number }>();

	for (let i = 0; i < events.length; i++) {
		const system = events[i].systemName ?? "Unknown";
		const entry = stats.get(system) ?? { visits: 0, totalMs: 0 };
		entry.visits++;

		// Dwell time = time until next jump (or 0 for last entry)
		if (i < events.length - 1) {
			const dwellMs =
				new Date(events[i + 1].timestamp).getTime() - new Date(events[i].timestamp).getTime();
			entry.totalMs += dwellMs;
		}

		stats.set(system, entry);
	}

	return [...stats.entries()]
		.map(([system, s]) => ({ system, ...s }))
		.sort((a, b) => b.totalMs - a.totalMs);
}

// ── Component ───────────────────────────────────────────────────────────────

export function TravelTab() {
	const { activeSessionId } = useLogStore();
	const characterSessionIds = useCharacterSessionIds();

	const systemChanges = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents
						.where("[sessionId+type]")
						.equals([activeSessionId, "system_change"])
						.sortBy("timestamp")
				: [],
		[activeSessionId],
	);

	// All system changes -- filtered by character when a character filter is active
	const allSystemChanges = useLiveQuery(
		() =>
			db.logEvents
				.where("type")
				.equals("system_change")
				.filter((e) => !characterSessionIds || characterSessionIds.has(e.sessionId))
				.sortBy("timestamp"),
		[characterSessionIds],
	);

	// Filter session-scoped data when active session doesn't belong to selected character
	const sessionBelongsToChar =
		!characterSessionIds || !activeSessionId || characterSessionIds.has(activeSessionId);
	const currentSession = sessionBelongsToChar ? (systemChanges ?? []) : [];
	const allHistory = allSystemChanges ?? [];

	// Compute per-system dwell times for current session
	const dwellTimes = computeDwellTimes(currentSession);

	// Unique systems visited this session
	const uniqueSystems = new Set(currentSession.map((e) => e.systemName));

	// Unique systems visited all-time
	const allUniqueSystems = new Set(allHistory.map((e) => e.systemName));

	if (allHistory.length === 0) {
		return (
			<div className="space-y-4">
				<p className="py-8 text-center text-sm text-zinc-600">
					No travel data yet. System changes are detected from Local chat logs.
				</p>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
					<p className="font-medium text-zinc-400">How travel tracking works:</p>
					<p className="mt-1">
						When the game client changes systems, the Local chat log records a{" "}
						<span className="font-mono text-zinc-300">
							Keeper &gt; Channel changed to Local : SystemCode
						</span>{" "}
						message. Make sure you selected the <span className="text-zinc-300">logs</span> parent
						folder (not just Gamelogs) so chat logs are accessible.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Summary cards */}
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Jumps (Session)</p>
					<p className="text-xl font-bold text-indigo-400">{currentSession.length}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Systems (Session)</p>
					<p className="text-xl font-bold text-zinc-200">{uniqueSystems.size}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Jumps (All Time)</p>
					<p className="text-xl font-bold text-indigo-400/60">{allHistory.length}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Systems (All Time)</p>
					<p className="text-xl font-bold text-zinc-400">{allUniqueSystems.size}</p>
				</div>
			</div>

			{/* Current session route */}
			{currentSession.length > 0 && (
				<div>
					<h3 className="mb-2 text-sm font-medium text-zinc-400">Session Route</h3>
					<div className="flex flex-wrap items-center gap-1">
						{currentSession.map((e, i) => (
							<div key={e.id} className="flex items-center gap-1">
								{i > 0 && <ChevronRight size={12} className="text-zinc-700" />}
								<span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-indigo-300">
									{e.systemName}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Dwell times */}
			{dwellTimes.length > 0 && (
				<div>
					<h3 className="mb-2 text-sm font-medium text-zinc-400">Time per System</h3>
					<div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-zinc-800 text-xs text-zinc-500">
									<th className="px-3 py-2 text-left">System</th>
									<th className="px-3 py-2 text-right">Visits</th>
									<th className="px-3 py-2 text-right">Total Time</th>
									<th className="px-3 py-2 text-right">Avg Stay</th>
								</tr>
							</thead>
							<tbody>
								{dwellTimes.map((d) => (
									<tr key={d.system} className="border-b border-zinc-800/50">
										<td className="px-3 py-2 font-mono text-indigo-300">{d.system}</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">{d.visits}</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{formatDuration(d.totalMs)}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{formatDuration(d.visits > 0 ? d.totalMs / d.visits : 0)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Jump timeline */}
			<div>
				<h3 className="mb-2 text-sm font-medium text-zinc-400">Jump Log ({allHistory.length})</h3>
				<div className="max-h-[400px] space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
					{[...allHistory].reverse().map((e) => (
						<div
							key={e.id}
							className="flex items-center gap-2 rounded px-2 py-0.5 text-xs hover:bg-zinc-800/50"
						>
							<span className="font-mono text-zinc-600">{fmtDateTime(e.timestamp)}</span>
							<span className="font-mono font-bold text-indigo-400">JUMP</span>
							<span className="font-mono text-zinc-300">{e.systemName}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
