import { type ExcelFilterValue, excelFilterFn } from "@/components/ColumnFilter";
import { DataGrid } from "@/components/DataGrid";
import { ItemIcon } from "@/components/ItemIcon";
import { db } from "@/db";
import { isRefineryFacility, useBlueprintData } from "@/hooks/useBlueprintData";
import type { Blueprint } from "@/lib/bomTypes";
import {
	addJob,
	addOrder,
	createQueue,
	getActiveQueueId,
	setActiveQueue,
} from "@/stores/buildQueueStore";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef, Table } from "@tanstack/react-table";
import { ArrowRight, Building2, Clock, Eye, Factory, Wrench } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

const UNAVAILABLE_TOOLTIP =
	"Present in client data but not available in the current game build -- removed or not yet released";

interface BlueprintRow {
	bp: Blueprint;
	facilities: string[];
	buildable: boolean;
	removedFacilities: string[];
	group: string;
	category: string;
	totalInputQty: number;
	primaryQty: number;
	/** Whether >= 1 of this blueprint's live facilities is a refinery-class facility. */
	isRefinery: boolean;
}

const LS_RECENT_KEY = "blueprint-library:recent";
const RECENT_CAP = 10;

/** Load the blueprint IDs most recently added to the calculator (most recent first). */
function loadRecentBlueprints(): number[] {
	try {
		const raw = localStorage.getItem(LS_RECENT_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.filter((n): n is number => typeof n === "number").slice(0, RECENT_CAP);
		}
	} catch {
		/* ignore */
	}
	return [];
}

