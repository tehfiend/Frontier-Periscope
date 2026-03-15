import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import {
	MapPin,
	Plus,
	Search,
	X,
	Pencil,
	Check,
	Trash2,
	Star,
	Navigation,
	Anchor,
	AlertTriangle,
	Eye,
	Tag,
} from "lucide-react";
import type { LocationIntel } from "@/db/types";

const CATEGORIES = [
	{ value: "bookmark", label: "Bookmark", icon: Star, color: "text-amber-400" },
	{ value: "poi", label: "Point of Interest", icon: Navigation, color: "text-cyan-400" },
	{ value: "station", label: "Station / Base", icon: Anchor, color: "text-emerald-400" },
	{ value: "danger", label: "Danger Zone", icon: AlertTriangle, color: "text-red-400" },
	{ value: "scout", label: "Scout Report", icon: Eye, color: "text-purple-400" },
] as const;

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]));

export function Locations() {
	const locations = useLiveQuery(() => db.locations.orderBy("updatedAt").reverse().filter(notDeleted).toArray());
	const systems = useLiveQuery(() => db.solarSystems.toArray());

	const [searchQuery, setSearchQuery] = useState("");
	const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");
	const [showAdd, setShowAdd] = useState(false);

	// Build system name lookup
	const systemNames = useMemo(() => {
		const map = new Map<number, string>();
		for (const s of systems ?? []) {
			if (s.name) map.set(s.id, s.name);
		}
		return map;
	}, [systems]);

	const filtered = locations?.filter((loc) => {
		if (categoryFilter !== "all" && loc.category !== categoryFilter) return false;
		if (!searchQuery) return true;
		const q = searchQuery.toLowerCase();
		const sysName = systemNames.get(loc.systemId) ?? "";
		return (
			loc.name.toLowerCase().includes(q) ||
			sysName.toLowerCase().includes(q) ||
			loc.notes?.toLowerCase().includes(q) ||
			loc.tags.some((t) => t.toLowerCase().includes(q))
		);
	});

	const categoryCounts = locations?.reduce(
		(acc, loc) => {
			acc[loc.category] = (acc[loc.category] ?? 0) + 1;
			return acc;
		},
		{} as Record<string, number>,
	) ?? {};

	return (
		<div className="p-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<MapPin size={24} className="text-amber-500" />
						Locations
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{locations?.length ?? 0} bookmarks
						{Object.entries(categoryCounts).map(([cat, count]) => {
							const cfg = CATEGORY_MAP[cat];
							return cfg ? ` · ${count} ${cfg.label.toLowerCase()}` : "";
						}).join("")}
					</p>
				</div>
				<button
					type="button"
					onClick={() => setShowAdd(true)}
					className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-500"
				>
					<Plus size={14} />
					Add Location
				</button>
			</div>

			{/* Add Form */}
			{showAdd && (
				<AddLocationForm
					systemNames={systemNames}
					onClose={() => setShowAdd(false)}
				/>
			)}

			{/* Search + Filters */}
			<div className="mt-6 flex items-center gap-4">
				<div className="relative max-w-md flex-1">
					<Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search locations..."
						className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-600 focus:outline-none"
					/>
					{searchQuery && (
						<button type="button" onClick={() => setSearchQuery("")} className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300">
							<X size={14} />
						</button>
					)}
				</div>
				<div className="flex gap-1">
					<button
						type="button"
						onClick={() => setCategoryFilter("all")}
						className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
							categoryFilter === "all" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						All
					</button>
					{CATEGORIES.map((cat) => (
						<button
							key={cat.value}
							type="button"
							onClick={() => setCategoryFilter(cat.value)}
							className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
								categoryFilter === cat.value
									? "bg-zinc-700 text-zinc-100"
									: "text-zinc-500 hover:text-zinc-300"
							}`}
						>
							{cat.label}
						</button>
					))}
				</div>
			</div>

			{/* Location List */}
			<div className="mt-4 space-y-2">
				{filtered && filtered.length > 0 ? (
					filtered.map((loc) => (
						<LocationRow
							key={loc.id}
							location={loc}
							systemName={systemNames.get(loc.systemId)}
						/>
					))
				) : (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
						<p className="text-sm text-zinc-500">
							{searchQuery || categoryFilter !== "all"
								? "No locations match your filters"
								: "No bookmarks saved yet. Click \"Add Location\" to bookmark a system."}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

function AddLocationForm({
	systemNames,
	onClose,
}: {
	systemNames: Map<number, string>;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const [systemSearch, setSystemSearch] = useState("");
	const [selectedSystemId, setSelectedSystemId] = useState<number | null>(null);
	const [category, setCategory] = useState("bookmark");
	const [notes, setNotes] = useState("");
	const [tagInput, setTagInput] = useState("");

	// System search results
	const systemResults = useMemo(() => {
		if (systemSearch.length < 2) return [];
		const q = systemSearch.toLowerCase();
		const results: { id: number; name: string }[] = [];
		for (const [id, sysName] of systemNames) {
			if (sysName.toLowerCase().includes(q)) {
				results.push({ id, name: sysName });
				if (results.length >= 10) break;
			}
		}
		return results;
	}, [systemSearch, systemNames]);

	async function save() {
		if (!name.trim() || selectedSystemId === null) return;

		const tags = tagInput
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);

		const now = new Date().toISOString();
		const location: LocationIntel = {
			id: crypto.randomUUID(),
			name: name.trim(),
			systemId: selectedSystemId,
			category,
			notes: notes || undefined,
			tags,
			source: "manual",
			createdAt: now,
			updatedAt: now,
		};

		await db.locations.put(location);
		onClose();
	}

	return (
		<div className="mt-4 space-y-3 rounded-lg border border-amber-900/50 bg-zinc-900/50 p-4">
			<div className="flex gap-3">
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Location name"
					className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-600 focus:outline-none"
				/>
				<select
					value={category}
					onChange={(e) => setCategory(e.target.value)}
					className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 focus:outline-none"
				>
					{CATEGORIES.map((c) => (
						<option key={c.value} value={c.value}>{c.label}</option>
					))}
				</select>
			</div>

			{/* System search */}
			<div className="relative">
				<input
					type="text"
					value={selectedSystemId !== null ? systemNames.get(selectedSystemId) ?? systemSearch : systemSearch}
					onChange={(e) => {
						setSystemSearch(e.target.value);
						setSelectedSystemId(null);
					}}
					placeholder="Search for a solar system..."
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-600 focus:outline-none"
				/>
				{systemResults.length > 0 && selectedSystemId === null && (
					<div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl">
						{systemResults.map((sys) => (
							<button
								key={sys.id}
								type="button"
								onClick={() => {
									setSelectedSystemId(sys.id);
									setSystemSearch(sys.name);
								}}
								className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700"
							>
								{sys.name}
							</button>
						))}
					</div>
				)}
			</div>

			<div className="flex gap-3">
				<input
					type="text"
					value={tagInput}
					onChange={(e) => setTagInput(e.target.value)}
					placeholder="Tags (comma-separated)"
					className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-600 focus:outline-none"
				/>
			</div>

			<textarea
				value={notes}
				onChange={(e) => setNotes(e.target.value)}
				placeholder="Notes (optional)"
				rows={2}
				className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-600 focus:border-amber-600 focus:outline-none"
			/>

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={save}
					disabled={!name.trim() || selectedSystemId === null}
					className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
				>
					Save
				</button>
			</div>
		</div>
	);
}

function LocationRow({ location: loc, systemName }: { location: LocationIntel; systemName?: string }) {
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(loc.name);
	const [category, setCategory] = useState(loc.category);
	const [notes, setNotes] = useState(loc.notes ?? "");

	const cfg = CATEGORY_MAP[loc.category];
	const Icon = cfg?.icon ?? MapPin;
	const color = cfg?.color ?? "text-zinc-400";

	async function save() {
		await db.locations.update(loc.id, {
			name: name.trim() || loc.name,
			category,
			notes: notes || undefined,
			updatedAt: new Date().toISOString(),
		});
		setEditing(false);
	}

	async function remove() {
		if (!confirm(`Remove "${loc.name}"?`)) return;
		await db.locations.update(loc.id, { _deleted: true, updatedAt: new Date().toISOString() });
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="flex items-center gap-3">
				{/* Category icon */}
				<Icon size={16} className={`shrink-0 ${color}`} />

				{/* Name + System */}
				<div className="min-w-0 flex-1">
					{editing ? (
						<div className="flex items-center gap-2">
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-amber-600 focus:outline-none"
							/>
							<select
								value={category}
								onChange={(e) => setCategory(e.target.value)}
								className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:outline-none"
							>
								{CATEGORIES.map((c) => (
									<option key={c.value} value={c.value}>{c.label}</option>
								))}
							</select>
						</div>
					) : (
						<span className="text-sm font-medium text-zinc-100">{loc.name}</span>
					)}
					<div className="mt-0.5 flex items-center gap-2 text-xs">
						<span className="text-zinc-500">{systemName ?? `System ${loc.systemId}`}</span>
						<span className={`${color} opacity-70`}>{cfg?.label ?? loc.category}</span>
					</div>
				</div>

				{/* Tags */}
				{!editing && loc.tags.length > 0 && (
					<div className="flex gap-1">
						{loc.tags.map((tag) => (
							<span key={tag} className="flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
								<Tag size={10} />
								{tag}
							</span>
						))}
					</div>
				)}

				{/* Timestamp */}
				<span className="shrink-0 text-xs text-zinc-600">
					{new Date(loc.updatedAt).toLocaleDateString()}
				</span>

				{/* Actions */}
				{editing ? (
					<div className="flex shrink-0 gap-1">
						<button type="button" onClick={save} className="text-green-400 hover:text-green-300">
							<Check size={16} />
						</button>
						<button
							type="button"
							onClick={() => { setEditing(false); setName(loc.name); setCategory(loc.category); setNotes(loc.notes ?? ""); }}
							className="text-zinc-500 hover:text-zinc-300"
						>
							<X size={16} />
						</button>
						<button type="button" onClick={remove} className="text-red-500/60 hover:text-red-400">
							<Trash2 size={14} />
						</button>
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
					placeholder="Notes..."
					rows={2}
					className="mt-3 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-amber-600 focus:outline-none"
				/>
			)}

			{/* Notes display */}
			{!editing && loc.notes && <p className="mt-2 text-xs text-zinc-500">{loc.notes}</p>}
		</div>
	);
}
