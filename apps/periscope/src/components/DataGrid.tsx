import {
	type Column,
	type ColumnDef,
	type ColumnFiltersState,
	type RowData,
	type SortingState,
	flexRender,
	getCoreRowModel,
	getFacetedRowModel,
	getFacetedUniqueValues,
	getFilteredRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import {
	ChevronDown,
	ChevronRight,
	ChevronUp,
	ChevronsUpDown,
	Download,
	Search,
	X,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ColumnFilter, type ExcelFilterValue, excelFilterFn } from "./ColumnFilter";

// Opt-in per-column filter UI. `multiselect` renders a dropdown checklist of the column's faceted
// values (used for the Facilities column) instead of the default text "contains" box.
declare module "@tanstack/react-table" {
	// biome-ignore lint/correctness/noUnusedVariables: augmentation must match the base signature
	interface ColumnMeta<TData extends RowData, TValue> {
		filterVariant?: "multiselect";
	}
}

// ── Re-exports for consumers ────────────────────────────────────────────────

export { excelFilterFn } from "./ColumnFilter";
export type { ColumnDef } from "@tanstack/react-table";

// ── Filter-state persistence ─────────────────────────────────────────────────

interface PersistedFilters {
	global: string;
	cols: ColumnFiltersState;
}

function loadPersistedFilters(persistKey: string | undefined): PersistedFilters | null {
	if (!persistKey) return null;
	try {
		const raw = localStorage.getItem(`dg-filters:${persistKey}`);
		if (!raw) return null;
		// Revive Set values -- ColumnFilter multiselect stores includedValues as a Set.
		return JSON.parse(raw, (_k, v) =>
			v && typeof v === "object" && Array.isArray((v as { __set?: unknown }).__set)
				? new Set((v as { __set: string[] }).__set)
				: v,
		) as PersistedFilters;
	} catch {
		return null;
	}
}

function savePersistedFilters(persistKey: string, value: PersistedFilters): void {
	try {
		localStorage.setItem(
			`dg-filters:${persistKey}`,
			JSON.stringify(value, (_k, v) => (v instanceof Set ? { __set: Array.from(v) } : v)),
		);
	} catch {
		// quota or serialization failure -- ignore
	}
}

// ── Per-column inline search ─────────────────────────────────────────────────

/**
 * Always-visible dropdown checklist of a column's faceted values, applied as an "include" filter.
 * Used for `meta.filterVariant === "multiselect"` columns (e.g. Facilities). No selection = no
 * filter (all rows); selecting a subset narrows to rows whose value is in the set.
 */
function ColumnMultiSelectCell<T>({ column }: { column: Column<T, unknown> }) {
	const [open, setOpen] = useState(false);
	const btnRef = useRef<HTMLButtonElement>(null);
	const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

	const facets = column.getFacetedUniqueValues();
	const allValues = useMemo(
		() =>
			Array.from(facets.keys())
				.map((v) => String(v))
				.sort(),
		[facets],
	);
	const filter = column.getFilterValue() as ExcelFilterValue | undefined;
	const selected =
		filter?.mode === "include" && filter.includedValues instanceof Set ? filter.includedValues : null;
	const isActive = selected != null;
	const columnName =
		typeof column.columnDef.header === "string" ? column.columnDef.header : column.id;

	function apply(next: Set<string>) {
		if (next.size === 0 || next.size === allValues.length) {
			column.setFilterValue(undefined);
		} else {
			column.setFilterValue({ mode: "include", includedValues: next } satisfies ExcelFilterValue);
		}
	}
	function toggle(v: string) {
		const base = new Set(selected ?? allValues);
		if (base.has(v)) base.delete(v);
		else base.add(v);
		apply(base);
	}
	function openMenu() {
		const r = btnRef.current?.getBoundingClientRect();
		if (r) setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) });
		setOpen(true);
	}

	return (
		<th className="px-1.5 pb-1.5">
			<button
				ref={btnRef}
				type="button"
				onClick={openMenu}
				aria-label={`Filter ${columnName}`}
				className={`flex w-full items-center justify-between gap-1 rounded border px-2 py-1 text-xs font-normal ${
					isActive
						? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
						: "border-zinc-700/60 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
				}`}
			>
				<span className="truncate">{isActive ? `${selected.size} selected` : "All"}</span>
				<ChevronDown size={12} className="shrink-0" />
			</button>
			{open &&
				createPortal(
					<>
						<button
							type="button"
							aria-label="Close menu"
							className="fixed inset-0 z-40 cursor-default"
							onClick={() => setOpen(false)}
						/>
						<div
							className="fixed z-50 max-h-64 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
							style={{ top: pos.top, left: pos.left, width: pos.width }}
						>
							<div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1">
								<button
									type="button"
									onClick={() => column.setFilterValue(undefined)}
									className="text-xs text-zinc-400 hover:text-cyan-400"
								>
									Select all
								</button>
								{isActive && (
									<button
										type="button"
										onClick={() => column.setFilterValue(undefined)}
										className="text-xs text-zinc-500 hover:text-red-400"
									>
										Clear
									</button>
								)}
							</div>
							{allValues.map((v) => {
								const checked = selected ? selected.has(v) : true;
								return (
									<label
										key={v}
										className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-800"
									>
										<input
											type="checkbox"
											checked={checked}
											onChange={() => toggle(v)}
											className="accent-cyan-500"
										/>
										<span className="truncate text-zinc-300">{v || "(blank)"}</span>
									</label>
								);
							})}
						</div>
					</>,
					document.body,
				)}
		</th>
	);
}