export function Blueprints() {
	const {
		blueprints,
		blueprintList,
		blueprintFacilities,
		buildableBlueprintIds,
		removedFacilitiesByBlueprint,
		defaultRecipes,
		typeGroups,
		typeCategories,
		isLoading,
	} = useBlueprintData();
	const navigate = useNavigate();
	const [showUnavailable, setShowUnavailable] = useState(false);
	const [recent, setRecent] = useState<number[]>(loadRecentBlueprints);
	const [selectedBpId, setSelectedBpId] = useState<number | null>(() => recent[0] ?? null);

	// Highlight + scroll to a blueprint row. Does NOT touch recents -- the recents dropdown only
	// lists blueprints actually added to the calculator (see addToIndustry/recordRecent).
	const selectBlueprint = useCallback((bpId: number) => {
		setSelectedBpId(bpId);
	}, []);

	const recordRecent = useCallback((bpId: number) => {
		setRecent((prev) => {
			const next = [bpId, ...prev.filter((id) => id !== bpId)].slice(0, RECENT_CAP);
			try {
				localStorage.setItem(LS_RECENT_KEY, JSON.stringify(next));
			} catch {
				/* ignore */
			}
			return next;
		});
	}, []);

	// Append the picked blueprint as a job on the active Build Queue's current (last) order. The
	// store increments runs if that blueprint is already queued in the order. Ensures an active queue
	// and at least one order exist first, then navigates to the queue. (Replaces the old
	// bom-order-items localStorage write -- plan 36 Phase 5.) addJob mints the job's stable id.
	const addToIndustry = useCallback(
		async (bpId: number) => {
			let activeId = await getActiveQueueId();
			let queue = activeId ? await db.buildQueues.get(activeId) : undefined;
			if (!queue) {
				queue = await createQueue("My Build Queue");
				activeId = queue.id;
				await setActiveQueue(activeId);
			}
			let orderId = queue.batches[queue.batches.length - 1]?.id;
			if (!orderId) orderId = await addOrder(queue.id);
			await addJob(queue.id, orderId, { blueprintId: bpId, runs: 1 });
			recordRecent(bpId);
			navigate({ to: "/industry" });
		},
		[navigate, recordRecent],
	);

	// Available/total hint derived from the full catalog (not buildableBlueprintIds.size,
	// which could include facility-listed IDs absent from blueprints.json).
	const availableCount = useMemo(
		() => blueprintList.filter((bp) => buildableBlueprintIds.has(bp.blueprintID)).length,
		[blueprintList, buildableBlueprintIds],
	);

	// Default to buildable-only; the "Show unavailable" toggle reveals the rest.
	const visibleBlueprints = useMemo(
		() =>
			showUnavailable
				? blueprintList
				: blueprintList.filter((bp) => buildableBlueprintIds.has(bp.blueprintID)),
		[blueprintList, buildableBlueprintIds, showUnavailable],
	);

	const rows: BlueprintRow[] = useMemo(() => {
		return visibleBlueprints.map((bp) => {
			const primaryOutput = bp.outputs.find((o) => o.typeID === bp.primaryTypeID);
			// De-dup defensively: a blueprint runnable by two facilities with the same name would
			// otherwise render a duplicate badge + React key. (Historically 87119/95302 both read
			// "Mini Printer"; 95302 is now "Emergency Printer", so they render as distinct badges.)
			const facilities = [...new Set(blueprintFacilities.get(bp.blueprintID) ?? [])];
			return {
				bp,
				facilities,
				buildable: buildableBlueprintIds.has(bp.blueprintID),
				removedFacilities: removedFacilitiesByBlueprint.get(bp.blueprintID) ?? [],
				group: typeGroups.get(bp.primaryTypeID) ?? "",
				category: typeCategories.get(bp.primaryTypeID) ?? "",
				totalInputQty: bp.inputs.reduce((sum, i) => sum + i.quantity, 0),
				primaryQty: primaryOutput?.quantity ?? 1,
				isRefinery: facilities.some(isRefineryFacility),
			};
		});
	}, [
		visibleBlueprints,
		blueprintFacilities,
		buildableBlueprintIds,
		removedFacilitiesByBlueprint,
		typeGroups,
		typeCategories,
	]);

	const columns: ColumnDef<BlueprintRow, unknown>[] = useMemo(
		() => [
			{
				id: "name",
				accessorFn: (r) => r.bp.primaryTypeName,
				header: "Blueprint",
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const { bp, buildable } = row.original;
					return (
						<span
							className={`flex items-center gap-2 font-medium ${
								buildable ? "text-zinc-100" : "text-zinc-500"
							}`}
						>
							{buildable && (
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										addToIndustry(bp.blueprintID);
									}}
									className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-600 bg-zinc-800 px-1.5 py-1 text-[11px] font-medium text-zinc-300 shadow-sm transition-colors hover:border-cyan-500/60 hover:bg-cyan-500/15 hover:text-cyan-300"
									title="Add to Industry Calculator"
								>
									<Factory size={12} />
									Add
								</button>
							)}
							<ItemIcon typeId={bp.primaryTypeID} size={32} />
							{bp.primaryTypeName}
						</span>
					);
				},
			},
			{
				id: "category",
				accessorFn: (r) => r.category,
				header: "Category",
				size: 110,
				filterFn: excelFilterFn,
				cell: ({ row, table }) => {
					const value = row.original.category;
					if (!value) return <span className="text-zinc-400">--</span>;
					return (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								table.getColumn("category")?.setFilterValue({
									mode: "textFilter",
									textFilterType: "equals",
									textFilterValue: value,
								} satisfies ExcelFilterValue);
							}}
							className="text-left text-zinc-400 hover:text-cyan-400"
							title={`Filter by ${value}`}
						>
							{value}
						</button>
					);
				},
			},
			{
				id: "group",
				accessorFn: (r) => r.group,
				header: "Group",
				size: 130,
				filterFn: excelFilterFn,
				cell: ({ row, table }) => {
					const value = row.original.group;
					if (!value) return <span className="text-zinc-400">--</span>;
					return (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								table.getColumn("group")?.setFilterValue({
									mode: "textFilter",
									textFilterType: "equals",
									textFilterValue: value,
								} satisfies ExcelFilterValue);
							}}
							className="text-left text-zinc-400 hover:text-cyan-400"
							title={`Filter by ${value}`}
						>
							{value}
						</button>
					);
				},
			},
			{
				id: "inputs",
				accessorFn: (r) => r.bp.inputs.map((i) => i.typeName).join(", "),
				header: "Inputs",
				filterFn: excelFilterFn,
				cell: ({ row, table }) => {
					const { bp, isRefinery, primaryQty } = row.original;
					// A single-input recipe run in a refinery is a reprocessing job; cue its input with
					// the same green palette used for a blueprint's primary output.
					const isRefining = bp.inputs.length === 1 && isRefinery;
					// Manufacturing: the single output is the solo unit; express each input per 1 output.
					const showRatio = !isRefinery && primaryQty > 0;
					const spanClass = `flex items-center gap-1.5 whitespace-nowrap ${
						isRefining ? "font-medium text-green-300" : "text-zinc-300"
					}`;
					const qtyClass = `font-mono ${isRefining ? "text-green-400" : "text-zinc-400"}`;
					return (
						<div className="flex flex-col gap-1">
							{bp.inputs.map((input) => {
								// Clicking an input "sources" it: filter the Outputs column to every recipe that
								// produces it. Truly-raw materials (no producer) get a "raw" tag instead, since
								// filtering for their producers would return nothing.
								const hasProducer = defaultRecipes.has(input.typeID);
								return hasProducer ? (
									<button
										key={input.typeID}
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											showProducers(table, input.typeName);
										}}
										className={`${spanClass} text-left hover:text-cyan-400`}
										title={`Show recipes that produce ${input.typeName}`}
									>
										<ItemIcon typeId={input.typeID} size={20} />
										<span className={qtyClass}>{input.quantity.toLocaleString()}</span>{" "}
										{input.typeName}
										{showRatio && (
											<span
												className="ml-2 font-mono text-xs text-zinc-500"
												title="input per 1 output"
											>
												{`${formatRatio(input.quantity / primaryQty)}:1`}
											</span>
										)}
									</button>
								) : (
									<span key={input.typeID} className={spanClass}>
										<ItemIcon typeId={input.typeID} size={20} />
										<span className={qtyClass}>{input.quantity.toLocaleString()}</span>{" "}
										{input.typeName}
										<span
											className="ml-1.5 rounded bg-zinc-800 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500"
											title="Raw material -- not produced by any recipe (mine, loot, or buy)"
										>
											raw
										</span>
										{showRatio && (
											<span
												className="ml-2 font-mono text-xs text-zinc-500"
												title="input per 1 output"
											>
												{`${formatRatio(input.quantity / primaryQty)}:1`}
											</span>
										)}
									</span>
								);
							})}
						</div>
					);
				},
			},
			{
				id: "arrow",
				header: "",
				size: 24,
				enableColumnFilter: false,
				enableSorting: false,
				cell: () => <ArrowRight size={14} className="mx-auto text-zinc-600" />,
			},
			{
				id: "outputs",
				// Array-valued so an exact per-output "include" filter (set by clicking an input)
				// matches only recipes that actually produce that material -- not "Packaged" / "Batched"
				// name variants that merely contain it. Manual text search still works (matches any output).
				accessorFn: (r) => r.bp.outputs.map((o) => o.typeName),
				sortingFn: (a, b) =>
					a.original.bp.outputs
						.map((o) => o.typeName)
						.join(", ")
						.localeCompare(b.original.bp.outputs.map((o) => o.typeName).join(", ")),
				header: "Outputs",
				filterFn: excelFilterFn,
				cell: ({ row, table }) => {
					const { bp, isRefinery } = row.original;
					// Refinery recipes have a single input (the solo unit); express each output per 1 input.
					const inputBasis = bp.inputs.length === 1 ? bp.inputs[0].quantity : 0;
					return (
						<div className="flex flex-col gap-1">
							{bp.outputs.map((output) => {
								const isPrimary = output.typeID === bp.primaryTypeID;
								const perInput = isRefinery && inputBasis > 0 ? output.quantity / inputBasis : null;
								return (
									<button
										key={output.typeID}
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											showProducers(table, output.typeName);
										}}
										title={`Show recipes that produce ${output.typeName}`}
										className={`flex items-center gap-1.5 whitespace-nowrap text-left hover:text-cyan-400 ${
											isPrimary ? "font-medium text-green-300" : "text-zinc-400"
										}`}
									>
										<ItemIcon typeId={output.typeID} size={20} />
										<span className={`font-mono ${isPrimary ? "text-green-400" : "text-zinc-500"}`}>
											{output.quantity.toLocaleString()}
										</span>{" "}
										{output.typeName}
										{perInput != null && (
											<span
												className={`ml-2 font-mono text-xs ${isPrimary ? "text-green-400/70" : "text-zinc-500"}`}
												title="output per 1 input"
											>
												{`1:${formatRatio(perInput)}`}
											</span>
										)}
									</button>
								);
							})}
						</div>
					);
				},
			},
			{
				id: "time",
				accessorFn: (r) => r.bp.runTime,
				header: "Time",
				size: 100,
				enableColumnFilter: false,
				cell: ({ row }) => {
					const { bp, totalInputQty, primaryQty, isRefinery } = row.original;
					return (
						<div className="text-right">
							<span className="flex items-center justify-end gap-1 whitespace-nowrap text-zinc-300">
								<Clock size={12} />
								{bp.runTimeFormatted}
							</span>
							<div className="mt-0.5 whitespace-nowrap text-xs text-zinc-500">
								{isRefinery
									? totalInputQty > 0
										? `${formatTimePerUnit(bp.runTime, totalInputQty)}/in`
										: "--"
									: primaryQty > 0
										? `${formatTimePerUnit(bp.runTime, primaryQty)}/out`
										: "--"}
							</div>
						</div>
					);
				},
			},
			{
				id: "facilities",
				// Return an array so the funnel multiselect (and excelFilterFn) operates on individual
				// facility names rather than one joined string.
				accessorFn: (r) => (r.buildable ? r.facilities : ["Unavailable"]),
				// getUniqueValues controls faceting: the table-core default wraps the accessor result in
				// a single-element array (one joined entry), so supply the element array directly to make
				// the funnel list each facility individually.
				getUniqueValues: (r) => (r.buildable ? r.facilities : ["Unavailable"]),
				header: "Facilities",
				size: 180,
				enableSorting: false,
				filterFn: excelFilterFn,
				meta: { filterVariant: "multiselect" },
				cell: ({ row }) => {
					const { facilities, buildable, removedFacilities } = row.original;
					if (!buildable) {
						const tooltip =
							removedFacilities.length > 0
								? `${UNAVAILABLE_TOOLTIP}; recipe was: ${removedFacilities.join(", ")}`
								: UNAVAILABLE_TOOLTIP;
						return (
							<span
								className="inline-flex items-center whitespace-nowrap rounded bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-400/80 ring-1 ring-amber-500/20"
								title={tooltip}
							>
								Unavailable
							</span>
						);
					}
					return (
						<div className="flex flex-wrap gap-1.5">
							{facilities.map((name) => (
								<span
									key={name}
									className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
								>
									<Building2 size={10} className="shrink-0 text-zinc-500" />
									{name}
								</span>
							))}
						</div>
					);
				},
			},
		],
		[addToIndustry, defaultRecipes],
	);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-zinc-500">Loading blueprint data...</p>
			</div>
		);
	}

	return (
		<DataGrid
			columns={columns}
			data={rows}
			keyFn={(r) => String(r.bp.blueprintID)}
			columnSearch
			persistKey="blueprint-library"
			searchPlaceholder="Search all columns..."
			emptyMessage="No blueprints found"
			initialSorting={[{ id: "name", desc: false }]}
			selectedRowId={selectedBpId != null ? String(selectedBpId) : undefined}
			onRowClick={(id) => selectBlueprint(Number(id))}
			scrollToRowId={selectedBpId != null ? String(selectedBpId) : undefined}
			actions={
				<h1 className="flex shrink-0 items-center gap-2 text-sm font-semibold text-zinc-100">
					<Wrench size={16} className="text-violet-500" />
					Blueprint Library
				</h1>
			}
			afterSearch={
				recent.length > 0 ? (
					<select
						value={selectedBpId != null ? String(selectedBpId) : ""}
						onChange={(e) => selectBlueprint(Number(e.target.value))}
						title="Recently selected blueprints"
						className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-2 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
					>
						{recent.map((bpId) => (
							<option key={bpId} value={bpId}>
								{blueprints[String(bpId)]?.primaryTypeName ?? `#${bpId}`}
							</option>
						))}
					</select>
				) : undefined
			}
			toolbarRight={
				<>
					<span className="whitespace-nowrap text-xs text-zinc-500">
						{availableCount} available / {blueprintList.length} total
					</span>
					<button
						type="button"
						onClick={() => setShowUnavailable((v) => !v)}
						className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors ${
							showUnavailable
								? "border-amber-500/40 bg-amber-500/10 text-amber-300"
								: "border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						}`}
						title="Show blueprints present in client data but not available in the current game build"
					>
						<Eye size={12} />
						Show unavailable
					</button>
				</>
			}
		/>
	);
}

