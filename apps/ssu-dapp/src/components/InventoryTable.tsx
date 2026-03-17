import { useState, useMemo } from "react";
import type { InventoryItem, InventoryData } from "@/hooks/useInventory";
import { resolveItemIcon } from "@/lib/items";

interface InventoryTableProps {
	inventory: InventoryData;
	isLoading?: boolean;
}

type SortField = "name" | "typeId" | "quantity" | "volume";
type SortDir = "asc" | "desc";

export function InventoryTable({ inventory, isLoading }: InventoryTableProps) {
	const [sortField, setSortField] = useState<SortField>("name");
	const [sortDir, setSortDir] = useState<SortDir>("asc");

	const sortedItems = useMemo(() => {
		const items = [...inventory.items];
		items.sort((a, b) => {
			let cmp = 0;
			switch (sortField) {
				case "name":
					cmp = a.name.localeCompare(b.name);
					break;
				case "typeId":
					cmp = a.typeId - b.typeId;
					break;
				case "quantity":
					cmp = a.quantity - b.quantity;
					break;
				case "volume":
					cmp = a.volume * a.quantity - b.volume * b.quantity;
					break;
			}
			return sortDir === "asc" ? cmp : -cmp;
		});
		return items;
	}, [inventory.items, sortField, sortDir]);

	function handleSort(field: SortField) {
		if (sortField === field) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortField(field);
			setSortDir("asc");
		}
	}

	// Loading skeleton
	if (isLoading) {
		return (
			<div className="space-y-2">
				{Array.from({ length: 4 }).map((_, i) => (
					<div key={i} className="flex gap-3 rounded border border-zinc-800 bg-zinc-900/50 p-3">
						<div className="h-8 w-8 animate-pulse rounded bg-zinc-800" />
						<div className="flex-1 space-y-1.5">
							<div className="h-3 w-32 animate-pulse rounded bg-zinc-800" />
							<div className="h-2.5 w-20 animate-pulse rounded bg-zinc-800" />
						</div>
						<div className="h-3 w-12 animate-pulse rounded bg-zinc-800" />
					</div>
				))}
			</div>
		);
	}

	// Empty state
	if (inventory.items.length === 0) {
		return (
			<div className="flex h-32 items-center justify-center rounded border border-dashed border-zinc-800">
				<p className="text-sm text-zinc-600">No items in this inventory</p>
			</div>
		);
	}

	const sortIcon = (field: SortField) => {
		if (sortField !== field) return null;
		return sortDir === "asc" ? " \u25B2" : " \u25BC";
	};

	return (
		<div>
			{/* Capacity bar */}
			<div className="mb-3 flex items-center gap-2 text-xs text-zinc-500">
				<span>
					Capacity: {inventory.usedCapacity.toLocaleString()} /{" "}
					{inventory.maxCapacity.toLocaleString()}
				</span>
				<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
					<div
						className="h-full rounded-full bg-cyan-600 transition-all"
						style={{
							width: `${inventory.maxCapacity > 0 ? Math.min(100, (inventory.usedCapacity / inventory.maxCapacity) * 100) : 0}%`,
						}}
					/>
				</div>
			</div>

			{/* Table */}
			<div className="overflow-hidden rounded-lg border border-zinc-800">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-zinc-800 bg-zinc-900/80">
							<th className="w-10 px-3 py-2" />
							<th
								className="cursor-pointer px-3 py-2 text-left text-xs font-medium text-zinc-400 hover:text-zinc-300"
								onClick={() => handleSort("name")}
							>
								Name{sortIcon("name")}
							</th>
							<th
								className="cursor-pointer px-3 py-2 text-right text-xs font-medium text-zinc-400 hover:text-zinc-300"
								onClick={() => handleSort("typeId")}
							>
								Type ID{sortIcon("typeId")}
							</th>
							<th
								className="cursor-pointer px-3 py-2 text-right text-xs font-medium text-zinc-400 hover:text-zinc-300"
								onClick={() => handleSort("quantity")}
							>
								Qty{sortIcon("quantity")}
							</th>
							<th
								className="cursor-pointer px-3 py-2 text-right text-xs font-medium text-zinc-400 hover:text-zinc-300"
								onClick={() => handleSort("volume")}
							>
								Volume{sortIcon("volume")}
							</th>
						</tr>
					</thead>
					<tbody>
						{sortedItems.map((item) => (
							<ItemRow key={item.typeId} item={item} />
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function ItemRow({ item }: { item: InventoryItem }) {
	const iconUrl = resolveItemIcon(item.typeId);
	const totalVolume = item.volume * item.quantity;

	return (
		<tr className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/50">
			<td className="px-3 py-2">
				{iconUrl ? (
					<img
						src={iconUrl}
						alt=""
						className="h-6 w-6 rounded object-cover"
					/>
				) : (
					<div className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-xs text-zinc-600">
						?
					</div>
				)}
			</td>
			<td className="px-3 py-2 text-zinc-200">{item.name}</td>
			<td className="px-3 py-2 text-right font-mono text-xs text-zinc-500">
				{item.typeId}
			</td>
			<td className="px-3 py-2 text-right font-mono text-zinc-300">
				{item.quantity.toLocaleString()}
			</td>
			<td className="px-3 py-2 text-right font-mono text-xs text-zinc-500">
				{totalVolume.toLocaleString()}
			</td>
		</tr>
	);
}