/** A single always-visible "contains" search input beneath a column header. */
function ColumnSearchCell<T>({ column }: { column: Column<T, unknown> }) {
	// Only render a text input for columns that actually use excelFilterFn. Writing an
	// ExcelFilterValue object into a column with the default/auto filterFn would stringify to
	// "[object Object]" and filter out every row.
	if (!column.getCanFilter() || column.columnDef.filterFn !== excelFilterFn) {
		return <th className="px-1.5 pb-1.5" />;
	}
	// Opt-in dropdown checklist (e.g. Facilities) instead of the text box.
	if (column.columnDef.meta?.filterVariant === "multiselect") {
		return <ColumnMultiSelectCell column={column} />;
	}
	// Derive a readable name for accessible labels (the header is usually a string).
	const columnName =
		typeof column.columnDef.header === "string" ? column.columnDef.header : column.id;
	const filter = column.getFilterValue() as ExcelFilterValue | undefined;

	// A funnel (multiselect) include filter owns the column -- surface its state with a disabled
	// input instead of a blank box so typing here can't silently clobber the active filter.
	if (filter?.mode === "include") {
		const count = filter.includedValues instanceof Set ? filter.includedValues.size : 0;
		return (
			<th className="px-1.5 pb-1.5">
				<input
					type="text"
					disabled
					value=""
					placeholder={count > 0 ? `${count} selected` : "filtered"}
					aria-label={`Filter ${columnName}`}
					className={`w-full cursor-not-allowed rounded border px-2 py-1 text-xs font-normal italic placeholder:text-zinc-500 focus:outline-none ${
						count > 0
							? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300 placeholder:text-cyan-300/70"
							: "border-zinc-700/60 bg-zinc-800/30 text-zinc-500"
					}`}
				/>
			</th>
		);
	}

	const value = filter?.mode === "textFilter" ? (filter.textFilterValue ?? "") : "";
	return (
		<th className="px-1.5 pb-1.5">
			<div className="relative">
				<input
					type="text"
					value={value}
					onChange={(e) => {
						const v = e.target.value;
						column.setFilterValue(
							v
								? ({
										mode: "textFilter",
										textFilterType: "contains",
										textFilterValue: v,
									} satisfies ExcelFilterValue)
								: undefined,
						);
					}}
					placeholder="filter"
					aria-label={`Filter ${columnName}`}
					className={`w-full rounded border px-2 py-1 pr-6 text-xs font-normal placeholder:text-zinc-600 focus:outline-none ${
						value
							? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
							: "border-zinc-700/60 bg-zinc-800/60 text-zinc-300 focus:border-cyan-500"
					}`}
				/>
				{value && (
					<button
						type="button"
						onClick={() => column.setFilterValue(undefined)}
						aria-label="Clear filter"
						className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
						title="Clear"
					>
						<X size={12} />
					</button>
				)}
			</div>
		</th>
	);
}

// ── Component ───────────────────────────────────────────────────────────────

