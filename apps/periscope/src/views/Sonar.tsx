import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "@tanstack/react-router";
import { db } from "@/db";
import { useSonarStore } from "@/stores/sonarStore";
import { DataGrid, excelFilterFn, type ColumnDef } from "@/components/DataGrid";
import type { SonarEvent, SonarChannelStatus } from "@/db/types";
import { FileText } from "lucide-react";

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
// Local = orange, Chain = cyan — distinct and consistent across all UI elements

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
			{/* Local: ring + center dot that fades with it (green, 5s) */}
			{localActive && (
				<>
					<span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${CHANNEL_COLORS.local.ring} animate-[sonar-ring_5s_ease-out_infinite]`} />
					<span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${CHANNEL_COLORS.local.dotActive} animate-[sonar-dot_5s_ease-out_infinite]`} />
				</>
			)}
			{/* Chain: ring + center dot that fades with it (orange, 15s) */}
			{chainActive && (
				<>
					<span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${CHANNEL_COLORS.chain.ring} animate-[sonar-ring_15s_ease-out_infinite]`} />
					<span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${CHANNEL_COLORS.chain.dotActive} animate-[sonar-dot_15s_ease-out_infinite]`} />
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

// ── Channel Status Dots (for header, next to title) ──────────────────────────

function ChannelDots({
	localStatus,
	chainStatus,
}: {
	localStatus: SonarChannelStatus;
	chainStatus: SonarChannelStatus;
}) {
	function dotClass(status: SonarChannelStatus, channel: "local" | "chain") {
		const c = CHANNEL_COLORS[channel];
		if (status === "active") return c.dotActive;
		if (status === "error") return c.dotError;
		return c.dotOff;
	}

	return (
		<div className="flex items-center gap-1">
			<span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass(localStatus, "local")}`} title="Local Sonar" />
			<span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass(chainStatus, "chain")}`} title="Chain Sonar" />
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
	const dotColor = !enabled ? c.dotOff : status === "active" ? c.dotActive : status === "error" ? c.dotError : c.dotOff;

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

// ── Main View ────────────────────────────────────────────────────────────────

export function Sonar() {
	const localEnabled = useSonarStore((s) => s.localEnabled);
	const chainEnabled = useSonarStore((s) => s.chainEnabled);
	const localStatus = useSonarStore((s) => s.localStatus);
	const chainStatus = useSonarStore((s) => s.chainStatus);
	const setLocalEnabled = useSonarStore((s) => s.setLocalEnabled);
	const setChainEnabled = useSonarStore((s) => s.setChainEnabled);

	// Live query on sonarEvents, sorted newest first
	const events = useLiveQuery(
		() => db.sonarEvents.orderBy("id").reverse().limit(1000).toArray(),
		[],
	);

	const data = useMemo(() => events ?? [], [events]);

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

			{/* DataGrid */}
			<div className="flex-1 overflow-hidden">
				<DataGrid
					columns={columns}
					data={data}
					keyFn={(row) => String(row.id ?? 0)}
					searchPlaceholder="Search sonar events..."
					emptyMessage="No sonar events yet. Enable channels above and ensure log files are accessible."
				/>
			</div>
		</div>
	);
}
