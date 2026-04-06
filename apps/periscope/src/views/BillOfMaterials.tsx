import { BomStockPanel } from "@/components/BomStockPanel";
import { useBlueprintData } from "@/hooks/useBlueprintData";
import { classifyRecipePath } from "@/hooks/useBlueprintData";
import { type BomResult, resolveBom } from "@/lib/bomResolver";
import type {
	Blueprint,
	BomLineItem,
	BomOrderItem,
	BomSurplus,
	RecipeOverride,
} from "@/lib/bomTypes";
import { buildNameLookup, parseItemList } from "@/lib/fittingParser";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	ClipboardList,
	ClipboardPaste,
	Clock,
	Minus,
	Pickaxe,
	Plus,
	Recycle,
	Search,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── localStorage keys ───────────────────────────────────────────────────────

const LS_ORDER_KEY = "bom-order-items";
const LS_OVERRIDES_KEY = "bom-recipe-overrides";

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
		// quota exceeded or similar -- silently ignore
	}
}

// ── Item search component ───────────────────────────────────────────────────

interface ItemSearchProps {
	/** Only producible items (blueprint outputs) */
	producibleItems: Array<{ typeId: number; typeName: string }>;
	onSelect: (typeId: number, typeName: string) => void;
	placeholder?: string;
}

