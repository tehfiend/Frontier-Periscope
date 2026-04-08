import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Column, FilterFn } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ArrowUp,
	ArrowDown,
	ListFilter,
	ChevronDown,
	ChevronRight,
	X,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExcelFilterValue {
	mode: "include" | "textFilter";
	includedValues?: Set<string>;
	textFilterType?: "equals" | "notEquals" | "beginsWith" | "endsWith" | "contains" | "notContains";
	textFilterValue?: string;
}

// ── Shared filter function ──────────────────────────────────────────────────

// biome-ignore lint: FilterFn needs to be typed as `any` for cross-table compatibility
export const excelFilterFn: FilterFn<any> = (row, columnId, filterValue) => {
	const filter = filterValue as ExcelFilterValue | undefined;
	if (!filter) return true;

	const rawVal = String(row.getValue(columnId) ?? "");

	if (filter.mode === "include" && filter.includedValues) {
		return filter.includedValues.has(rawVal);
	}

	if (filter.mode === "textFilter" && filter.textFilterValue) {
		const cellVal = rawVal.toLowerCase();
		const filterVal = filter.textFilterValue.toLowerCase();
		switch (filter.textFilterType) {
			case "equals": return cellVal === filterVal;
			case "notEquals": return cellVal !== filterVal;
			case "beginsWith": return cellVal.startsWith(filterVal);
			case "endsWith": return cellVal.endsWith(filterVal);
			case "notContains": return !cellVal.includes(filterVal);
			case "contains":
			default: return cellVal.includes(filterVal);
		}
	}

	return true;
};

// ── Component ───────────────────────────────────────────────────────────────

interface ColumnFilterProps<TData> {
	column: Column<TData, unknown>;
	valueLabels?: Record<string, string>;
}

const TEXT_FILTER_TYPES = [
	{ value: "contains", label: "Contains" },
	{ value: "notContains", label: "Does Not Contain" },
	{ value: "equals", label: "Equals" },
	{ value: "notEquals", label: "Does Not Equal" },
	{ value: "beginsWith", label: "Begins With" },
	{ value: "endsWith", label: "Ends With" },
] as const;

