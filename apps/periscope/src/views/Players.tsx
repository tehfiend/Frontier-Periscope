import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { syncCharacter } from "@/chain/sync";
import {
	Users,
	Plus,
	Search,
	X,
	Pencil,
	Check,
	Shield,
	AlertTriangle,
	Skull,
	Heart,
	HelpCircle,
	Loader2,
} from "lucide-react";
import type { PlayerIntel, ThreatLevel } from "@/db/types";

const THREAT_CONFIG: Record<ThreatLevel, { label: string; color: string; icon: typeof Shield }> = {
	unknown: { label: "Unknown", color: "text-zinc-500", icon: HelpCircle },
	friendly: { label: "Friendly", color: "text-green-400", icon: Heart },
	neutral: { label: "Neutral", color: "text-blue-400", icon: Shield },
	hostile: { label: "Hostile", color: "text-orange-400", icon: AlertTriangle },
	critical: { label: "Critical", color: "text-red-500", icon: Skull },
};

export function Players() {
	const players = useLiveQuery(() => db.players.orderBy("updatedAt").reverse().filter(notDeleted).toArray());
	const [searchQuery, setSearchQuery] = useState("");
	const [threatFilter, setThreatFilter] = useState<ThreatLevel | "all">("all");
	const [showAdd, setShowAdd] = useState(false);
	const [newAddress, setNewAddress] = useState("");
	const [newName, setNewName] = useState("");
	const [addStatus, setAddStatus] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);

	const filtered = players?.filter((p) => {
		if (threatFilter !== "all" && p.threat !== threatFilter) return false;
		if (!searchQuery) return true;
		const q = searchQuery.toLowerCase();
		return (
			p.name.toLowerCase().includes(q) ||
			p.address.toLowerCase().includes(q) ||
			p.notes?.toLowerCase().includes(q)
		);
	});

	const threatCounts = players?.reduce(
		(acc, p) => {
			acc[p.threat] = (acc[p.threat] ?? 0) + 1;
			return acc;
		},
		{} as Record<string, number>,
	) ?? {};

	async function addPlayer() {
		if (adding) return;
		setAdding(true);
		try {
			const addr = newAddress.trim();
			const name = newName.trim();
			if (!addr && !name) return;

			// Check for duplicates if address provided
			if (addr) {
				const exists = await db.players.where("address").equals(addr).count();
				if (exists > 0) {
					setAddStatus("Player already exists");
					return;
				}
			}

			const player: PlayerIntel = {
				id: crypto.randomUUID(),
				address: addr || `manual-${Date.now()}`,
				name: name || "Unknown",
				threat: "unknown",
				source: addr ? "chain" : "manual",
				tags: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await db.players.put(player);

			// Try to resolve name from chain if we have an address
			if (addr && !name) {
				setAddStatus("Resolving character...");
				try {
					const resolved = await syncCharacter(addr);
					if (resolved) {
						setAddStatus(`Added: ${resolved.name}`);
					} else {
						setAddStatus("Added (no character found on chain)");
					}
				} catch {
					setAddStatus("Added (character lookup failed)");
				}
			} else {
				setAddStatus("Player added");
			}

			setNewAddress("");
			setNewName("");
			setShowAdd(false);
		} finally {
			setAdding(false);
		}
	}

	return (
		<div className="p-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<Users size={24} className="text-yellow-500" />
						Players
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{players?.length ?? 0} known players
						{threatCounts.hostile ? ` · ${threatCounts.hostile} hostile` : ""}
						{threatCounts.critical ? ` · ${threatCounts.critical} critical` : ""}
					</p>
				</div>
				<button
					type="button"
					onClick={() => setShowAdd(true)}
					className="flex items-center gap-1.5 rounded-lg bg-yellow-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-yellow-500"
				>
					<Plus size={14} />
					Add Player
				</button>
			</div>

			{/* Add Player Form */}
			{showAdd && (
				<div className="mt-4 rounded-lg border border-yellow-900/50 bg-zinc-900/50 p-4">
					<div className="flex items-center gap-3">
						<input
							type="text"
							value={newAddress}
							onChange={(e) => setNewAddress(e.target.value)}
							placeholder="Sui address (0x...)"
							className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-yellow-600 focus:outline-none"
						/>
						<input
							type="text"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							placeholder="Name (optional)"
							className="w-48 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-yellow-600 focus:outline-none"
						/>
						<button type="button" onClick={addPlayer} disabled={adding} className="rounded bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-500 disabled:opacity-50">
							{adding ? "Adding..." : "Add"}
						</button>
						<button type="button" onClick={() => { setShowAdd(false); setAddStatus(null); }} className="text-zinc-500 hover:text-zinc-300">
							<X size={18} />
						</button>
					</div>
					{addStatus && <p className="mt-2 text-xs text-zinc-400">{addStatus}</p>}
				</div>
			)}

			{/* Search + Filter */}
			<div className="mt-6 flex items-center gap-4">
				<div className="relative max-w-md flex-1">
					<Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search players..."
						className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-yellow-600 focus:outline-none"
					/>
					{searchQuery && (
						<button type="button" onClick={() => setSearchQuery("")} className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300">
							<X size={14} />
						</button>
					)}
				</div>
				<div className="flex gap-1">
					{(["all", "critical", "hostile", "neutral", "friendly", "unknown"] as const).map((f) => (
						<button
							key={f}
							type="button"
							onClick={() => setThreatFilter(f)}
							className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
								threatFilter === f
									? "bg-zinc-700 text-zinc-100"
									: "text-zinc-500 hover:text-zinc-300"
							}`}
						>
							{f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
						</button>
					))}
				</div>
			</div>

			{/* Player List */}
			<div className="mt-4 space-y-2">
				{filtered && filtered.length > 0 ? (
					filtered.map((p) => <PlayerRow key={p.id} player={p} />)
				) : (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
						<p className="text-sm text-zinc-500">
							{searchQuery || threatFilter !== "all"
								? "No players match your filters"
								: "No players recorded yet. Add players manually or they'll appear through intel and chain discovery."}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

function PlayerRow({ player: p }: { player: PlayerIntel }) {
	const [editing, setEditing] = useState(false);
	const [threat, setThreat] = useState(p.threat);
	const [notes, setNotes] = useState(p.notes ?? "");

	const cfg = THREAT_CONFIG[p.threat];
	const Icon = cfg.icon;

	async function save() {
		try {
			await db.players.update(p.id, {
				threat,
				notes: notes || undefined,
				updatedAt: new Date().toISOString(),
			});
			setEditing(false);
		} catch (e) {
			console.error("[Players] Save failed:", e);
			alert("Failed to save changes. Please try again.");
		}
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="flex items-center gap-3">
				{/* Threat icon */}
				<Icon size={16} className={`shrink-0 ${cfg.color}`} />

				{/* Name + Address */}
				<div className="min-w-0 flex-1">
					<span className="font-mono text-sm font-medium text-zinc-100">{p.name}</span>
					<div className="flex items-center gap-2 text-xs">
						<span className="font-mono text-zinc-600">{p.address.startsWith("manual") ? "Manual entry" : p.address}</span>
						{p.tribe && <span className="text-zinc-500">· {p.tribe}</span>}
					</div>
				</div>

				{/* Threat level */}
				{editing ? (
					<select
						value={threat}
						onChange={(e) => setThreat(e.target.value as ThreatLevel)}
						className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:outline-none"
					>
						<option value="unknown">Unknown</option>
						<option value="friendly">Friendly</option>
						<option value="neutral">Neutral</option>
						<option value="hostile">Hostile</option>
						<option value="critical">Critical</option>
					</select>
				) : (
					<span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
				)}

				{/* Last seen */}
				{p.lastSeenAt && (
					<span className="text-xs text-zinc-600">
						Seen {new Date(p.lastSeenAt).toLocaleDateString()}
					</span>
				)}

				{/* Edit / Save */}
				{editing ? (
					<div className="flex shrink-0 gap-1">
						<button type="button" onClick={save} className="text-green-400 hover:text-green-300"><Check size={16} /></button>
						<button type="button" onClick={() => { setEditing(false); setThreat(p.threat); setNotes(p.notes ?? ""); }} className="text-zinc-500 hover:text-zinc-300"><X size={16} /></button>
					</div>
				) : (
					<button type="button" onClick={() => setEditing(true)} className="shrink-0 text-zinc-600 hover:text-zinc-400">
						<Pencil size={14} />
					</button>
				)}
			</div>

			{/* Notes edit */}
			{editing && (
				<textarea
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					placeholder="Notes on this player..."
					rows={2}
					className="mt-3 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-yellow-600 focus:outline-none"
				/>
			)}

			{/* Notes display */}
			{!editing && p.notes && <p className="mt-2 text-xs text-zinc-500">{p.notes}</p>}
		</div>
	);
}
