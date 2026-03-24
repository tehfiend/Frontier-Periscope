import { type ColumnDef, DataGrid, excelFilterFn } from "@/components/DataGrid";
import { ContactPicker } from "@/components/ContactPicker";
import { GrantAccessView } from "@/components/GrantAccessView";
import { LogEventRow } from "@/components/LogEventRow";
import { StatCard } from "@/components/StatCard";
import {
	ChatTab,
	CombatTab,
	MiningTab,
	SessionDetailView,
	SessionsTab,
	StructuresTab,
	TravelTab,
} from "@/components/log-analyzer";
import { db } from "@/db";
import type {
	ManifestTribe,
	SonarChannelStatus,
	SonarEvent,
	SonarEventType,
	SonarWatchItem,
} from "@/db/types";
import {
	addWatchItem,
	removeWatchItem,
	updateWatchItem,
	useWatchlistFilter,
} from "@/hooks/useSonarWatchlist";
import { requestDirectoryAccess } from "@/lib/logFileAccess";
import { useLogStore } from "@/stores/logStore";
import { useSonarStore } from "@/stores/sonarStore";
import { useLiveQuery } from "dexie-react-hooks";
import {
	Activity,
	Bell,
	BellOff,
	ChevronDown,
	ChevronRight,
	CircleOff,
	Clock,
	Eye,
	EyeOff,
	FolderOpen,
	Landmark,
	MessageSquare,
	Navigation,
	Pickaxe,
	Plus,
	Radio,
	Search,
	Settings,
	Swords,
	Trash2,
	UserPlus,
	Users,
	Volume2,
	VolumeX,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// ── Event Type Color Badges ──────────────────────────────────────────────────

/** Color category for event type badges. */
function getEventBadgeColor(eventType: string): string {
	switch (eventType) {
		// Red -- combat / bounty
		case "killmail":
		case "bounty_posted":
		case "bounty_claimed":
		case "bounty_cancelled":
			return "bg-red-500/15 text-red-400";
		// Blue -- navigation / gate
		case "jump":
		case "gate_linked":
		case "jump_permit_issued":
		case "access_granted":
			return "bg-blue-500/15 text-blue-400";
		// Green -- market / trade
		case "market_sell_posted":
		case "market_buy_posted":
		case "market_buy_filled":
		case "market_buy_cancelled":
		case "market_sell_cancelled":
		case "ssu_market_buy_filled":
		case "ssu_market_transfer":
		case "ssu_market_sell_cancelled":
		case "exchange_order_placed":
		case "exchange_order_cancelled":
		case "exchange_trade":
			return "bg-green-500/15 text-green-400";
		// Orange -- fuel / energy
		case "fuel":
		case "energy_start":
		case "energy_stop":
		case "energy_reserved":
		case "energy_released":
			return "bg-orange-500/15 text-orange-400";
		// Gray -- admin / structure lifecycle
		case "assembly_created":
		case "gate_created":
		case "storage_unit_created":
		case "turret_created":
		case "network_node_created":
		case "status_changed":
		case "metadata_changed":
		case "location_revealed":
		case "lease_created":
		case "rent_collected":
		case "lease_cancelled":
			return "bg-zinc-500/15 text-zinc-400";
		// Teal -- inventory
		case "item_deposited":
		case "item_withdrawn":
		case "item_minted":
		case "item_burned":
		case "item_destroyed":
			return "bg-teal-500/15 text-teal-400";
		// Default
		default:
			return "bg-zinc-500/15 text-zinc-400";
	}
}

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
		size: 160,
		cell: ({ getValue }) => {
			const type = getValue() as string;
			const badgeColor = getEventBadgeColor(type);
			return (
				<span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${badgeColor}`}>
					{type.replace(/_/g, " ")}
				</span>
			);
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
				return row.systemName ? `Entered ${row.systemName}` : (row.details ?? "-");
			}
			// Chain events -- prefer details field when present (new handler events)
			if (row.details) return row.details;
			// Fallback for inventory events with structured fields
			const parts: string[] = [];
			if (row.typeName) parts.push(row.typeName);
			else if (row.typeId) parts.push(`type #${row.typeId}`);
			if (row.quantity != null) parts.push(`x${row.quantity}`);
			if (row.assemblyName) parts.push(`@ ${row.assemblyName}`);
			else if (row.assemblyId) parts.push(`@ ${row.assemblyId.slice(0, 10)}...`);
			return parts.length > 0 ? parts.join(" ") : "-";
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
					<button
						type="button"
						onClick={() => {
							useSonarStore.getState().setActiveTab("logFeed");
							useLogStore.getState().setActiveTab("sessions");
							useLogStore.getState().setSelectedSessionId(event.sessionId ?? "");
						}}
						className="text-zinc-600 hover:text-cyan-400"
						title="View session in Log Feed"
					>
						<Clock size={14} />
					</button>
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

type SonarTab = "pings" | "logFeed" | "chainFeed" | "watchlist";

const SONAR_TABS: { id: SonarTab; label: string }[] = [
	{ id: "pings", label: "Pings" },
	{ id: "logFeed", label: "Log Feed" },
	{ id: "chainFeed", label: "Chain Feed" },
	{ id: "watchlist", label: "Watchlist" },
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

// ── Ping Type Categories ──────────────────────────────────────────────────────

interface PingCategory {
	label: string;
	types: Partial<Record<SonarEventType, string>>;
}

const PING_CATEGORIES: PingCategory[] = [
	{
		label: "Log Events",
		types: {
			system_change: "System Change (Jump)",
			chat: "Chat Message",
		},
	},
	{
		label: "Inventory",
		types: {
			item_deposited: "Item Deposited",
			item_withdrawn: "Item Withdrawn",
			item_minted: "Item Minted",
			item_burned: "Item Burned",
			item_destroyed: "Item Destroyed",
		},
	},
	{
		label: "Combat / Intel",
		types: {
			killmail: "Killmail",
			bounty_posted: "Bounty Posted",
			bounty_claimed: "Bounty Claimed",
			bounty_cancelled: "Bounty Cancelled",
		},
	},
	{
		label: "Navigation",
		types: {
			jump: "Jump",
			gate_linked: "Gate Linked",
			jump_permit_issued: "Jump Permit Issued",
			toll_collected: "Toll Collected",
			access_granted: "Access Granted",
		},
	},
	{
		label: "Fuel / Energy",
		types: {
			fuel: "Fuel",
			energy_start: "Energy Start",
			energy_stop: "Energy Stop",
			energy_reserved: "Energy Reserved",
			energy_released: "Energy Released",
		},
	},
	{
		label: "Structure Lifecycle",
		types: {
			assembly_created: "Assembly Created",
			gate_created: "Gate Created",
			storage_unit_created: "SSU Created",
			turret_created: "Turret Created",
			network_node_created: "Network Node Created",
			status_changed: "Status Changed",
			metadata_changed: "Metadata Changed",
			location_revealed: "Location Revealed",
		},
	},
	{
		label: "Market",
		types: {
			market_sell_posted: "Sell Listing Posted",
			market_buy_posted: "Buy Order Posted",
			market_buy_filled: "Buy Order Filled",
			market_buy_cancelled: "Buy Order Cancelled",
			market_sell_cancelled: "Sell Listing Cancelled",
			ssu_market_buy_filled: "SSU Buy Order Filled",
			ssu_market_transfer: "SSU Transfer",
			ssu_market_sell_cancelled: "SSU Sell Cancelled",
		},
	},
	{
		label: "Lease / Exchange",
		types: {
			lease_created: "Lease Created",
			rent_collected: "Rent Collected",
			lease_cancelled: "Lease Cancelled",
			exchange_order_placed: "Exchange Order Placed",
			exchange_order_cancelled: "Exchange Order Cancelled",
			exchange_trade: "Exchange Trade",
		},
	},
];

/** Flat lookup of all sonar event type -> display label. */
const _PING_TYPE_LABELS: Record<SonarEventType, string> = Object.fromEntries(
	PING_CATEGORIES.flatMap((cat) => Object.entries(cat.types)),
) as Record<SonarEventType, string>;

// ── Ping Settings Panel (Collapsible Categories) ─────────────────────────────

function PingSettingsPanel({
	pingEventTypes,
	onToggle,
}: {
	pingEventTypes: Set<SonarEventType>;
	onToggle: (type: SonarEventType) => void;
}) {
	const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
		() => new Set(["Log Events", "Inventory", "Combat / Intel"]),
	);

	function toggleCategory(label: string) {
		setExpandedCategories((prev) => {
			const next = new Set(prev);
			if (next.has(label)) next.delete(label);
			else next.add(label);
			return next;
		});
	}

	function toggleAllInCategory(cat: PingCategory) {
		const types = Object.keys(cat.types) as SonarEventType[];
		const allChecked = types.every((t) => pingEventTypes.has(t));
		for (const t of types) {
			if (allChecked) {
				if (pingEventTypes.has(t)) onToggle(t);
			} else {
				if (!pingEventTypes.has(t)) onToggle(t);
			}
		}
	}

	return (
		<div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
			<p className="mb-2 text-xs font-medium text-zinc-400">Alert on these event types:</p>
			<div className="space-y-1">
				{PING_CATEGORIES.map((cat) => {
					const isExpanded = expandedCategories.has(cat.label);
					const types = Object.keys(cat.types) as SonarEventType[];
					const checkedCount = types.filter((t) => pingEventTypes.has(t)).length;
					return (
						<div key={cat.label}>
							<div className="flex items-center gap-1">
								<button
									type="button"
									onClick={() => toggleCategory(cat.label)}
									className="flex flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
								>
									{isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
									{cat.label}
									<span className="text-zinc-600">
										({checkedCount}/{types.length})
									</span>
								</button>
								<button
									type="button"
									onClick={() => toggleAllInCategory(cat)}
									className="rounded px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
								>
									{checkedCount === types.length ? "none" : "all"}
								</button>
							</div>
							{isExpanded && (
								<div className="ml-4 flex flex-wrap gap-1.5 pb-1 pt-0.5">
									{types.map((type) => (
										<label
											key={type}
											className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1 text-xs transition-colors hover:border-zinc-700"
										>
											<input
												type="checkbox"
												checked={pingEventTypes.has(type)}
												onChange={() => onToggle(type)}
												className="accent-teal-500"
											/>
											<span className="text-zinc-300">{cat.types[type]}</span>
										</label>
									))}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ── Pings Tab ────────────────────────────────────────────────────────────────

function PingsTab() {
	const [showSettings, setShowSettings] = useState(false);
	const pingEventTypes = useSonarStore((s) => s.pingEventTypes);
	const pingAudioEnabled = useSonarStore((s) => s.pingAudioEnabled);
	const pingNotifyEnabled = useSonarStore((s) => s.pingNotifyEnabled);
	const setPingEventTypes = useSonarStore((s) => s.setPingEventTypes);
	const setPingAudioEnabled = useSonarStore((s) => s.setPingAudioEnabled);
	const setPingNotifyEnabled = useSonarStore((s) => s.setPingNotifyEnabled);
	const { matchesWatchlist, isOwnedEvent } = useWatchlistFilter();

	const events = useLiveQuery(
		() => db.sonarEvents.orderBy("id").reverse().limit(1000).toArray(),
		[],
	);

	const filteredData = useMemo(() => {
		if (!events) return [];
		if (pingEventTypes.size === 0) return [];
		return events.filter((e) => {
			const watchItem = matchesWatchlist(e);
			if (watchItem) {
				// Watched item with per-item overrides
				if (watchItem.pingEventTypes) {
					return watchItem.pingEnabled && watchItem.pingEventTypes.includes(e.eventType);
				}
				// Watched item using global defaults
				return watchItem.pingEnabled && pingEventTypes.has(e.eventType);
			}
			// Owned entity or unattributed -- use global types
			return pingEventTypes.has(e.eventType);
		});
	}, [events, pingEventTypes, matchesWatchlist]);

	// Augment columns with a "Watchlist" badge for watched entities
	const pingColumns = useMemo((): ColumnDef<SonarEvent, unknown>[] => {
		const badgeCol: ColumnDef<SonarEvent, unknown> = {
			id: "watchBadge",
			header: "",
			size: 60,
			enableSorting: false,
			enableColumnFilter: false,
			cell: ({ row }) => {
				const event = row.original;
				const watched = matchesWatchlist(event);
				if (watched) {
					return (
						<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
							Watchlist
						</span>
					);
				}
				return null;
			},
		};
		return [...columns, badgeCol];
	}, [matchesWatchlist]);

	function toggleEventType(type: SonarEventType) {
		const next = new Set(pingEventTypes);
		if (next.has(type)) next.delete(type);
		else next.add(type);
		setPingEventTypes(next);
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
						title={pingNotifyEnabled ? "Desktop notifications on" : "Desktop notifications off"}
					>
						{pingNotifyEnabled ? <Bell size={12} /> : <BellOff size={12} />}
						Notify
					</button>
				</div>
				<span className="text-xs text-zinc-600">
					{filteredData.length} ping{filteredData.length !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Collapsible settings panel with categories */}
			{showSettings && (
				<PingSettingsPanel pingEventTypes={pingEventTypes} onToggle={toggleEventType} />
			)}

			{/* Filtered DataGrid */}
			<div className="flex-1 overflow-hidden">
				<DataGrid
					columns={pingColumns}
					data={filteredData}
					keyFn={(row) => String(row.id ?? 0)}
					searchPlaceholder="Search pings..."
					emptyMessage="No ping events. Adjust event type filters in Ping Settings above."
				/>
			</div>
		</div>
	);
}

// ── Log Feed Sub-Tab Bar ─────────────────────────────────────────────────────

type LogFeedSubTab =
	| "activity"
	| "sessions"
	| "mining"
	| "combat"
	| "travel"
	| "structures"
	| "chat";

const LOG_FEED_SUB_TABS: { id: LogFeedSubTab; label: string; icon: typeof Activity }[] = [
	{ id: "activity", label: "Activity", icon: Activity },
	{ id: "sessions", label: "Sessions", icon: Clock },
	{ id: "mining", label: "Mining", icon: Pickaxe },
	{ id: "combat", label: "Combat", icon: Swords },
	{ id: "travel", label: "Travel", icon: Navigation },
	{ id: "structures", label: "Structures", icon: Landmark },
	{ id: "chat", label: "Chat", icon: MessageSquare },
];

// ── Activity Feed (default sub-tab content) ─────────────────────────────────

function ActivityFeed() {
	const activeSessionId = useLogStore((s) => s.activeSessionId);
	const clearAndReimport = useLogStore((s) => s.clearAndReimport);

	const recentEvents = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents.where("sessionId").equals(activeSessionId).reverse().limit(50).toArray()
				: [],
		[activeSessionId],
	);

	return (
		<div className="space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
			{(!recentEvents || recentEvents.length === 0) && (
				<div className="flex flex-col items-center gap-3 py-8">
					<p className="text-sm text-zinc-600">
						{activeSessionId ? "No events in this session yet." : "Waiting for game log events..."}
					</p>
					{clearAndReimport && (
						<button
							type="button"
							onClick={clearAndReimport}
							className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						>
							Reimport all logs
						</button>
					)}
				</div>
			)}
			{recentEvents?.map((event) => (
				<LogEventRow key={event.id} event={event} />
			))}
		</div>
	);
}

// ── Log Feed Tab ─────────────────────────────────────────────────────────────

function LogFeedTab() {
	const hasAccess = useLogStore((s) => s.hasAccess);
	const isWatching = useLogStore((s) => s.isWatching);
	const miningRate = useLogStore((s) => s.miningRate);
	const miningOre = useLogStore((s) => s.miningOre);
	const dpsDealt = useLogStore((s) => s.dpsDealt);
	const dpsReceived = useLogStore((s) => s.dpsReceived);
	const activeSessionId = useLogStore((s) => s.activeSessionId);
	const grantAccess = useLogStore((s) => s.grantAccess);
	const clearAndReimport = useLogStore((s) => s.clearAndReimport);
	const activeSubTab = useLogStore((s) => s.activeTab);
	const setActiveSubTab = useLogStore((s) => s.setActiveTab);
	const selectedSessionId = useLogStore((s) => s.selectedSessionId);

	// Session totals
	const sessionMining = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents.where("[sessionId+type]").equals([activeSessionId, "mining"]).toArray()
				: [],
		[activeSessionId],
	);
	const totalMined = sessionMining?.reduce((sum, e) => sum + (e.amount ?? 0), 0) ?? 0;

	const sessionDamageDealt = useLiveQuery(
		() =>
			activeSessionId
				? db.logEvents.where("[sessionId+type]").equals([activeSessionId, "combat_dealt"]).toArray()
				: [],
		[activeSessionId],
	);
	const totalDamageDealt = sessionDamageDealt?.reduce((sum, e) => sum + (e.damage ?? 0), 0) ?? 0;

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
	const totalDamageRecv = sessionDamageRecv?.reduce((sum, e) => sum + (e.damage ?? 0), 0) ?? 0;

	if (!hasAccess) {
		if (!grantAccess) {
			return (
				<p className="py-8 text-center text-sm text-zinc-600">
					Log watcher not initialized. Grant access to your game log directory to enable log
					analysis.
				</p>
			);
		}
		return <GrantAccessView onGrant={grantAccess} />;
	}

	// If a session is selected in SessionsTab, show the detail view
	if (selectedSessionId) {
		return <SessionDetailView />;
	}

	async function handleChangeDir() {
		const handle = await requestDirectoryAccess();
		if (handle && grantAccess) grantAccess(handle);
	}

	return (
		<div className="flex h-full flex-col gap-3">
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

			{/* Header controls row */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					{clearAndReimport && (
						<button
							type="button"
							onClick={clearAndReimport}
							className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:border-red-800 hover:text-red-400"
							title="Clear all parsed data and reimport from logs"
						>
							<Trash2 size={12} />
							Clear &amp; Reimport
						</button>
					)}
					<button
						type="button"
						onClick={handleChangeDir}
						className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
						title="Change log directory"
					>
						<FolderOpen size={12} />
						Change Dir
					</button>
				</div>
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

			{/* Sub-tab bar */}
			<div className="flex border-b border-zinc-800">
				{LOG_FEED_SUB_TABS.map(({ id, label, icon: Icon }) => (
					<button
						key={id}
						type="button"
						onClick={() => setActiveSubTab(id)}
						className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
							activeSubTab === id
								? "border-b-2 border-teal-500 text-teal-400"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						<Icon size={14} />
						{label}
					</button>
				))}
			</div>

			{/* Sub-tab content */}
			<div className="flex-1 overflow-y-auto">
				{activeSubTab === "activity" && <ActivityFeed />}
				{activeSubTab === "sessions" && <SessionsTab />}
				{activeSubTab === "mining" && <MiningTab />}
				{activeSubTab === "combat" && <CombatTab />}
				{activeSubTab === "travel" && <TravelTab />}
				{activeSubTab === "structures" && <StructuresTab />}
				{activeSubTab === "chat" && <ChatTab />}
			</div>
		</div>
	);
}

// ── Tribe Picker ─────────────────────────────────────────────────────────────

function TribePicker({ onSelect }: { onSelect: (tribe: ManifestTribe) => void }) {
	const [query, setQuery] = useState("");

	const results = useLiveQuery(async () => {
		if (query.length < 2) return [];
		const q = query.toLowerCase();
		return db.manifestTribes
			.filter((t) => t.name.toLowerCase().includes(q) || t.nameShort.toLowerCase().includes(q))
			.limit(10)
			.toArray();
	}, [query]);

	return (
		<div className="relative">
			<div className="relative">
				<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search tribes..."
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>
			{results && results.length > 0 && (
				<div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
					{results.map((tribe) => (
						<button
							key={tribe.id}
							type="button"
							onClick={() => {
								onSelect(tribe);
								setQuery("");
							}}
							className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-zinc-800"
						>
							<Users size={14} className="shrink-0 text-zinc-500" />
							<span className="text-sm font-medium text-zinc-100">{tribe.name}</span>
							{tribe.nameShort && (
								<span className="text-xs text-zinc-500">[{tribe.nameShort}]</span>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// ── Watch Item Ping Settings ─────────────────────────────────────────────────

function WatchItemPingSettings({ item }: { item: SonarWatchItem }) {
	const useGlobalDefaults = !item.pingEventTypes;
	const localTypes = useMemo(
		() => new Set<SonarEventType>(item.pingEventTypes ?? []),
		[item.pingEventTypes],
	);

	function handleToggleGlobal() {
		if (useGlobalDefaults) {
			// Switch to custom -- initialize with current global defaults
			const globalTypes = useSonarStore.getState().pingEventTypes;
			updateWatchItem(item.id, { pingEventTypes: [...globalTypes] });
		} else {
			// Switch back to global defaults
			updateWatchItem(item.id, { pingEventTypes: undefined });
		}
	}

	function handleToggleType(type: SonarEventType) {
		const next = new Set(localTypes);
		if (next.has(type)) next.delete(type);
		else next.add(type);
		updateWatchItem(item.id, { pingEventTypes: [...next] });
	}

	return (
		<div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
			<label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
				<input
					type="checkbox"
					checked={useGlobalDefaults}
					onChange={handleToggleGlobal}
					className="accent-teal-500"
				/>
				Use global defaults
			</label>
			{!useGlobalDefaults && (
				<div className="mt-2">
					<PingSettingsPanel pingEventTypes={localTypes} onToggle={handleToggleType} />
				</div>
			)}
		</div>
	);
}

// ── Watchlist Tab ────────────────────────────────────────────────────────────

function WatchlistTab() {
	const { items } = useWatchlistFilter();
	const [showAddCharacter, setShowAddCharacter] = useState(false);
	const [showAddTribe, setShowAddTribe] = useState(false);
	const [expandedSettings, setExpandedSettings] = useState<Set<string>>(new Set());

	const handleAddCharacter = useCallback(
		(mc: { characterItemId: string; name: string; suiAddress: string; tribeId: number }) => {
			addWatchItem({
				kind: "character",
				characterId: mc.characterItemId,
				characterName: mc.name,
				suiAddress: mc.suiAddress,
				tribeId: mc.tribeId || undefined,
				pingEnabled: true,
			});
			setShowAddCharacter(false);
		},
		[],
	);

	const handleAddTribe = useCallback((tribe: ManifestTribe) => {
		addWatchItem({
			kind: "tribe",
			tribeId: tribe.id,
			tribeName: tribe.name,
			pingEnabled: true,
		});
		setShowAddTribe(false);
	}, []);

	function toggleSettings(id: string) {
		setExpandedSettings((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	// Get last event timestamp for each watched item
	const lastEventMap = useLiveQuery(async () => {
		const map = new Map<string, string>();
		for (const item of items) {
			let event: SonarEvent | undefined;
			if (item.kind === "character" && item.characterId) {
				event = await db.sonarEvents
					.where("characterId")
					.equals(item.characterId)
					.reverse()
					.first();
			} else if (item.kind === "tribe" && item.tribeId) {
				event = await db.sonarEvents
					.where("tribeId")
					.equals(item.tribeId)
					.reverse()
					.first();
			}
			if (event) map.set(item.id, event.timestamp);
		}
		return map;
	}, [items]);

	return (
		<div className="flex h-full flex-col gap-3">
			{/* Action buttons */}
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => {
						setShowAddCharacter(!showAddCharacter);
						setShowAddTribe(false);
					}}
					className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
						showAddCharacter
							? "border-teal-500/40 bg-teal-500/10 text-teal-300"
							: "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
					}`}
				>
					<UserPlus size={12} />
					Add Character
				</button>
				<button
					type="button"
					onClick={() => {
						setShowAddTribe(!showAddTribe);
						setShowAddCharacter(false);
					}}
					className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
						showAddTribe
							? "border-teal-500/40 bg-teal-500/10 text-teal-300"
							: "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
					}`}
				>
					<Plus size={12} />
					Add Tribe
				</button>
				<span className="ml-auto text-xs text-zinc-600">
					{items.length} watched {items.length !== 1 ? "items" : "item"}
				</span>
			</div>

			{/* Add character picker */}
			{showAddCharacter && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<ContactPicker
						onSelect={handleAddCharacter}
						placeholder="Search characters to watch..."
					/>
				</div>
			)}

			{/* Add tribe picker */}
			{showAddTribe && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<TribePicker onSelect={handleAddTribe} />
				</div>
			)}

			{/* Watchlist items */}
			<div className="flex-1 space-y-2 overflow-y-auto">
				{items.length === 0 ? (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
						<p className="text-sm text-zinc-500">
							No watched entities. Add characters or tribes to monitor their chain activity.
						</p>
					</div>
				) : (
					items.map((item) => {
						const lastEvent = lastEventMap?.get(item.id);
						return (
							<div
								key={item.id}
								className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
							>
								<div className="flex items-center gap-3">
									{/* Kind badge */}
									<span
										className={`rounded px-2 py-0.5 text-xs font-medium ${
											item.kind === "character"
												? "bg-cyan-500/15 text-cyan-400"
												: "bg-purple-500/15 text-purple-400"
										}`}
									>
										{item.kind === "character" ? "Character" : "Tribe"}
									</span>

									{/* Name */}
									<div className="min-w-0 flex-1">
										<span className="text-sm font-medium text-zinc-100">
											{item.kind === "character"
												? item.characterName || "Unknown"
												: item.tribeName || `Tribe #${item.tribeId}`}
										</span>
										{item.notes && (
											<p className="truncate text-xs text-zinc-500">{item.notes}</p>
										)}
									</div>

									{/* Last event */}
									{lastEvent && (
										<span className="text-xs text-zinc-600" title="Last event">
											<Clock size={10} className="mr-1 inline" />
											{new Date(lastEvent).toLocaleString()}
										</span>
									)}

									{/* Ping status toggle */}
									<button
										type="button"
										onClick={() =>
											updateWatchItem(item.id, { pingEnabled: !item.pingEnabled })
										}
										className={`rounded p-1 transition-colors ${
											item.pingEnabled
												? "text-teal-400 hover:text-teal-300"
												: "text-zinc-600 hover:text-zinc-400"
										}`}
										title={item.pingEnabled ? "Pings enabled" : "Pings disabled"}
									>
										{item.pingEnabled ? <Eye size={14} /> : <EyeOff size={14} />}
									</button>

									{/* Settings toggle */}
									<button
										type="button"
										onClick={() => toggleSettings(item.id)}
										className="rounded p-1 text-zinc-600 transition-colors hover:text-zinc-400"
										title="Ping settings"
									>
										<Settings size={14} />
									</button>

									{/* Remove */}
									<button
										type="button"
										onClick={() => removeWatchItem(item.id)}
										className="rounded p-1 text-zinc-600 transition-colors hover:text-red-400"
										title="Remove"
									>
										<Trash2 size={14} />
									</button>
								</div>

								{/* Collapsible per-item ping settings */}
								{expandedSettings.has(item.id) && <WatchItemPingSettings item={item} />}
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}

// ── Chain Feed Tab ───────────────────────────────────────────────────────────

function ChainFeedTab() {
	const events = useLiveQuery(
		() => db.sonarEvents.where("source").equals("chain").reverse().limit(1000).toArray(),
		[],
	);
	const { matchesWatchlist, isOwnedEvent } = useWatchlistFilter();

	const data = useMemo(() => {
		if (!events) return [];
		return events.filter((e) => {
			if (matchesWatchlist(e) !== null) return true;
			if (isOwnedEvent(e)) return true;
			// No character/tribe attribution = global event, always show
			if (!e.characterId && !e.tribeId) return true;
			return false;
		});
	}, [events, matchesWatchlist, isOwnedEvent]);

	// Augment columns with a "Source" badge column for watched items
	const chainColumns = useMemo((): ColumnDef<SonarEvent, unknown>[] => {
		const badgeCol: ColumnDef<SonarEvent, unknown> = {
			id: "watchBadge",
			header: "",
			size: 60,
			enableSorting: false,
			enableColumnFilter: false,
			cell: ({ row }) => {
				const event = row.original;
				const watched = matchesWatchlist(event);
				if (watched) {
					return (
						<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
							Watched
						</span>
					);
				}
				return null;
			},
		};
		return [...columns, badgeCol];
	}, [matchesWatchlist]);

	return (
		<div className="flex h-full flex-col gap-3">
			<div className="flex-1 overflow-hidden">
				<DataGrid
					columns={chainColumns}
					data={data}
					keyFn={(row) => String(row.id ?? 0)}
					searchPlaceholder="Search chain events..."
					emptyMessage="No chain events. Enable Chain Sonar to monitor jumps, killmails, inventory, market, and structure events."
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
				</div>
			</div>

			{/* Tab Bar */}
			<SonarTabBar activeTab={activeTab} onTabChange={setActiveTab} />

			{/* Tab Content */}
			<div className="flex-1 overflow-hidden">
				{activeTab === "pings" && <PingsTab />}
				{activeTab === "logFeed" && <LogFeedTab />}
				{activeTab === "chainFeed" && <ChainFeedTab />}
				{activeTab === "watchlist" && <WatchlistTab />}
			</div>
		</div>
	);
}
