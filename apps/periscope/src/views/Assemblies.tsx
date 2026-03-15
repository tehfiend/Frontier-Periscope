import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { syncTargetAssemblies } from "@/chain/sync";
import {
	Box,
	Search,
	X,
	RefreshCw,
	Pencil,
	Check,
	Loader2,
	ExternalLink,
	Filter,
} from "lucide-react";
import type { AssemblyIntel, AssemblyStatus } from "@/db/types";

const STATUS_COLORS: Record<AssemblyStatus, string> = {
	online: "text-green-400",
	offline: "text-zinc-500",
	anchoring: "text-yellow-400",
	unanchoring: "text-orange-400",
	destroyed: "text-red-500",
	unknown: "text-zinc-600",
};

const STATUS_DOTS: Record<AssemblyStatus, string> = {
	online: "bg-green-400",
	offline: "bg-zinc-600",
	anchoring: "bg-yellow-400",
	unanchoring: "bg-orange-400",
	destroyed: "bg-red-500",
	unknown: "bg-zinc-700",
};

export function Assemblies() {
	const assemblies = useLiveQuery(() => db.assemblies.orderBy("updatedAt").reverse().filter(notDeleted).toArray());
	const players = useLiveQuery(() => db.players.filter(notDeleted).toArray());
	const targets = useLiveQuery(() => db.targets.filter(notDeleted).toArray());

	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<AssemblyStatus | "all">("all");
	const [typeFilter, setTypeFilter] = useState<string | "all">("all");
	const [syncing, setSyncing] = useState(false);
	const [syncStatus, setSyncStatus] = useState<string | null>(null);

	// Build owner name lookup from players table
	const ownerNames = new Map<string, string>();
	for (const p of players ?? []) {
		ownerNames.set(p.address, p.name);
	}

	// Get unique assembly types for filter
	const assemblyTypes = [...new Set(assemblies?.map((a) => a.assemblyType) ?? [])].sort();

	const filtered = assemblies?.filter((a) => {
		if (statusFilter !== "all" && a.status !== statusFilter) return false;
		if (typeFilter !== "all" && a.assemblyType !== typeFilter) return false;
		if (!searchQuery) return true;
		const q = searchQuery.toLowerCase();
		const ownerName = ownerNames.get(a.owner) ?? "";
		return (
			a.objectId.toLowerCase().includes(q) ||
			a.assemblyType.toLowerCase().includes(q) ||
			a.owner.toLowerCase().includes(q) ||
			ownerName.toLowerCase().includes(q) ||
			a.label?.toLowerCase().includes(q) ||
			a.notes?.toLowerCase().includes(q)
		);
	});

	// Sync all active targets
	const handleSyncAll = useCallback(async () => {
		if (syncing) return;
		const activeTargets = targets?.filter((t) => t.watchStatus === "active") ?? [];
		if (activeTargets.length === 0) {
			setSyncStatus("No active targets to sync");
			return;
		}
		setSyncing(true);
		setSyncStatus(`Syncing ${activeTargets.length} targets...`);
		try {
			let total = 0;
			for (const target of activeTargets) {
				const count = await syncTargetAssemblies(target.address);
				total += count;
			}
			setSyncStatus(`Found ${total} assemblies from ${activeTargets.length} targets`);
		} catch (e) {
			setSyncStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setSyncing(false);
		}
	}, [targets, syncing]);

	const statusCounts = assemblies?.reduce(
		(acc, a) => {
			acc[a.status] = (acc[a.status] ?? 0) + 1;
			return acc;
		},
		{} as Record<string, number>,
	) ?? {};

	const uniqueOwners = new Set(assemblies?.map((a) => a.owner) ?? []).size;

	return (
		<div className="p-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<Box size={24} className="text-blue-500" />
						Assemblies
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{assemblies?.length ?? 0} tracked &middot; {uniqueOwners} owners
						{statusCounts.online ? ` · ${statusCounts.online} online` : ""}
					</p>
				</div>
				<div className="flex items-center gap-3">
					{syncStatus && <span className="text-xs text-zinc-500">{syncStatus}</span>}
					<button
						type="button"
						onClick={handleSyncAll}
						disabled={syncing}
						className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
					>
						{syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
						Sync Targets
					</button>
				</div>
			</div>

			{/* Search + Filters */}
			<div className="mt-6 flex flex-wrap items-center gap-4">
				<div className="relative max-w-md flex-1">
					<Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search assemblies, owners..."
						className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-blue-600 focus:outline-none"
					/>
					{searchQuery && (
						<button type="button" onClick={() => setSearchQuery("")} className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300">
							<X size={14} />
						</button>
					)}
				</div>

				{/* Status filter */}
				<div className="flex gap-1">
					{(["all", "online", "offline", "anchoring", "destroyed", "unknown"] as const).map((f) => (
						<button
							key={f}
							type="button"
							onClick={() => setStatusFilter(f)}
							className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
								statusFilter === f
									? "bg-zinc-700 text-zinc-100"
									: "text-zinc-500 hover:text-zinc-300"
							}`}
						>
							{f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
						</button>
					))}
				</div>

				{/* Type filter */}
				{assemblyTypes.length > 1 && (
					<div className="flex items-center gap-1.5">
						<Filter size={12} className="text-zinc-600" />
						<select
							value={typeFilter}
							onChange={(e) => setTypeFilter(e.target.value)}
							className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:outline-none"
						>
							<option value="all">All types</option>
							{assemblyTypes.map((t) => (
								<option key={t} value={t}>{t}</option>
							))}
						</select>
					</div>
				)}
			</div>

			{/* Assembly List */}
			<div className="mt-4 space-y-2">
				{filtered && filtered.length > 0 ? (
					filtered.map((a) => (
						<AssemblyRow key={a.id} assembly={a} ownerName={ownerNames.get(a.owner)} />
					))
				) : (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
						<p className="text-sm text-zinc-500">
							{searchQuery || statusFilter !== "all" || typeFilter !== "all"
								? "No assemblies match your filters"
								: "No assemblies tracked yet. Add targets in the Watchlist to discover their deployments, then click \"Sync Targets\"."}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

function AssemblyRow({ assembly: a, ownerName }: { assembly: AssemblyIntel; ownerName?: string }) {
	const [editing, setEditing] = useState(false);
	const [label, setLabel] = useState(a.label ?? "");
	const [notes, setNotes] = useState(a.notes ?? "");

	async function save() {
		await db.assemblies.update(a.id, {
			label: label || undefined,
			notes: notes || undefined,
			updatedAt: new Date().toISOString(),
		});
		setEditing(false);
	}

	async function remove() {
		if (!confirm("Remove this assembly from tracking?")) return;
		await db.assemblies.update(a.id, { _deleted: true, updatedAt: new Date().toISOString() });
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="flex items-center gap-3">
				{/* Status dot */}
				<span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOTS[a.status]}`} />

				{/* Type + Label */}
				<div className="min-w-0 flex-1">
					{editing ? (
						<input
							type="text"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="Label..."
							className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-blue-600 focus:outline-none"
						/>
					) : (
						<div className="flex items-center gap-2">
							<span className="font-mono text-sm font-medium text-zinc-100">
								{a.label || a.assemblyType}
							</span>
							<span className="text-xs text-zinc-600">{a.assemblyType}</span>
						</div>
					)}
					<div className="mt-0.5 flex items-center gap-3 text-xs">
						<span className={STATUS_COLORS[a.status]}>{a.status}</span>
						<span className="font-mono text-zinc-600" title={a.objectId}>
							{a.objectId.slice(0, 10)}...{a.objectId.slice(-6)}
						</span>
					</div>
				</div>

				{/* Owner */}
				<div className="shrink-0 text-right">
					<span className="text-xs text-zinc-400">{ownerName ?? "Unknown"}</span>
					<div className="font-mono text-xs text-zinc-600" title={a.owner}>
						{a.owner.slice(0, 6)}...{a.owner.slice(-4)}
					</div>
				</div>

				{/* Actions */}
				{editing ? (
					<div className="flex shrink-0 gap-1">
						<button type="button" onClick={save} className="text-green-400 hover:text-green-300">
							<Check size={16} />
						</button>
						<button
							type="button"
							onClick={() => { setEditing(false); setLabel(a.label ?? ""); setNotes(a.notes ?? ""); }}
							className="text-zinc-500 hover:text-zinc-300"
						>
							<X size={16} />
						</button>
					</div>
				) : (
					<div className="flex shrink-0 gap-1">
						<button type="button" onClick={() => setEditing(true)} className="text-zinc-600 hover:text-zinc-400">
							<Pencil size={14} />
						</button>
						<a
							href={`https://testnet.suivision.xyz/object/${a.objectId}`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-zinc-600 hover:text-zinc-400"
						>
							<ExternalLink size={14} />
						</a>
					</div>
				)}
			</div>

			{/* Notes edit */}
			{editing && (
				<div className="mt-3 flex gap-2">
					<textarea
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
						placeholder="Notes..."
						rows={2}
						className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-blue-600 focus:outline-none"
					/>
					<button
						type="button"
						onClick={remove}
						className="self-end rounded px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-500/10"
					>
						Remove
					</button>
				</div>
			)}

			{/* Notes display */}
			{!editing && a.notes && <p className="mt-2 text-xs text-zinc-500">{a.notes}</p>}

			{/* Tags */}
			{a.tags.length > 0 && (
				<div className="mt-2 flex gap-1">
					{a.tags.map((tag) => (
						<span key={tag} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
							{tag}
						</span>
					))}
				</div>
			)}
		</div>
	);
}