/**
 * "Source" a material: reset every other filter (column + global search) so the result isn't
 * narrowed by a pre-existing filter, then narrow the table to recipes whose output is exactly
 * `typeName`. Used by clicking an input or an output.
 */
function showProducers(table: Table<BlueprintRow>, typeName: string) {
	table.setGlobalFilter("");
	table.setColumnFilters([
		{
			id: "outputs",
			value: { mode: "include", includedValues: new Set([typeName]) } satisfies ExcelFilterValue,
		},
	]);
}

/** Format a per-unit ratio: whole numbers exact, >=1 to one decimal, otherwise two decimals. */
function formatRatio(value: number): string {
	if (value % 1 === 0) return value.toFixed(0);
	return value >= 1 ? value.toFixed(1) : value.toFixed(2);
}

function formatTimePerUnit(batchSeconds: number, primaryQty: number): string {
	const spu = batchSeconds / primaryQty;
	if (spu < 1) return `${(spu * 1000).toFixed(0)}ms`;
	if (spu < 60) return `${spu.toFixed(1)}s`;
	// Round to whole seconds FIRST, then split, so a value like 59.7s carries into the next minute
	// instead of rendering an out-of-range "1m 60s".
	const total = Math.round(spu);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const parts = [];
	if (h > 0) parts.push(`${h}h`);
	if (m > 0) parts.push(`${m}m`);
	if (s > 0) parts.push(`${s}s`);
	return parts.join(" ") || "0s";
}
