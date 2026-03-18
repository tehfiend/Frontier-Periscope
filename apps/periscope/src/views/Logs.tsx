import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useLogStore } from "@/stores/logStore";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { requestDirectoryAccess } from "@/lib/logFileAccess";
import { GrantAccessView } from "@/components/GrantAccessView";
import { LogEventRow } from "@/components/LogEventRow";
import { fmtTime, fmtDateTime, formatDuration } from "@/lib/format";
import type { LogEvent, LogSession } from "@/db/types";
import { useState } from "react";
import {
	FileText,
	FolderOpen,
	Pickaxe,
	Swords,
	Clock,
	Radio,
	CircleOff,
	ChevronRight,
	ArrowLeft,
	Navigation,
	MessageSquare,
	Search,
	Trash2,
	Landmark,
} from "lucide-react";

// ── Main View ───────────────────────────────────────────────────────────────

export function Logs() {
	const { hasAccess, activeTab, selectedSessionId, grantAccess, clearAndReimport } =
		useLogStore();

	if (!hasAccess) {
		if (!grantAccess) {
			return (
				<p className="py-8 text-center text-sm text-zinc-600">
					Log watcher not initialized. Navigate to the Sonar page to grant access.
				</p>
			);
		}
		return <GrantAccessView onGrant={grantAccess} />;
	}

	if (selectedSessionId) {
		return <SessionDetailView />;
	}

	return (
		<div className="flex h-full flex-col">
			<Header
				onChangeDir={grantAccess ?? (() => {})}
				onClearData={clearAndReimport ?? (() => {})}
			/>
			<TabBar />
			<div className="flex-1 overflow-y-auto p-4">
				{activeTab === "sessions" && <SessionsTab />}
				{activeTab === "mining" && <MiningTab />}
				{activeTab === "combat" && <CombatTab />}
				{activeTab === "travel" && <TravelTab />}
				{activeTab === "structures" && <StructuresTab />}
				{activeTab === "chat" && <ChatTab />}
			</div>
		</div>
	);
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header({
	onChangeDir,
	onClearData,
}: {
	onChangeDir: (h: FileSystemDirectoryHandle) => void;
	onClearData: () => void;
}) {
	const { isWatching, activeSessionId } = useLogStore();

	const session = useLiveQuery(
		() => (activeSessionId ? db.logSessions.get(activeSessionId) : undefined),
		[activeSessionId],
	);

	async function handleChangeDir() {
		const handle = await requestDirectoryAccess();
		if (handle) onChangeDir(handle);
	}

	return (
		<div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
			<div className="flex items-center gap-3">
				<FileText size={22} className="text-teal-500" />
				<div>
					<h1 className="text-lg font-bold text-zinc-100">Log Analyzer</h1>
					{session && (
						<p className="text-xs text-zinc-500">
							{session.characterName} — started {fmtDateTime(session.startedAt)}
						</p>
					)}
				</div>
			</div>
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={onClearData}
					className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:border-red-800 hover:text-red-400"
					title="Clear all parsed data and reimport from logs"
				>
					<Trash2 size={12} />
					Clear &amp; Reimport
				</button>
				<button
					type="button"
					onClick={handleChangeDir}
					className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
					title="Change log directory"
				>
					<FolderOpen size={12} />
					Change Dir
				</button>
				<div className="flex items-center gap-2 text-xs">
					{isWatching ? (
						<>
							<Radio size={14} className="animate-pulse text-green-500" />
							<span className="text-green-400">Live</span>
						</>
					) : (
						<>
							<CircleOff size={14} className="text-zinc-600" />
							<span className="text-zinc-500">Paused</span>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Tab Bar ─────────────────────────────────────────────────────────────────

const TABS = [
	{ id: "sessions" as const, label: "Sessions", icon: Clock },
	{ id: "mining" as const, label: "Mining", icon: Pickaxe },
	{ id: "combat" as const, label: "Combat", icon: Swords },
	{ id: "travel" as const, label: "Travel", icon: Navigation },
	{ id: "structures" as const, label: "Structures", icon: Landmark },
	{ id: "chat" as const, label: "Chat", icon: MessageSquare },
];

function TabBar() {
	const { activeTab, setActiveTab } = useLogStore();
	return (
		<div className="flex border-b border-zinc-800">
			{TABS.map(({ id, label, icon: Icon }) => (
				<button
					key={id}
					type="button"
					onClick={() => setActiveTab(id)}
					className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
						activeTab === id
							? "border-b-2 border-teal-500 text-teal-400"
							: "text-zinc-500 hover:text-zinc-300"
					}`}
				>
					<Icon size={14} />
					{label}
				</button>
			))}
		</div>
	);
}

// ── Sessions Tab ────────────────────────────────────────────────────────────

function SessionsTab() {
	const { setSelectedSessionId } = useLogStore();
	const { activeCharacter, isFiltered } = useActiveCharacter();

	const sessions = useLiveQuery(
		() => {
			const query = isFiltered && activeCharacter
				? db.logSessions.where("characterName").equals(activeCharacter.characterName)
				: db.logSessions.orderBy("startedAt");
			return query.reverse().toArray();
		},
		[isFiltered, activeCharacter?.characterName],
	);

	const showCharColumn = !isFiltered;

	return (
		<div className="space-y-2">
			<h3 className="text-sm font-medium text-zinc-400">Parsed Sessions</h3>
			{(!sessions || sessions.length === 0) && (
				<p className="py-8 text-center text-sm text-zinc-600">
					No sessions parsed yet. Events will appear as logs are read.
				</p>
			)}
			{sessions?.map((s) => (
				<SessionRow
					key={s.id}
					session={s}
					showCharacter={showCharColumn}
					onClick={() => setSelectedSessionId(s.id)}
				/>
			))}
		</div>
	);
}

function SessionRow({
	session,
	showCharacter = true,
	onClick,
}: { session: LogSession; showCharacter?: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900/60"
		>
			<div>
				<p className="text-sm font-medium text-zinc-200">
					{showCharacter ? session.characterName : fmtDateTime(session.startedAt)}
				</p>
				<p className="text-xs text-zinc-500">
					{showCharacter ? fmtDateTime(session.startedAt) : `${session.eventCount.toLocaleString()} events`}
				</p>
			</div>
			<div className="flex items-center gap-3">
				{showCharacter && (
					<span className="text-xs text-zinc-500">
						{session.eventCount.toLocaleString()} events
					</span>
				)}
				<ChevronRight size={14} className="text-zinc-600" />
			</div>
		</button>
	);
}

// ── Mining Tab ──────────────────────────────────────────────────────────────

function MiningTab() {
	const { activeSessionId } = useLogStore();

	const miningEvents = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents
						.where("[sessionId+type]")
						.equals([activeSessionId, "mining"])
						.toArray()
				: [],
		[activeSessionId],
	);

	if (!miningEvents || miningEvents.length === 0) {
		return (
			<p className="py-8 text-center text-sm text-zinc-600">
				No mining data for this session yet.
			</p>
		);
	}

	// Aggregate by ore type
	const oreStats = new Map<
		string,
		{ total: number; count: number; first: string; last: string }
	>();
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
					<p className="text-xl font-bold text-amber-400">
						{totalMined.toLocaleString()}
					</p>
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
								const durationMs =
									new Date(stats.last).getTime() -
									new Date(stats.first).getTime();
								const durationMin = Math.max(durationMs / 60_000, 1 / 60);
								const ratePerMin = stats.total / durationMin;
								return (
									<tr key={ore} className="border-b border-zinc-800/50">
										<td className="px-3 py-2 text-zinc-200">{ore}</td>
										<td className="px-3 py-2 text-right font-mono text-amber-400">
											{stats.total.toLocaleString()}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{stats.count}
										</td>
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
								<span className="text-amber-400/70">
									{Math.round(run.ratePerMin)}/min
								</span>
								{run.cargoFull && (
									<span className="text-orange-500">Full</span>
								)}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

// ── Combat Tab ──────────────────────────────────────────────────────────────

function CombatTab() {
	const { activeSessionId } = useLogStore();

	const combatDealt = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents
						.where("[sessionId+type]")
						.equals([activeSessionId, "combat_dealt"])
						.toArray()
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
				? db.logEvents
						.where("[sessionId+type]")
						.equals([activeSessionId, "miss_dealt"])
						.toArray()
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

	const totalDealt = combatDealt?.reduce((sum, e) => sum + (e.damage ?? 0), 0) ?? 0;
	const totalRecv = combatRecv?.reduce((sum, e) => sum + (e.damage ?? 0), 0) ?? 0;
	const hitCount = (combatDealt?.length ?? 0) + (combatRecv?.length ?? 0);
	const missCount = (missesDealt?.length ?? 0) + (missesRecv?.length ?? 0);

	// Per-target breakdown (dealt)
	const targetDealtStats = new Map<
		string,
		{ total: number; hits: number; maxHit: number }
	>();
	for (const e of combatDealt ?? []) {
		const t = e.target ?? "Unknown";
		const existing = targetDealtStats.get(t) ?? { total: 0, hits: 0, maxHit: 0 };
		existing.total += e.damage ?? 0;
		existing.hits++;
		existing.maxHit = Math.max(existing.maxHit, e.damage ?? 0);
		targetDealtStats.set(t, existing);
	}

	// Per-target breakdown (received)
	const targetRecvStats = new Map<
		string,
		{ total: number; hits: number; maxHit: number }
	>();
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
			<p className="py-8 text-center text-sm text-zinc-600">
				No combat data for this session yet.
			</p>
		);
	}

	return (
		<div className="space-y-4">
			{/* Summary cards */}
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Damage Dealt</p>
					<p className="text-xl font-bold text-cyan-400">
						{totalDealt.toLocaleString()}
					</p>
					<p className="text-xs text-zinc-600">{combatDealt?.length ?? 0} hits</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Damage Received</p>
					<p className="text-xl font-bold text-red-400">
						{totalRecv.toLocaleString()}
					</p>
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
					<p className="text-xl font-bold text-zinc-200">
						{targetDealtStats.size}
					</p>
				</div>
			</div>

			{/* Damage dealt per target */}
			{targetDealtStats.size > 0 && (
				<div>
					<h3 className="mb-2 text-sm font-medium text-zinc-400">
						Damage Dealt by Target
					</h3>
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
									<tr
										key={target}
										className="border-b border-zinc-800/50"
									>
										<td className="px-3 py-2 text-zinc-200">{target}</td>
										<td className="px-3 py-2 text-right font-mono text-cyan-400">
											{stats.total.toLocaleString()}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{stats.hits}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{Math.round(stats.total / stats.hits)}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{stats.maxHit}
										</td>
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
					<h3 className="mb-2 text-sm font-medium text-zinc-400">
						Damage Received by Attacker
					</h3>
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
									<tr
										key={target}
										className="border-b border-zinc-800/50"
									>
										<td className="px-3 py-2 text-zinc-200">{target}</td>
										<td className="px-3 py-2 text-right font-mono text-red-400">
											{stats.total.toLocaleString()}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{stats.hits}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{Math.round(stats.total / stats.hits)}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{stats.maxHit}
										</td>
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
					<h3 className="mb-2 text-sm font-medium text-zinc-400">
						Hit Quality (Dealt)
					</h3>
					<div className="flex flex-wrap gap-2">
						{[...hitQualityDealt.entries()]
							.sort((a, b) => b[1] - a[1])
							.map(([quality, count]) => (
								<div
									key={quality}
									className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs"
								>
									<span className="text-zinc-300">{quality}</span>
									<span className="ml-2 font-mono text-zinc-500">
										{count}
									</span>
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
			<h3 className="mb-2 text-sm font-medium text-zinc-400">
				Encounters ({encounters.length})
			</h3>
			<div className="space-y-2">
				{encounters.map((enc, i) => (
					<div
						key={enc.startTime}
						className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3"
					>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span className="text-xs font-mono text-zinc-600">
									#{i + 1}
								</span>
								<span className="text-sm font-medium text-zinc-200">
									{enc.targets.join(", ")}
								</span>
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
								<p className="font-mono text-sm text-red-400">
									{enc.damageRecv.toLocaleString()}
								</p>
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
									{enc.durationMs > 0
										? (enc.damageRecv / (enc.durationMs / 1000)).toFixed(1)
										: "—"}
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

// ── Travel Tab ──────────────────────────────────────────────────────────────

function TravelTab() {
	const { activeSessionId } = useLogStore();

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

	// All system changes across all sessions for history view
	const allSystemChanges = useLiveQuery(() =>
		db.logEvents.where("type").equals("system_change").sortBy("timestamp"),
	);

	const currentSession = systemChanges ?? [];
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
						message. Make sure you selected the{" "}
						<span className="text-zinc-300">logs</span> parent folder (not just
						Gamelogs) so chat logs are accessible.
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
					<h3 className="mb-2 text-sm font-medium text-zinc-400">
						Session Route
					</h3>
					<div className="flex flex-wrap items-center gap-1">
						{currentSession.map((e, i) => (
							<div key={e.id} className="flex items-center gap-1">
								{i > 0 && (
									<ChevronRight size={12} className="text-zinc-700" />
								)}
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
					<h3 className="mb-2 text-sm font-medium text-zinc-400">
						Time per System
					</h3>
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
									<tr
										key={d.system}
										className="border-b border-zinc-800/50"
									>
										<td className="px-3 py-2 font-mono text-indigo-300">
											{d.system}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{d.visits}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{formatDuration(d.totalMs)}
										</td>
										<td className="px-3 py-2 text-right font-mono text-zinc-400">
											{formatDuration(
												d.visits > 0
													? d.totalMs / d.visits
													: 0,
											)}
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
				<h3 className="mb-2 text-sm font-medium text-zinc-400">
					Jump Log ({allHistory.length})
				</h3>
				<div className="max-h-[400px] space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
					{[...allHistory].reverse().map((e) => (
						<div
							key={e.id}
							className="flex items-center gap-2 rounded px-2 py-0.5 text-xs hover:bg-zinc-800/50"
						>
							<span className="font-mono text-zinc-600">
								{fmtDateTime(e.timestamp)}
							</span>
							<span className="font-mono font-bold text-indigo-400">
								JUMP
							</span>
							<span className="font-mono text-zinc-300">
								{e.systemName}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

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
				new Date(events[i + 1].timestamp).getTime() -
				new Date(events[i].timestamp).getTime();
			entry.totalMs += dwellMs;
		}

		stats.set(system, entry);
	}

	return [...stats.entries()]
		.map(([system, s]) => ({ system, ...s }))
		.sort((a, b) => b.totalMs - a.totalMs);
}

// ── Structures Tab ──────────────────────────────────────────────────────────

const STRUCTURE_TYPES = ["structure_departed", "gate_offline", "build_fail", "dismantle"] as const;

function StructuresTab() {
	const { activeSessionId } = useLogStore();
	const [typeFilter, setTypeFilter] = useState<string>("all");

	// All structure events for current session
	const sessionEvents = useLiveQuery(
		() =>
			activeSessionId
				? Promise.all(
						STRUCTURE_TYPES.map((t) =>
							db.logEvents
								.where("[sessionId+type]")
								.equals([activeSessionId, t])
								.toArray(),
						),
					).then((arrays) => arrays.flat())
				: [],
		[activeSessionId],
	);

	// All structure events across all sessions
	const allEvents = useLiveQuery(() =>
		Promise.all(
			STRUCTURE_TYPES.map((t) =>
				db.logEvents.where("type").equals(t).toArray(),
			),
		).then((arrays) => arrays.flat()),
	);

	const current = sessionEvents ?? [];
	const all = allEvents ?? [];

	// Sort all events by timestamp descending
	const sortedAll = [...all].sort(
		(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
	);

	// Apply type filter
	const filtered = typeFilter === "all"
		? sortedAll
		: sortedAll.filter((e) => e.type === typeFilter);

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
				<p className="py-8 text-center text-sm text-zinc-600">
					No structure events yet.
				</p>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
					<p className="font-medium text-zinc-400">What gets tracked:</p>
					<ul className="mt-1 list-inside list-disc space-y-1">
						<li><span className="text-orange-400">Structure Departed</span> — when a structure is picked up / dismantled from a system</li>
						<li><span className="text-rose-400">Gate Offline</span> — smart gate Traffic Control offline messages</li>
						<li><span className="text-red-500">Build Fail</span> — insufficient resources, wrong location, assembly offline</li>
						<li><span className="text-orange-300">Dismantle</span> — dismantle confirmation prompts</li>
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
					<h3 className="mb-2 text-sm font-medium text-zinc-400">
						Structures Departed (Session)
					</h3>
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
														<span key={sys} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-indigo-300">
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
						<p className="py-4 text-center text-sm text-zinc-600">
							No events match the filter.
						</p>
					)}
					{filtered.slice(0, 500).map((e) => (
						<LogEventRow key={e.id} event={e} />
					))}
				</div>
			</div>
		</div>
	);
}

// ── Chat Tab ────────────────────────────────────────────────────────────────

function ChatTab() {
	const [channelFilter, setChannelFilter] = useState<string>("all");
	const [searchQuery, setSearchQuery] = useState("");

	// Get all chat events across all sessions
	const chatEvents = useLiveQuery(
		() => db.logEvents.where("type").equals("chat").sortBy("timestamp"),
	);

	const allEvents = chatEvents ?? [];

	// Extract distinct channels
	const channels = [...new Set(allEvents.map((e) => e.channel).filter(Boolean))].sort();

	// Apply filters
	const filtered = allEvents.filter((e) => {
		if (channelFilter !== "all" && e.channel !== channelFilter) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			return (
				(e.message?.toLowerCase().includes(q) ?? false) ||
				(e.speaker?.toLowerCase().includes(q) ?? false)
			);
		}
		return true;
	});

	// Channel message counts
	const channelCounts = new Map<string, number>();
	for (const e of allEvents) {
		const ch = e.channel ?? "Unknown";
		channelCounts.set(ch, (channelCounts.get(ch) ?? 0) + 1);
	}

	// Unique speakers
	const speakers = new Set(allEvents.map((e) => e.speaker).filter(Boolean));

	if (allEvents.length === 0) {
		return (
			<div className="space-y-4">
				<p className="py-8 text-center text-sm text-zinc-600">
					No chat data yet. Chat messages are parsed from the Chatlogs directory.
				</p>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
					<p className="font-medium text-zinc-400">How chat tracking works:</p>
					<p className="mt-1">
						Make sure you selected the{" "}
						<span className="text-zinc-300">logs</span> parent folder
						(not just Gamelogs) so chat logs in the{" "}
						<span className="text-zinc-300">Chatlogs</span> subdirectory
						are accessible.
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
					<p className="text-xs text-zinc-500">Total Messages</p>
					<p className="text-xl font-bold text-emerald-400">
						{allEvents.length.toLocaleString()}
					</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Channels</p>
					<p className="text-xl font-bold text-zinc-200">{channels.length}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Speakers</p>
					<p className="text-xl font-bold text-zinc-200">{speakers.size}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Showing</p>
					<p className="text-xl font-bold text-zinc-200">
						{filtered.length.toLocaleString()}
					</p>
				</div>
			</div>

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-3">
				<div className="flex items-center gap-2">
					<MessageSquare size={14} className="text-zinc-500" />
					<select
						value={channelFilter}
						onChange={(e) => setChannelFilter(e.target.value)}
						className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-300 outline-none focus:border-zinc-600"
					>
						<option value="all">All Channels</option>
						{channels.map((ch) => (
							<option key={ch} value={ch}>
								{ch} ({channelCounts.get(ch!) ?? 0})
							</option>
						))}
					</select>
				</div>
				<div className="flex flex-1 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
					<Search size={14} className="text-zinc-500" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search messages or speakers..."
						className="flex-1 bg-transparent text-sm text-zinc-300 outline-none placeholder:text-zinc-600"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => setSearchQuery("")}
							className="text-xs text-zinc-600 hover:text-zinc-400"
						>
							Clear
						</button>
					)}
				</div>
			</div>

			{/* Channel breakdown */}
			<div>
				<h3 className="mb-2 text-sm font-medium text-zinc-400">Channels</h3>
				<div className="flex flex-wrap gap-2">
					{[...channelCounts.entries()]
						.sort((a, b) => b[1] - a[1])
						.map(([ch, count]) => (
							<button
								key={ch}
								type="button"
								onClick={() =>
									setChannelFilter(
										channelFilter === ch ? "all" : ch,
									)
								}
								className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
									channelFilter === ch
										? "border-emerald-700 bg-emerald-900/30 text-emerald-300"
										: "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700"
								}`}
							>
								<span>{ch}</span>
								<span className="ml-1.5 font-mono text-zinc-500">
									{count}
								</span>
							</button>
						))}
				</div>
			</div>

			{/* Message list */}
			<div>
				<h3 className="mb-2 text-sm font-medium text-zinc-400">
					Messages ({filtered.length.toLocaleString()})
				</h3>
				<div className="max-h-[500px] space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
					{filtered.length === 0 && (
						<p className="py-8 text-center text-sm text-zinc-600">
							No messages match your filters.
						</p>
					)}
					{[...filtered].reverse().slice(0, 500).map((e) => (
						<div
							key={e.id}
							className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-800/50"
						>
							<span className="shrink-0 font-mono text-zinc-600">
								{fmtDateTime(e.timestamp)}
							</span>
							<span className="shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-emerald-500/70">
								{e.channel}
							</span>
							{e.systemName && (
								<span className="shrink-0 font-mono text-indigo-400/70">
									{e.systemName}
								</span>
							)}
							<span className="shrink-0 font-medium text-zinc-300">
								{e.speaker}
							</span>
							<span className="text-zinc-400">{e.message}</span>
						</div>
					))}
					{filtered.length > 500 && (
						<p className="py-2 text-center text-xs text-zinc-600">
							Showing latest 500 of {filtered.length.toLocaleString()} messages. Use filters to narrow results.
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Session Detail View ─────────────────────────────────────────────────────

function SessionDetailView() {
	const { selectedSessionId, setSelectedSessionId, setActiveTab } = useLogStore();

	const session = useLiveQuery(
		() => (selectedSessionId ? db.logSessions.get(selectedSessionId) : undefined),
		[selectedSessionId],
	);

	const events = useLiveQuery(
		() =>
			selectedSessionId
				? db.logEvents
						.where("sessionId")
						.equals(selectedSessionId)
						.sortBy("timestamp")
				: [],
		[selectedSessionId],
	);

	if (!session) return null;

	const miningEvents = events?.filter((e) => e.type === "mining") ?? [];
	const combatDealtEvents = events?.filter((e) => e.type === "combat_dealt") ?? [];
	const combatRecvEvents =
		events?.filter((e) => e.type === "combat_received") ?? [];
	const totalMined = miningEvents.reduce((sum, e) => sum + (e.amount ?? 0), 0);
	const totalDealt = combatDealtEvents.reduce(
		(sum, e) => sum + (e.damage ?? 0),
		0,
	);
	const totalRecv = combatRecvEvents.reduce(
		(sum, e) => sum + (e.damage ?? 0),
		0,
	);

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
				<button
					type="button"
					onClick={() => {
						setSelectedSessionId(null);
						setActiveTab("sessions");
					}}
					className="text-zinc-500 hover:text-zinc-300"
				>
					<ArrowLeft size={18} />
				</button>
				<div>
					<h2 className="text-lg font-bold text-zinc-100">
						{session.characterName}
					</h2>
					<p className="text-xs text-zinc-500">
						{fmtDateTime(session.startedAt)} — {session.eventCount.toLocaleString()} events
					</p>
				</div>
			</div>
			<div className="flex-1 space-y-4 overflow-y-auto p-4">
				{/* Summary */}
				<div className="grid grid-cols-3 gap-3">
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
						<p className="text-xs text-zinc-500">Ore Mined</p>
						<p className="text-lg font-bold text-amber-400">
							{totalMined.toLocaleString()}
						</p>
					</div>
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
						<p className="text-xs text-zinc-500">Damage Dealt</p>
						<p className="text-lg font-bold text-cyan-400">
							{totalDealt.toLocaleString()}
						</p>
					</div>
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
						<p className="text-xs text-zinc-500">Damage Received</p>
						<p className="text-lg font-bold text-red-400">
							{totalRecv.toLocaleString()}
						</p>
					</div>
				</div>

				{/* Full event log */}
				<div>
					<h3 className="mb-2 text-sm font-medium text-zinc-400">
						Event Log ({events?.length ?? 0})
					</h3>
					<div className="max-h-[600px] space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
						{events?.map((event) => (
							<LogEventRow key={event.id} event={event} />
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

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
		(a, b) =>
			new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	const runs: MiningRun[] = [];
	let runStart = 0;

	for (let i = 1; i <= sorted.length; i++) {
		const gap =
			i < sorted.length
				? new Date(sorted[i].timestamp).getTime() -
					new Date(sorted[i - 1].timestamp).getTime()
				: Number.POSITIVE_INFINITY;

		if (gap > 30_000) {
			const runEvents = sorted.slice(runStart, i);
			const total = runEvents.reduce((s, e) => s + (e.amount ?? 0), 0);
			const startTime = runEvents[0].timestamp;
			const endTime = runEvents[runEvents.length - 1].timestamp;
			const durationMs =
				new Date(endTime).getTime() - new Date(startTime).getTime();
			const durationMin = Math.max(durationMs / 60_000, 1 / 60);

			const lastAmount = runEvents[runEvents.length - 1].amount ?? 0;
			const avgAmount = total / runEvents.length;
			const cargoFull =
				lastAmount < avgAmount * 0.5 && runEvents.length > 2;

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
				? new Date(all[i].timestamp).getTime() -
					new Date(all[i - 1].timestamp).getTime()
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

