import type { InventoryData, InventoryItem } from "@/hooks/useInventory";
import { useMemo, useState } from "react";

interface InventoryTableProps {
	inventory: InventoryData;
	isLoading?: boolean;
	canTransfer?: boolean;
	onTransfer?: (item: InventoryItem) => void;
	canSell?: boolean;
	onSell?: (item: InventoryItem) => void;
}

type SortField = "name" | "quantity" | "volume";
type SortDir = "asc" | "desc";

export function InventoryTable({
	inventory,
	isLoading,
	canTransfer,
	onTransfer,
	canSell,
	onSell,
}: InventoryTableProps) {
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

	const hasActions = canTransfer || canSell;

	// Loading skeleton
	if (isLoading) {
		return (
			<div className="space-y-2">
				{Array.from({ length: 4 }).map((_, i) => (
					<div
						key={i}
						className="flex gap-3 rounded border border-zinc-800 bg-zinc-900/50 p-3"
					>
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
			<div className="overflow-x-auto rounded-lg border border-zinc-800">
				<table className="w-full min-w-[320px] text-sm">
					<thead>
						<tr className="border-b border-zinc-800 bg-zinc-900/80">
							<th
								className="cursor-pointer px-3 py-2 text-left text-xs font-medium text-zinc-400 hover:text-zinc-300"
								onClick={() => handleSort("name")}
							>
								Item{sortIcon("name")}
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
								Volume (m&#xB3;){sortIcon("volume")}
							</th>
							{hasActions && (
								<th className="px-3 py-2 text-right text-xs font-medium text-zinc-400">
									Actions
								</th>
							)}
						</tr>
					</thead>
					<tbody>
						{sortedItems.map((item) => (
							<ItemRow
								key={item.typeId}
								item={item}
								onTransfer={canTransfer ? onTransfer : undefined}
								onSell={canSell ? onSell : undefined}
							/>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function ItemRow({
	item,
	onTransfer,
	onSell,
}: {
	item: InventoryItem;
	onTransfer?: (item: InventoryItem) => void;
	onSell?: (item: InventoryItem) => void;
}) {
	const totalVolume = (item.volume * item.quantity) / 1000;
	const hasActions = !!onTransfer || !!onSell;

	return (
		<tr className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/50">
			<td className="px-3 py-2 text-zinc-200">{item.name}</td>
			<td className="px-3 py-2 text-right font-mono text-zinc-300">
				{item.quantity.toLocaleString()}
			</td>
			<td className="px-3 py-2 text-right font-mono text-xs text-zinc-500">
				{totalVolume.toLocaleString()}
			</td>
			{hasActions && (
				<td className="px-3 py-2 text-right">
					<div className="flex items-center justify-end gap-2">
						{onTransfer && (
							<button
								type="button"
								onClick={() => onTransfer(item)}
								className="text-xs text-cyan-400 hover:text-cyan-300"
							>
								Transfer
							</button>
						)}
						{onSell && (
							<button
								type="button"
								onClick={() => onSell(item)}
								className="text-xs text-amber-400 hover:text-amber-300"
							>
								Sell
							</button>
						)}
					</div>
				</td>
			)}
		</tr>
	);
}
