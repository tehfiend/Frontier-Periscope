import { db } from "@/db";
import type { LogEvent } from "@/db/types";
import { useCharacterSessionIds } from "@/hooks/useCharacterSessionIds";
import { fmtTime, formatDuration } from "@/lib/format";
import { useLogStore } from "@/stores/logStore";
import { useLiveQuery } from "dexie-react-hooks";

// ── Helpers ─────────────────────────────────────────────────────────────────

interface MiningRun {
	ore: string;
	total: number;
	cycles: number;
	startTime: string;
	endTime: string;
	durationMs: number;
	ratePerMin: number;
	cargoFull: boolean;
}

function computeMiningRuns(events: LogEvent[]): MiningRun[] {
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

		if (gap > 30_000) {
			const runEvents = sorted.slice(runStart, i);
			const total = runEvents.reduce((s, e) => s + (e.amount ?? 0), 0);
			const startTime = runEvents[0].timestamp;
			const endTime = runEvents[runEvents.length - 1].timestamp;
			const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
			const durationMin = Math.max(durationMs / 60_000, 1 / 60);

			const lastAmount = runEvents[runEvents.length - 1].amount ?? 0;
			const avgAmount = total / runEvents.length;
			const cargoFull = lastAmount < avgAmount * 0.5 && runEvents.length > 2;

			runs.push({
				ore: runEvents[0].ore ?? "Unknown",
				total,
				cycles: runEvents.length,
				startTime,
				endTime,
				durationMs,
				ratePerMin: total / durationMin,
				cargoFull,
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
	const runs = computeMiningRuns(miningEvents);

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
								{run.cargoFull && <span className="text-orange-500">Full</span>}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
