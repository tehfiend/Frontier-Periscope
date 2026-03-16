import { fetchAssemblyInventory } from "@/chain/inventory";
import { db } from "@/db";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Loader2, Package } from "lucide-react";
import { useMemo } from "react";

interface SsuInventoryPanelProps {
	assemblyId: string;
	assemblyType: string;
	onSelectItem: (typeId: number) => void;
}

export function SsuInventoryPanel({
	assemblyId,
	assemblyType,
	onSelectItem,
}: SsuInventoryPanelProps) {
	const client = useCurrentClient();

	const { data: inventories, isLoading } = useQuery({
		queryKey: ["ssuInventory", assemblyId],
		queryFn: () => fetchAssemblyInventory(client, assemblyId, assemblyType),
		staleTime: 30_000,
	});

	const gameTypes = useLiveQuery(() => db.gameTypes.toArray()) ?? [];

	const typeNameMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const gt of gameTypes) {
			map[gt.id] = gt.name;
		}
		return map;
	}, [gameTypes]);

	const allItems = useMemo(() => inventories?.flatMap((inv) => inv.items) ?? [], [inventories]);

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-3 py-4 text-xs text-zinc-500">
				<Loader2 size={14} className="animate-spin" />
				Loading inventory...
			</div>
		);
	}

	if (allItems.length === 0) {
		return (
			<div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-3 py-4 text-xs text-zinc-500">
				<Package size={14} />
				No items in this Trade Node
			</div>
		);
	}

	return (
		<div className="rounded border border-zinc-800 bg-zinc-900/30">
			<div className="border-b border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400">
				Inventory ({allItems.length} item
				{allItems.length !== 1 ? "s" : ""})
			</div>
			<div className="max-h-48 overflow-y-auto">
				{allItems.map((item) => (
					<div
						key={item.typeId}
						className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 text-sm last:border-b-0"
					>
						<div className="min-w-0 flex-1">
							<span className="text-zinc-200">
								{typeNameMap[item.typeId] ?? `Type #${item.typeId}`}
							</span>
							<span className="ml-2 text-xs text-zinc-500">x{item.quantity.toLocaleString()}</span>
						</div>
						<button
							type="button"
							onClick={() => onSelectItem(item.typeId)}
							className="ml-2 shrink-0 rounded bg-cyan-600/20 px-2 py-1 text-xs text-cyan-400 hover:bg-cyan-600/30"
						>
							Select
						</button>
					</div>
				))}
			</div>
		</div>
	);
}
