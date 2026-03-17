import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "@tanstack/react-router";
import { db } from "@/db";
import { useSonarStore } from "@/stores/sonarStore";
import { useLocalSonar } from "@/hooks/useLocalSonar";
import { useChainSonar } from "@/hooks/useChainSonar";
import { DataGrid, excelFilterFn, type ColumnDef } from "@/components/DataGrid";
import type { SonarEvent, SonarChannelStatus } from "@/db/types";
import { FileText, Radio } from "lucide-react";

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
							? "bg-emerald-500/10 text-emerald-400"
							: "bg-blue-500/10 text-blue-400"
					}`}
				>
					{source === "local" ? "Local" : "Chain"}
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

// ── Status Dot ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: SonarChannelStatus }) {
	const color =
		status === "active"
			? "bg-green-500"
			: status === "error"
				? "bg-red-500"
				: "bg-zinc-600";
	return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

// ── Channel Toggle ───────────────────────────────────────────────────────────

function ChannelToggle({
	label,
	enabled,
	status,
	onToggle,
}: {
	label: string;
	enabled: boolean;
	status: SonarChannelStatus;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
				enabled
					? "border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
					: "border-zinc-800 bg-zinc-900 text-zinc-600 hover:bg-zinc-800"
			}`}
		>
			<StatusDot status={enabled ? status : "off"} />
			{label}
		</button>
	);
}

// ── Main View ────────────────────────────────────────────────────────────────

export function Sonar() {
	// Activate both sonar channels
	useLocalSonar();
	useChainSonar();

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
					<Radio size={20} className="text-cyan-400" />
					<h1 className="text-lg font-semibold text-zinc-100">Sonar</h1>
				</div>
				<div className="flex items-center gap-2">
					<ChannelToggle
						label="Local"
						enabled={localEnabled}
						status={localStatus}
						onToggle={() => setLocalEnabled(!localEnabled)}
					/>
					<ChannelToggle
						label="Chain"
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
