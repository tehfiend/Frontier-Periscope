import { useState, useMemo, type ReactNode } from "react";
import {
	useReactTable,
	getCoreRowModel,
	getSortedRowModel,
	getFilteredRowModel,
	getFacetedRowModel,
	getFacetedUniqueValues,
	flexRender,
	type ColumnDef,
	type SortingState,
	type ColumnFiltersState,
} from "@tanstack/react-table";
import { Search, X, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { ColumnFilter, excelFilterFn } from "./ColumnFilter";

// ── Re-exports for consumers ────────────────────────────────────────────────

export { excelFilterFn } from "./ColumnFilter";
export type { ColumnDef } from "@tanstack/react-table";

// ── Component ───────────────────────────────────────────────────────────────

interface DataGridProps<T> {
	columns: ColumnDef<T, unknown>[];
	data: T[];
	keyFn: (row: T) => string;
	searchPlaceholder?: string;
	emptyMessage?: string;
	actions?: ReactNode;
	/** Enable global search. Default true. */
	enableSearch?: boolean;
}

export function DataGrid<T>({
	columns,
	data,
	keyFn,
	searchPlaceholder = "Search...",
	emptyMessage = "No data",
	actions,
	enableSearch = true,
}: DataGridProps<T>) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [globalFilter, setGlobalFilter] = useState("");

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

	return (
		<div className="flex flex-col gap-3">
			{/* Toolbar */}
			<div className="flex items-center gap-3">
				{enableSearch && (
					<div className="relative flex-1">
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
								className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
							>
								<X size={14} />
							</button>
						)}
					</div>
				)}
				{hasFilters && (
					<button
						type="button"
						onClick={() => setColumnFilters([])}
						className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					>
						<X size={12} />
						Clear {columnFilters.length} filter{columnFilters.length > 1 ? "s" : ""}
					</button>
				)}
				{actions}
			</div>

			{/* Table */}
			<div className="overflow-x-auto rounded-lg border border-zinc-800">
				<table className="w-full text-sm">
					<thead>
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id} className="border-b border-zinc-800 bg-zinc-900/80">
								{headerGroup.headers.map((header) => (
									<th
										key={header.id}
										className="px-3 py-2 text-left font-medium text-zinc-400"
										style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
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
													}[header.column.getIsSorted() as string] ?? (
														header.column.getCanSort() ? <ChevronsUpDown size={12} className="text-zinc-700" /> : null
													)}
												</button>
												{header.column.getCanFilter() && (
													<ColumnFilter column={header.column} />
												)}
											</div>
										)}
									</th>
								))}
							</tr>
						))}
					</thead>
					<tbody>
						{table.getRowModel().rows.length === 0 ? (
							<tr>
								<td
									colSpan={columns.length}
									className="px-3 py-12 text-center text-sm text-zinc-600"
								>
									{emptyMessage}
								</td>
							</tr>
						) : (
							table.getRowModel().rows.map((row) => (
								<tr
									key={row.id}
									className="border-b border-zinc-800/30 transition-colors hover:bg-zinc-800/30"
								>
									{row.getVisibleCells().map((cell) => (
										<td key={cell.id} className="px-3 py-2 text-zinc-300">
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</td>
									))}
								</tr>
							))
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