interface DataGridProps<T> {
	columns: ColumnDef<T, unknown>[];
	data: T[];
	keyFn: (row: T) => string;
	searchPlaceholder?: string;
	emptyMessage?: string;
	actions?: ReactNode;
	/** Content rendered after the search box in the toolbar. */
	afterSearch?: ReactNode;
	/** Content pinned to the far right of the toolbar (after search / clear / export). */
	toolbarRight?: ReactNode;
	/** Enable global search. Default true. */
	enableSearch?: boolean;
	/** Currently selected row ID (optional). */
	selectedRowId?: string;
	/** Callback when a row is clicked (optional). */
	onRowClick?: (rowId: string) => void;
	/** When set, scroll the row with this ID into view. */
	scrollToRowId?: string;
	/** When provided, renders a download button that exports filtered rows. */
	onExport?: (rows: T[]) => void;
	/** Initial sorting state (e.g. [{id: "timestamp", desc: true}]). */
	initialSorting?: SortingState;
	/** Render an always-visible per-column "contains" search row beneath the header. */
	columnSearch?: boolean;
	/** When set, persist global + column filter state to localStorage under this key. */
	persistKey?: string;
	/**
	 * When set, rows are partitioned into collapsible groups keyed by this accessor. Grouping is a
	 * display layer over the sorted/filtered rows -- each group's rows keep the active sort order.
	 */
	groupBy?: (row: T) => string;
	/** Renders a group header row's content (spans all columns); receives the group's original rows. */
	renderGroupHeader?: (groupKey: string, rows: T[]) => ReactNode;
	/** Orders group keys (default: order of first appearance in the sorted rows). */
	groupSort?: (a: string, b: string) => number;
	/**
	 * Rows for which this returns true are the group's anchor: they still establish their group (so a
	 * childless anchor keeps a header) but are rendered ONLY via `renderGroupHeader`, never as a body
	 * row. Used to promote a parent node into its group header instead of duplicating it as a row.
	 */
	isGroupAnchorRow?: (row: T) => boolean;
	/**
	 * When true, a group's anchor row is rendered as a normal columned row (with the collapse toggle
	 * injected into its first cell) instead of the full-width `renderGroupHeader` banner, so the anchor
	 * lines up with the same columns as its children. Groups without an anchor row (e.g. an
	 * "Unassigned" bucket) still fall back to `renderGroupHeader`.
	 */
	renderGroupHeaderAsAnchorRow?: boolean;
}

