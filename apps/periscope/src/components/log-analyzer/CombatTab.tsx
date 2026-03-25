import { db } from "@/db";
import type { LogEvent } from "@/db/types";
import { useCharacterSessionIds } from "@/hooks/useCharacterSessionIds";
import { fmtTime, formatDuration } from "@/lib/format";
import { useLogStore } from "@/stores/logStore";
import { useLiveQuery } from "dexie-react-hooks";

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Encounter {
	targets: string[];
	weapons: string[];
	startTime: string;
	endTime: string;
	durationMs: number;
	damageDealt: number;
	damageRecv: number;
	hitsDealt: number;
	hitsRecv: number;
	missesDealt: number;
	missesRecv: number;
}

function computeEncounters(
	combatDealt: LogEvent[],
	combatRecv: LogEvent[],
	missesDealt: LogEvent[],
	missesRecv: LogEvent[],
): Encounter[] {
	// Merge all combat events and sort by timestamp
	const all = [
		...combatDealt.map((e) => ({ ...e, _kind: "dealt" as const })),
		...combatRecv.map((e) => ({ ...e, _kind: "recv" as const })),
		...missesDealt.map((e) => ({ ...e, _kind: "miss_d" as const })),
		...missesRecv.map((e) => ({ ...e, _kind: "miss_r" as const })),
	].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

	if (all.length === 0) return [];

	const encounters: Encounter[] = [];
	let groupStart = 0;

	for (let i = 1; i <= all.length; i++) {
		const gap =
			i < all.length
				? new Date(all[i].timestamp).getTime() - new Date(all[i - 1].timestamp).getTime()
				: Number.POSITIVE_INFINITY;

		// 60s gap = new encounter
		if (gap > 60_000) {
			const group = all.slice(groupStart, i);
			const targets = new Set<string>();
			const weapons = new Set<string>();
			let damageDealt = 0;
			let damageRecv = 0;
			let hitsDealt = 0;
			let hitsRecv = 0;
			let mDealt = 0;
			let mRecv = 0;

			for (const e of group) {
				if (e.target) targets.add(e.target);
				if (e.weapon) weapons.add(e.weapon);
				switch (e._kind) {
					case "dealt":
						damageDealt += e.damage ?? 0;
						hitsDealt++;
						break;
					case "recv":
						damageRecv += e.damage ?? 0;
						hitsRecv++;
						break;
					case "miss_d":
						mDealt++;
						break;
					case "miss_r":
						mRecv++;
						break;
				}
			}

			const startTime = group[0].timestamp;
			const endTime = group[group.length - 1].timestamp;

			encounters.push({
				targets: [...targets],
				weapons: [...weapons],
				startTime,
				endTime,
				durationMs: new Date(endTime).getTime() - new Date(startTime).getTime(),
				damageDealt,
				damageRecv,
				hitsDealt,
				hitsRecv,
				missesDealt: mDealt,
				missesRecv: mRecv,
			});
			groupStart = i;
		}
	}

	return encounters;
}

// ── EncountersList ──────────────────────────────────────────────────────────

