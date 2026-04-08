import { excelFilterFn } from "@/components/ColumnFilter";
import { DataGrid } from "@/components/DataGrid";
import { ItemIcon } from "@/components/ItemIcon";
import { useBlueprintData } from "@/hooks/useBlueprintData";
import type { Blueprint } from "@/lib/bomTypes";
import type { ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Building2, Clock, Factory, Wrench } from "lucide-react";
import { useCallback, useMemo } from "react";

interface BlueprintRow {
	bp: Blueprint;
	facilities: string[];
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
	const { blueprintList, blueprintFacilities, typeGroups, typeCategories, isLoading } =
		useBlueprintData();
	const navigate = useNavigate();

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

	const rows: BlueprintRow[] = useMemo(() => {
		return blueprintList.map((bp) => {
			const primaryOutput = bp.outputs.find((o) => o.typeID === bp.primaryTypeID);
			return {
				bp,
				facilities: blueprintFacilities.get(bp.blueprintID) ?? [],
				group: typeGroups.get(bp.primaryTypeID) ?? "",
				category: typeCategories.get(bp.primaryTypeID) ?? "",
				totalInputQty: bp.inputs.reduce((sum, i) => sum + i.quantity, 0),
				primaryQty: primaryOutput?.quantity ?? 1,
			};
		});
	}, [blueprintList, blueprintFacilities, typeGroups, typeCategories]);

	const columns: ColumnDef<BlueprintRow, unknown>[] = useMemo(
		() => [
			{
				id: "name",
				accessorFn: (r) => r.bp.primaryTypeName,
				header: "Blueprint",
				filterFn: excelFilterFn,
				cell: ({ row }) => (
					<span className="flex items-center gap-2 font-medium text-zinc-100">
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								addToIndustry(
									row.original.bp.primaryTypeID,
									row.original.bp.primaryTypeName,
								);
							}}
							className="rounded p-0.5 text-zinc-600 transition-colors hover:text-cyan-400"
							title="Add to Industry Calculator"
						>
							<Factory size={14} />
						</button>
						<ItemIcon typeId={row.original.bp.primaryTypeID} size={32} />
						{row.original.bp.primaryTypeName}
					</span>
				),
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
					const isRefinery = facilities.some((f) => f.includes("Refinery"));
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
				accessorFn: (r) => r.facilities.join(", "),
				header: "Facilities",
				size: 180,
				filterFn: excelFilterFn,
				cell: ({ row }) => (
					<div className="flex flex-wrap gap-1.5">
						{row.original.facilities.map((name) => (
							<span
								key={name}
								className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
							>
								<Building2 size={10} className="shrink-0 text-zinc-500" />
								{name}
							</span>
						))}
					</div>
				),
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
			searchPlaceholder="Search blueprints, materials, groups..."
			emptyMessage="No blueprints found"
			initialSorting={[{ id: "name", desc: false }]}
			actions={
				<h1 className="flex shrink-0 items-center gap-2 text-sm font-semibold text-zinc-100">
					<Wrench size={16} className="text-violet-500" />
					Blueprint Library
				</h1>
			}
			afterSearch={
				<span className="shrink-0 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-400 ring-1 ring-amber-500/30">
					Improved after hackathon submission deadline, not part of contest entry
				</span>
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
