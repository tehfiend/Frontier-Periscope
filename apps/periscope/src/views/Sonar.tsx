import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "@tanstack/react-router";
import { db } from "@/db";
import { useSonarStore } from "@/stores/sonarStore";
import { useLogStore } from "@/stores/logStore";
import { DataGrid, excelFilterFn, type ColumnDef } from "@/components/DataGrid";
import { StatCard } from "@/components/StatCard";
import { LogEventRow } from "@/components/LogEventRow";
import { GrantAccessView } from "@/components/GrantAccessView";
import type { SonarEvent, SonarChannelStatus, SonarEventType } from "@/db/types";
import {
	FileText,
	Settings,
	Bell,
	BellOff,
	Volume2,
	VolumeX,
	Activity,
	Pickaxe,
	Swords,
} from "lucide-react";

// ── Column Definitions ───────────────────────────────────────────────────────

const columns: ColumnDef<SonarEvent, unknown>[] = [
	{
		accessorKey: "timestamp",
		header: "Timestamp",
		size: 180,
		cell: ({ getValue }) => {
			const ts = getValue() as string;
			try {
				return new Date(ts).toLocaleString();
			} catch {
				return ts;
			}
		},
		filterFn: excelFilterFn,
	},
	{
		accessorKey: "source",
		header: "Source",
		size: 90,
		cell: ({ getValue }) => {
			const source = getValue() as string;
			return (
				<span
					className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${
						source === "local"
							? "bg-green-500/10 text-green-400"
							: "bg-orange-500/10 text-orange-400"
					}`}
				>
					{source === "local" ? "Log" : "Chain"}
				</span>
			);
		},
		filterFn: excelFilterFn,
	},
	{
		accessorKey: "eventType",
		header: "Type",
		size: 140,
		cell: ({ getValue }) => {
			const type = getValue() as string;
			return type.replace(/_/g, " ");
		},
		filterFn: excelFilterFn,
	},
	{
		accessorKey: "characterName",
		header: "Character",
		size: 140,
		cell: ({ getValue }) => (getValue() as string) || "-",
		filterFn: excelFilterFn,
	},
	{
		id: "details",
		header: "Details",
		accessorFn: (row) => {
			if (row.source === "local") {
				return row.systemName
					? `Entered ${row.systemName}`
					: (row.details ?? "-");
			}
			// Chain events
			const parts: string[] = [];
			if (row.typeName) parts.push(row.typeName);
			else if (row.typeId) parts.push(`type #${row.typeId}`);
			if (row.quantity != null) parts.push(`x${row.quantity}`);
			if (row.assemblyName) parts.push(`@ ${row.assemblyName}`);
			else if (row.assemblyId) parts.push(`@ ${row.assemblyId.slice(0, 10)}...`);
			return parts.length > 0 ? parts.join(" ") : (row.details ?? "-");
		},
		filterFn: excelFilterFn,
	},
	{
		id: "actions",
		header: "",
		size: 40,
		enableSorting: false,
		enableColumnFilter: false,
		cell: ({ row }) => {
			const event = row.original;
			if (event.source === "local" && event.sessionId) {
				return (
					<a
						href={`/logs/detail?sessionId=${event.sessionId}`}
						className="text-zinc-600 hover:text-cyan-400"
						title="Open in Log Analyzer"
					>
						<FileText size={14} />
					</a>
				);
			}
			return null;
		},
	},
];

// ── Channel Colors ───────────────────────────────────────────────────────────

export const CHANNEL_COLORS = {
	local: {
		ring: "border-green-400",
		dotActive: "bg-green-400",
		dotOff: "bg-zinc-600",
		dotError: "bg-red-500",
		btnBorder: "border-green-500/40",
		btnBg: "bg-green-500/10",
		btnText: "text-green-300",
	},
	chain: {
		ring: "border-orange-400",
		dotActive: "bg-orange-400",
		dotOff: "bg-zinc-600",
		dotError: "bg-red-500",
		btnBorder: "border-orange-500/40",
		btnBg: "bg-orange-500/10",
		btnText: "text-orange-300",
	},
} as const;

// ── Sonar Ping Animation ─────────────────────────────────────────────────────

function SonarPing({
	localActive,
	chainActive,
}: {
	localActive: boolean;
	chainActive: boolean;
}) {
	return (
		<div className="relative h-10 w-10 shrink-0">
			{localActive && (
				<>
					<span
						className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${CHANNEL_COLORS.local.ring} animate-[sonar-ring_5s_ease-out_infinite]`}
					/>
					<span
						className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${CHANNEL_COLORS.local.dotActive} animate-[sonar-dot_5s_ease-out_infinite]`}
					/>
				</>
			)}
			{chainActive && (
				<>
					<span
						className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${CHANNEL_COLORS.chain.ring} animate-[sonar-ring_15s_ease-out_infinite]`}
					/>
					<span
						className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${CHANNEL_COLORS.chain.dotActive} animate-[sonar-dot_15s_ease-out_infinite]`}
					/>
				</>
			)}
			<style>{`
				@keyframes sonar-ring {
					0% { width: 6px; height: 6px; opacity: 0.8; }
					60% { opacity: 0.3; }
					100% { width: 40px; height: 40px; opacity: 0; }
				}
				@keyframes sonar-dot {
					0% { width: 6px; height: 6px; opacity: 0.9; }
					40% { width: 6px; height: 6px; opacity: 0.6; }
					100% { width: 6px; height: 6px; opacity: 0; }
				}
			`}</style>
		</div>
	);
}