export function DataGrid<T>({
	columns,
	afterSearch,
	toolbarRight,
	data,
	keyFn,
	searchPlaceholder = "Search...",
	emptyMessage = "No data",
	actions,
	enableSearch = true,
	selectedRowId,
	onRowClick,
	scrollToRowId,
	onExport,
	initialSorting,
	columnSearch = false,
	persistKey,
	groupBy,
	renderGroupHeader,
	groupSort,
	isGroupAnchorRow,
	renderGroupHeaderAsAnchorRow,
}: DataGridProps<T>) {
	const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
	const toggleGroup = (key: string) =>
		setCollapsedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	// Load persisted filter state once (lazy) so we don't re-read localStorage on every render.
	const [persisted] = useState(() => loadPersistedFilters(persistKey));
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
		() => persisted?.cols ?? [],
	);
	const [globalFilter, setGlobalFilter] = useState(() => persisted?.global ?? "");

	// Keep the latest filter state in a ref so the unmount flush below can read current values
	// without re-subscribing the effect on every change.
	const latestFiltersRef = useRef<PersistedFilters>({ global: globalFilter, cols: columnFilters });
	latestFiltersRef.current = { global: globalFilter, cols: columnFilters };

	// Persist filter state so it survives navigating away from the table and back. Skip the
	// initial run (state was just hydrated) and debounce writes so we don't hit localStorage on
	// every keystroke.
	const hasMountedRef = useRef(false);
	useEffect(() => {
		if (!persistKey) return;
		if (!hasMountedRef.current) {
			hasMountedRef.current = true;
			return;
		}
		const handle = setTimeout(() => {
			savePersistedFilters(persistKey, { global: globalFilter, cols: columnFilters });
		}, 200);
		return () => clearTimeout(handle);
	}, [persistKey, globalFilter, columnFilters]);

	// Flush the latest state on unmount so a pending debounced write isn't lost.
	useEffect(() => {
		if (!persistKey) return;
		return () => {
			savePersistedFilters(persistKey, latestFiltersRef.current);
		};
	}, [persistKey]);

	// Scroll a specific row into view when scrollToRowId changes (e.g. the recents dropdown).
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!scrollToRowId) return;
		const el = containerRef.current?.querySelector(`[data-row-id="${scrollToRowId}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [scrollToRowId]);

	const table = useReactTable({
		data,
		columns,
		state: { sorting, columnFilters, globalFilter },
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onGlobalFilterChange: setGlobalFilter,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getFacetedRowModel: getFacetedRowModel(),
		getFacetedUniqueValues: getFacetedUniqueValues(),
		getRowId: (row) => keyFn(row),
	});

	const hasFilters = columnFilters.length > 0;

	const rows = table.getRowModel().rows;
	const leafColumnCount = table.getVisibleLeafColumns().length;

	const renderDataRow = (row: (typeof rows)[number]) => {
		const isSelected = selectedRowId != null && row.id === selectedRowId;
		return (
			<tr
				key={row.id}
				data-row-id={row.id}
				onClick={onRowClick ? () => onRowClick(row.id) : undefined}
				className={`border-b border-zinc-800/30 transition-colors hover:bg-zinc-800/30 ${
					onRowClick ? "cursor-pointer" : ""
				} ${isSelected ? "bg-cyan-900/20 border-l-2 border-l-cyan-500" : ""}`}
			>
				{row.getVisibleCells().map((cell) => {
					const hasSize = cell.column.columnDef.size != null;
					return (
						<td
							key={cell.id}
							className={`px-1.5 py-1.5 text-zinc-300 ${hasSize ? "whitespace-nowrap" : "max-w-0 overflow-hidden"}`}
						>
							{flexRender(cell.column.columnDef.cell, cell.getContext())}
						</td>
					);
				})}
			</tr>
		);
	};

	// A group's anchor rendered as a normal columned row, with the collapse toggle prepended into its
	// first cell -- so the header lines up with the same columns as the body rows beneath it.
	const renderAnchorHeaderRow = (row: (typeof rows)[number], key: string, collapsed: boolean) => {
		const isSelected = selectedRowId != null && row.id === selectedRowId;
		return (
			<tr
				key={`${key}-anchor`}
				data-row-id={row.id}
				onClick={onRowClick ? () => onRowClick(row.id) : undefined}
				className={`border-b border-zinc-800 bg-zinc-900/70 transition-colors hover:bg-zinc-800/40 ${
					onRowClick ? "cursor-pointer" : ""
				} ${isSelected ? "border-l-2 border-l-cyan-500" : ""}`}
			>
				{row.getVisibleCells().map((cell, i) => {
					const hasSize = cell.column.columnDef.size != null;
					const content = flexRender(cell.column.columnDef.cell, cell.getContext());
					return (
						<td
							key={cell.id}
							className={`px-1.5 py-2 font-medium text-zinc-200 ${hasSize ? "whitespace-nowrap" : "max-w-0 overflow-hidden"}`}
						>
							{i === 0 ? (
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											toggleGroup(key);
										}}
										className="shrink-0 text-zinc-500 hover:text-zinc-200"
										aria-label={collapsed ? "Expand group" : "Collapse group"}
									>
										{collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
									</button>
									<div className="min-w-0 flex-1">{content}</div>
								</div>
							) : (
								content
							)}
						</td>
					);
				})}
			</tr>
		);
	};

	// Partition the sorted/filtered rows into contiguous groups (display layer only).
	const groupedRows = groupBy
		? (() => {
				const map = new Map<string, typeof rows>();
				const order: string[] = [];
				for (const row of rows) {
					const key = groupBy(row.original);
					const arr = map.get(key);
					if (arr) arr.push(row);
					else {
						map.set(key, [row]);
						order.push(key);
					}
				}
				if (groupSort) order.sort(groupSort);
				return order.map((key) => ({ key, rows: map.get(key) ?? [] }));
			})()
		: null;

	return (
		<div className="flex h-full flex-col gap-3 pt-3">
			{/* Toolbar */}
			<div className="flex items-center gap-3">
				{actions}
				{enableSearch && (
					<div className="relative max-w-sm flex-1">
						<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
						<input
							type="text"
							value={globalFilter}
							onChange={(e) => setGlobalFilter(e.target.value)}
							placeholder={searchPlaceholder}
							className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
						/>
						{globalFilter && (
							<button
								type="button"
								onClick={() => setGlobalFilter("")}
								aria-label="Clear search"
								className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
							>
								<X size={14} />
							</button>
						)}
					</div>
				)}
				{afterSearch}
				{hasFilters && (
					<button
						type="button"
						onClick={() => setColumnFilters([])}
						className="flex shrink-0 items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-500/20"
					>
						<X size={12} />
						Clear {columnFilters.length} filter{columnFilters.length > 1 ? "s" : ""}
					</button>
				)}
				{onExport && (
					<button
						type="button"
						onClick={() => onExport(table.getFilteredRowModel().rows.map((r) => r.original))}
						className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
						title="Export CSV"
					>
						<Download size={14} />
					</button>
				)}
				{toolbarRight && <div className="ml-auto flex items-center gap-3">{toolbarRight}</div>}
			</div>

			{/* Table */}
			<div
				ref={containerRef}
				className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-800"
			>
				<table className="w-full text-sm">
					<thead className="sticky top-0 z-10">
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id} className="border-b border-zinc-800 bg-zinc-900/80">
								{headerGroup.headers.map((header) => {
									const hasSize = header.column.columnDef.size != null;
									const isFiltered = header.column.getIsFiltered();
									return (
									<th
										key={header.id}
										className={`px-1.5 py-1.5 text-left font-medium ${hasSize ? "whitespace-nowrap" : "w-full"} ${
											isFiltered ? "bg-cyan-500/10 text-cyan-300" : "text-zinc-400"
										}`}
									>
										{header.isPlaceholder ? null : (
											<div className="flex items-center gap-1">
												<button
													type="button"
													onClick={header.column.getToggleSortingHandler()}
													className="flex items-center gap-1 hover:text-zinc-200"
												>
													{flexRender(header.column.columnDef.header, header.getContext())}
													{{
														asc: <ChevronUp size={12} />,
														desc: <ChevronDown size={12} />,
													}[header.column.getIsSorted() as string] ??
														(header.column.getCanSort() ? (
															<ChevronsUpDown size={12} className="text-zinc-700" />
														) : null)}
												</button>
												{header.column.getCanFilter() && <ColumnFilter column={header.column} />}
											</div>
										)}
									</th>
									);
								})}
							</tr>
						))}
						{columnSearch && (
							<tr className="border-b border-zinc-800 bg-zinc-900/60">
								{table.getLeafHeaders().map((header) => (
									<ColumnSearchCell key={header.id} column={header.column} />
								))}
							</tr>
						)}
					</thead>
					<tbody>
						{rows.length === 0 ? (
							<tr>
								<td
									colSpan={columns.length}
									className="px-3 py-12 text-center text-sm text-zinc-600"
								>
									{emptyMessage}
								</td>
							</tr>
						) : groupedRows ? (
							groupedRows.map(({ key, rows: groupRows }) => {
								const collapsed = collapsedGroups.has(key);
								const anchorRow = isGroupAnchorRow
									? groupRows.find((r) => isGroupAnchorRow(r.original))
									: undefined;
								const bodyRows = isGroupAnchorRow
									? groupRows.filter((r) => !isGroupAnchorRow(r.original))
									: groupRows;
								return (
									<Fragment key={key}>
										{renderGroupHeaderAsAnchorRow && anchorRow ? (
											renderAnchorHeaderRow(anchorRow, key, collapsed)
										) : (
											<tr className="border-b border-zinc-800 bg-zinc-900/70">
												<td colSpan={leafColumnCount} className="px-2 py-2">
													<div className="flex items-center gap-2">
														<button
															type="button"
															onClick={() => toggleGroup(key)}
															className="shrink-0 text-zinc-500 hover:text-zinc-200"
															aria-label={collapsed ? "Expand group" : "Collapse group"}
														>
															{collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
														</button>
														<div className="min-w-0 flex-1">
															{renderGroupHeader?.(key, groupRows.map((r) => r.original))}
														</div>
													</div>
												</td>
											</tr>
										)}
										{!collapsed && bodyRows.map(renderDataRow)}
									</Fragment>
								);
							})
						) : (
							rows.map(renderDataRow)
						)}
					</tbody>
				</table>
			</div>

			{/* Footer */}
			<div className="text-xs text-zinc-600">
				{table.getFilteredRowModel().rows.length} of {data.length} rows
			</div>
		</div>
	);
}