function EncountersList({
	combatDealt,
	combatRecv,
	missesDealt,
	missesRecv,
}: {
	combatDealt: LogEvent[];
	combatRecv: LogEvent[];
	missesDealt: LogEvent[];
	missesRecv: LogEvent[];
}) {
	const encounters = computeEncounters(combatDealt, combatRecv, missesDealt, missesRecv);

	if (encounters.length === 0) return null;

	return (
		<div>
			<h3 className="mb-2 text-sm font-medium text-zinc-400">Encounters ({encounters.length})</h3>
			<div className="space-y-2">
				{encounters.map((enc, i) => (
					<div key={enc.startTime} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span className="text-xs font-mono text-zinc-600">#{i + 1}</span>
								<span className="text-sm font-medium text-zinc-200">{enc.targets.join(", ")}</span>
							</div>
							<div className="flex items-center gap-3 text-xs text-zinc-500">
								<span>{formatDuration(enc.durationMs)}</span>
								<span className="text-zinc-600">
									{fmtTime(enc.startTime)} – {fmtTime(enc.endTime)}
								</span>
							</div>
						</div>
						<div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
							<div>
								<p className="text-xs text-zinc-600">Dealt</p>
								<p className="font-mono text-sm text-cyan-400">
									{enc.damageDealt.toLocaleString()}
								</p>
								<p className="text-xs text-zinc-600">
									{enc.hitsDealt} hits / {enc.missesDealt} miss
								</p>
							</div>
							<div>
								<p className="text-xs text-zinc-600">Received</p>
								<p className="font-mono text-sm text-red-400">{enc.damageRecv.toLocaleString()}</p>
								<p className="text-xs text-zinc-600">
									{enc.hitsRecv} hits / {enc.missesRecv} miss
								</p>
							</div>
							<div>
								<p className="text-xs text-zinc-600">DPS Dealt</p>
								<p className="font-mono text-sm text-zinc-300">
									{enc.durationMs > 0
										? (enc.damageDealt / (enc.durationMs / 1000)).toFixed(1)
										: "—"}
								</p>
							</div>
							<div>
								<p className="text-xs text-zinc-600">DPS Recv</p>
								<p className="font-mono text-sm text-zinc-300">
									{enc.durationMs > 0 ? (enc.damageRecv / (enc.durationMs / 1000)).toFixed(1) : "—"}
								</p>
							</div>
						</div>
						{enc.weapons.length > 0 && (
							<div className="mt-1.5 flex flex-wrap gap-1">
								{enc.weapons.map((w) => (
									<span
										key={w}
										className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-xs text-zinc-500"
									>
										{w}
									</span>
								))}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

// ── Component ───────────────────────────────────────────────────────────────

export function CombatTab() {
	const { activeSessionId } = useLogStore();
	const characterSessionIds = useCharacterSessionIds();

	const combatDealt = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents.where("[sessionId+type]").equals([activeSessionId, "combat_dealt"]).toArray()
				: [],
		[activeSessionId],
	);

	const combatRecv = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents
						.where("[sessionId+type]")
						.equals([activeSessionId, "combat_received"])
						.toArray()
				: [],
		[activeSessionId],
	);

	const missesDealt = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents.where("[sessionId+type]").equals([activeSessionId, "miss_dealt"]).toArray()
				: [],
		[activeSessionId],
	);

	const missesRecv = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents
						.where("[sessionId+type]")
						.equals([activeSessionId, "miss_received"])
						.toArray()
				: [],
		[activeSessionId],
	);

	// Filter out if active session doesn't belong to selected character
	if (characterSessionIds && activeSessionId && !characterSessionIds.has(activeSessionId)) {
		return (
			<p className="py-8 text-center text-sm text-zinc-600">
				No combat data for the selected character. Switch to the character currently playing or
				select "All Characters."
			</p>
		);
	}

	const totalDealt = combatDealt?.reduce((sum, e) => sum + (e.damage ?? 0), 0) ?? 0;
	const totalRecv = combatRecv?.reduce((sum, e) => sum + (e.damage ?? 0), 0) ?? 0;
	const hitCount = (combatDealt?.length ?? 0) + (combatRecv?.length ?? 0);
	const missCount = (missesDealt?.length ?? 0) + (missesRecv?.length ?? 0);

	// Per-target breakdown (dealt)
	const targetDealtStats = new Map<string, { total: number; hits: number; maxHit: number }>();
	for (const e of combatDealt ?? []) {
		const t = e.target ?? "Unknown";
		const existing = targetDealtStats.get(t) ?? { total: 0, hits: 0, maxHit: 0 };
		existing.total += e.damage ?? 0;
		existing.hits++;
		existing.maxHit = Math.max(existing.maxHit, e.damage ?? 0);
		targetDealtStats.set(t, existing);
	}

	// Per-target breakdown (received)
	const targetRecvStats = new Map<string, { total: number; hits: number; maxHit: number }>();
	for (const e of combatRecv ?? []) {
		const t = e.target ?? "Unknown";
		const existing = targetRecvStats.get(t) ?? { total: 0, hits: 0, maxHit: 0 };
		existing.total += e.damage ?? 0;
		existing.hits++;
		existing.maxHit = Math.max(existing.maxHit, e.damage ?? 0);
		targetRecvStats.set(t, existing);
	}

	// Hit quality distribution (dealt)
	const hitQualityDealt = new Map<string, number>();
	for (const e of combatDealt ?? []) {
		const q = e.hitQuality ?? "Unknown";
		hitQualityDealt.set(q, (hitQualityDealt.get(q) ?? 0) + 1);
	}

	if (hitCount === 0 && missCount === 0) {
		return (
			<p className="py-8 text-center text-sm text-zinc-600">No combat data for this session yet.</p>
		);
	}

	return (
		<div className="space-y-4">
			{/* Summary cards */}
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Damage Dealt</p>
					<p className="text-xl font-bold text-cyan-400">{totalDealt.toLocaleString()}</p>
					<p className="text-xs text-zinc-600">{combatDealt?.length ?? 0} hits</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Damage Received</p>
					<p className="text-xl font-bold text-red-400">{totalRecv.toLocaleString()}</p>
					<p className="text-xs text-zinc-600">{combatRecv?.length ?? 0} hits</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Hit Rate</p>
					<p className="text-xl font-bold text-zinc-200">
						{hitCount + missCount > 0
							? `${Math.round((hitCount / (hitCount + missCount)) * 100)}%`
							: "—"}
					</p>
					<p className="text-xs text-zinc-600">
						{hitCount} hits / {missCount} misses
					</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Targets Engaged</p>
					<p className="text-xl font-bold text-zinc-200">{targetDealtStats.size}</p>
				</div>
			</div>

			{/* Damage dealt per target */}
			{targetDealtStats.size > 0 && (
				<div>
					<h3 className="mb-2 text-sm font-medium text-zinc-400">Damage Dealt by Target</h3>
					<div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-zinc-800 text-xs text-zinc-500">
									<th className="px-3 py-2 text-left">Target</th>
									<th className="px-3 py-2 text-right">Total</th>
									<th className="px-3 py-2 text-right">Hits</th>
									<th className="px-3 py-2 text-right">Avg</th>
									<th className="px-3 py-2 text-right">Max</th>
								</tr>
							</thead>
							<tbody>
								{[...targetDealtStats.entries()].map(([target, stats]) => (
									<tr key={target} className="border-b border-zinc-800/50">
										<td className="px-3 py-2 text-zinc-200">{target}</td>
										<td className="px-3 py-2 text-right font-mono text-cyan-400">
											{stats.total.toLocaleString()}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">{stats.hits}</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{Math.round(stats.total / stats.hits)}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">{stats.maxHit}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Damage received per attacker */}
			{targetRecvStats.size > 0 && (
				<div>
					<h3 className="mb-2 text-sm font-medium text-zinc-400">Damage Received by Attacker</h3>
					<div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-zinc-800 text-xs text-zinc-500">
									<th className="px-3 py-2 text-left">Attacker</th>
									<th className="px-3 py-2 text-right">Total</th>
									<th className="px-3 py-2 text-right">Hits</th>
									<th className="px-3 py-2 text-right">Avg</th>
									<th className="px-3 py-2 text-right">Max</th>
								</tr>
							</thead>
							<tbody>
								{[...targetRecvStats.entries()].map(([target, stats]) => (
									<tr key={target} className="border-b border-zinc-800/50">
										<td className="px-3 py-2 text-zinc-200">{target}</td>
										<td className="px-3 py-2 text-right font-mono text-red-400">
											{stats.total.toLocaleString()}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">{stats.hits}</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{Math.round(stats.total / stats.hits)}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">{stats.maxHit}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Hit quality distribution */}
			{hitQualityDealt.size > 0 && (
				<div>
					<h3 className="mb-2 text-sm font-medium text-zinc-400">Hit Quality (Dealt)</h3>
					<div className="flex flex-wrap gap-2">
						{[...hitQualityDealt.entries()]
							.sort((a, b) => b[1] - a[1])
							.map(([quality, count]) => (
								<div
									key={quality}
									className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs"
								>
									<span className="text-zinc-300">{quality}</span>
									<span className="ml-2 font-mono text-zinc-500">{count}</span>
								</div>
							))}
					</div>
				</div>
			)}

			{/* Encounters */}
			<EncountersList
				combatDealt={combatDealt ?? []}
				combatRecv={combatRecv ?? []}
				missesDealt={missesDealt ?? []}
				missesRecv={missesRecv ?? []}
			/>
		</div>
	);
}
