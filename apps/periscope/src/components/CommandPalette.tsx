import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import {
	Search,
	Map,
	Package,
	Box,
	MapPin,
	Target,
	Users,
	Skull,
	StickyNote,
	LayoutDashboard,
	Radio,
	Wrench,
	FileText,
	Shield,
	Puzzle,
	ShieldCheck,
	Settings,
	type LucideIcon,
} from "lucide-react";

interface SearchResult {
	id: string;
	category: string;
	icon: LucideIcon;
	label: string;
	sublabel?: string;
	action: () => void;
}

const NAV_ITEMS: { path: string; label: string; icon: LucideIcon; keywords: string }[] = [
	{ path: "/", label: "Dashboard", icon: LayoutDashboard, keywords: "home overview" },
	{ path: "/map", label: "Star Map", icon: Map, keywords: "systems route 3d" },
	{ path: "/intel", label: "Intel Channel", icon: Radio, keywords: "chat reports" },
	{ path: "/targets", label: "Watchlist", icon: Target, keywords: "targets surveillance" },
	{ path: "/players", label: "Players", icon: Users, keywords: "characters threats" },
	{ path: "/killmails", label: "Killmails", icon: Skull, keywords: "combat kills deaths" },
	{ path: "/deployables", label: "Deployables", icon: Package, keywords: "assemblies fuel owned" },
	{ path: "/assemblies", label: "Assemblies", icon: Box, keywords: "tracked discovered" },
	{ path: "/extensions", label: "Extensions", icon: Puzzle, keywords: "deploy authorize" },
	{ path: "/permissions", label: "Permissions", icon: ShieldCheck, keywords: "groups policies acl" },
	{ path: "/locations", label: "Locations", icon: MapPin, keywords: "bookmarks poi" },
	{ path: "/blueprints", label: "Blueprints", icon: Wrench, keywords: "manufacturing bom materials" },
	{ path: "/logs", label: "Log Analyzer", icon: FileText, keywords: "mining combat travel chat" },
	{ path: "/opsec", label: "OPSEC", icon: Shield, keywords: "security exposure risk" },
	{ path: "/notes", label: "Notes", icon: StickyNote, keywords: "freeform intel" },
	{ path: "/settings", label: "Settings", icon: Settings, keywords: "profile backup encryption" },
];