// ── Channel Toggle ───────────────────────────────────────────────────────────

function ChannelToggle({
	label,
	channel,
	enabled,
	status,
	onToggle,
}: {
	label: string;
	channel: "local" | "chain";
	enabled: boolean;
	status: SonarChannelStatus;
	onToggle: () => void;
}) {
	const c = CHANNEL_COLORS[channel];
	const dotColor = !enabled
		? c.dotOff
		: status === "active"
			? c.dotActive
			: status === "error"
				? c.dotError
				: c.dotOff;

	return (
		<button
			type="button"
			onClick={onToggle}
			className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
				enabled
					? `${c.btnBorder} ${c.btnBg} ${c.btnText} hover:brightness-125`
					: "border-zinc-800 bg-zinc-900 text-zinc-600 hover:bg-zinc-800"
			}`}
		>
			<span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
			{label}
		</button>
	);
}

// ── Tab Bar ──────────────────────────────────────────────────────────────────

type SonarTab = "pings" | "logFeed" | "chainFeed";

const SONAR_TABS: { id: SonarTab; label: string }[] = [
	{ id: "pings", label: "Pings" },
	{ id: "logFeed", label: "Log Feed" },
	{ id: "chainFeed", label: "Chain Feed" },
];

function SonarTabBar({
	activeTab,
	onTabChange,
}: {
	activeTab: SonarTab;
	onTabChange: (tab: SonarTab) => void;
}) {
	return (
		<div className="flex border-b border-zinc-800">
			{SONAR_TABS.map(({ id, label }) => (
				<button
					key={id}
					type="button"
					onClick={() => onTabChange(id)}
					className={`px-4 py-2.5 text-sm font-medium transition-colors ${
						activeTab === id
							? "border-b-2 border-teal-500 text-teal-400"
							: "text-zinc-500 hover:text-zinc-300"
					}`}
				>
					{label}
				</button>
			))}
		</div>
	);
}

// ── Ping Settings Labels ─────────────────────────────────────────────────────

const PING_TYPE_LABELS: Record<SonarEventType, string> = {
	system_change: "System Change (Jump)",
	item_deposited: "Item Deposited",
	item_withdrawn: "Item Withdrawn",
	item_minted: "Item Minted",
	item_burned: "Item Burned",
	chat: "Chat Message",
};

// ── Pings Tab ────────────────────────────────────────────────────────────────

function PingsTab() {
	const [showSettings, setShowSettings] = useState(false);
	const pingEventTypes = useSonarStore((s) => s.pingEventTypes);
	const pingAudioEnabled = useSonarStore((s) => s.pingAudioEnabled);
	const pingNotifyEnabled = useSonarStore((s) => s.pingNotifyEnabled);
	const setPingEventTypes = useSonarStore((s) => s.setPingEventTypes);
	const setPingAudioEnabled = useSonarStore((s) => s.setPingAudioEnabled);
	const setPingNotifyEnabled = useSonarStore((s) => s.setPingNotifyEnabled);

	const events = useLiveQuery(
		() => db.sonarEvents.orderBy("id").reverse().limit(1000).toArray(),
		[],
	);

	const filteredData = useMemo(() => {
		if (!events) return [];
		if (pingEventTypes.length === 0) return [];
		const typeSet = new Set<string>(pingEventTypes);
		return events.filter((e) => typeSet.has(e.eventType));
	}, [events, pingEventTypes]);

	function toggleEventType(type: SonarEventType) {
		if (pingEventTypes.includes(type)) {
			setPingEventTypes(pingEventTypes.filter((t) => t !== type));
		} else {
			setPingEventTypes([...pingEventTypes, type]);
		}
	}

	async function handleNotifyToggle() {
		if (!pingNotifyEnabled && Notification.permission !== "granted") {
			const perm = await Notification.requestPermission();
			if (perm !== "granted") return;
		}
		setPingNotifyEnabled(!pingNotifyEnabled);
	}

	return (
		<div className="flex h-full flex-col gap-3">
			{/* Settings toggle */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setShowSettings(!showSettings)}
						className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
							showSettings
								? "border-teal-500/40 bg-teal-500/10 text-teal-300"
								: "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
						}`}
					>
						<Settings size={12} />
						Ping Settings
					</button>
					<button
						type="button"
						onClick={() => setPingAudioEnabled(!pingAudioEnabled)}
						className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
							pingAudioEnabled
								? "border-amber-500/40 bg-amber-500/10 text-amber-300"
								: "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
						}`}
						title={pingAudioEnabled ? "Audio alerts on" : "Audio alerts off"}
					>
						{pingAudioEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
						Audio
					</button>
					<button
						type="button"
						onClick={handleNotifyToggle}
						className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
							pingNotifyEnabled
								? "border-blue-500/40 bg-blue-500/10 text-blue-300"
								: "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
						}`}
						title={
							pingNotifyEnabled
								? "Desktop notifications on"
								: "Desktop notifications off"
						}
					>
						{pingNotifyEnabled ? <Bell size={12} /> : <BellOff size={12} />}
						Notify
					</button>
				</div>
				<span className="text-xs text-zinc-600">
					{filteredData.length} ping{filteredData.length !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Collapsible settings panel */}
			{showSettings && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="mb-2 text-xs font-medium text-zinc-400">
						Alert on these event types:
					</p>
					<div className="flex flex-wrap gap-2">
						{(Object.keys(PING_TYPE_LABELS) as SonarEventType[]).map(
							(type) => (
								<label
									key={type}
									className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs transition-colors hover:border-zinc-700"
								>
									<input
										type="checkbox"
										checked={pingEventTypes.includes(type)}
										onChange={() => toggleEventType(type)}
										className="accent-teal-500"
									/>
									<span className="text-zinc-300">
										{PING_TYPE_LABELS[type]}
									</span>
								</label>
							),
						)}
					</div>
				</div>
			)}

			{/* Filtered DataGrid */}
			<div className="flex-1 overflow-hidden">
				<DataGrid
					columns={columns}
					data={filteredData}
					keyFn={(row) => String(row.id ?? 0)}
					searchPlaceholder="Search pings..."
					emptyMessage="No ping events. Adjust event type filters in Ping Settings above."
				/>
			</div>
		</div>
	);
}

