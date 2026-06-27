import { excelFilterFn } from "@/components/ColumnFilter";
import { DataGrid } from "@/components/DataGrid";
import { ItemIcon } from "@/components/ItemIcon";
import { isRefineryFacility, useBlueprintData } from "@/hooks/useBlueprintData";
import type { Blueprint } from "@/lib/bomTypes";
import type { ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "@tanstack/react-router";
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
}

const LS_ORDER_KEY = "bom-order-items";

interface BomOrderItemStorage {
	typeId: number;
	typeName: string;
	quantity: number;
}

export function Blueprints() {
	const {
		blueprintList,
		blueprintFacilities,
		buildableBlueprintIds,
		removedFacilitiesByBlueprint,
		typeGroups,
		typeCategories,
		isLoading,
	} = useBlueprintData();
	const navigate = useNavigate();
	const [showUnavailable, setShowUnavailable] = useState(false);

	const addToIndustry = useCallback(
		(typeId: number, typeName: string) => {
			let items: BomOrderItemStorage[] = [];
			try {
				const raw = localStorage.getItem(LS_ORDER_KEY);
				if (raw) items = JSON.parse(raw) as BomOrderItemStorage[];
			} catch { /* ignore */ }
			const existing = items.find((i) => i.typeId === typeId);
			if (existing) {
				existing.quantity += 1;
			} else {
				items.push({ typeId, typeName, quantity: 1 });
			}
			localStorage.setItem(LS_ORDER_KEY, JSON.stringify(items));
			navigate({ to: "/industry" });
		},
		[navigate],
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
			return {
				bp,
				// De-dup: two live facilities share the name "Mini Printer" (87119, 95302),
				// so a blueprint runnable by both would otherwise render a duplicate badge + React key.
				facilities: [...new Set(blueprintFacilities.get(bp.blueprintID) ?? [])],
				buildable: buildableBlueprintIds.has(bp.blueprintID),
				removedFacilities: removedFacilitiesByBlueprint.get(bp.blueprintID) ?? [],
				group: typeGroups.get(bp.primaryTypeID) ?? "",
				category: typeCategories.get(bp.primaryTypeID) ?? "",
				totalInputQty: bp.inputs.reduce((sum, i) => sum + i.quantity, 0),
				primaryQty: primaryOutput?.quantity ?? 1,
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
										addToIndustry(bp.primaryTypeID, bp.primaryTypeName);
									}}
									className="rounded p-0.5 text-zinc-600 transition-colors hover:text-cyan-400"
									title="Add to Industry Calculator"
								>
									<Factory size={14} />
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
				cell: ({ row }) => (
					<span className="text-zinc-400">{row.original.category || "--"}</span>
				),
			},
			{
				id: "group",
				accessorFn: (r) => r.group,
				header: "Group",
				size: 130,
				filterFn: excelFilterFn,
				cell: ({ row }) => (
					<span className="text-zinc-400">{row.original.group || "--"}</span>
				),
			},
			{
				id: "inputs",
				accessorFn: (r) => r.bp.inputs.map((i) => i.typeName).join(", "),
				header: "Inputs",
				filterFn: excelFilterFn,
				cell: ({ row }) => (
					<div className="flex flex-col gap-1">
						{row.original.bp.inputs.map((input) => (
							<span
								key={input.typeID}
								className="flex items-center gap-1.5 whitespace-nowrap text-zinc-300"
							>
								<ItemIcon typeId={input.typeID} size={20} />
								<span className="font-mono text-zinc-400">
									{input.quantity.toLocaleString()}
								</span>{" "}
								{input.typeName}
							</span>
						))}
					</div>
				),
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
				accessorFn: (r) => r.bp.outputs.map((o) => o.typeName).join(", "),
				header: "Outputs",
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const { bp, totalInputQty } = row.original;
					return (
						<div className="flex flex-col gap-1">
							{bp.outputs.map((output) => {
								const isPrimary = output.typeID === bp.primaryTypeID;
								const perInput = output.quantity / totalInputQty;
								const ratioStr =
									perInput >= 1
										? `1:${perInput % 1 === 0 ? perInput.toFixed(0) : perInput.toFixed(1)}`
										: `1:${perInput.toFixed(2)}`;
								return (
									<span
										key={output.typeID}
										className={`flex items-center gap-1.5 whitespace-nowrap ${
											isPrimary ? "font-medium text-green-300" : "text-zinc-400"
										}`}
									>
										<ItemIcon typeId={output.typeID} size={20} />
										<span
											className={`font-mono ${isPrimary ? "text-green-400" : "text-zinc-500"}`}
										>
											{output.quantity.toLocaleString()}
										</span>{" "}
										{output.typeName}
										<span
											className={`ml-2 font-mono text-xs ${isPrimary ? "text-green-400/70" : "text-zinc-500"}`}
										>
											{ratioStr}
										</span>
									</span>
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
					const { bp, facilities, totalInputQty, primaryQty } = row.original;
					const isRefinery = facilities.some(isRefineryFacility);
					return (
						<div className="text-right">
							<span className="flex items-center justify-end gap-1 whitespace-nowrap text-zinc-300">
								<Clock size={12} />
								{bp.runTimeFormatted}
							</span>
							<div className="mt-0.5 whitespace-nowrap text-xs text-zinc-500">
								{isRefinery
									? `${formatTimePerUnit(bp.runTime, totalInputQty)}/in`
									: `${formatTimePerUnit(bp.runTime, primaryQty)}/out`}
							</div>
						</div>
					);
				},
			},
			{
				id: "facilities",
				accessorFn: (r) => (r.buildable ? r.facilities.join(", ") : "Unavailable"),
				header: "Facilities",
				size: 180,
				filterFn: excelFilterFn,
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
		[addToIndustry],
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
			actions={
				<h1 className="flex shrink-0 items-center gap-2 text-sm font-semibold text-zinc-100">
					<Wrench size={16} className="text-violet-500" />
					Blueprint Library
				</h1>
			}
			afterSearch={
				<div className="flex shrink-0 items-center gap-3">
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
				</div>
			}
		/>
	);
}

function formatTimePerUnit(batchSeconds: number, primaryQty: number): string {
	const spu = batchSeconds / primaryQty;
	if (spu < 1) return `${(spu * 1000).toFixed(0)}ms`;
	if (spu < 60) return `${spu.toFixed(1)}s`;
	const h = Math.floor(spu / 3600);
	const m = Math.floor((spu % 3600) / 60);
	const s = Math.round(spu % 60);
	const parts = [];
	if (h > 0) parts.push(`${h}h`);
	if (m > 0) parts.push(`${m}m`);
	if (s > 0) parts.push(`${s}s`);
	return parts.join(" ") || "0s";
}
