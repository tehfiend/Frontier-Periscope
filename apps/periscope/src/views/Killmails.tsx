import { useState, useCallback, useEffect, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { syncKillmails } from "@/chain/sync";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { DataGrid, excelFilterFn, type ColumnDef } from "@/components/DataGrid";
import { Skull, RefreshCw, Loader2, Swords, Shield, MapPin } from "lucide-react";
import type { KillmailIntel } from "@/db/types";
import { KILLMAIL_MAX_AGE_MS } from "@/lib/constants";

export function Killmails() {
	const tenant = useActiveTenant();
	const killmails = useLiveQuery(() =>
		db.killmails.orderBy("timestamp").reverse().filter(notDeleted).limit(500).toArray(),
	);
	const totalCount = useLiveQuery(() => db.killmails.filter(notDeleted).count()) ?? 0;
	const [syncing, setSyncing] = useState(false);
	const [syncStatus, setSyncStatus] = useState<string | null>(null);

	// System name lookup
	const systems = useLiveQuery(() => db.solarSystems.toArray());
	const systemMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const s of systems ?? []) {
			if (s.name) map[s.id] = s.name;
		}
		return map;
	}, [systems]);

	// Prune old killmails on mount
	useEffect(() => {
		const cutoff = new Date(Date.now() - KILLMAIL_MAX_AGE_MS).toISOString();
		db.killmails.where("timestamp").below(cutoff).modify({ _deleted: true }).catch(console.error);
	}, []);

	const handleSync = useCallback(async () => {
		if (syncing) return;
		setSyncing(true);
		setSyncStatus("Fetching killmails...");
		try {
			const count = await syncKillmails(100, tenant);
			setSyncStatus(count > 0 ? `Found ${count} new killmails` : "No new killmails");
		} catch (e) {
			setSyncStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setSyncing(false);
		}
	}, [syncing, tenant]);

	const data = killmails ?? [];

	const columns: ColumnDef<KillmailIntel, unknown>[] = useMemo(() => [
		{
			id: "timestamp",
			accessorFn: (km) => new Date(km.timestamp).toLocaleString(),
			header: "Time",
			size: 170,
			enableColumnFilter: false,
		},
		{
			id: "victim",
			accessorKey: "victim",
			header: "Victim",
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<div className="flex items-center gap-1.5">
					<Shield size={14} className="shrink-0 text-red-400" />
					<span className="font-mono text-sm text-red-300">
						{row.original.victim.length > 12
							? `${row.original.victim.slice(0, 8)}...`
							: row.original.victim || "—"}
					</span>
				</div>
			),
		},
		{
			id: "finalBlow",
			accessorKey: "finalBlow",
			header: "Killer",
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<div className="flex items-center gap-1.5">
					<Swords size={14} className="shrink-0 text-orange-400" />
					<span className="font-mono text-sm text-orange-300">
						{row.original.finalBlow.length > 12
							? `${row.original.finalBlow.slice(0, 8)}...`
							: row.original.finalBlow || "—"}
					</span>
				</div>
			),
		},
		{
			id: "involved",
			accessorFn: (km) => km.involved.length,
			header: "Involved",
			size: 90,
			enableColumnFilter: false,
			cell: ({ row }) => (
				<span className="text-xs text-zinc-400">
					{row.original.involved.length}
				</span>
			),
		},
		{
			id: "system",
			accessorFn: (km) => km.systemId ? (systemMap[km.systemId] ?? `#${km.systemId}`) : "—",
			header: "System",
			size: 140,
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<div className="flex items-center gap-1 text-xs">
					{row.original.systemId && <MapPin size={12} className="text-zinc-600" />}
					<span className="text-zinc-400">
						{row.original.systemId
							? (systemMap[row.original.systemId] ?? `#${row.original.systemId}`)
							: "—"}
					</span>
				</div>
			),
		},
		{
			id: "lossType",
			accessorFn: (km) => km.tags[0] ?? "unknown",
			header: "Type",
			size: 100,
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs capitalize text-zinc-400">
					{row.original.tags[0] ?? "unknown"}
				</span>
			),
		},
		{
			id: "killmailId",
			accessorKey: "killmailId",
			header: "ID",
			size: 80,
			enableColumnFilter: false,
			cell: ({ row }) => (
				<span className="font-mono text-xs text-zinc-600">
					#{row.original.killmailId}
				</span>
			),
		},
	], [systemMap]);

	return (
		<div className="p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<Skull size={24} className="text-red-500" />
						Killmails
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{totalCount} killmails recorded
					</p>
				</div>
				<div className="flex items-center gap-3">
					{syncStatus && <span className="text-xs text-zinc-500">{syncStatus}</span>}
					<button
						type="button"
						onClick={handleSync}
						disabled={syncing}
						className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
					>
						{syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
						Fetch Killmails
					</button>
				</div>
			</div>

			{/* Data Grid */}
			<DataGrid
				columns={columns}
				data={data}
				keyFn={(km) => km.id}
				searchPlaceholder="Search victims, killers, systems..."
				emptyMessage='No killmails yet. Click "Fetch Killmails" to pull from chain events.'
			/>
		</div>
	);
}