// ── Log Feed Tab ─────────────────────────────────────────────────────────────

function LogFeedTab() {
	const hasAccess = useLogStore((s) => s.hasAccess);
	const miningRate = useLogStore((s) => s.miningRate);
	const miningOre = useLogStore((s) => s.miningOre);
	const dpsDealt = useLogStore((s) => s.dpsDealt);
	const dpsReceived = useLogStore((s) => s.dpsReceived);
	const activeSessionId = useLogStore((s) => s.activeSessionId);
	const grantAccess = useLogStore((s) => s.grantAccess);

	const recentEvents = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents
						.where("sessionId")
						.equals(activeSessionId)
						.reverse()
						.limit(50)
						.toArray()
				: [],
		[activeSessionId],
	);

	// Session totals
	const sessionMining = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents
						.where("[sessionId+type]")
						.equals([activeSessionId, "mining"])
						.toArray()
				: [],
		[activeSessionId],
	);
	const totalMined = sessionMining?.reduce((sum, e) => sum + (e.amount ?? 0), 0) ?? 0;

	const sessionDamageDealt = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents
						.where("[sessionId+type]")
						.equals([activeSessionId, "combat_dealt"])
						.toArray()
				: [],
		[activeSessionId],
	);
	const totalDamageDealt =
		sessionDamageDealt?.reduce((sum, e) => sum + (e.damage ?? 0), 0) ?? 0;

	const sessionDamageRecv = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents
						.where("[sessionId+type]")
						.equals([activeSessionId, "combat_received"])
						.toArray()
				: [],
		[activeSessionId],
	);
	const totalDamageRecv =
		sessionDamageRecv?.reduce((sum, e) => sum + (e.damage ?? 0), 0) ?? 0;

	if (!hasAccess) {
		if (!grantAccess) {
			return (
				<p className="py-8 text-center text-sm text-zinc-600">
					Log watcher not initialized. Navigate to the Log Analyzer to grant access.
				</p>
			);
		}
		return <GrantAccessView onGrant={grantAccess} />;
	}

	return (
		<div className="space-y-4">
			{/* Live stat cards */}
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard
					label="Mining Rate"
					value={`${Math.round(miningRate)}/min`}
					sub={miningOre ?? "--"}
					color="text-amber-400"
					icon={Pickaxe}
					active={miningRate > 0}
				/>
				<StatCard
					label="DPS Dealt"
					value={dpsDealt.toFixed(1)}
					sub="damage/sec"
					color="text-cyan-400"
					icon={Swords}
					active={dpsDealt > 0}
				/>
				<StatCard
					label="DPS Received"
					value={dpsReceived.toFixed(1)}
					sub="damage/sec"
					color="text-red-400"
					icon={Swords}
					active={dpsReceived > 0}
				/>
				<StatCard
					label="Session Totals"
					value={totalMined.toLocaleString()}
					sub={`ore mined | ${totalDamageDealt.toLocaleString()} dealt | ${totalDamageRecv.toLocaleString()} recv`}
					color="text-zinc-300"
					icon={Activity}
				/>
			</div>

			{/* Activity feed */}
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium text-zinc-400">Activity Feed</h3>
				<Link
					to="/logs/detail"
					className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
				>
					<FileText size={12} />
					Open Analyzer
				</Link>
			</div>
			<div className="space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
				{(!recentEvents || recentEvents.length === 0) && (
					<p className="py-8 text-center text-sm text-zinc-600">
						Waiting for game log events...
					</p>
				)}
				{recentEvents?.map((event) => (
					<LogEventRow key={event.id} event={event} />
				))}
			</div>
		</div>
	);
}

