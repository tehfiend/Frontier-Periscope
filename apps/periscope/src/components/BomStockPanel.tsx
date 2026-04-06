import { type AssemblyInventory, fetchAssemblyInventory } from "@/chain/inventory";
import { db } from "@/db";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import {
	Box,
	ChevronDown,
	ChevronRight,
	Loader2,
	Plus,
	Search,
	Trash2,
	Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── localStorage keys ───────────────────────────────────────────────────────

const LS_SELECTED_SSUS = "bom-selected-ssus";
const LS_MANUAL_STOCK = "bom-manual-stock";

interface ManualStockEntry {
	typeId: number;
	typeName: string;
	quantity: number;
}

function loadFromStorage<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function saveToStorage<T>(key: string, value: T): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// quota exceeded -- silently ignore
	}
}

// ── Any-type search (for manual stock, not limited to blueprint outputs) ────

function AnyTypeSearch({
	onSelect,
}: {
	onSelect: (typeId: number, typeName: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<Array<{ id: number; name: string }>>([]);
	const [isOpen, setIsOpen] = useState(false);
	const [highlightIndex, setHighlightIndex] = useState(0);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!query.trim()) {
			setResults([]);
			setIsOpen(false);
			return;
		}
		const timer = setTimeout(async () => {
			const q = query.trim().toLowerCase();
			let items = await db.gameTypes.where("name").startsWithIgnoreCase(q).limit(20).toArray();
			if (items.length < 5) {
				const existingIds = new Set(items.map((i) => i.id));
				const extra = await db.gameTypes
					.filter((t) => !existingIds.has(t.id) && t.name.toLowerCase().includes(q))
					.limit(20)
					.toArray();
				items = [...items, ...extra].slice(0, 20);
			}
			setResults(items.map((i) => ({ id: i.id, name: i.name })));
			setHighlightIndex(0);
			setIsOpen(items.length > 0);
		}, 200);
		return () => clearTimeout(timer);
	}, [query]);

	useEffect(() => {
		function handleMouseDown(e: MouseEvent) {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		}
		document.addEventListener("mousedown", handleMouseDown);
		return () => document.removeEventListener("mousedown", handleMouseDown);
	}, []);

	function handleSelect(item: { id: number; name: string }) {
		onSelect(item.id, item.name);
		setQuery("");
		setIsOpen(false);
		inputRef.current?.focus();
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (!isOpen) return;
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				setHighlightIndex((prev) => Math.min(prev + 1, results.length - 1));
				break;
			case "ArrowUp":
				e.preventDefault();
				setHighlightIndex((prev) => Math.max(prev - 1, 0));
				break;
			case "Enter":
				e.preventDefault();
				if (results[highlightIndex]) handleSelect(results[highlightIndex]);
				break;
			case "Escape":
				setIsOpen(false);
				break;
		}
	}

	return (
		<div className="relative" ref={wrapperRef}>
			<div className="relative">
				<Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onFocus={() => {
						if (results.length > 0) setIsOpen(true);
					}}
					onKeyDown={handleKeyDown}
					placeholder="Add stock item..."
					className="w-full rounded border border-zinc-700 bg-zinc-800 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>
			{isOpen && (
				<div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
					{results.map((item, idx) => (
						<button
							key={item.id}
							type="button"
							onClick={() => handleSelect(item)}
							className={`flex w-full items-center px-3 py-1.5 text-left text-xs ${
								idx === highlightIndex ? "bg-zinc-700" : "hover:bg-zinc-700/50"
							}`}
						>
							<span className="font-medium text-zinc-100">{item.name}</span>
							<span className="ml-2 font-mono text-zinc-600">#{item.id}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// ── Main stock panel ────────────────────────────────────────────────────────

interface BomStockPanelProps {
	onStockChange: (stockMap: Map<number, number>) => void;
}

export function BomStockPanel({ onStockChange }: BomStockPanelProps) {
	const [open, setOpen] = useState(false);
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const client = useSuiClient();
	const { data: discovery, isLoading: loadingAssemblies } = useOwnedAssemblies();

	// SSU selection state
	const [selectedSsuIds, setSelectedSsuIds] = useState<string[]>(() =>
		loadFromStorage<string[]>(LS_SELECTED_SSUS, []),
	);

	// Manual stock entries
	const [manualStock, setManualStock] = useState<ManualStockEntry[]>(() =>
		loadFromStorage<ManualStockEntry[]>(LS_MANUAL_STOCK, []),
	);

	// Type name lookup
	const gameTypes = useLiveQuery(() => db.gameTypes.toArray()) ?? [];
	const typeNameMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const gt of gameTypes) map[gt.id] = gt.name;
		return map;
	}, [gameTypes]);

	// Persist selections
	useEffect(() => {
		saveToStorage(LS_SELECTED_SSUS, selectedSsuIds);
	}, [selectedSsuIds]);
	useEffect(() => {
		saveToStorage(LS_MANUAL_STOCK, manualStock);
	}, [manualStock]);

	// Find storage-type assemblies
	const storageAssemblies = useMemo(
		() => discovery?.assemblies.filter((a) => a.type === "storage_unit") ?? [],
		[discovery],
	);

	// Fetch inventories for selected SSUs
	const enabledSsus = storageAssemblies.filter((a) => selectedSsuIds.includes(a.objectId));

	const { data: inventories, isLoading: loadingInventory } = useQuery({
		queryKey: ["bomSsuInventories", enabledSsus.map((a) => a.objectId).join(",")],
		queryFn: async () => {
			const results: AssemblyInventory[] = [];
			for (const assembly of enabledSsus) {
				const inv = await fetchAssemblyInventory(client, assembly.objectId, assembly.type);
				results.push(...inv);
			}
			return results;
		},
		enabled: enabledSsus.length > 0,
		staleTime: 60_000,
		refetchInterval: 120_000,
	});

	// Build merged stock map and notify parent
	const mergedStock = useMemo(() => {
		const map = new Map<number, number>();

		// SSU inventory
		if (inventories) {
			for (const inv of inventories) {
				for (const item of inv.items) {
					map.set(item.typeId, (map.get(item.typeId) ?? 0) + item.quantity);
				}
			}
		}

		// Manual stock (adds to SSU, doesn't replace)
		for (const entry of manualStock) {
			map.set(entry.typeId, (map.get(entry.typeId) ?? 0) + entry.quantity);
		}

		return map;
	}, [inventories, manualStock]);

	useEffect(() => {
		onStockChange(mergedStock);
	}, [mergedStock, onStockChange]);

	// SSU toggle
	const toggleSsu = useCallback((objectId: string) => {
		setSelectedSsuIds((prev) =>
			prev.includes(objectId) ? prev.filter((id) => id !== objectId) : [...prev, objectId],
		);
	}, []);

	// Manual stock handlers
	const handleAddManualItem = useCallback((typeId: number, typeName: string) => {
		setManualStock((prev) => {
			const existing = prev.find((e) => e.typeId === typeId);
			if (existing) return prev;
			return [...prev, { typeId, typeName, quantity: 1 }];
		});
	}, []);

	const handleManualQtyChange = useCallback((typeId: number, quantity: number) => {
		setManualStock((prev) =>
			prev.map((e) => (e.typeId === typeId ? { ...e, quantity: Math.max(0, quantity) } : e)),
		);
	}, []);

	const handleRemoveManual = useCallback((typeId: number) => {
		setManualStock((prev) => prev.filter((e) => e.typeId !== typeId));
	}, []);

	const hasWallet = !!activeCharacter?.suiAddress || !!account?.address;
	const totalStockItems = mergedStock.size;

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-300 hover:bg-zinc-800/30"
			>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				Stock
				{totalStockItems > 0 && (
					<span className="text-xs text-zinc-500">({totalStockItems} items)</span>
				)}
			</button>

			{open && (
				<div className="space-y-4 px-4 pb-4">
					{/* SSU Selector */}
					<div>
						<h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
							<Box size={12} />
							SSU Inventory
						</h4>

						{!hasWallet ? (
							<div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-3 py-3 text-xs text-zinc-500">
								<Wallet size={14} className="text-cyan-500" />
								Connect your wallet to load SSU inventories.
							</div>
						) : loadingAssemblies ? (
							<div className="flex items-center gap-2 text-xs text-zinc-500">
								<Loader2 size={12} className="animate-spin" />
								Loading assemblies...
							</div>
						) : storageAssemblies.length === 0 ? (
							<div className="text-xs text-zinc-600">No storage units found.</div>
						) : (
							<div className="space-y-1">
								{storageAssemblies.map((a) => {
									const label = a.label || `${a.objectId.slice(0, 8)}...${a.objectId.slice(-4)}`;
									const checked = selectedSsuIds.includes(a.objectId);
									return (
										<label
											key={a.objectId}
											className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-zinc-800/50"
										>
											<input
												type="checkbox"
												checked={checked}
												onChange={() => toggleSsu(a.objectId)}
												className="rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
											/>
											<span className={checked ? "text-zinc-200" : "text-zinc-400"}>{label}</span>
										</label>
									);
								})}
								{loadingInventory && (
									<div className="flex items-center gap-2 pt-1 text-xs text-zinc-500">
										<Loader2 size={12} className="animate-spin" />
										Loading inventory...
									</div>
								)}
							</div>
						)}
					</div>

					{/* Manual Stock */}
					<div>
						<h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
							<Plus size={12} />
							Manual Stock
						</h4>
						<AnyTypeSearch onSelect={handleAddManualItem} />
						{manualStock.length > 0 && (
							<div className="mt-2 space-y-1">
								{manualStock.map((entry) => (
									<div
										key={entry.typeId}
										className="flex items-center gap-2 rounded px-2 py-1 text-xs"
									>
										<span className="flex-1 truncate text-zinc-300">
											{typeNameMap[entry.typeId] ?? entry.typeName}
										</span>
										<input
											type="number"
											value={entry.quantity}
											onChange={(e) =>
												handleManualQtyChange(entry.typeId, Number.parseInt(e.target.value) || 0)
											}
											min={0}
											className="w-20 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-center text-xs text-zinc-100 focus:border-violet-600 focus:outline-none"
										/>
										<button
											type="button"
											onClick={() => handleRemoveManual(entry.typeId)}
											className="text-zinc-600 hover:text-red-400"
										>
											<Trash2 size={12} />
										</button>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
