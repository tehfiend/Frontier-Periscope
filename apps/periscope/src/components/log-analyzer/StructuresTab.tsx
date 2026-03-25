import { LogEventRow } from "@/components/LogEventRow";
import { db } from "@/db";
import { useCharacterSessionIds } from "@/hooks/useCharacterSessionIds";
import { useLogStore } from "@/stores/logStore";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";

// ── Component ───────────────────────────────────────────────────────────────

const STRUCTURE_TYPES = ["structure_departed", "gate_offline", "build_fail", "dismantle"] as const;

export function StructuresTab() {
	const { activeSessionId } = useLogStore();
	const characterSessionIds = useCharacterSessionIds();
	const [typeFilter, setTypeFilter] = useState<string>("all");

	// All structure events for current session
	const sessionEvents = useLiveQuery(
		() =>
			activeSessionId
				? Promise.all(
						STRUCTURE_TYPES.map((t) =>
							db.logEvents.where("[sessionId+type]").equals([activeSessionId, t]).toArray(),
						),
					).then((arrays) => arrays.flat())
				: [],
		[activeSessionId],
	);

	// All structure events -- filtered by character when a character filter is active
	const allEvents = useLiveQuery(
		() =>
			Promise.all(
				STRUCTURE_TYPES.map((t) =>
					db.logEvents
						.where("type")
						.equals(t)
						.filter((e) => !characterSessionIds || characterSessionIds.has(e.sessionId))
						.toArray(),
				),
			).then((arrays) => arrays.flat()),
		[characterSessionIds],
	);

	// Filter session-scoped data when active session doesn't belong to selected character
	const sessionBelongsToChar =
		!characterSessionIds || !activeSessionId || characterSessionIds.has(activeSessionId);
	const current = sessionBelongsToChar ? (sessionEvents ?? []) : [];
	const all = allEvents ?? [];

	// Sort all events by timestamp descending
	const sortedAll = [...all].sort(
		(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
	);

	// Apply type filter
	const filtered =
		typeFilter === "all" ? sortedAll : sortedAll.filter((e) => e.type === typeFilter);

	// Summary counts (current session)
	const departed = current.filter((e) => e.type === "structure_departed");
	const gateOffline = current.filter((e) => e.type === "gate_offline");
	const buildFails = current.filter((e) => e.type === "build_fail");
	const dismantles = current.filter((e) => e.type === "dismantle");

	// Departures breakdown: group by structure name
	const departuresByType = new Map<string, { count: number; systems: Set<string> }>();
	for (const e of departed) {
		const name = e.structureName ?? "Unknown";
		const entry = departuresByType.get(name) ?? { count: 0, systems: new Set() };
		entry.count++;
		if (e.systemName) entry.systems.add(e.systemName);
		departuresByType.set(name, entry);
	}

	if (all.length === 0) {
		return (
			<div className="space-y-4">
				<p className="py-8 text-center text-sm text-zinc-600">No structure events yet.</p>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
					<p className="font-medium text-zinc-400">What gets tracked:</p>
					<ul className="mt-1 list-inside list-disc space-y-1">
						<li>
							<span className="text-orange-400">Structure Departed</span> — when a structure is
							picked up / dismantled from a system
						</li>
						<li>
							<span className="text-rose-400">Gate Offline</span> — smart gate Traffic Control
							offline messages
						</li>
						<li>
							<span className="text-red-500">Build Fail</span> — insufficient resources, wrong
							location, assembly offline
						</li>
						<li>
							<span className="text-orange-300">Dismantle</span> — dismantle confirmation prompts
						</li>
					</ul>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Summary cards */}
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Departed (Session)</p>
					<p className="text-xl font-bold text-orange-400">{departed.length}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Gates Offline (Session)</p>
					<p className="text-xl font-bold text-rose-400">{gateOffline.length}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Build Failures (Session)</p>
					<p className="text-xl font-bold text-red-500">{buildFails.length}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Dismantles (Session)</p>
					<p className="text-xl font-bold text-orange-300">{dismantles.length}</p>
				</div>
			</div>

			{/* Departures breakdown */}
			{departuresByType.size > 0 && (
				<div>
					<h3 className="mb-2 text-sm font-medium text-zinc-400">Structures Departed (Session)</h3>
					<div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-zinc-800 text-xs text-zinc-500">
									<th className="px-3 py-2 text-left">Structure</th>
									<th className="px-3 py-2 text-right">Count</th>
									<th className="px-3 py-2 text-left">Systems</th>
								</tr>
							</thead>
							<tbody>
								{[...departuresByType.entries()]
									.sort((a, b) => b[1].count - a[1].count)
									.map(([name, data]) => (
										<tr key={name} className="border-b border-zinc-800/50">
											<td className="px-3 py-2 font-medium text-orange-300">{name}</td>
											<td className="px-3 py-2 text-right font-mono text-zinc-400">{data.count}</td>
											<td className="px-3 py-2">
												<div className="flex flex-wrap gap-1">
													{[...data.systems].map((sys) => (
														<span
															key={sys}
															className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-indigo-300"
														>
															{sys}
														</span>
													))}
												</div>
											</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Event log */}
			<div>
				<div className="mb-2 flex items-center justify-between">
					<h3 className="text-sm font-medium text-zinc-400">
						All Structure Events ({filtered.length})
					</h3>
					<select
						value={typeFilter}
						onChange={(e) => setTypeFilter(e.target.value)}
						className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
					>
						<option value="all">All Types</option>
						<option value="structure_departed">Departed</option>
						<option value="gate_offline">Gate Offline</option>
						<option value="build_fail">Build Fail</option>
						<option value="dismantle">Dismantle</option>
					</select>
				</div>
				<div className="max-h-[500px] space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
					{filtered.length === 0 && (
						<p className="py-4 text-center text-sm text-zinc-600">No events match the filter.</p>
					)}
					{filtered.slice(0, 500).map((e) => (
						<LogEventRow key={e.id} event={e} />
					))}
				</div>
			</div>
		</div>
	);
}
