import { BomStockPanel } from "@/components/BomStockPanel";
import { ItemIcon } from "@/components/ItemIcon";
import { useBlueprintData } from "@/hooks/useBlueprintData";
import {
	classifyRecipePath,
	computeDefaultRecipes,
	findRawMaterials,
} from "@/hooks/useBlueprintData";
import { type BomResult, buildBomFromLp, resolveBom } from "@/lib/bomResolver";
import type {
	Blueprint,
	BomLineItem,
	BomOrderItem,
	BomSurplus,
	RecipeOverride,
	RecipePin,
} from "@/lib/bomTypes";
import { buildNameLookup, parseItemList } from "@/lib/fittingParser";
import { ceilLpSolution, solveLp } from "@/lib/lpOptimizer";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	ChevronsUpDown,
	ClipboardCopy,
	ClipboardPaste,
	Factory,
	Clock,
	Minus,
	Plus,
	Search,
	Trash2,
	Zap,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── localStorage keys ───────────────────────────────────────────────────────

const LS_ORDER_KEY = "bom-order-items";
const LS_OVERRIDES_KEY = "bom-recipe-overrides";
const LS_PINS_KEY = "bom-recipe-pins";

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

// ── Copy to clipboard button ────────────────────────────────────────────────

function CopyButton({ getText }: { getText: () => string }) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
	return (
		<button
			type="button"
			onClick={() => {
				navigator.clipboard.writeText(getText());
				setCopied(true);
				if (timerRef.current) clearTimeout(timerRef.current);
				timerRef.current = setTimeout(() => setCopied(false), 1500);
			}}
			className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
			title="Copy as CSV"
		>
			<ClipboardCopy size={11} />
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

// ── CSV formatters ─────────────────────────────────────────────────────────

function materialsToCsv(items: BomLineItem[]): string {
	const rows = [["Item", "Need", "Have", "Still Need", "Volume (m³)"].join("\t")];
	for (const i of items) {
		rows.push(
			[
				i.typeName,
				i.quantity,
				i.stockQty || "",
				i.stillNeed,
				i.volumeMissing ? "" : i.volume.toFixed(1),
			].join("\t"),
		);
	}
	return rows.join("\n");
}

function surplusToCsv(items: BomSurplus[]): string {
	const rows = [["Item", "Quantity", "Volume (m³)"].join("\t")];
	for (const i of items) {
		rows.push([i.typeName, i.quantity, i.volume < 0 ? "" : i.volume.toFixed(1)].join("\t"));
	}
	return rows.join("\n");
}

function orderItemsToCsv(items: BomOrderItem[]): string {
	const rows = [["Item", "Quantity"].join("\t")];
	for (const i of items) {
		rows.push([i.typeName, i.quantity].join("\t"));
	}
	return rows.join("\n");
}

function summaryToCsv(totals: BomResult["totals"]): string {
	return [
		["Metric", "Value"].join("\t"),
		["Production Time", formatTime(totals.totalTime)].join("\t"),
		["Raw Volume (m³)", totals.rawVolume.toFixed(1)].join("\t"),
		["Intermediate Volume (m³)", totals.intermediateVolume.toFixed(1)].join("\t"),
		["Convergence Iterations", totals.iterations].join("\t"),
	].join("\n");
}

// ── Collapsible section ─────────────────────────────────────────────────────

function CollapsibleSection({
	title,
	count,
	defaultOpen = true,
	headerRight,
	collapsedSummary,
	children,
}: {
	title: string;
	count?: number;
	defaultOpen?: boolean;
	headerRight?: React.ReactNode;
	collapsedSummary?: string;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
			<div className="flex items-center">
				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="flex flex-1 items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-300 hover:bg-zinc-800/30"
				>
					{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					{title}
					{count !== undefined && <span className="text-xs text-zinc-500">({count})</span>}
					{!open && collapsedSummary && (
						<span className="ml-2 text-xs font-normal text-zinc-500">{collapsedSummary}</span>
					)}
				</button>
				{headerRight && <div className="pr-4">{headerRight}</div>}
			</div>
			{open && children}
		</div>
	);
}

// ── Material table ──────────────────────────────────────────────────────────

function MaterialTable({
	items,
	typeGroups,
	salvageMaterialIds,
}: {
	items: BomLineItem[];
	/** typeID -> group name (asteroid name for ores). When provided, shows a Source column. */
	typeGroups?: Map<number, string>;
	salvageMaterialIds?: Set<number>;
}) {
	if (items.length === 0) {
		return <div className="px-4 py-3 text-xs text-zinc-600">None</div>;
	}
	const showSource = typeGroups != null;
	const totalVolume = items.reduce(
		(sum, item) => (item.volumeMissing ? sum : sum + item.volume),
		0,
	);
	const hasMissing = items.some((item) => item.volumeMissing);

	function getSource(typeId: number): string {
		const group = typeGroups?.get(typeId);
		if (group === "Rift") return "Rift";
		if (group && group.endsWith("Ores")) {
			const asteroid = group.replace(" Ores", "");
			return `${asteroid} Asteroid`;
		}
		return "Loot";
	}

	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<th className="px-4 py-2 text-left">Item</th>
					{showSource && <th className="px-4 py-2 text-left">Source</th>}
					<th className="px-4 py-2 text-right">Need</th>
					<th className="px-4 py-2 text-right">Have</th>
					<th className="px-4 py-2 text-right">Still Need</th>
					<th className="px-4 py-2 text-right">Volume (m³)</th>
				</tr>
			</thead>
			<tbody>
				{items.map((item) => (
					<tr key={item.typeId} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
						<td className="px-4 py-2 text-zinc-200">
							<span className="flex items-center gap-2">
								<ItemIcon typeId={item.typeId} />
								{item.typeName}
							</span>
						</td>
						{showSource && (
							<td className="px-4 py-2 text-xs text-zinc-500">
								{getSource(item.typeId)}
							</td>
						)}
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
					<td className="px-4 py-2 text-xs font-medium text-zinc-400" colSpan={showSource ? 5 : 4}>
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
					<th className="px-4 py-2 text-left">Source</th>
					<th className="px-4 py-2 text-right">Quantity</th>
					<th className="px-4 py-2 text-right">Volume (m³)</th>
				</tr>
			</thead>
			<tbody>
				{items.map((item) => (
					<tr key={item.typeId} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
						<td className="px-4 py-2 text-zinc-200">
							<span className="flex items-center gap-2">
								<ItemIcon typeId={item.typeId} />
								{item.typeName}
							</span>
						</td>
						<td className="px-4 py-2 text-xs text-zinc-500">{item.source ?? "--"}</td>
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
					<td className="px-4 py-2 text-xs font-medium text-zinc-400" colSpan={3}>
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

// ── Recipe dropdown (shows facility name closed, full info in dropdown) ────

function RecipeDropdown({
	typeId,
	producers,
	currentBpId,
	isOverridden,
	outputToBlueprints,
	rawMaterialIds,
	salvageMaterialIds,
	blueprintFacilities,
	onSelect,
	formatOptionLabel,
	getFacilityLabel,
	onSplitRequest,
}: {
	typeId: number;
	producers: Blueprint[];
	currentBpId: number | undefined;
	isOverridden: boolean;
	outputToBlueprints: Map<number, Blueprint[]>;
	rawMaterialIds: Set<number>;
	salvageMaterialIds: Set<number>;
	blueprintFacilities: Map<number, string[]>;
	onSelect: (blueprintId: number) => void;
	formatOptionLabel: (bp: Blueprint, typeId: number) => string;
	getFacilityLabel: (bp: Blueprint) => string;
	/** When provided, shows a "Split..." option in the dropdown. */
	onSplitRequest?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const currentBp = producers.find((p) => p.blueprintID === currentBpId) ?? producers[0];

	useEffect(() => {
		if (!open) return;
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className={`flex items-center gap-1 truncate rounded border px-1.5 py-0.5 text-xs focus:border-violet-600 focus:outline-none ${
					isOverridden
						? "border-cyan-600/50 bg-zinc-900 text-cyan-300"
						: "border-zinc-700 bg-zinc-900 text-zinc-400"
				}`}
			>
				{getFacilityLabel(currentBp)}
				<ChevronDown size={10} className="shrink-0 text-zinc-600" />
			</button>
			{open && (
				<div className="absolute left-0 top-full z-20 mt-1 min-w-[320px] rounded border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
					{producers.map((bp) => {
						const path = classifyRecipePath(
							bp,
							outputToBlueprints,
							rawMaterialIds,
							salvageMaterialIds,
						);
						const isSelected = bp.blueprintID === currentBpId;
						return (
							<button
								key={bp.blueprintID}
								type="button"
								onClick={() => {
									onSelect(bp.blueprintID);
									setOpen(false);
								}}
								className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
									isSelected ? "text-cyan-300" : "text-zinc-400"
								}`}
							>
								{isSelected && <span className="text-cyan-400">●</span>}
								<span className={isSelected ? "" : "ml-4"}>
									{path === "salvage" ? "♻ " : ""}
									{formatOptionLabel(bp, typeId)}
								</span>
							</button>
						);
					})}
					{onSplitRequest && (
						<>
							<div className="mx-2 my-1 border-t border-zinc-800" />
							<button
								type="button"
								onClick={() => {
									onSplitRequest();
									setOpen(false);
								}}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-violet-400 hover:bg-zinc-800"
							>
								<span className="ml-4">Split...</span>
							</button>
						</>
					)}
				</div>
			)}
		</div>
	);
}

// ── Production table (merged order list + finals) ──────────────────────────

function ProductionTable({
	orderItems,
	finals,
	outputToBlueprints,
	rawMaterialIds,
	salvageMaterialIds,
	blueprintFacilities,
	overrides,
	onOverrideChange,
	onQuantityChange,
	onRemove,
}: {
	orderItems: BomOrderItem[];
	finals: BomLineItem[];
	outputToBlueprints: Map<number, Blueprint[]>;
	rawMaterialIds: Set<number>;
	salvageMaterialIds: Set<number>;
	blueprintFacilities: Map<number, string[]>;
	overrides: RecipeOverride[];
	onOverrideChange: (overrides: RecipeOverride[]) => void;
	onQuantityChange: (typeId: number, quantity: number) => void;
	onRemove: (typeId: number) => void;
}) {
	const overrideMap = useMemo(() => {
		const map = new Map<number, number>();
		for (const o of overrides) map.set(o.typeId, o.blueprintId);
		return map;
	}, [overrides]);

	const finalsMap = useMemo(() => {
		const map = new Map<number, BomLineItem>();
		for (const f of finals) map.set(f.typeId, f);
		return map;
	}, [finals]);

	function handleRecipeChange(typeId: number, blueprintId: number) {
		const existing = overrides.filter((o) => o.typeId !== typeId);
		onOverrideChange([...existing, { typeId, blueprintId }]);
	}

	function getFacilityLabel(bp: Blueprint): string {
		const facs = blueprintFacilities.get(bp.blueprintID) ?? [];
		return facs.length > 0 ? facs[0] : `BP #${bp.blueprintID}`;
	}

	function formatOptionLabel(bp: Blueprint, typeId: number): string {
		const outputQty = bp.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
		const totalInputQty = bp.inputs.reduce((s, i) => s + i.quantity, 0);
		const rawEff = totalInputQty / outputQty;
		const eff = rawEff < 1 ? rawEff.toPrecision(2) : rawEff.toFixed(1);
		const facs = blueprintFacilities.get(bp.blueprintID) ?? [];
		const facLabel = facs.length > 0 ? facs[0] : `BP #${bp.blueprintID}`;
		const inputs = bp.inputs.map((i) => i.typeName).join(", ");
		return `${facLabel} · ${inputs} · eff ${eff}`;
	}

	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<th className="px-4 py-2 text-left">Item</th>
					<th className="px-4 py-2 text-left">Recipe</th>
					<th className="px-4 py-2 text-center">Qty</th>
					<th className="px-4 py-2 text-right">Have</th>
					<th className="px-4 py-2 text-right">Still Need</th>
					<th className="px-4 py-2 text-right">Volume (m³)</th>
					<th className="w-8 px-2 py-2" />
				</tr>
			</thead>
			<tbody>
				{orderItems.map((item) => {
					const finalItem = finalsMap.get(item.typeId);
					const producers = outputToBlueprints.get(item.typeId) ?? [];
					const hasMultiple = producers.length > 1;
					const currentBpId = overrideMap.get(item.typeId) ?? finalItem?.blueprintId;
					const isOverridden = overrideMap.has(item.typeId);
					const currentBp = producers.find((p) => p.blueprintID === currentBpId) ?? producers[0];

					return (
						<tr
							key={item.typeId}
							className="border-t border-zinc-800/50 hover:bg-zinc-800/30 align-middle"
						>
							<td className="px-4 py-1 text-zinc-200">
								<span className="flex items-center gap-2">
									<ItemIcon typeId={item.typeId} size={24} />
									{item.typeName}
								</span>
							</td>
							<td className="px-4 py-2">
								{hasMultiple && currentBp ? (
									<RecipeDropdown
										typeId={item.typeId}
										producers={producers}
										currentBpId={currentBpId}
										isOverridden={isOverridden}
										outputToBlueprints={outputToBlueprints}
										rawMaterialIds={rawMaterialIds}
										salvageMaterialIds={salvageMaterialIds}
										blueprintFacilities={blueprintFacilities}
										onSelect={(bpId) => handleRecipeChange(item.typeId, bpId)}
										formatOptionLabel={formatOptionLabel}
										getFacilityLabel={getFacilityLabel}
									/>
								) : currentBp ? (
									<span className="text-xs text-zinc-500">{getFacilityLabel(currentBp)}</span>
								) : null}
							</td>
							<td className="px-4 py-2">
								<div className="flex items-center justify-center gap-1">
									<button
										type="button"
										onClick={() => onQuantityChange(item.typeId, item.quantity - 1)}
										className="rounded border border-zinc-700 p-0.5 text-zinc-400 hover:text-zinc-200"
									>
										<Minus size={12} />
									</button>
									<input
										type="number"
										value={item.quantity}
										onChange={(e) =>
											onQuantityChange(item.typeId, Number.parseInt(e.target.value) || 1)
										}
										min={1}
										className="w-14 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-center text-xs text-zinc-100 focus:border-violet-600 focus:outline-none"
									/>
									<button
										type="button"
										onClick={() => onQuantityChange(item.typeId, item.quantity + 1)}
										className="rounded border border-zinc-700 p-0.5 text-zinc-400 hover:text-zinc-200"
									>
										<Plus size={12} />
									</button>
								</div>
							</td>
							<td className="px-4 py-2 text-right font-mono text-cyan-400">
								{finalItem && finalItem.stockQty > 0 ? finalItem.stockQty.toLocaleString() : "--"}
							</td>
							<td
								className={`px-4 py-2 text-right font-mono ${
									finalItem && finalItem.stillNeed === 0 ? "text-green-400" : "text-violet-300"
								}`}
							>
								{finalItem
									? finalItem.stillNeed === 0
										? "0"
										: finalItem.stillNeed.toLocaleString()
									: item.quantity.toLocaleString()}
							</td>
							<td className="px-4 py-2 text-right">
								{finalItem ? (
									finalItem.volumeMissing ? (
										<span
											className="inline-flex items-center gap-1 text-amber-400"
											title="Volume data missing"
										>
											<AlertTriangle size={12} />
											<span className="text-xs">??</span>
										</span>
									) : (
										<span className="font-mono text-zinc-400">
											{finalItem.volume.toLocaleString(undefined, { maximumFractionDigits: 1 })}
										</span>
									)
								) : (
									<span className="text-zinc-600">--</span>
								)}
							</td>
							<td className="px-2 py-2 text-center">
								<button
									type="button"
									onClick={() => onRemove(item.typeId)}
									className="rounded p-0.5 text-zinc-600 hover:text-red-400"
								>
									<Trash2 size={12} />
								</button>
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

// ── Intermediate table with inline recipe selection ─────────────────────────

function IntermediateTable({
	items,
	outputToBlueprints,
	rawMaterialIds,
	salvageMaterialIds,
	blueprintFacilities,
	overrides,
	onOverrideChange,
	recipePins = [],
	onRecipePinChange,
	typeGroups,
	typeCategories,
}: {
	items: BomLineItem[];
	outputToBlueprints: Map<number, Blueprint[]>;
	rawMaterialIds: Set<number>;
	salvageMaterialIds: Set<number>;
	blueprintFacilities: Map<number, string[]>;
	overrides: RecipeOverride[];
	onOverrideChange: (overrides: RecipeOverride[]) => void;
	recipePins?: RecipePin[];
	onRecipePinChange?: (pins: RecipePin[]) => void;
	typeGroups: Map<number, string>;
	typeCategories: Map<number, string>;
}) {
	const overrideMap = useMemo(() => {
		const map = new Map<number, number>();
		for (const o of overrides) map.set(o.typeId, o.blueprintId);
		return map;
	}, [overrides]);

	const pinMap = useMemo(() => {
		const map = new Map<number, RecipePin>();
		for (const p of recipePins) map.set(p.typeId, p);
		return map;
	}, [recipePins]);

	// Sorting
	const [sortCol, setSortCol] = useState<"name" | "category" | "group" | null>(null);
	const [sortDesc, setSortDesc] = useState(false);

	function toggleSort(col: "name" | "category" | "group") {
		if (sortCol === col) {
			if (sortDesc) {
				setSortCol(null);
				setSortDesc(false);
			} else {
				setSortDesc(true);
			}
		} else {
			setSortCol(col);
			setSortDesc(false);
		}
	}

	const sortedItems = useMemo(() => {
		if (!sortCol) return items;
		const sorted = [...items].sort((a, b) => {
			let av: string;
			let bv: string;
			if (sortCol === "name") {
				av = a.typeName;
				bv = b.typeName;
			} else if (sortCol === "group") {
				av = typeGroups.get(a.typeId) ?? "";
				bv = typeGroups.get(b.typeId) ?? "";
			} else {
				av = typeCategories.get(a.typeId) ?? "";
				bv = typeCategories.get(b.typeId) ?? "";
			}
			return av.localeCompare(bv);
		});
		return sortDesc ? sorted.reverse() : sorted;
	}, [items, sortCol, sortDesc, typeGroups, typeCategories]);

	// Split editor: which typeId is being edited, and the draft quantities
	const [splitEditTypeId, setSplitEditTypeId] = useState<number | null>(null);
	const [splitDraft, setSplitDraft] = useState<Map<number, number>>(new Map());

	function openSplitEditor(typeId: number) {
		const existingPin = pinMap.get(typeId);
		const draft = new Map<number, number>();
		if (existingPin?.kind === "split") {
			for (const s of existingPin.splits) draft.set(s.blueprintId, s.quantity);
		} else {
			const item = items.find((i) => i.typeId === typeId);
			if (item?.splits && item.splits.length > 1) {
				// Load LP-decided splits, snapped to batch sizes
				const prods = outputToBlueprints.get(typeId) ?? [];
				for (const s of item.splits) {
					const bpDef = prods.find((p) => p.blueprintID === s.blueprintId);
					const batch = bpDef?.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
					draft.set(s.blueprintId, Math.round(s.quantity / batch) * batch);
				}
			} else if (item) {
				// Start with full demand on the currently selected recipe
				const currentBpId =
					existingPin?.kind === "exclusive"
						? existingPin.blueprintId
						: (overrideMap.get(typeId) ?? item.blueprintId);
				if (currentBpId != null) {
					draft.set(currentBpId, item.quantity);
				}
			}
		}
		setSplitDraft(draft);
		setSplitEditTypeId(typeId);
	}

	function saveSplitPin(typeId: number) {
		if (!onRecipePinChange) return;
		const otherPins = recipePins.filter((p) => p.typeId !== typeId);
		const entries: Array<{ blueprintId: number; quantity: number }> = [];
		for (const [bpId, qty] of splitDraft) {
			if (qty > 0) entries.push({ blueprintId: bpId, quantity: qty });
		}
		if (entries.length === 0) {
			// No quantities -- remove pin
			onRecipePinChange(otherPins);
		} else if (entries.length === 1) {
			// Single entry -- convert to exclusive pin
			onRecipePinChange([...otherPins, { typeId, kind: "exclusive", blueprintId: entries[0].blueprintId }]);
		} else {
			onRecipePinChange([...otherPins, { typeId, kind: "split", splits: entries }]);
		}
		setSplitEditTypeId(null);
	}

	function clearSplitPin(typeId: number) {
		if (!onRecipePinChange) return;
		onRecipePinChange(recipePins.filter((p) => p.typeId !== typeId));
		setSplitEditTypeId(null);
	}

	if (items.length === 0) {
		return <div className="px-4 py-3 text-xs text-zinc-600">None</div>;
	}

	const totalVolume = items.reduce(
		(sum, item) => (item.volumeMissing ? sum : sum + item.volume),
		0,
	);
	const hasMissing = items.some((item) => item.volumeMissing);

	function handleRecipeChange(typeId: number, blueprintId: number) {
		if (onRecipePinChange) {
			const existingPin = pinMap.get(typeId);
			const otherPins = recipePins.filter((p) => p.typeId !== typeId);
			if (existingPin?.kind === "exclusive" && existingPin.blueprintId === blueprintId) {
				// Clicking the same pin clears it
				onRecipePinChange(otherPins);
			} else {
				onRecipePinChange([...otherPins, { typeId, kind: "exclusive", blueprintId }]);
			}
		}
	}

	function getFacilityLabel(bp: Blueprint): string {
		const facs = blueprintFacilities.get(bp.blueprintID) ?? [];
		return facs.length > 0 ? facs[0] : `BP #${bp.blueprintID}`;
	}

	function getTotalInputs(bp: Blueprint, typeId: number, quantity: number) {
		const outputQty = bp.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
		const runs = Math.ceil(quantity / outputQty);
		return bp.inputs.map((input) => ({
			typeName: input.typeName,
			total: input.quantity * runs,
		}));
	}

	function formatOptionLabel(bp: Blueprint, typeId: number): string {
		const outputQty = bp.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
		const totalInputQty = bp.inputs.reduce((s, i) => s + i.quantity, 0);
		const rawEff = totalInputQty / outputQty;
		const eff = rawEff < 1 ? rawEff.toPrecision(2) : rawEff.toFixed(1);
		const facs = blueprintFacilities.get(bp.blueprintID) ?? [];
		const facLabel = facs.length > 0 ? facs[0] : `BP #${bp.blueprintID}`;
		const inputs = bp.inputs.map((i) => i.typeName).join(", ");
		return `${facLabel} · ${inputs} · eff ${eff}`;
	}

	function SortHeader({
		col,
		label,
		align = "left",
	}: {
		col: "name" | "category" | "group";
		label: string;
		align?: "left" | "right";
	}) {
		const icon =
			sortCol === col ? (
				sortDesc ? (
					<ChevronDown size={12} />
				) : (
					<ChevronUp size={12} />
				)
			) : (
				<ChevronsUpDown size={12} className="text-zinc-700" />
			);
		return (
			<th className={`px-4 py-2 text-${align}`}>
				<button
					type="button"
					onClick={() => toggleSort(col)}
					className="flex items-center gap-1 hover:text-zinc-200"
				>
					{label}
					{icon}
				</button>
			</th>
		);
	}

	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<SortHeader col="name" label="Item" />
					<SortHeader col="group" label="Group" />
					<th className="px-4 py-2 text-left">Recipe</th>
					<th className="px-4 py-2 text-right">Need</th>
					<th className="px-4 py-2 text-right">Have</th>
					<th className="px-4 py-2 text-right">Still Need</th>
					<th className="px-4 py-2 text-right">Volume (m³)</th>
				</tr>
			</thead>
			<tbody>
				{sortedItems.map((item) => {
					const producers = outputToBlueprints.get(item.typeId) ?? [];
					const hasMultiple = producers.length > 1;
					const pin = pinMap.get(item.typeId);
					const pinnedBpId = pin?.kind === "exclusive" ? pin.blueprintId : undefined;
					const currentBpId = pinnedBpId ?? item.blueprintId;
					const isOverridden = pinnedBpId !== undefined;
					const currentBp = producers.find((p) => p.blueprintID === currentBpId) ?? producers[0];
					const hasSplits = item.splits && item.splits.length > 1;

					return (
						<Fragment key={item.typeId}>
							<tr className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
								<td className="px-4 py-1 text-zinc-200">
									<span className="flex items-center gap-2">
										<ItemIcon typeId={item.typeId} size={32} />
										{item.typeName}
									</span>
								</td>
								<td className="px-4 py-2 text-xs text-zinc-500">
									{typeGroups.get(item.typeId) || "--"}
								</td>
								<td className="px-4 py-2">
									<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
										{hasSplits ? (
											<button
												type="button"
												onClick={() => openSplitEditor(item.typeId)}
												className="inline-flex w-fit items-center gap-1 rounded border border-violet-500/50 bg-zinc-900 px-1.5 py-0.5 text-xs text-violet-300 hover:border-violet-400"
											>
												Split
												<ChevronDown size={10} className="shrink-0 text-zinc-600" />
											</button>
										) : hasMultiple && currentBp ? (
											<RecipeDropdown
												typeId={item.typeId}
												producers={producers}
												currentBpId={currentBpId}
												isOverridden={isOverridden}
												outputToBlueprints={outputToBlueprints}
												rawMaterialIds={rawMaterialIds}
												salvageMaterialIds={salvageMaterialIds}
												blueprintFacilities={blueprintFacilities}
												onSelect={(bpId) => handleRecipeChange(item.typeId, bpId)}
												formatOptionLabel={formatOptionLabel}
												getFacilityLabel={getFacilityLabel}
												onSplitRequest={
													onRecipePinChange && hasMultiple
														? () => openSplitEditor(item.typeId)
														: undefined
												}
											/>
										) : currentBp ? (
											<span className="text-xs text-zinc-500">{getFacilityLabel(currentBp)}</span>
										) : null}
										{currentBp && !hasSplits && (
											<span className="text-xs text-zinc-500">
												{getTotalInputs(currentBp, item.typeId, item.stillNeed)
													.map((i) => `${i.total.toLocaleString()} ${i.typeName}`)
													.join(", ")}
											</span>
										)}
										{hasSplits && splitEditTypeId !== item.typeId && (
											<span className="text-xs text-zinc-500">
												{item.splits?.map((split, idx) => {
													const facs = blueprintFacilities.get(split.blueprintId) ?? [];
													const facLabel = facs.length > 0 ? facs[0] : `BP #${split.blueprintId}`;
													const isRefinery = facs.some((f) => f.includes("Refinery"));
													const splitBp = producers.find((p) => p.blueprintID === split.blueprintId);
													const label = isRefinery && splitBp
														? splitBp.inputs.map((i) => i.typeName).join(", ")
														: facLabel;
													return (
														<span key={split.blueprintId}>
															{idx > 0 && ", "}
															{Math.round(split.quantity).toLocaleString()} {label}
														</span>
													);
												})}
											</span>
										)}
									</div>
								</td>
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
											title="Volume data missing"
										>
											<AlertTriangle size={12} />
											<span className="text-xs">??</span>
										</span>
									) : (
										<span className="font-mono text-zinc-400">
											{item.volume.toLocaleString(undefined, { maximumFractionDigits: 1 })}
										</span>
									)}
								</td>
							</tr>
							{splitEditTypeId === item.typeId && (
								<tr className="border-t border-zinc-800/30">
									<td colSpan={7} className="px-4 py-3">
										<div className="ml-8 space-y-2 rounded border border-violet-500/30 bg-violet-500/5 p-3">
											<div className="text-sm font-medium text-zinc-200">
												Split production across facilities
											</div>
											{producers.map((bp) => {
												const facs = blueprintFacilities.get(bp.blueprintID) ?? [];
												const facLabel = facs.length > 0 ? facs[0] : `BP #${bp.blueprintID}`;
												const outQty = bp.outputs.find((o) => o.typeID === item.typeId)?.quantity ?? 1;
												const draftQty = splitDraft.get(bp.blueprintID) ?? 0;
												const inputTotals = getTotalInputs(bp, item.typeId, draftQty);

												function snapToBatch(val: number, batchSize: number): number {
													return Math.ceil(val / batchSize) * batchSize;
												}

												function setQtyAndRedistribute(newVal: number) {
													const snapped = snapToBatch(Math.max(0, Math.min(newVal, item.quantity)), outQty);
													const next = new Map(splitDraft);
													next.set(bp.blueprintID, snapped);

													// Only take from others when total exceeds demand
													let totalAfter = 0;
													for (const v of next.values()) totalAfter += v;
													const overflow = totalAfter - item.quantity;

													if (overflow > 0) {
														const otherBps = producers.filter((p) => p.blueprintID !== bp.blueprintID);
														let remaining = overflow;
														let othersSum = 0;
														for (const p of otherBps) othersSum += next.get(p.blueprintID) ?? 0;
														if (othersSum > 0) {
															for (const p of otherBps) {
																if (remaining <= 0) break;
																const cur = next.get(p.blueprintID) ?? 0;
																const otherBatch = p.outputs.find((o) => o.typeID === item.typeId)?.quantity ?? 1;
																const raw = cur - (cur / othersSum) * overflow;
																const reduced = snapToBatch(Math.max(0, raw), otherBatch);
																const took = cur - reduced;
																next.set(p.blueprintID, reduced);
																remaining -= took;
															}
														}
													}

													// Clean up zeros
													for (const [id, q] of next) {
														if (q <= 0) next.delete(id);
													}
													setSplitDraft(next);
												}

												const pct = item.quantity > 0
													? Math.round((draftQty / item.quantity) * 100)
													: 0;
												return (
													<div key={bp.blueprintID} className="grid grid-cols-[5rem_12rem_1fr] gap-x-2 gap-y-0">
														<input
															type="number"
															value={draftQty || ""}
															onChange={(e) => {
																const val = Math.max(0, Number.parseInt(e.target.value) || 0);
																const next = new Map(splitDraft);
																if (val > 0) next.set(bp.blueprintID, val);
																else next.delete(bp.blueprintID);
																setSplitDraft(next);
															}}
															onBlur={() => setQtyAndRedistribute(draftQty)}
															placeholder="0"
															min={0}
															className="row-span-2 w-20 self-center rounded border border-zinc-700 bg-zinc-800 px-2 py-2.5 text-center text-sm font-mono text-zinc-100 focus:border-violet-600 focus:outline-none"
														/>
														<div className="flex items-center gap-1.5">
															<span className="text-sm text-zinc-200">{facLabel}</span>
															<button
																type="button"
																onClick={() => {
																	if (!onRecipePinChange) return;
																	const otherPins = recipePins.filter((p) => p.typeId !== item.typeId);
																	onRecipePinChange([...otherPins, { typeId: item.typeId, kind: "exclusive", blueprintId: bp.blueprintID }]);
																	setSplitEditTypeId(null);
																}}
																className="text-xs text-violet-400/60 hover:text-violet-300"
																title="Use only this recipe"
															>
																only
															</button>
														</div>
														<div className="flex items-center gap-2">
															<span className="shrink-0 w-16 text-right text-xs font-mono text-zinc-500">
																{pct}% · {draftQty > 0 ? Math.ceil(draftQty / outQty) : 0}r
															</span>
															<input
																type="range"
																value={draftQty}
																onChange={(e) => setQtyAndRedistribute(Number.parseInt(e.target.value) || 0)}
																min={0}
																max={item.quantity}
															step={outQty}
																className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-violet-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400"
															/>
														</div>
														<div className="col-start-2 col-span-2 whitespace-nowrap text-xs text-zinc-500">
															{inputTotals
																.map((i) => `${i.total.toLocaleString()} ${i.typeName}`)
																.join(", ")}
														</div>
													</div>
												);
											})}
											{(() => {
												let totalPinned = 0;
												for (const qty of splitDraft.values()) totalPinned += qty;
												const demand = item.quantity;
												const diff = totalPinned - demand;
												return (
													<div className="flex items-center gap-3 border-t border-zinc-800 pt-2 text-xs">
														<span className="text-zinc-400">
															Allocated: {totalPinned.toLocaleString()} / {demand.toLocaleString()}
														</span>
														{diff < 0 && (
															<span className="text-amber-400">
																Shortfall of {Math.abs(diff).toLocaleString()} -- optimizer will allocate the rest
															</span>
														)}
														{diff > 0 && (
															<span className="text-amber-400">
																Exceeds demand by {diff.toLocaleString()} -- surplus will be produced
															</span>
														)}
													</div>
												);
											})()}
											<div className="flex items-center gap-2 border-t border-zinc-800 pt-2">
												<button
													type="button"
													onClick={() => saveSplitPin(item.typeId)}
													className="rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500"
												>
													Apply
												</button>
												<button
													type="button"
													onClick={() => setSplitEditTypeId(null)}
													className="rounded px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-300"
												>
													Cancel
												</button>
												<button
													type="button"
													onClick={() => clearSplitPin(item.typeId)}
													className="ml-auto text-xs text-zinc-600 hover:text-zinc-400"
												>
													Clear override
												</button>
											</div>
										</div>
									</td>
								</tr>
							)}
						</Fragment>
					);
				})}
			</tbody>
			<tfoot>
				<tr className="border-t border-zinc-700">
					<td className="px-4 py-2 text-xs font-medium text-zinc-400" colSpan={6}>
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

// ── Main view ───────────────────────────────────────────────────────────────

export function IndustryCalculator() {
	const {
		blueprints,
		outputToBlueprints,
		defaultRecipes,
		rawMaterialIds,
		salvageMaterialIds,
		volumeMap,
		blueprintFacilities,
		typeGroups,
		typeCategories,
		isLoading,
	} = useBlueprintData();

	// Facility filter state
	const [selectedFacilities, setSelectedFacilities] = useState<Set<string>>(new Set());

	const facilityGroups = useMemo(() => {
		const names = new Set<string>();
		for (const facs of blueprintFacilities.values()) {
			for (const name of facs) names.add(name);
		}
		const groups: Array<{ label: string; facilities: Array<{ name: string; short: string }> }> = [];
		const classify: Array<[string, string[], string[]]> = [
			[
				"Refineries",
				["Field Refinery", "Refinery", "Heavy Refinery"],
				["Field", "Standard", "Heavy"],
			],
			[
				"Printers",
				["Mini Printer", "Field Printer", "Printer", "Heavy Printer"],
				["Mini", "Field", "Standard", "Heavy"],
			],
			["Berths", ["Mini Berth", "Berth", "Heavy Berth"], ["Mini", "Standard", "Heavy"]],
		];
		const classified = new Set<string>();
		for (const [label, order, shorts] of classify) {
			const matched: Array<{ name: string; short: string }> = [];
			for (let i = 0; i < order.length; i++) {
				if (names.has(order[i])) matched.push({ name: order[i], short: shorts[i] });
			}
			if (matched.length > 0) {
				groups.push({ label, facilities: matched });
				for (const m of matched) classified.add(m.name);
			}
		}
		const other = [...names].filter((n) => !classified.has(n)).sort();
		if (other.length > 0) {
			groups.push({ label: "Other", facilities: other.map((n) => ({ name: n, short: n })) });
		}
		return groups;
	}, [blueprintFacilities]);

	function toggleFacility(name: string) {
		setSelectedFacilities((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});
	}

	// Filter blueprints by selected facilities
	const filteredBlueprints = useMemo(() => {
		if (selectedFacilities.size === 0) return blueprints;
		const allowedBpIds = new Set<number>();
		for (const [bpId, facs] of blueprintFacilities) {
			if (facs.some((f) => selectedFacilities.has(f))) allowedBpIds.add(bpId);
		}
		const result: Record<string, Blueprint> = {};
		for (const [id, bp] of Object.entries(blueprints)) {
			if (allowedBpIds.has(bp.blueprintID)) result[id] = bp;
		}
		return result;
	}, [blueprints, blueprintFacilities, selectedFacilities]);

	const filteredOutputToBlueprints = useMemo(() => {
		if (selectedFacilities.size === 0) return outputToBlueprints;
		const allowedBpIds = new Set<number>();
		for (const [bpId, facs] of blueprintFacilities) {
			if (facs.some((f) => selectedFacilities.has(f))) allowedBpIds.add(bpId);
		}
		const map = new Map<number, Blueprint[]>();
		for (const [typeId, bps] of outputToBlueprints) {
			const filtered = bps.filter((bp) => allowedBpIds.has(bp.blueprintID));
			if (filtered.length > 0) map.set(typeId, filtered);
		}
		return map;
	}, [outputToBlueprints, blueprintFacilities, selectedFacilities]);

	// Full name map from all blueprints (not affected by facility filter)
	const fullNameMap = useMemo(() => {
		const names = new Map<number, string>();
		for (const bp of Object.values(blueprints)) {
			for (const i of bp.inputs) names.set(i.typeID, i.typeName);
			for (const o of bp.outputs) names.set(o.typeID, o.typeName);
		}
		return names;
	}, [blueprints]);

	const filteredDefaultRecipes = useMemo(() => {
		if (selectedFacilities.size === 0) return defaultRecipes;
		const filteredRaw = findRawMaterials(filteredBlueprints);
		return computeDefaultRecipes(filteredOutputToBlueprints, filteredRaw, salvageMaterialIds);
	}, [
		selectedFacilities,
		defaultRecipes,
		filteredBlueprints,
		filteredOutputToBlueprints,
		salvageMaterialIds,
	]);

	// Order list state (persisted to localStorage)
	const [orderItems, setOrderItems] = useState<BomOrderItem[]>(() =>
		loadFromStorage<BomOrderItem[]>(LS_ORDER_KEY, []),
	);
	const [recipeOverrides, setRecipeOverrides] = useState<RecipeOverride[]>(() =>
		loadFromStorage<RecipeOverride[]>(LS_OVERRIDES_KEY, []),
	);

	// Stock state (managed by BomStockPanel)
	const [stockMap, setStockMap] = useState<Map<number, number>>(new Map());

	// Recipe pins for LP optimizer
	const [recipePins, setRecipePins] = useState<RecipePin[]>(() =>
		loadFromStorage<RecipePin[]>(LS_PINS_KEY, []),
	);

	// Persist order items, overrides, and recipe pins
	useEffect(() => {
		saveToStorage(LS_ORDER_KEY, orderItems);
	}, [orderItems]);
	useEffect(() => {
		saveToStorage(LS_OVERRIDES_KEY, recipeOverrides);
	}, [recipeOverrides]);
	useEffect(() => {
		saveToStorage(LS_PINS_KEY, recipePins);
	}, [recipePins]);

	// Purge stale overrides whose blueprint no longer produces the target type
	useEffect(() => {
		if (Object.keys(blueprints).length === 0) return;
		const valid = recipeOverrides.filter((o) => {
			const bp = blueprints[String(o.blueprintId)];
			return bp && bp.outputs.some((out) => out.typeID === o.typeId);
		});
		if (valid.length !== recipeOverrides.length) {
			setRecipeOverrides(valid);
		}
	}, [blueprints]); // only re-check when blueprint data loads/changes

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

	// Resolve BOM via LP optimizer
	const result = useMemo<BomResult>(() => {
		const emptyResult: BomResult = {
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
		if (orderItems.length === 0) return emptyResult;

		const bpData = {
			blueprints: filteredBlueprints,
			outputToBlueprints: filteredOutputToBlueprints,
			defaultRecipes: filteredDefaultRecipes,
		};

		console.time("LP solve");
		const t0 = performance.now();

		// Convert final-item recipe overrides to exclusive pins for the LP
		const overridePins: RecipePin[] = recipeOverrides
			.filter((o) => {
				const producers = filteredOutputToBlueprints.get(o.typeId);
				return producers?.some((bp) => bp.blueprintID === o.blueprintId);
			})
			.map((o) => ({ typeId: o.typeId, kind: "exclusive" as const, blueprintId: o.blueprintId }));

		// Filter pins to only include blueprints present in filtered set
		const validPins = recipePins
			.filter((pin) => {
				const producers = filteredOutputToBlueprints.get(pin.typeId);
				if (!producers || producers.length === 0) return false;
				if (pin.kind === "exclusive") {
					return producers.some((bp) => bp.blueprintID === pin.blueprintId);
				}
				if (pin.kind === "split") {
					// Keep only splits whose blueprints are still available
					return pin.splits.some((s) =>
						producers.some((bp) => bp.blueprintID === s.blueprintId),
					);
				}
				return true;
			})
			.map((pin) => {
				if (pin.kind !== "split") return pin;
				// Strip out entries referencing filtered-out blueprints
				const producers = filteredOutputToBlueprints.get(pin.typeId) ?? [];
				const producerIds = new Set(producers.map((bp) => bp.blueprintID));
				const validSplits = pin.splits.filter((s) => producerIds.has(s.blueprintId));
				if (validSplits.length === 1) {
					return { typeId: pin.typeId, kind: "exclusive" as const, blueprintId: validSplits[0].blueprintId };
				}
				return { ...pin, splits: validSplits };
			});

		// Merge: explicit pins take precedence over recipe overrides
		const pinTypeIds = new Set(validPins.map((p) => p.typeId));
		const allPins = [...validPins, ...overridePins.filter((p) => !pinTypeIds.has(p.typeId))];

		const lpSolution = solveLp(orderItems, bpData, allPins, stockMap, salvageMaterialIds);
		const ceiled = ceilLpSolution(lpSolution);
		const solveTimeMs = performance.now() - t0;
		console.timeEnd("LP solve");

		if (!ceiled.feasible) {
			console.warn("LP infeasible, falling back to heuristic BOM resolution");
			// Convert all pins to recipe overrides so the fallback honors user choices
			const pinOverrides: RecipeOverride[] = allPins.flatMap((pin) => {
				if (pin.kind === "exclusive") {
					return [{ typeId: pin.typeId, blueprintId: pin.blueprintId }];
				}
				if (pin.kind === "split" && pin.splits.length > 0) {
					// Pick the largest split as the override
					const best = pin.splits.reduce((a, b) => (b.quantity > a.quantity ? b : a));
					return [{ typeId: pin.typeId, blueprintId: best.blueprintId }];
				}
				return [];
			});
			// Merge: pin overrides take precedence over recipe dropdown overrides
			const pinTypeIds2 = new Set(pinOverrides.map((o) => o.typeId));
			const mergedOverrides = [
				...pinOverrides,
				...recipeOverrides.filter((o) => !pinTypeIds2.has(o.typeId)),
			];
			const fallback = resolveBom(
				orderItems,
				bpData,
				mergedOverrides,
				volumeMap,
				stockMap,
				fullNameMap,
			);
			return {
				...fallback,
				totals: { ...fallback.totals, objectiveValue: -1, solveTimeMs },
			};
		}

		return buildBomFromLp(
			ceiled,
			bpData,
			orderItems,
			volumeMap,
			stockMap,
			fullNameMap,
			solveTimeMs,
		);
	}, [
		orderItems,
		filteredBlueprints,
		filteredOutputToBlueprints,
		filteredDefaultRecipes,
		recipePins,
		recipeOverrides,
		volumeMap,
		stockMap,
		fullNameMap,
		salvageMaterialIds,
	]);

	// Heuristic comparison result (for delta display)
	const manualResult = useMemo<BomResult | null>(() => {
		if (orderItems.length === 0) return null;
		return resolveBom(
			orderItems,
			{
				blueprints: filteredBlueprints,
				outputToBlueprints: filteredOutputToBlueprints,
				defaultRecipes: filteredDefaultRecipes,
			},
			recipeOverrides,
			volumeMap,
			stockMap,
			fullNameMap,
		);
	}, [
		orderItems,
		filteredBlueprints,
		filteredOutputToBlueprints,
		filteredDefaultRecipes,
		recipeOverrides,
		volumeMap,
		stockMap,
		fullNameMap,
	]);

	// Detect items that are raw in the filtered BOM but producible in the full blueprint set
	const missingFacilities = useMemo(() => {
		if (selectedFacilities.size === 0) return [];
		const missing: Array<{
			typeId: number;
			typeName: string;
			quantity: number;
			facilities: string[];
		}> = [];
		for (const raw of result.rawMaterials) {
			// Skip items fully covered by stock
			if (raw.stillNeed === 0) continue;
			// Check if this "raw" item has producers in the unfiltered set
			const producers = outputToBlueprints.get(raw.typeId);
			if (!producers || producers.length === 0) continue;
			// It's producible but filtered out -- find which facilities can make it
			const neededFacs = new Set<string>();
			for (const bp of producers) {
				const facs = blueprintFacilities.get(bp.blueprintID);
				if (facs) for (const f of facs) neededFacs.add(f);
			}
			// Only show if none of the needed facilities are currently selected
			const hasSelected = [...neededFacs].some((f) => selectedFacilities.has(f));
			if (!hasSelected) {
				missing.push({
					typeId: raw.typeId,
					typeName: raw.typeName,
					quantity: raw.quantity,
					facilities: [...neededFacs].sort(),
				});
			}
		}
		return missing;
	}, [result.rawMaterials, outputToBlueprints, blueprintFacilities, selectedFacilities]);

	// Collect unique facility names needed to resolve all missing items
	const suggestedFacilities = useMemo(() => {
		const facs = new Set<string>();
		for (const m of missingFacilities) {
			for (const f of m.facilities) facs.add(f);
		}
		return [...facs].sort();
	}, [missingFacilities]);

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

	const hasResults =
		orderItems.length > 0 &&
		(result.rawMaterials.length > 0 || result.intermediates.length > 0 || result.finals.length > 0);

	return (
		<div className="flex h-full flex-col">
			{/* Page header */}
			<div className="border-b border-zinc-800 px-5 py-3">
				<div className="flex items-center gap-2">
					<Factory size={18} className="text-violet-500" />
					<h1 className="text-base font-semibold text-zinc-100">Industry Calculator</h1>
					<span className="rounded bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-400 ring-1 ring-amber-500/30">
						Added after hackathon submission deadline, not part of contest entry
					</span>
				</div>
				<div className="mt-2 flex items-center gap-3">
					{facilityGroups.map((group) => (
						<div key={group.label} className="flex items-center gap-1">
							<span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
								{group.label}
							</span>
							{group.facilities.map((fac) => (
								<button
									key={fac.name}
									type="button"
									onClick={() => toggleFacility(fac.name)}
									className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] transition-colors ${
										selectedFacilities.has(fac.name)
											? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40"
											: "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
									}`}
								>
									{fac.short}
								</button>
							))}
						</div>
					))}
					{selectedFacilities.size > 0 && (
						<button
							type="button"
							onClick={() => setSelectedFacilities(new Set())}
							className="text-[11px] text-zinc-600 hover:text-zinc-400"
						>
							Clear
						</button>
					)}

				</div>
			</div>

			<div className="flex flex-1 overflow-hidden">
				{/* Results Panel */}
				<div className="flex-1 overflow-y-auto p-6">
					{/* Production List -- integrated with finals */}
					<div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/30">
						<div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
							<h2 className="flex items-center gap-2 text-sm font-medium text-zinc-300">
								Production List
								{orderItems.length > 0 && (
									<span className="text-xs text-zinc-500">({orderItems.length})</span>
								)}
							</h2>
							<div className="flex items-center gap-3">
								{orderItems.length > 0 && (
									<>
										<CopyButton getText={() => orderItemsToCsv(orderItems)} />
										<button
											type="button"
											onClick={handleClearAll}
											className="flex items-center gap-1 text-xs text-zinc-500 hover:text-red-400"
										>
											<Trash2 size={11} />
											Clear
										</button>
									</>
								)}
							</div>
						</div>

						{/* Search + paste */}
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
										{pasteText.trim()
											? `${parseItemList(pasteText, producibleNameLookup).length} items matched`
											: ""}
									</span>
									<div className="flex gap-1.5">
										<button
											type="button"
											onClick={() => {
												setPasteText("");
												setShowPaste(false);
											}}
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

						{/* Order items table with finals data */}
						{orderItems.length === 0 ? (
							<div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
								<Factory size={32} className="text-zinc-800" />
								<p className="text-sm text-zinc-500">
									Search above to add items to your production list.
								</p>
							</div>
						) : (
							<ProductionTable
								orderItems={orderItems}
								finals={result.finals}
								outputToBlueprints={filteredOutputToBlueprints}
								rawMaterialIds={rawMaterialIds}
								salvageMaterialIds={salvageMaterialIds}
								blueprintFacilities={blueprintFacilities}
								overrides={recipeOverrides}
								onOverrideChange={setRecipeOverrides}
								onQuantityChange={handleQuantityChange}
								onRemove={handleRemoveItem}
							/>
						)}
					</div>

					{!hasResults && orderItems.length === 0 && (
						<div className="flex h-64 items-center justify-center">
							<div className="text-center">
								<Factory size={48} className="mx-auto mb-3 text-zinc-800" />
								<p className="text-sm text-zinc-500">
									Add items to your production list to calculate materials.
								</p>
							</div>
						</div>
					)}

					{orderItems.length > 0 && (
						<div className="space-y-4">
							{/* Missing Facilities Warning */}
							{missingFacilities.length > 0 && (
								<div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
									<div className="flex items-center gap-2 text-sm font-medium text-amber-400">
										<AlertTriangle size={14} />
										Missing Facilities
									</div>
									<p className="mt-1 text-xs text-zinc-400">
										{missingFacilities.length} item{missingFacilities.length > 1 ? "s" : ""} cannot
										be produced with the selected facilities and will need to be sourced externally.
									</p>
									<div className="mt-3 space-y-1.5">
										{missingFacilities.map((m) => (
											<div key={m.typeId} className="flex items-center justify-between text-xs">
												<span className="text-zinc-300">{m.typeName}</span>
												<span className="text-zinc-500">{m.facilities.join(", ")}</span>
											</div>
										))}
									</div>
									{suggestedFacilities.length > 0 && (
										<div className="mt-3 flex flex-wrap items-center gap-1.5">
											<span className="text-[11px] text-zinc-500">Add:</span>
											{suggestedFacilities.map((fac) => (
												<button
													key={fac}
													type="button"
													onClick={() => toggleFacility(fac)}
													className="rounded bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300 ring-1 ring-amber-500/30 transition-colors hover:bg-amber-500/20"
												>
													{fac}
												</button>
											))}
										</div>
									)}
								</div>
							)}

							{/* Stock Integration */}
							<BomStockPanel onStockChange={setStockMap} typeList={blueprintTypes} />

							{/* Summary */}
							<CollapsibleSection
								title="Summary"
								headerRight={<CopyButton getText={() => summaryToCsv(result.totals)} />}
							>
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
										<div className="text-xs text-zinc-500">Optimizer</div>
										<div className="mt-1 font-mono text-zinc-200">
											<span className="flex items-center gap-1">
												<Zap size={12} className="text-violet-400" />
												{result.totals.solveTimeMs !== undefined
													? `${result.totals.solveTimeMs.toFixed(1)}ms`
													: "--"}
											</span>
										</div>
									</div>
								</div>
								{/* LP infeasible warning */}
								{result.totals.objectiveValue === -1 && (
									<div className="mx-4 mb-4 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
										<AlertTriangle size={12} className="mr-1 inline" />
										The optimizer could not find a feasible solution with the current constraints.
										This may happen when facility filters exclude necessary blueprints or recipe
										overrides conflict. Falling back to heuristic mode.
									</div>
								)}
								{/* Optimization delta vs manual */}
								{manualResult &&
									result.totals.objectiveValue !== -1 && (
										<div className="mx-4 mb-4">
											{(() => {
												const optRaw = result.rawMaterials.reduce((s, i) => s + i.stillNeed, 0);
												const manRaw = manualResult.rawMaterials.reduce(
													(s, i) => s + i.stillNeed,
													0,
												);
												const delta = manRaw - optRaw;
												const pct = manRaw > 0 ? ((delta / manRaw) * 100).toFixed(1) : "0";
												if (delta > 0) {
													return (
														<span className="text-xs text-green-400">
															Optimizer saves {delta.toLocaleString()} raw units ({pct}%) vs default recipes
														</span>
													);
												}
												if (delta < 0) {
													return (
														<span className="text-xs text-amber-400">
															Optimizer uses {Math.abs(delta).toLocaleString()} more raw units (
															{Math.abs(Number.parseFloat(pct)).toFixed(1)}%) vs default recipes
														</span>
													);
												}
												return (
													<span className="text-xs text-zinc-500">
														Optimizer matches default recipes
													</span>
												);
											})()}
										</div>
									)}
							</CollapsibleSection>

							{/* Raw Materials */}
							<CollapsibleSection
								title="Raw Materials"
								count={result.rawMaterials.length}
								collapsedSummary={summarizeItems(result.rawMaterials)}
								headerRight={
									result.rawMaterials.length > 0 ? (
										<CopyButton getText={() => materialsToCsv(result.rawMaterials)} />
									) : undefined
								}
							>
								<MaterialTable
									items={result.rawMaterials}
									typeGroups={typeGroups}
									salvageMaterialIds={salvageMaterialIds}
								/>
							</CollapsibleSection>

							{/* Intermediates */}
							<CollapsibleSection
								title="Intermediates"
								count={result.intermediates.length}
								collapsedSummary={summarizeItems(result.intermediates)}
								headerRight={
									<div className="flex items-center gap-3">
										{recipePins.length > 0 && (
											<button
												type="button"
												onClick={() => setRecipePins([])}
												className="text-xs text-zinc-500 hover:text-zinc-300"
											>
												Clear Overrides
											</button>
										)}
										{result.intermediates.length > 0 && (
											<CopyButton getText={() => materialsToCsv(result.intermediates)} />
										)}
									</div>
								}
							>
								<IntermediateTable
									items={result.intermediates}
									outputToBlueprints={filteredOutputToBlueprints}
									rawMaterialIds={rawMaterialIds}
									salvageMaterialIds={salvageMaterialIds}
									blueprintFacilities={blueprintFacilities}
									overrides={recipeOverrides}
									onOverrideChange={setRecipeOverrides}
									recipePins={recipePins}
									onRecipePinChange={setRecipePins}
									typeGroups={typeGroups}
									typeCategories={typeCategories}
								/>
							</CollapsibleSection>

							{/* Surplus */}
							{result.surplus.length > 0 && (
								<CollapsibleSection
									title="Surplus Co-Products"
									count={result.surplus.length}
									defaultOpen={false}
									collapsedSummary={summarizeSurplus(result.surplus)}
									headerRight={<CopyButton getText={() => surplusToCsv(result.surplus)} />}
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

function summarizeItems(items: BomLineItem[]): string {
	if (items.length === 0) return "";
	const totalQty = items.reduce((s, i) => s + i.quantity, 0);
	const totalVol = items.reduce((s, i) => (i.volumeMissing ? s : s + i.volume), 0);
	return `${totalQty.toLocaleString()} units · ${totalVol.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³`;
}

function summarizeSurplus(items: BomSurplus[]): string {
	if (items.length === 0) return "";
	const totalQty = items.reduce((s, i) => s + i.quantity, 0);
	const totalVol = items.reduce((s, i) => (i.volume < 0 ? s : s + i.volume), 0);
	return `${totalQty.toLocaleString()} units · ${totalVol.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³`;
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
