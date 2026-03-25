import { LogEventRow } from "@/components/LogEventRow";
import { db } from "@/db";
import type { LogSession } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { fmtDateTime } from "@/lib/format";
import { useLogStore } from "@/stores/logStore";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ChevronRight } from "lucide-react";

// ── SessionRow ──────────────────────────────────────────────────────────────

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
					{showCharacter
						? fmtDateTime(session.startedAt)
						: `${session.eventCount.toLocaleString()} events`}
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

// ── SessionDetailView ───────────────────────────────────────────────────────

export function SessionDetailView() {
	const { selectedSessionId, setSelectedSessionId, setActiveTab } = useLogStore();

	const session = useLiveQuery(
		() => (selectedSessionId ? db.logSessions.get(selectedSessionId) : undefined),
		[selectedSessionId],
	);

	const events = useLiveQuery(
		() =>
			selectedSessionId
				? db.logEvents.where("sessionId").equals(selectedSessionId).sortBy("timestamp")
				: [],
		[selectedSessionId],
	);

	if (!session) return null;

	const miningEvents = events?.filter((e) => e.type === "mining") ?? [];
	const combatDealtEvents = events?.filter((e) => e.type === "combat_dealt") ?? [];
	const combatRecvEvents = events?.filter((e) => e.type === "combat_received") ?? [];
	const totalMined = miningEvents.reduce((sum, e) => sum + (e.amount ?? 0), 0);
	const totalDealt = combatDealtEvents.reduce((sum, e) => sum + (e.damage ?? 0), 0);
	const totalRecv = combatRecvEvents.reduce((sum, e) => sum + (e.damage ?? 0), 0);

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
					<h2 className="text-lg font-bold text-zinc-100">{session.characterName}</h2>
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
						<p className="text-lg font-bold text-amber-400">{totalMined.toLocaleString()}</p>
					</div>
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
						<p className="text-xs text-zinc-500">Damage Dealt</p>
						<p className="text-lg font-bold text-cyan-400">{totalDealt.toLocaleString()}</p>
					</div>
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
						<p className="text-xs text-zinc-500">Damage Received</p>
						<p className="text-lg font-bold text-red-400">{totalRecv.toLocaleString()}</p>
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

// ── SessionsTab ─────────────────────────────────────────────────────────────

export function SessionsTab() {
	const { setSelectedSessionId } = useLogStore();
	const { activeCharacter, isFiltered } = useActiveCharacter();

	const sessions = useLiveQuery(() => {
		const query =
			isFiltered && activeCharacter
				? db.logSessions.where("characterName").equals(activeCharacter.characterName)
				: db.logSessions.orderBy("startedAt");
		return query.reverse().toArray();
	}, [isFiltered, activeCharacter?.characterName]);

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