function ProducibleItemSearch({
	producibleItems,
	onSelect,
	placeholder = "Search producible items...",
}: ItemSearchProps) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<Array<{ typeId: number; typeName: string }>>([]);
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
		const q = query.toLowerCase();
		const matched = producibleItems
			.filter((item) => item.typeName.toLowerCase().includes(q))
			.slice(0, 20);
		setResults(matched);
		setHighlightIndex(0);
		setIsOpen(matched.length > 0);
	}, [query, producibleItems]);

	useEffect(() => {
		function handleMouseDown(e: MouseEvent) {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		}
		document.addEventListener("mousedown", handleMouseDown);
		return () => document.removeEventListener("mousedown", handleMouseDown);
	}, []);

	function handleSelect(item: { typeId: number; typeName: string }) {
		onSelect(item.typeId, item.typeName);
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
				<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onFocus={() => {
						if (results.length > 0) setIsOpen(true);
					}}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					className="w-full rounded border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>
			{isOpen && (
				<div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
					{results.map((item, idx) => (
						<button
							key={item.typeId}
							type="button"
							onClick={() => handleSelect(item)}
							className={`flex w-full items-center px-3 py-2 text-left text-sm ${
								idx === highlightIndex ? "bg-zinc-700" : "hover:bg-zinc-700/50"
							}`}
						>
							<span className="font-medium text-zinc-100">{item.typeName}</span>
							<span className="ml-2 font-mono text-xs text-zinc-600">#{item.typeId}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// ── Collapsible section ─────────────────────────────────────────────────────

function CollapsibleSection({
	title,
	count,
	defaultOpen = true,
	children,
}: {
	title: string;
	count?: number;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-300 hover:bg-zinc-800/30"
			>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				{title}
				{count !== undefined && <span className="text-xs text-zinc-500">({count})</span>}
			</button>
			{open && children}
		</div>
	);
}

// ── Material table ──────────────────────────────────────────────────────────

function MaterialTable({ items }: { items: BomLineItem[] }) {
	if (items.length === 0) {
		return <div className="px-4 py-3 text-xs text-zinc-600">None</div>;
	}
	const totalVolume = items.reduce(
		(sum, item) => (item.volumeMissing ? sum : sum + item.volume),
		0,
	);
	const hasMissing = items.some((item) => item.volumeMissing);
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<th className="px-4 py-2 text-left">Item</th>
					<th className="px-4 py-2 text-right">Need</th>
					<th className="px-4 py-2 text-right">Have</th>
					<th className="px-4 py-2 text-right">Still Need</th>
					<th className="px-4 py-2 text-right">Volume (m³)</th>
				</tr>
			</thead>
			<tbody>
				{items.map((item) => (
					<tr key={item.typeId} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
						<td className="px-4 py-2 text-zinc-200">{item.typeName}</td>
						<td className="px-4 py-2 text-right font-mono text-zinc-400">
							{item.quantity.toLocaleString()}
						</td>
						<td className="px-4 py-2 text-right font-mono text-cyan-400">
							{item.stockQty > 0 ? item.stockQty.toLocaleString() : "--"}
						</td>
						<td
							className={`px-4 py-2 text-right font-mono ${
								item.stillNeed === 0 ? "text-green-400" : "text-violet-300"
							}`}
						>
							{item.stillNeed === 0 ? "0" : item.stillNeed.toLocaleString()}
						</td>
						<td className="px-4 py-2 text-right">
							{item.volumeMissing ? (
								<span
									className="inline-flex items-center gap-1 text-amber-400"
									title="Volume data missing for this item"
								>
									<AlertTriangle size={12} />
									<span className="text-xs">??</span>
								</span>
							) : (
								<span className="font-mono text-zinc-400">
									{item.volume.toLocaleString(undefined, {
										maximumFractionDigits: 1,
									})}
								</span>
							)}
						</td>
					</tr>
				))}
			</tbody>
			<tfoot>
				<tr className="border-t border-zinc-700">
					<td className="px-4 py-2 text-xs font-medium text-zinc-400" colSpan={4}>
						Total
					</td>
					<td className="px-4 py-2 text-right font-mono text-sm text-zinc-200">
						{totalVolume.toLocaleString(undefined, { maximumFractionDigits: 1 })}
						{hasMissing && (
							<span className="ml-1 text-amber-400" title="Some items have missing volume">
								*
							</span>
						)}
					</td>
				</tr>
			</tfoot>
		</table>
	);
}

// ── Surplus table ───────────────────────────────────────────────────────────

function SurplusTable({ items }: { items: BomSurplus[] }) {
	if (items.length === 0) {
		return <div className="px-4 py-3 text-xs text-zinc-600">No surplus co-products</div>;
	}
	const totalVolume = items.reduce((sum, item) => (item.volume < 0 ? sum : sum + item.volume), 0);
	const hasMissing = items.some((item) => item.volume < 0);
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<th className="px-4 py-2 text-left">Item</th>
					<th className="px-4 py-2 text-right">Quantity</th>
					<th className="px-4 py-2 text-right">Volume (m³)</th>
				</tr>
			</thead>
			<tbody>
				{items.map((item) => (
					<tr key={item.typeId} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
						<td className="px-4 py-2 text-zinc-200">{item.typeName}</td>
						<td className="px-4 py-2 text-right font-mono text-zinc-400">
							{item.quantity.toLocaleString()}
						</td>
						<td className="px-4 py-2 text-right font-mono text-zinc-400">
							{item.volume < 0 ? (
								<span className="inline-flex items-center gap-1 text-amber-400">
									<AlertTriangle size={12} />
									<span className="text-xs">??</span>
								</span>
							) : (
								item.volume.toLocaleString(undefined, { maximumFractionDigits: 1 })
							)}
						</td>
					</tr>
				))}
			</tbody>
			<tfoot>
				<tr className="border-t border-zinc-700">
					<td className="px-4 py-2 text-xs font-medium text-zinc-400">Total</td>
					<td className="px-4 py-2" />
					<td className="px-4 py-2 text-right font-mono text-sm text-zinc-200">
						{totalVolume.toLocaleString(undefined, { maximumFractionDigits: 1 })}
						{hasMissing && (
							<span className="ml-1 text-amber-400" title="Some items have missing volume">
								*
							</span>
						)}
					</td>
				</tr>
			</tfoot>
		</table>
	);
}

// ── Recipe Configuration section ────────────────────────────────────────────

function RecipeConfigSection({
	result,
	outputToBlueprints,
	rawMaterialIds,
	salvageMaterialIds,
	blueprintFacilities,
	overrides,
	onOverrideChange,
}: {
	result: BomResult;
	outputToBlueprints: Map<number, Blueprint[]>;
	rawMaterialIds: Set<number>;
	salvageMaterialIds: Set<number>;
	blueprintFacilities: Map<number, string[]>;
	overrides: RecipeOverride[];
	onOverrideChange: (overrides: RecipeOverride[]) => void;
}) {
	// Collect all intermediates + finals that have multiple production recipes
	const multiRecipeItems = useMemo(() => {
		const allItems = [...result.intermediates, ...result.finals];
		return allItems.filter((item) => {
			const producers = outputToBlueprints.get(item.typeId);
			return producers && producers.length > 1;
		});
	}, [result.intermediates, result.finals, outputToBlueprints]);

	const overrideMap = useMemo(() => {
		const map = new Map<number, number>();
		for (const o of overrides) map.set(o.typeId, o.blueprintId);
		return map;
	}, [overrides]);

	if (multiRecipeItems.length === 0) return null;

	function handleChange(typeId: number, blueprintId: number) {
		const existing = overrides.filter((o) => o.typeId !== typeId);
		onOverrideChange([...existing, { typeId, blueprintId }]);
	}

	return (
		<CollapsibleSection
			title="Recipe Configuration"
			count={multiRecipeItems.length}
			defaultOpen={false}
		>
			<div className="space-y-3 px-4 pb-4">
				{multiRecipeItems.map((item) => {
					const producers = outputToBlueprints.get(item.typeId) ?? [];
					const currentBpId = overrideMap.get(item.typeId) ?? item.blueprintId;

					return (
						<div key={item.typeId} className="rounded border border-zinc-800 bg-zinc-900/30 p-3">
							<div className="mb-2 text-sm font-medium text-zinc-200">{item.typeName}</div>
							<div className="space-y-1.5">
								{producers.map((bp) => {
									const path = classifyRecipePath(
										bp,
										outputToBlueprints,
										rawMaterialIds,
										salvageMaterialIds,
									);
									const outputQty = bp.outputs.find((o) => o.typeID === item.typeId)?.quantity ?? 1;
									const totalInputQty = bp.inputs.reduce((s, i) => s + i.quantity, 0);
									const rawEff = totalInputQty / outputQty;
									const efficiency = rawEff < 1 ? rawEff.toPrecision(2) : rawEff.toFixed(1);
									const secPerUnit = bp.runTime / outputQty;
									const isSelected = bp.blueprintID === currentBpId;
									const facilities = blueprintFacilities.get(bp.blueprintID) ?? [];

									return (
										<button
											key={bp.blueprintID}
											type="button"
											onClick={() => handleChange(item.typeId, bp.blueprintID)}
											className={`flex w-full flex-col gap-1.5 rounded px-3 py-2 text-left text-xs transition-colors ${
												isSelected
													? "border border-cyan-600/50 bg-cyan-500/10 text-cyan-300"
													: "border border-zinc-800 text-zinc-400 hover:bg-zinc-800/50"
											}`}
										>
											<div className="flex w-full items-center gap-2">
												{path === "ore" ? (
													<Pickaxe size={12} className="shrink-0 text-amber-400" />
												) : (
													<Recycle size={12} className="shrink-0 text-green-400" />
												)}
												<span className="flex-1">
													<span className="text-zinc-200">BP #{bp.blueprintID}</span>
													<span className="ml-1.5 text-cyan-400">x{outputQty}</span>
													<span className="ml-2 text-zinc-500">
														{bp.inputs.map((i) => `${i.typeName} x${i.quantity}`).join(", ")}
													</span>
												</span>
												<span className="shrink-0 text-zinc-500">
													{formatTimePerUnit(secPerUnit)}/unit
												</span>
												<span className="shrink-0 text-zinc-500">{efficiency} input/unit</span>
												<span
													className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
														path === "ore"
															? "bg-amber-500/10 text-amber-400"
															: "bg-green-500/10 text-green-400"
													}`}
												>
													{path}
												</span>
											</div>
											{facilities.length > 0 && (
												<div className="flex flex-wrap gap-1 pl-5">
													{facilities.map((name) => (
														<span
															key={name}
															className="rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-300"
														>
															{name}
														</span>
													))}
												</div>
											)}
										</button>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</CollapsibleSection>
	);
}

// ── Main BOM view ───────────────────────────────────────────────────────────

export function BillOfMaterials() {
	const {
		blueprints,
		outputToBlueprints,
		defaultRecipes,
		rawMaterialIds,
		salvageMaterialIds,
		volumeMap,
		blueprintFacilities,
		isLoading,
	} = useBlueprintData();

	// Order list state (persisted to localStorage)
	const [orderItems, setOrderItems] = useState<BomOrderItem[]>(() =>
		loadFromStorage<BomOrderItem[]>(LS_ORDER_KEY, []),
	);
	const [recipeOverrides, setRecipeOverrides] = useState<RecipeOverride[]>(() =>
		loadFromStorage<RecipeOverride[]>(LS_OVERRIDES_KEY, []),
	);

	// Stock state (managed by BomStockPanel)
	const [stockMap, setStockMap] = useState<Map<number, number>>(new Map());

	// Persist order items and overrides
	useEffect(() => {
		saveToStorage(LS_ORDER_KEY, orderItems);
	}, [orderItems]);
	useEffect(() => {
		saveToStorage(LS_OVERRIDES_KEY, recipeOverrides);
	}, [recipeOverrides]);

	// Producible items list (outputs only, for order list search)
	const producibleItems = useMemo(() => {
		const seen = new Set<number>();
		const items: Array<{ typeId: number; typeName: string }> = [];
		for (const bp of Object.values(blueprints)) {
			for (const out of bp.outputs) {
				if (!seen.has(out.typeID)) {
					seen.add(out.typeID);
					items.push({ typeId: out.typeID, typeName: out.typeName });
				}
			}
		}
		items.sort((a, b) => a.typeName.localeCompare(b.typeName));
		return items;
	}, [blueprints]);

	// All blueprint-related types (inputs + outputs, for stock search)
	const blueprintTypes = useMemo(() => {
		const seen = new Set<number>();
		const items: Array<{ id: number; name: string }> = [];
		for (const bp of Object.values(blueprints)) {
			for (const io of [...bp.inputs, ...bp.outputs]) {
				if (!seen.has(io.typeID)) {
					seen.add(io.typeID);
					items.push({ id: io.typeID, name: io.typeName });
				}
			}
		}
		items.sort((a, b) => a.name.localeCompare(b.name));
		return items;
	}, [blueprints]);

	// Resolve BOM
	const result = useMemo<BomResult>(() => {
		if (orderItems.length === 0 || Object.keys(blueprints).length === 0) {
			return {
				rawMaterials: [],
				intermediates: [],
				finals: [],
				surplus: [],
				totals: {
					rawVolume: 0,
					intermediateVolume: 0,
					totalVolume: 0,
					totalTime: 0,
					iterations: 0,
				},
			};
		}
		return resolveBom(
			orderItems,
			{ blueprints, outputToBlueprints, defaultRecipes },
			recipeOverrides,
			volumeMap,
			stockMap,
		);
	}, [
		orderItems,
		blueprints,
		outputToBlueprints,
		defaultRecipes,
		recipeOverrides,
		volumeMap,
		stockMap,
	]);

	// Handlers
	const handleAddItem = useCallback((typeId: number, typeName: string) => {
		setOrderItems((prev) => {
			const existing = prev.find((i) => i.typeId === typeId);
			if (existing) {
				return prev.map((i) => (i.typeId === typeId ? { ...i, quantity: i.quantity + 1 } : i));
			}
			return [...prev, { typeId, typeName, quantity: 1 }];
		});
	}, []);

	const handleRemoveItem = useCallback((typeId: number) => {
		setOrderItems((prev) => prev.filter((i) => i.typeId !== typeId));
	}, []);

	const handleQuantityChange = useCallback((typeId: number, quantity: number) => {
		setOrderItems((prev) =>
			prev.map((i) => (i.typeId === typeId ? { ...i, quantity: Math.max(1, quantity) } : i)),
		);
	}, []);

	const handleClearAll = useCallback(() => {
		setOrderItems([]);
		setRecipeOverrides([]);
	}, []);

	// Import from clipboard
	const [showPaste, setShowPaste] = useState(false);
	const [pasteText, setPasteText] = useState("");

	const producibleNameLookup = useMemo(
		() => buildNameLookup(producibleItems.map((i) => ({ id: i.typeId, name: i.typeName }))),
		[producibleItems],
	);

	const handleImportItems = useCallback(() => {
		if (!pasteText.trim()) return;
		const parsed = parseItemList(pasteText, producibleNameLookup);
		if (parsed.length === 0) return;
		setOrderItems((prev) => {
			const updated = [...prev];
			for (const item of parsed) {
				const existing = updated.find((i) => i.typeId === item.typeId);
				if (existing) {
					existing.quantity += item.quantity;
				} else {
					updated.push(item);
				}
			}
			return updated;
		});
		setPasteText("");
		setShowPaste(false);
	}, [pasteText, producibleNameLookup]);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-zinc-500">Loading blueprint data...</p>
			</div>
		);
	}

	const hasResults = orderItems.length > 0 && result.rawMaterials.length > 0;

	return (
		<div className="flex h-full flex-col">
			{/* Page header */}
			<div className="flex items-center gap-2 border-b border-zinc-800 px-5 py-3">
				<ClipboardList size={18} className="text-violet-500" />
				<h1 className="text-base font-semibold text-zinc-100">Bill of Materials Calculator</h1>
			</div>

			<div className="flex flex-1 overflow-hidden">
			{/* Production List (left) */}
			<div className="flex w-96 shrink-0 flex-col border-r border-zinc-800">
				<div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
					<h2 className="flex items-center gap-2 text-sm font-medium text-zinc-300">
						Production List
						{orderItems.length > 0 && (
							<span className="text-xs text-zinc-500">({orderItems.length})</span>
						)}
					</h2>
					{orderItems.length > 0 && (
						<button
							type="button"
							onClick={handleClearAll}
							className="flex items-center gap-1 text-xs text-zinc-500 hover:text-red-400"
						>
							<Trash2 size={11} />
							Clear
						</button>
					)}
				</div>

				{/* Search to add items */}
				<div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-2">
					<div className="flex-1">
						<ProducibleItemSearch
							producibleItems={producibleItems}
							onSelect={handleAddItem}
							placeholder="Add producible item..."
						/>
					</div>
					<button
						type="button"
						onClick={() => setShowPaste(!showPaste)}
						className={`rounded p-1.5 ${showPaste ? "bg-violet-600/20 text-violet-400" : "text-zinc-500 hover:text-zinc-300"}`}
						title="Import from clipboard"
					>
						<ClipboardPaste size={14} />
					</button>
				</div>
				{showPaste && (
					<div className="border-b border-zinc-800 px-3 py-2 space-y-2">
						<textarea
							value={pasteText}
							onChange={(e) => setPasteText(e.target.value)}
							placeholder={"Paste from EVE client...\nFitting or inventory format"}
							rows={6}
							className="w-full rounded border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-violet-600 focus:outline-none"
						/>
						<div className="flex items-center justify-between">
							<span className="text-xs text-zinc-600">
								{pasteText.trim() ? `${parseItemList(pasteText, producibleNameLookup).length} items matched` : ""}
							</span>
							<div className="flex gap-1.5">
								<button
									type="button"
									onClick={() => { setPasteText(""); setShowPaste(false); }}
									className="rounded px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-300"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleImportItems}
									disabled={!pasteText.trim()}
									className="rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40"
								>
									Import
								</button>
							</div>
						</div>
					</div>
				)}

				{/* Order list */}
				<div className="flex-1 overflow-y-auto">
					{orderItems.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
							<ClipboardList size={32} className="text-zinc-800" />
							<p className="text-sm text-zinc-500">
								Search above to add items to your production list.
							</p>
						</div>
					) : (
						<div className="space-y-0">
							{orderItems.map((item) => (
								<div
									key={item.typeId}
									className="flex items-center gap-2 border-b border-zinc-800/50 px-4 py-2.5"
								>
									<div className="flex-1 min-w-0">
										<div className="text-sm font-medium text-zinc-200 truncate">
											{item.typeName}
										</div>
									</div>
									<div className="flex items-center gap-1.5">
										<button
											type="button"
											onClick={() => handleQuantityChange(item.typeId, item.quantity - 1)}
											className="rounded border border-zinc-700 p-0.5 text-zinc-400 hover:text-zinc-200"
										>
											<Minus size={12} />
										</button>
										<input
											type="number"
											value={item.quantity}
											onChange={(e) =>
												handleQuantityChange(item.typeId, Number.parseInt(e.target.value) || 1)
											}
											min={1}
											className="w-16 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-center text-xs text-zinc-100 focus:border-violet-600 focus:outline-none"
										/>
										<button
											type="button"
											onClick={() => handleQuantityChange(item.typeId, item.quantity + 1)}
											className="rounded border border-zinc-700 p-0.5 text-zinc-400 hover:text-zinc-200"
										>
											<Plus size={12} />
										</button>
										<button
											type="button"
											onClick={() => handleRemoveItem(item.typeId)}
											className="ml-1 rounded p-0.5 text-zinc-600 hover:text-red-400"
										>
											<Trash2 size={12} />
										</button>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Results Panel (right) */}
			<div className="flex-1 overflow-y-auto p-6">
				{!hasResults && orderItems.length === 0 && (
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<ClipboardList size={48} className="mx-auto mb-3 text-zinc-800" />
							<p className="text-sm text-zinc-500">
								Add items to your production list to calculate materials.
							</p>
						</div>
					</div>
				)}

				{orderItems.length > 0 && (
					<div className="space-y-4">
						{/* Recipe Configuration */}
						<RecipeConfigSection
							result={result}
							outputToBlueprints={outputToBlueprints}
							rawMaterialIds={rawMaterialIds}
							salvageMaterialIds={salvageMaterialIds}
							blueprintFacilities={blueprintFacilities}
							overrides={recipeOverrides}
							onOverrideChange={setRecipeOverrides}
						/>

						{/* Stock Integration */}
						<BomStockPanel onStockChange={setStockMap} typeList={blueprintTypes} />

						{/* Summary */}
						<CollapsibleSection title="Summary">
							<div className="grid grid-cols-2 gap-4 px-4 pb-4 text-sm sm:grid-cols-4">
								<div>
									<div className="text-xs text-zinc-500">Production Time</div>
									<div className="mt-1 font-mono text-zinc-200">
										<span className="flex items-center gap-1">
											<Clock size={12} className="text-zinc-500" />
											{formatTime(result.totals.totalTime)}
										</span>
									</div>
								</div>
								<div>
									<div className="text-xs text-zinc-500">Raw Volume</div>
									<div className="mt-1 font-mono text-zinc-200">
										{result.totals.rawVolume.toLocaleString(undefined, {
											maximumFractionDigits: 1,
										})}
									</div>
								</div>
								<div>
									<div className="text-xs text-zinc-500">Intermediate Volume</div>
									<div className="mt-1 font-mono text-zinc-200">
										{result.totals.intermediateVolume.toLocaleString(undefined, {
											maximumFractionDigits: 1,
										})}
									</div>
								</div>
								<div>
									<div className="text-xs text-zinc-500">Convergence</div>
									<div className="mt-1 font-mono text-zinc-200">
										{result.totals.iterations} iteration{result.totals.iterations !== 1 ? "s" : ""}
									</div>
								</div>
							</div>
						</CollapsibleSection>

						{/* Finals */}
						{result.finals.length > 0 && (
							<CollapsibleSection title="Final Products" count={result.finals.length}>
								<MaterialTable items={result.finals} />
							</CollapsibleSection>
						)}

						{/* Raw Materials */}
						<CollapsibleSection title="Raw Materials" count={result.rawMaterials.length}>
							<MaterialTable items={result.rawMaterials} />
						</CollapsibleSection>

						{/* Intermediates */}
						<CollapsibleSection title="Intermediates" count={result.intermediates.length}>
							<MaterialTable items={result.intermediates} />
						</CollapsibleSection>

						{/* Surplus */}
						{result.surplus.length > 0 && (
							<CollapsibleSection
								title="Surplus Co-Products"
								count={result.surplus.length}
								defaultOpen={false}
							>
								<SurplusTable items={result.surplus} />
							</CollapsibleSection>
						)}
					</div>
				)}
			</div>
			</div>
		</div>
	);
}

function formatTimePerUnit(seconds: number): string {
	if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	return formatTime(Math.round(seconds));
}

function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	const parts = [];
	if (h > 0) parts.push(`${h}h`);
	if (m > 0) parts.push(`${m}m`);
	if (s > 0) parts.push(`${s}s`);
	return parts.join(" ") || "0s";
}
