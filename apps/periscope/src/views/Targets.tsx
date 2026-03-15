import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { syncTargetAssemblies, syncCharacter } from "@/chain/sync";
import {
	Target,
	Plus,
	RefreshCw,
	Loader2,
	Eye,
	EyeOff,
	Archive,
	Trash2,
	X,
	Clock,
	Package,
} from "lucide-react";
import type { TargetRecord, WatchStatus, AssemblyIntel } from "@/db/types";

const STATUS_BADGE: Record<WatchStatus, { label: string; color: string }> = {
	active: { label: "Active", color: "bg-green-500/20 text-green-400" },
	paused: { label: "Paused", color: "bg-yellow-500/20 text-yellow-400" },
	archived: { label: "Archived", color: "bg-zinc-500/20 text-zinc-400" },
};

export function Targets() {
	const targets = useLiveQuery(() => db.targets.filter(notDeleted).toArray());
	const [showAdd, setShowAdd] = useState(false);
	const [newAddress, setNewAddress] = useState("");
	const [newName, setNewName] = useState("");
	const [addStatus, setAddStatus] = useState<string | null>(null);
	const [filter, setFilter] = useState<WatchStatus | "all">("all");
	const [adding, setAdding] = useState(false);

	const filtered = targets?.filter((t) => filter === "all" || t.watchStatus === filter);
	const activeCount = targets?.filter((t) => t.watchStatus === "active").length ?? 0;

	async function addTarget() {
		if (!newAddress.trim() || adding) return;
		setAdding(true);
		const addr = newAddress.trim();

		try {
			// Check for duplicates
			const exists = await db.targets.where("address").equals(addr).count();
			if (exists > 0) {
				setAddStatus("Target already exists");
				return;
			}

			const target: TargetRecord = {
				id: crypto.randomUUID(),
				address: addr,
				name: newName.trim() || undefined,
				watchStatus: "active",
				pollInterval: 60,
				tags: [],
			};

			await db.targets.put(target);

			// Try to resolve character name from chain
			setAddStatus("Resolving character...");
			try {
				const player = await syncCharacter(addr);
				if (player && !newName.trim()) {
					await db.targets.update(target.id, { name: player.name });
				}
			} catch {
				// Character lookup failed — that's fine
			}

			// Discover assemblies
			setAddStatus("Scanning assemblies...");
			try {
				const count = await syncTargetAssemblies(addr);
				setAddStatus(`Added target. Found ${count} assemblies.`);
			} catch (e) {
				setAddStatus(`Added target. Assembly scan failed: ${e instanceof Error ? e.message : String(e)}`);
			}

			setNewAddress("");
			setNewName("");
			setShowAdd(false);
		} finally {
			setAdding(false);
		}
	}

	async function removeTarget(id: string) {
		if (!confirm("Remove this target and all associated data?")) return;
		const target = await db.targets.get(id);
		if (target) {
			const now = new Date().toISOString();
			await db.targetEvents.where("targetId").equals(id).modify({ _deleted: true });
			await db.inventoryDiffs.where("targetId").equals(id).modify({ _deleted: true });
			await db.assemblies.where("owner").equals(target.address).modify({ _deleted: true, updatedAt: now });
		}
		await db.targets.update(id, { _deleted: true });
	}

	async function setStatus(id: string, status: WatchStatus) {
		await db.targets.update(id, { watchStatus: status });
	}

	return (
		<div className="p-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<Target size={24} className="text-orange-500" />
						Watchlist
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{targets?.length ?? 0} targets &middot; {activeCount} active
					</p>
				</div>
				<button
					type="button"
					onClick={() => setShowAdd(true)}
					className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-orange-500"
				>
					<Plus size={14} />
					Add Target
				</button>
			</div>

			{/* Add Target Form */}
			{showAdd && (
				<div className="mt-4 rounded-lg border border-orange-900/50 bg-zinc-900/50 p-4">
					<div className="flex items-center gap-3">
						<input
							type="text"
							value={newAddress}
							onChange={(e) => setNewAddress(e.target.value)}
							placeholder="Sui address (0x...)"
							className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-orange-600 focus:outline-none"
						/>
						<input
							type="text"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							placeholder="Name (optional)"
							className="w-48 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-orange-600 focus:outline-none"
						/>
						<button
							type="button"
							onClick={addTarget}
							disabled={adding}
							className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
						>
							{adding ? "Adding..." : "Add"}
						</button>
						<button
							type="button"
							onClick={() => { setShowAdd(false); setAddStatus(null); }}
							className="text-zinc-500 hover:text-zinc-300"
						>
							<X size={18} />
						</button>
					</div>
					{addStatus && <p className="mt-2 text-xs text-zinc-400">{addStatus}</p>}
				</div>
			)}

			{/* Filter tabs */}
			<div className="mt-6 flex gap-2">
				{(["all", "active", "paused", "archived"] as const).map((f) => (
					<button
						key={f}
						type="button"
						onClick={() => setFilter(f)}
						className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
							filter === f
								? "bg-zinc-700 text-zinc-100"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						{f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
					</button>
				))}
			</div>

			{/* Target List */}
			<div className="mt-4 space-y-2">
				{filtered && filtered.length > 0 ? (
					filtered.map((t) => (
						<TargetRow
							key={t.id}
							target={t}
							onRemove={() => removeTarget(t.id)}
							onSetStatus={(s) => setStatus(t.id, s)}
						/>
					))
				) : (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
						<p className="text-sm text-zinc-500">
							No targets tracked. Add a player's Sui address to begin surveillance.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

function TargetRow({
	target: t,
	onRemove,
	onSetStatus,
}: {
	target: TargetRecord;
	onRemove: () => void;
	onSetStatus: (s: WatchStatus) => void;
}) {
	const assemblies = useLiveQuery(
		() => db.assemblies.where("owner").equals(t.address).filter(notDeleted).toArray(),
		[t.address],
	);
	const [syncing, setSyncing] = useState(false);

	const handleRefresh = useCallback(async () => {
		setSyncing(true);
		try {
			await syncTargetAssemblies(t.address);
		} catch {
			// silently fail
		} finally {
			setSyncing(false);
		}
	}, [t.address]);

	const badge = STATUS_BADGE[t.watchStatus];

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="flex items-center gap-3">
				{/* Status badge */}
				<span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.color}`}>
					{badge.label}
				</span>

				{/* Name + Address */}
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="font-mono text-sm font-medium text-zinc-100">
							{t.name || "Unknown"}
						</span>
					</div>
					<span className="font-mono text-xs text-zinc-600">{t.address}</span>
				</div>

				{/* Assembly count */}
				<div className="flex items-center gap-1 text-xs text-zinc-500">
					<Package size={12} />
					<span>{assemblies?.length ?? 0} assemblies</span>
				</div>

				{/* Last polled */}
				{t.lastPolled && (
					<div className="flex items-center gap-1 text-xs text-zinc-600">
						<Clock size={12} />
						<span>{new Date(t.lastPolled).toLocaleTimeString()}</span>
					</div>
				)}

				{/* Actions */}
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						onClick={handleRefresh}
						disabled={syncing}
						className="rounded p-1 text-zinc-600 hover:text-cyan-400"
						title="Refresh"
					>
						{syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
					</button>
					{t.watchStatus === "active" ? (
						<button type="button" onClick={() => onSetStatus("paused")} className="rounded p-1 text-zinc-600 hover:text-yellow-400" title="Pause">
							<EyeOff size={14} />
						</button>
					) : (
						<button type="button" onClick={() => onSetStatus("active")} className="rounded p-1 text-zinc-600 hover:text-green-400" title="Activate">
							<Eye size={14} />
						</button>
					)}
					<button type="button" onClick={() => onSetStatus("archived")} className="rounded p-1 text-zinc-600 hover:text-zinc-400" title="Archive">
						<Archive size={14} />
					</button>
					<button type="button" onClick={onRemove} className="rounded p-1 text-zinc-600 hover:text-red-400" title="Remove">
						<Trash2 size={14} />
					</button>
				</div>
			</div>

			{/* Assemblies */}
			{assemblies && assemblies.length > 0 && (
				<div className="mt-3 border-t border-zinc-800 pt-3">
					<div className="grid gap-1">
						{assemblies.map((a) => (
							<div key={a.id} className="flex items-center gap-2 text-xs">
								<span className={`h-1.5 w-1.5 rounded-full ${a.status === "online" ? "bg-green-400" : "bg-zinc-600"}`} />
								<span className="text-zinc-400">{a.assemblyType}</span>
								<span className="font-mono text-zinc-600">{a.objectId.slice(0, 10)}...</span>
								<span className={a.status === "online" ? "text-green-400" : "text-zinc-600"}>{a.status}</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Tags */}
			{t.tags.length > 0 && (
				<div className="mt-2 flex gap-1">
					{t.tags.map((tag) => (
						<span key={tag} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{tag}</span>
					))}
				</div>
			)}
		</div>
	);
}
