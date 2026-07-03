// Queue-local scratch pad -- plan 39 Phase 6 (decision 18).
//
// A per-queue speculative stock list: editable item rows + EVE inventory/fitting paste import. Its
// contents fold into THIS queue's baseStock as the { kind: "scratch" } container (queueResolver.
// scratchInventory) and can be ranked/excluded like any real container in the Container sourcing panel,
// but the pad is NEVER surfaced in Assets and NEVER selectable by other queues. It persists inside the
// queue record (queue.scratch), so what-ifs survive reloads but stay scoped to this one queue.

import { ItemIcon } from "@/components/ItemIcon";
import type { BuildQueue } from "@/lib/buildQueueTypes";
import { type InventoryTypeInfo, parseInventoryPaste } from "@/lib/inventoryParser";
import {
	addScratchItem,
	clearScratch,
	mergeScratchItems,
	removeScratchItem,
	setScratchItemQty,
} from "@/stores/buildQueueStore";
import {
	ChevronDown,
	ChevronRight,
	ClipboardPaste,
	FlaskConical,
	Search,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface ScratchPadPanelProps {
	queue: BuildQueue;
	/** All game types (id + name) for the add-item search. */
	typeList: Array<{ id: number; name: string }>;
	/** typeID -> unit volume (m3) -- lets the paste parser disambiguate shared names. */
	volumeMap: Map<number, number>;
	/**
	 * Render as a nested subsection of the unified Stock panel: drop the standalone card chrome and use
	 * a lighter subsection heading, so the scratch pad reads as part of Stock rather than its own card.
	 */
	embedded?: boolean;
}

// ── Any-type search (scratch holds speculative stock of ANY type, not just blueprint outputs) ──

function ScratchItemSearch({
	onSelect,
	typeList,
}: {
	onSelect: (typeId: number) => void;
	typeList: Array<{ id: number; name: string }>;
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
		const q = query.trim().toLowerCase();
		const matched = typeList.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 20);
		setResults(matched);
		setHighlightIndex(0);
		setIsOpen(matched.length > 0);
	}, [query, typeList]);

	useEffect(() => {
		function onMouseDown(e: MouseEvent) {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setIsOpen(false);
		}
		document.addEventListener("mousedown", onMouseDown);
		return () => document.removeEventListener("mousedown", onMouseDown);
	}, []);

	function select(item: { id: number; name: string }) {
		onSelect(item.id);
		setQuery("");
		setIsOpen(false);
		inputRef.current?.focus();
	}

	function onKeyDown(e: React.KeyboardEvent) {
		if (!isOpen) return;
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				setHighlightIndex((p) => Math.min(p + 1, results.length - 1));
				break;
			case "ArrowUp":
				e.preventDefault();
				setHighlightIndex((p) => Math.max(p - 1, 0));
				break;
			case "Enter":
				e.preventDefault();
				if (results[highlightIndex]) select(results[highlightIndex]);
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
					onKeyDown={onKeyDown}
					placeholder="Add what-if stock item..."
					className="w-full rounded border border-zinc-700 bg-zinc-800 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>
			{isOpen && (
				<div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
					{results.map((item, idx) => (
						<button
							key={item.id}
							type="button"
							onClick={() => select(item)}
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

// ── Panel ──────────────────────────────────────────────────────────────────────

export function ScratchPadPanel({ queue, typeList, volumeMap, embedded }: ScratchPadPanelProps) {
	const [open, setOpen] = useState(false);
	const [showPaste, setShowPaste] = useState(false);
	const [pasteText, setPasteText] = useState("");

	const items = queue.scratch ?? [];

	const nameMap = useMemo(() => {
		const m = new Map<number, string>();
		for (const t of typeList) m.set(t.id, t.name);
		return m;
	}, [typeList]);

	// Candidate types (with volume) for the inventory paste parser's name -> typeId resolution.
	const inventoryTypes = useMemo<InventoryTypeInfo[]>(
		() => typeList.map((t) => ({ id: t.id, name: t.name, volume: volumeMap.get(t.id) ?? 0 })),
		[typeList, volumeMap],
	);

	const parsed = useMemo(
		() => (pasteText.trim() ? parseInventoryPaste(pasteText, inventoryTypes) : null),
		[pasteText, inventoryTypes],
	);

	const handleImport = () => {
		if (!parsed || parsed.items.length === 0) return;
		mergeScratchItems(queue.id, parsed.items);
		setPasteText("");
		setShowPaste(false);
	};

	return (
		<div className={embedded ? "" : "rounded-lg border border-zinc-800 bg-zinc-900/50"}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className={
					embedded
						? "flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-zinc-400 hover:text-zinc-200"
						: "flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-300 hover:bg-zinc-800/30"
				}
			>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				<FlaskConical size={14} className="text-violet-400" />
				Scratch pad
				{items.length > 0 && <span className="text-xs text-zinc-500">({items.length})</span>}
				{!open && (
					<span className="ml-2 text-xs font-normal text-zinc-500">queue-local what-if stock</span>
				)}
			</button>

			{open && (
				<div className="space-y-3 px-4 pb-4">
					<p className="text-[11px] text-zinc-500">
						Speculative stock for this queue only. It folds into the solve and can be ranked or
						excluded under Container sourcing, but is never shown in Assets or shared with other
						queues.
					</p>

					<div className="flex items-center justify-between">
						<h4 className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">Items</h4>
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={() => setShowPaste(!showPaste)}
								className={`rounded p-1 ${showPaste ? "bg-violet-600/20 text-violet-400" : "text-zinc-600 hover:text-zinc-300"}`}
								title="Import from clipboard"
							>
								<ClipboardPaste size={12} />
							</button>
							{items.length > 0 && (
								<button
									type="button"
									onClick={() => clearScratch(queue.id)}
									className="rounded p-1 text-zinc-600 hover:text-red-400"
									title="Clear scratch pad"
								>
									<Trash2 size={12} />
								</button>
							)}
						</div>
					</div>

					{showPaste && (
						<div className="space-y-1.5">
							<textarea
								value={pasteText}
								onChange={(e) => setPasteText(e.target.value)}
								placeholder={"Paste from EVE client...\nInventory or fitting format"}
								rows={5}
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-violet-600 focus:outline-none"
							/>
							<div className="flex items-center justify-between">
								<span className="text-xs text-zinc-600">
									{parsed
										? `${parsed.items.length} matched${
												parsed.unresolved.length > 0
													? `, ${parsed.unresolved.length} unmatched`
													: ""
											}`
										: ""}
								</span>
								<div className="flex gap-1.5">
									<button
										type="button"
										onClick={() => {
											setPasteText("");
											setShowPaste(false);
										}}
										className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:text-zinc-300"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={handleImport}
										disabled={!parsed || parsed.items.length === 0}
										className="rounded bg-violet-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40"
									>
										Import
									</button>
								</div>
							</div>
						</div>
					)}

					<ScratchItemSearch
						onSelect={(typeId) => addScratchItem(queue.id, typeId)}
						typeList={typeList}
					/>

					{items.length > 0 && (
						<div className="space-y-1">
							{items.map((entry) => (
								<div
									key={entry.typeId}
									className="flex items-center gap-2 rounded px-2 py-1 text-xs"
								>
									<ItemIcon typeId={entry.typeId} />
									<span className="min-w-0 flex-1 truncate text-zinc-300">
										{nameMap.get(entry.typeId) ?? `Type ${entry.typeId}`}
									</span>
									<input
										type="number"
										value={entry.qty}
										onChange={(e) =>
											setScratchItemQty(
												queue.id,
												entry.typeId,
												Number.parseInt(e.target.value, 10) || 0,
											)
										}
										min={0}
										className="w-20 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-center text-xs text-zinc-100 focus:border-violet-600 focus:outline-none"
									/>
									<button
										type="button"
										onClick={() => removeScratchItem(queue.id, entry.typeId)}
										className="text-zinc-600 hover:text-red-400"
										title="Remove"
									>
										<Trash2 size={12} />
									</button>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
