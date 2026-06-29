import { db } from "@/db";
import type { LogEvent } from "@/db/types";
import { useCharacterSessionIds } from "@/hooks/useCharacterSessionIds";
import { fmtTime, formatDuration } from "@/lib/format";
import { useLogStore } from "@/stores/logStore";
import { useLiveQuery } from "dexie-react-hooks";

// ── Helpers ─────────────────────────────────────────────────────────────────

const MINING_GAP_MS = 30_000;

/** Why a mining run ended, reconciled against real log events (matches useLocalSonar). */
type MiningEndReason = "full" | "depleted" | "range";

const MINING_REASON_FROM_TYPE: Record<string, MiningEndReason> = {
	cargo_full: "full",
	asteroid_depleted: "depleted",
	mining_interrupted: "range",
};

const MINING_REASON_BADGE: Record<MiningEndReason, { label: string; className: string }> = {
	full: { label: "Cargo Full", className: "text-orange-500" },
	depleted: { label: "Depleted", className: "text-amber-500" },
	range: { label: "Out of Range", className: "text-zinc-400" },
};

interface MiningRun {
	ore: string;
	total: number;
	cycles: number;
	startTime: string;
	endTime: string;
	durationMs: number;
	ratePerMin: number;
	reason?: MiningEndReason;
}

/** Find the reason event nearest a run's end, within +/- the gap window. Mirrors
 * useLocalSonar.consumeMiningReason (same window, nearest-wins) so the tab and the sonar feed
 * resolve the same reason instead of the tab also claiming mid-run events. */
function findRunEndReason(reasonEvents: LogEvent[], endTime: string): MiningEndReason | undefined {
	const endMs = new Date(endTime).getTime();
	let best: { dist: number; reason: MiningEndReason } | undefined;
	for (const e of reasonEvents) {
		const reason = MINING_REASON_FROM_TYPE[e.type];
		if (!reason) continue;
		const dist = Math.abs(new Date(e.timestamp).getTime() - endMs);
		if (dist <= MINING_GAP_MS && (!best || dist < best.dist)) {
			best = { dist, reason };
		}
	}
	return best?.reason;
}

function computeMiningRuns(events: LogEvent[], reasonEvents: LogEvent[]): MiningRun[] {
	if (events.length === 0) return [];

	const sorted = [...events].sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	const runs: MiningRun[] = [];
	let runStart = 0;

	for (let i = 1; i <= sorted.length; i++) {
		const gap =
			i < sorted.length
				? new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime()
				: Number.POSITIVE_INFINITY;

		if (gap > MINING_GAP_MS) {
			const runEvents = sorted.slice(runStart, i);
			const total = runEvents.reduce((s, e) => s + (e.amount ?? 0), 0);
			const startTime = runEvents[0].timestamp;
			const endTime = runEvents[runEvents.length - 1].timestamp;
			const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
			const durationMin = Math.max(durationMs / 60_000, 1 / 60);

			runs.push({
				ore: runEvents[0].ore ?? "Unknown",
				total,
				cycles: runEvents.length,
				startTime,
				endTime,
				durationMs,
				ratePerMin: total / durationMin,
				reason: findRunEndReason(reasonEvents, endTime),
			});
			runStart = i;
		}
	}

	return runs;
}

// ── Component ───────────────────────────────────────────────────────────────

