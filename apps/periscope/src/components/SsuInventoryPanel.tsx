import { fetchAssemblyInventory } from "@/chain/inventory";
import type { InventoryKind } from "@/chain/inventory";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Package } from "lucide-react";
import { useMemo } from "react";

interface SsuInventoryPanelProps {
	assemblyId: string;
	assemblyType: string;
	onSelectItem: (typeId: number) => void;
	/** Which inventories to show. Defaults to all. */
	filterKind?: InventoryKind;
}

export function SsuInventoryPanel({
	assemblyId,
	assemblyType,
	onSelectItem,
	filterKind,
}: SsuInventoryPanelProps) {
	const client = useSuiClient();

	const { data: inventories, isLoading } = useQuery({
		queryKey: ["ssuInventory", assemblyId],
		queryFn: () => fetchAssemblyInventory(client, assemblyId, assemblyType),
		staleTime: 30_000,
	});

	const { data: typeNameMap = {} } = useQuery({
		queryKey: ["staticTypes"],
		queryFn: async () => {
			const res = await fetch("/data/types.json");
			const data = (await res.json()) as Record<
				string,
				{ typeID: number; typeNameID: string }
			>;
			const map: Record<number, string> = {};
			for (const entry of Object.values(data)) {
				if (entry.typeNameID) map[entry.typeID] = entry.typeNameID;
			}
			return map;
		},
		staleTime: Number.POSITIVE_INFINITY,
	});

	const grouped = useMemo(() => {
		if (!inventories) return [];
		const filtered = filterKind
			? inventories.filter((inv) => inv.kind === filterKind)
			: inventories;
		return filtered.filter((inv) => inv.items.length > 0);
	}, [inventories, filterKind]);

	const totalItems = useMemo(
		() => grouped.reduce((sum, inv) => sum + inv.items.length, 0),
		[grouped],
	);

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-3 py-4 text-xs text-zinc-500">
				<Loader2 size={14} className="animate-spin" />
				Loading inventory...
			</div>
		);
	}

	if (totalItems === 0) {
		return (
			<div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-3 py-4 text-xs text-zinc-500">
				<Package size={14} />
				{filterKind === "owner"
					? "No items in owner inventory"
					: "No items in this Trade Node"}
			</div>
		);
	}

	return (
		<div className="rounded border border-zinc-800 bg-zinc-900/30">
			<div className="border-b border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400">
				Inventory ({totalItems} item
				{totalItems !== 1 ? "s" : ""})
			</div>
			<div className="max-h-48 overflow-y-auto">
				{grouped.map((inv) => (
					<div key={inv.inventoryId}>
						{grouped.length > 1 && (
							<div className="border-b border-zinc-800/50 bg-zinc-800/20 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
								{inv.label}
								{inv.kind === "extension" && (
									<span className="ml-1 text-amber-500/60">(escrowed)</span>
								)}
							</div>
						)}
						{inv.items.map((item) => (
							<div
								key={`${inv.inventoryId}-${item.typeId}`}
								className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 text-sm last:border-b-0"
							>
								<div className="min-w-0 flex-1">
									<span className="text-zinc-200">
										{typeNameMap[item.typeId] ?? `Type #${item.typeId}`}
									</span>
									<span className="ml-2 text-xs text-zinc-500">
										x{item.quantity.toLocaleString()}
									</span>
								</div>
								{inv.kind === "owner" || !filterKind ? (
									<button
										type="button"
										onClick={() => onSelectItem(item.typeId)}
										className="ml-2 shrink-0 rounded bg-cyan-600/20 px-2 py-1 text-xs text-cyan-400 hover:bg-cyan-600/30"
									>
										Select
									</button>
								) : null}
							</div>
						))}
					</div>
				))}
			</div>
		</div>
	);
}
