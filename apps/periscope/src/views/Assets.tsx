import { useState, useMemo } from "react";
import { useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Boxes, Loader2, RefreshCw } from "lucide-react";
import { DataGrid, excelFilterFn, type ColumnDef } from "@/components/DataGrid";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant, useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import { fetchAssemblyInventory, type InventoryItem, type AssemblyInventory } from "@/chain/inventory";
import { db } from "@/db";
import { ASSEMBLY_TYPE_IDS } from "@/chain/config";

// ── Types ───────────────────────────────────────────────────────────────────

interface AssetRow {
	id: string;
	typeId: number;
	typeName: string;
	quantity: number;
	assemblyId: string;
	assemblyLabel: string;
	assemblyType: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export function Assets() {
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const client = useSuiClient();
	const { data: discovery, isLoading: loadingAssemblies } = useOwnedAssemblies();
	const gameTypes = useLiveQuery(() => db.gameTypes.toArray()) ?? [];

	// Build type name lookup
	const typeNameMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const gt of gameTypes) {
			map[gt.id] = gt.name;
		}
		return map;
	}, [gameTypes]);

	// Fetch inventories for all storage-type assemblies
	const storageAssemblies = discovery?.assemblies.filter(
		(a) => a.type === "storage_unit",
	) ?? [];

	const {
		data: inventories,
		isLoading: loadingInventory,
		refetch,
		isFetching,
	} = useQuery({
		queryKey: ["assetInventories", storageAssemblies.map((a) => a.objectId).join(",")],
		queryFn: async () => {
			const results: AssemblyInventory[] = [];
			for (const assembly of storageAssemblies) {
				const inv = await fetchAssemblyInventory(client, assembly.objectId, assembly.type);
				results.push(...inv);
			}
			return results;
		},
		enabled: storageAssemblies.length > 0,
		staleTime: 60_000,
		refetchInterval: 120_000,
	});

	// Flatten inventory data into rows
	const rows: AssetRow[] = useMemo(() => {
		if (!inventories) return [];

		const result: AssetRow[] = [];
		for (const inv of inventories) {
			const assemblyLabel = inv.assemblyId.slice(0, 10) + "...";
			const assemblyTypeName = ASSEMBLY_TYPE_IDS[Number(inv.assemblyType)] ?? inv.assemblyType;

			for (const item of inv.items) {
				result.push({
					id: `${inv.assemblyId}-${item.typeId}`,
					typeId: item.typeId,
					typeName: typeNameMap[item.typeId] ?? `Type ${item.typeId}`,
					quantity: item.quantity,
					assemblyId: inv.assemblyId,
					assemblyLabel,
					assemblyType: assemblyTypeName,
				});
			}
		}

		return result;
	}, [inventories, typeNameMap]);

	// Summary stats
	const totalItems = rows.reduce((sum, r) => sum + r.quantity, 0);
	const uniqueTypes = new Set(rows.map((r) => r.typeId)).size;

	const columns: ColumnDef<AssetRow, unknown>[] = [
		{
			id: "typeName",
			accessorKey: "typeName",
			header: "Item",
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<div>
					<span className="font-medium text-zinc-100">{row.original.typeName}</span>
					<span className="ml-2 font-mono text-xs text-zinc-600">#{row.original.typeId}</span>
				</div>
			),
		},
		{
			id: "quantity",
			accessorKey: "quantity",
			header: "Qty",
			size: 100,
			enableColumnFilter: false,
			cell: ({ row }) => (
				<span className="font-mono text-zinc-200">{row.original.quantity.toLocaleString()}</span>
			),
		},
		{
			id: "assemblyType",
			accessorKey: "assemblyType",
			header: "Container Type",
			size: 150,
			filterFn: excelFilterFn,
		},
		{
			id: "assembly",
			accessorKey: "assemblyId",
			header: "Container",
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<span className="font-mono text-xs text-zinc-500" title={row.original.assemblyId}>
					{row.original.assemblyId.slice(0, 10)}...{row.original.assemblyId.slice(-6)}
				</span>
			),
		},
	];

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<Boxes size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">Select a character to view assets</p>
					<a
						href="/manifest"
						className="mt-2 inline-block text-xs text-cyan-400 hover:text-cyan-300"
					>
						Go to Manifest &rarr;
					</a>
				</div>
			</div>
		);
	}

	const isLoading = loadingAssemblies || loadingInventory;

	return (
		<div className="p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<Boxes size={24} className="text-amber-500" />
						Assets
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{isLoading
							? "Loading inventories..."
							: `${totalItems.toLocaleString()} items across ${uniqueTypes} types in ${storageAssemblies.length} container${storageAssemblies.length !== 1 ? "s" : ""}`}
					</p>
				</div>
				<button
					type="button"
					onClick={() => refetch()}
					disabled={isFetching}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
					Refresh
				</button>
			</div>

			{/* Summary Cards */}
			<div className="mb-6 grid grid-cols-3 gap-4">
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<p className="text-xs text-zinc-500">Total Items</p>
					<p className="mt-1 text-2xl font-bold text-zinc-100">{totalItems.toLocaleString()}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<p className="text-xs text-zinc-500">Unique Types</p>
					<p className="mt-1 text-2xl font-bold text-amber-400">{uniqueTypes}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<p className="text-xs text-zinc-500">Containers</p>
					<p className="mt-1 text-2xl font-bold text-cyan-400">{storageAssemblies.length}</p>
				</div>
			</div>

			{/* Data Grid */}
			{isLoading ? (
				<div className="flex items-center justify-center py-16">
					<Loader2 size={24} className="animate-spin text-cyan-500" />
					<span className="ml-3 text-sm text-zinc-400">
						{loadingAssemblies ? "Discovering assemblies..." : "Fetching inventories..."}
					</span>
				</div>
			) : (
				<DataGrid
					columns={columns}
					data={rows}
					keyFn={(r) => r.id}
					searchPlaceholder="Search items, types, containers..."
					emptyMessage={
						storageAssemblies.length === 0
							? "No storage units found. Deploy a storage unit in-game first."
							: "No items in your storage units."
					}
				/>
			)}
		</div>
	);
}