// ── Chain Feed Tab ───────────────────────────────────────────────────────────

function ChainFeedTab() {
	const events = useLiveQuery(
		() =>
			db.sonarEvents
				.where("source")
				.equals("chain")
				.reverse()
				.limit(1000)
				.toArray(),
		[],
	);

	const data = useMemo(() => events ?? [], [events]);

	return (
		<div className="flex h-full flex-col gap-3">
			<div className="flex-1 overflow-hidden">
				<DataGrid
					columns={columns}
					data={data}
					keyFn={(row) => String(row.id ?? 0)}
					searchPlaceholder="Search chain events..."
					emptyMessage="No chain events. Enable Chain Sonar to monitor SSU inventory activity."
				/>
			</div>
		</div>
	);
}

// ── Main View ────────────────────────────────────────────────────────────────

export function Sonar() {
	const localEnabled = useSonarStore((s) => s.localEnabled);
	const chainEnabled = useSonarStore((s) => s.chainEnabled);
	const localStatus = useSonarStore((s) => s.localStatus);
	const chainStatus = useSonarStore((s) => s.chainStatus);
	const setLocalEnabled = useSonarStore((s) => s.setLocalEnabled);
	const setChainEnabled = useSonarStore((s) => s.setChainEnabled);
	const activeTab = useSonarStore((s) => s.activeTab);
	const setActiveTab = useSonarStore((s) => s.setActiveTab);

	return (
		<div className="flex h-full flex-col gap-4 p-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<SonarPing
						localActive={localStatus === "active"}
						chainActive={chainStatus === "active"}
					/>
					<h1 className="text-lg font-semibold text-zinc-100">Sonar</h1>
				</div>
				<div className="flex items-center gap-2">
					<ChannelToggle
						label="Log"
						channel="local"
						enabled={localEnabled}
						status={localStatus}
						onToggle={() => setLocalEnabled(!localEnabled)}
					/>
					<ChannelToggle
						label="Chain"
						channel="chain"
						enabled={chainEnabled}
						status={chainStatus}
						onToggle={() => setChainEnabled(!chainEnabled)}
					/>
					<Link
						to="/logs/detail"
						className="ml-2 flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					>
						<FileText size={12} />
						Open Analyzer
					</Link>
				</div>
			</div>

			{/* Tab Bar */}
			<SonarTabBar activeTab={activeTab} onTabChange={setActiveTab} />

			{/* Tab Content */}
			<div className="flex-1 overflow-hidden">
				{activeTab === "pings" && <PingsTab />}
				{activeTab === "logFeed" && <LogFeedTab />}
				{activeTab === "chainFeed" && <ChainFeedTab />}
			</div>
		</div>
	);
}