export function CommandPalette() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();

	// Load searchable data
	const systems = useLiveQuery(() => db.solarSystems.toArray());
	const players = useLiveQuery(() => db.players.filter(notDeleted).toArray());
	const deployables = useLiveQuery(() => db.deployables.filter(notDeleted).toArray());
	const assemblies = useLiveQuery(() => db.assemblies.filter(notDeleted).toArray());
	const notes = useLiveQuery(() => db.notes.filter(notDeleted).toArray());
	const locations = useLiveQuery(() => db.locations.filter(notDeleted).toArray());

	// Keyboard shortcut to open
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if ((e.ctrlKey || e.metaKey) && e.key === "k") {
				e.preventDefault();
				setOpen((prev) => !prev);
			}
			if (e.key === "Escape" && open) {
				setOpen(false);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open]);

	// Focus input when opened
	useEffect(() => {
		if (open) {
			setQuery("");
			setSelectedIndex(0);
			setTimeout(() => inputRef.current?.focus(), 0);
		}
	}, [open]);

	const go = useCallback(
		(path: string) => {
			setOpen(false);
			navigate({ to: path });
		},
		[navigate],
	);

	// Build search results
	const results = useMemo((): SearchResult[] => {
		if (!query.trim()) {
			// Show nav items when no query
			return NAV_ITEMS.map((item) => ({
				id: `nav-${item.path}`,
				category: "Pages",
				icon: item.icon,
				label: item.label,
				action: () => go(item.path),
			}));
		}

		const q = query.toLowerCase();
		const out: SearchResult[] = [];

		// Nav items
		for (const item of NAV_ITEMS) {
			if (
				item.label.toLowerCase().includes(q) ||
				item.keywords.includes(q)
			) {
				out.push({
					id: `nav-${item.path}`,
					category: "Pages",
					icon: item.icon,
					label: item.label,
					action: () => go(item.path),
				});
			}
		}

		// Systems (limit to 8)
		let sysCount = 0;
		for (const sys of systems ?? []) {
			if (sysCount >= 8) break;
			if (sys.name?.toLowerCase().includes(q)) {
				sysCount++;
				out.push({
					id: `sys-${sys.id}`,
					category: "Systems",
					icon: Map,
					label: sys.name,
					sublabel: `ID ${sys.id}`,
					action: () => go("/map"),
				});
			}
		}

		// Players (limit to 5)
		let playerCount = 0;
		for (const p of players ?? []) {
			if (playerCount >= 5) break;
			if (
				p.name.toLowerCase().includes(q) ||
				p.address.toLowerCase().includes(q)
			) {
				playerCount++;
				out.push({
					id: `player-${p.id}`,
					category: "Players",
					icon: Users,
					label: p.name,
					sublabel: p.address.startsWith("manual") ? "Manual entry" : `${p.address.slice(0, 8)}...`,
					action: () => go("/players"),
				});
			}
		}

		// Deployables (limit to 5)
		let depCount = 0;
		for (const d of deployables ?? []) {
			if (depCount >= 5) break;
			if (
				d.label.toLowerCase().includes(q) ||
				d.objectId.toLowerCase().includes(q) ||
				d.assemblyType.toLowerCase().includes(q)
			) {
				depCount++;
				out.push({
					id: `dep-${d.id}`,
					category: "Deployables",
					icon: Package,
					label: d.label,
					sublabel: `${d.assemblyType} · ${d.status}`,
					action: () => go("/deployables"),
				});
			}
		}

		// Assemblies (limit to 5)
		let asmCount = 0;
		for (const a of assemblies ?? []) {
			if (asmCount >= 5) break;
			if (
				a.objectId.toLowerCase().includes(q) ||
				a.assemblyType.toLowerCase().includes(q) ||
				a.label?.toLowerCase().includes(q)
			) {
				asmCount++;
				out.push({
					id: `asm-${a.id}`,
					category: "Assemblies",
					icon: Box,
					label: a.label || a.assemblyType,
					sublabel: `${a.objectId.slice(0, 10)}... · ${a.status}`,
					action: () => go("/assemblies"),
				});
			}
		}

		// Notes (limit to 5)
		let noteCount = 0;
		for (const n of notes ?? []) {
			if (noteCount >= 5) break;
			if (n.title.toLowerCase().includes(q)) {
				noteCount++;
				out.push({
					id: `note-${n.id}`,
					category: "Notes",
					icon: StickyNote,
					label: n.title,
					action: () => go("/notes"),
				});
			}
		}

		// Locations (limit to 5)
		let locCount = 0;
		for (const loc of locations ?? []) {
			if (locCount >= 5) break;
			if (loc.name.toLowerCase().includes(q)) {
				locCount++;
				out.push({
					id: `loc-${loc.id}`,
					category: "Locations",
					icon: MapPin,
					label: loc.name,
					sublabel: loc.category,
					action: () => go("/locations"),
				});
			}
		}

		return out;
	}, [query, systems, players, deployables, assemblies, notes, locations, go]);

	// Keyboard navigation
	function onKeyDown(e: React.KeyboardEvent) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter" && results[selectedIndex]) {
			e.preventDefault();
			results[selectedIndex].action();
		}
	}

	// Scroll selected item into view
	useEffect(() => {
		const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
		el?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	// Reset selection when results change
	useEffect(() => {
		setSelectedIndex(0);
	}, [results.length]);

	if (!open) return null;

	// Group results by category
	const grouped: { category: string; items: SearchResult[] }[] = [];
	for (const result of results) {
		const existing = grouped.find((g) => g.category === result.category);
		if (existing) {
			existing.items.push(result);
		} else {
			grouped.push({ category: result.category, items: [result] });
		}
	}

	// Flat index mapping for keyboard navigation
	let flatIndex = 0;

	return (
		<>
			{/* Backdrop */}
			<div
				className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
				onClick={() => setOpen(false)}
				onKeyDown={() => {}}
			/>

			{/* Modal */}
			<div className="fixed left-1/2 top-[15%] z-50 w-full max-w-xl -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
				{/* Search input */}
				<div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
					<Search size={18} className="shrink-0 text-zinc-500" />
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder="Search pages, systems, players, assemblies..."
						className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
					/>
					<kbd className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-500">Esc</kbd>
				</div>

				{/* Results */}
				<div ref={listRef} className="max-h-96 overflow-y-auto p-2">
					{grouped.length > 0 ? (
						grouped.map((group) => (
							<div key={group.category}>
								<p className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-zinc-600">
									{group.category}
								</p>
								{group.items.map((result) => {
									const idx = flatIndex++;
									const Icon = result.icon;
									return (
										<button
											key={result.id}
											type="button"
											onClick={result.action}
											onMouseEnter={() => setSelectedIndex(idx)}
											className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
												selectedIndex === idx
													? "bg-zinc-800 text-zinc-100"
													: "text-zinc-400 hover:bg-zinc-800/50"
											}`}
										>
											<Icon size={16} className="shrink-0 text-zinc-500" />
											<span className="flex-1 truncate">{result.label}</span>
											{result.sublabel && (
												<span className="shrink-0 text-xs text-zinc-600">{result.sublabel}</span>
											)}
										</button>
									);
								})}
							</div>
						))
					) : (
						<p className="px-3 py-6 text-center text-sm text-zinc-600">No results found</p>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center gap-4 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-600">
					<span><kbd className="rounded border border-zinc-700 px-1 py-0.5">↑↓</kbd> Navigate</span>
					<span><kbd className="rounded border border-zinc-700 px-1 py-0.5">Enter</kbd> Select</span>
					<span><kbd className="rounded border border-zinc-700 px-1 py-0.5">Esc</kbd> Close</span>
				</div>
			</div>
		</>
	);
}