export function ColumnFilter<TData>({ column, valueLabels }: ColumnFilterProps<TData>) {
	const [open, setOpen] = useState(false);
	const currentFilter = column.getFilterValue() as ExcelFilterValue | undefined;
	const isFiltered = !!currentFilter;

	// Pending state — only applies on OK
	const [pendingIncluded, setPendingIncluded] = useState<Set<string> | null>(null);
	const [textFilterType, setTextFilterType] = useState<ExcelFilterValue["textFilterType"]>("contains");
	const [textFilterValue, setTextFilterValue] = useState("");
	const [textFilterOpen, setTextFilterOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");

	// Get unique values from faceted model
	const facetedValues = column.getFacetedUniqueValues();
	const allValues = useMemo(() => {
		const vals = Array.from(facetedValues.keys()).map(String).sort();
		return vals;
	}, [facetedValues]);

	const filteredValues = useMemo(() => {
		if (!searchQuery) return allValues;
		const q = searchQuery.toLowerCase();
		return allValues.filter((v) => {
			const label = valueLabels?.[v] ?? v;
			return label.toLowerCase().includes(q);
		});
	}, [allValues, searchQuery, valueLabels]);

	// Virtualization
	const parentRef = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count: filteredValues.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 28,
		overscan: 5,
	});

	const included = pendingIncluded ?? (currentFilter?.mode === "include" ? currentFilter.includedValues : null) ?? new Set<string>(allValues);
	const allSelected = filteredValues.every((v) => included.has(v));
	const noneSelected = filteredValues.every((v) => !included.has(v));

	function handleOpen() {
		// Initialize pending state from current filter
		const f = column.getFilterValue() as ExcelFilterValue | undefined;
		if (f?.mode === "include" && f.includedValues) {
			setPendingIncluded(new Set(f.includedValues));
		} else {
			setPendingIncluded(null);
		}
		if (f?.mode === "textFilter") {
			setTextFilterType(f.textFilterType ?? "contains");
			setTextFilterValue(f.textFilterValue ?? "");
		} else {
			setTextFilterType("contains");
			setTextFilterValue("");
		}
		setSearchQuery("");
		setTextFilterOpen(false);
		setOpen(true);
	}

	function handleToggle(value: string) {
		const next = new Set(included);
		if (next.has(value)) next.delete(value);
		else next.add(value);
		setPendingIncluded(next);
	}

	function handleSelectAll() {
		if (allSelected) {
			// Deselect all filtered values
			const next = new Set(included);
			for (const v of filteredValues) next.delete(v);
			setPendingIncluded(next);
		} else {
			// Select all filtered values
			const next = new Set(included);
			for (const v of filteredValues) next.add(v);
			setPendingIncluded(next);
		}
	}

	function handleOk() {
		if (textFilterValue) {
			column.setFilterValue({
				mode: "textFilter",
				textFilterType,
				textFilterValue,
			} satisfies ExcelFilterValue);
		} else if (pendingIncluded && pendingIncluded.size > 0 && pendingIncluded.size < allValues.length) {
			column.setFilterValue({
				mode: "include",
				includedValues: pendingIncluded,
			} satisfies ExcelFilterValue);
		} else {
			// None selected or all selected = no filter (show everything)
			column.setFilterValue(undefined);
		}
		setOpen(false);
	}

	function handleCancel() {
		setOpen(false);
	}

	function handleClear() {
		column.setFilterValue(undefined);
		setOpen(false);
	}

	const buttonRef = useRef<HTMLButtonElement>(null);
	const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

	useEffect(() => {
		if (open && buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect();
			setPopoverPos({
				top: rect.bottom + 4,
				left: Math.min(rect.left, window.innerWidth - 270),
			});
		}
	}, [open]);

	return (
		<div>
			<button
				ref={buttonRef}
				type="button"
				onClick={handleOpen}
				className={`rounded p-0.5 transition-colors ${
					isFiltered
						? "text-cyan-400 hover:text-cyan-300"
						: "text-zinc-600 hover:text-zinc-400"
				}`}
				title="Filter column"
			>
				<ListFilter size={12} />
			</button>

			{open && createPortal(
				<>
					{/* Backdrop */}
					<div className="fixed inset-0 z-40" onClick={handleCancel} />

					{/* Popover */}
					<div
						className="fixed z-50 w-64 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
						style={{ top: popoverPos.top, left: popoverPos.left }}
					>
						{/* Sort buttons */}
						<div className="flex gap-1 border-b border-zinc-800 p-2">
							<button
								type="button"
								onClick={() => { column.toggleSorting(false); setOpen(false); }}
								className="flex flex-1 items-center gap-1.5 rounded px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
							>
								<ArrowUp size={12} /> Sort A → Z
							</button>
							<button
								type="button"
								onClick={() => { column.toggleSorting(true); setOpen(false); }}
								className="flex flex-1 items-center gap-1.5 rounded px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
							>
								<ArrowDown size={12} /> Sort Z → A
							</button>
						</div>

						{/* Text filter section */}
						<div className="border-b border-zinc-800">
							<button
								type="button"
								onClick={() => setTextFilterOpen(!textFilterOpen)}
								className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200"
							>
								{textFilterOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
								Text Filters
							</button>
							{textFilterOpen && (
								<div className="space-y-2 px-3 pb-3">
									<select
										value={textFilterType}
										onChange={(e) => setTextFilterType(e.target.value as ExcelFilterValue["textFilterType"])}
										className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-cyan-600 focus:outline-none"
									>
										{TEXT_FILTER_TYPES.map((t) => (
											<option key={t.value} value={t.value}>{t.label}</option>
										))}
									</select>
									<input
										type="text"
										value={textFilterValue}
										onChange={(e) => setTextFilterValue(e.target.value)}
										placeholder="Filter value..."
										className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
									/>
								</div>
							)}
						</div>

						{/* Search box */}
						<div className="p-2">
							<input
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Search values..."
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
							/>
						</div>

						{/* Select All */}
						<div className="border-b border-zinc-800/50 px-2 pb-1">
							<label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-zinc-800">
								<input
									type="checkbox"
									checked={allSelected}
									ref={(el) => { if (el) el.indeterminate = !allSelected && !noneSelected; }}
									onChange={handleSelectAll}
									className="accent-cyan-500"
								/>
								<span className="text-zinc-300">(Select All)</span>
								<span className="ml-auto text-zinc-600">{filteredValues.length}</span>
							</label>
						</div>

						{/* Virtualized checkbox list */}
						<div ref={parentRef} className="max-h-48 overflow-y-auto px-2">
							<div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
								{virtualizer.getVirtualItems().map((virtualItem) => {
									const value = filteredValues[virtualItem.index];
									const label = valueLabels?.[value] ?? (value || "(blank)");
									const checked = included.has(value);
									return (
										<div
											key={value}
											style={{
												position: "absolute",
												top: 0,
												left: 0,
												width: "100%",
												height: `${virtualItem.size}px`,
												transform: `translateY(${virtualItem.start}px)`,
											}}
										>
											<label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-zinc-800">
												<input
													type="checkbox"
													checked={checked}
													onChange={() => handleToggle(value)}
													className="accent-cyan-500"
												/>
												<span className="truncate text-zinc-300">{label}</span>
											</label>
										</div>
									);
								})}
							</div>
						</div>

						{/* Footer: OK / Cancel / Clear */}
						<div className="flex items-center justify-between border-t border-zinc-800 p-2">
							{isFiltered ? (
								<button
									type="button"
									onClick={handleClear}
									className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:text-red-400"
								>
									<X size={10} /> Clear
								</button>
							) : (
								<div />
							)}
							<div className="flex gap-1">
								<button
									type="button"
									onClick={handleOk}
									className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-500"
								>
									OK
								</button>
								<button
									type="button"
									onClick={handleCancel}
									className="rounded px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
								>
									Cancel
								</button>
							</div>
						</div>
					</div>
				</>,
				document.body,
			)}
		</div>
	);
}