export function MiningTab() {
	const { activeSessionId } = useLogStore();
	const characterSessionIds = useCharacterSessionIds();

	const miningEvents = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents.where("[sessionId+type]").equals([activeSessionId, "mining"]).toArray()
				: [],
		[activeSessionId],
	);

	// Run-end reason events (cargo full / asteroid depleted / out of range), reconciled against
	// each run's end instead of the old "last cycle was small" heuristic.
	const reasonEvents = useLiveQuery(async () => {
		if (!activeSessionId) return [];
		const [full, depleted, interrupted] = await Promise.all([
			db.logEvents.where("[sessionId+type]").equals([activeSessionId, "cargo_full"]).toArray(),
			db.logEvents
				.where("[sessionId+type]")
				.equals([activeSessionId, "asteroid_depleted"])
				.toArray(),
			db.logEvents
				.where("[sessionId+type]")
				.equals([activeSessionId, "mining_interrupted"])
				.toArray(),
		]);
		return [...full, ...depleted, ...interrupted];
	}, [activeSessionId]);

	// Filter out if active session doesn't belong to selected character
	if (characterSessionIds && activeSessionId && !characterSessionIds.has(activeSessionId)) {
		return (
			<p className="py-8 text-center text-sm text-zinc-600">
				No mining data for the selected character. Switch to the character currently playing or
				select "All Characters."
			</p>
		);
	}

	if (!miningEvents || miningEvents.length === 0) {
		return (
			<p className="py-8 text-center text-sm text-zinc-600">No mining data for this session yet.</p>
		);
	}

	// Aggregate by ore type
	const oreStats = new Map<string, { total: number; count: number; first: string; last: string }>();
	for (const e of miningEvents) {
		const ore = e.ore ?? "Unknown";
		const existing = oreStats.get(ore) ?? {
			total: 0,
			count: 0,
			first: e.timestamp,
			last: e.timestamp,
		};
		existing.total += e.amount ?? 0;
		existing.count++;
		if (e.timestamp < existing.first) existing.first = e.timestamp;
		if (e.timestamp > existing.last) existing.last = e.timestamp;
		oreStats.set(ore, existing);
	}

	const totalMined = miningEvents.reduce((sum, e) => sum + (e.amount ?? 0), 0);
	const runs = computeMiningRuns(miningEvents, reasonEvents ?? []);

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Total Mined</p>
					<p className="text-xl font-bold text-amber-400">{totalMined.toLocaleString()}</p>
					<p className="text-xs text-zinc-600">{miningEvents.length} cycles</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Ore Types</p>
					<p className="text-xl font-bold text-zinc-200">{oreStats.size}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Mining Runs</p>
					<p className="text-xl font-bold text-zinc-200">{runs.length}</p>
				</div>
			</div>

			{/* Ore breakdown table */}
			<div>
				<h3 className="mb-2 text-sm font-medium text-zinc-400">Ore Breakdown</h3>
				<div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-zinc-800 text-xs text-zinc-500">
								<th className="px-3 py-2 text-left">Ore</th>
								<th className="px-3 py-2 text-right">Total</th>
								<th className="px-3 py-2 text-right">Cycles</th>
								<th className="px-3 py-2 text-right">Avg/Cycle</th>
								<th className="px-3 py-2 text-right">Rate/min</th>
							</tr>
						</thead>
						<tbody>
							{[...oreStats.entries()].map(([ore, stats]) => {
								const durationMs = new Date(stats.last).getTime() - new Date(stats.first).getTime();
								const durationMin = Math.max(durationMs / 60_000, 1 / 60);
								const ratePerMin = stats.total / durationMin;
								return (
									<tr key={ore} className="border-b border-zinc-800/50">
										<td className="px-3 py-2 text-zinc-200">{ore}</td>
										<td className="px-3 py-2 text-right font-mono text-amber-400">
											{stats.total.toLocaleString()}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">{stats.count}</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{(stats.total / stats.count).toFixed(1)}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{Math.round(ratePerMin)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>

			{/* Mining runs */}
			<div>
				<h3 className="mb-2 text-sm font-medium text-zinc-400">Mining Runs</h3>
				<div className="space-y-1.5">
					{runs.map((run, i) => (
						<div
							key={run.startTime}
							className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-sm"
						>
							<div className="flex items-center gap-2">
								<span className="text-xs text-zinc-600">#{i + 1}</span>
								<span className="text-zinc-300">{run.ore}</span>
								<span className="text-xs text-zinc-600">
									{fmtTime(run.startTime)} – {fmtTime(run.endTime)}
								</span>
							</div>
							<div className="flex items-center gap-4 text-xs text-zinc-500">
								<span>
									{run.total.toLocaleString()} ore / {run.cycles} cycles
								</span>
								<span>{formatDuration(run.durationMs)}</span>
								<span className="text-amber-400/70">{Math.round(run.ratePerMin)}/min</span>
								{run.reason && (
									<span className={MINING_REASON_BADGE[run.reason].className}>
										{MINING_REASON_BADGE[run.reason].label}
									</span>
								)}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
