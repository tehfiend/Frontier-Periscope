import { ItemIcon } from "@/components/ItemIcon";
import type { BomSurplus } from "@/lib/bomTypes";
import { AlertTriangle } from "lucide-react";

// ── Surplus table ───────────────────────────────────────────────────────────

export interface SurplusTableProps {
	items: BomSurplus[];
	consumerLabelsByType?: Map<number, string>;
}

export function SurplusTable({ items, consumerLabelsByType }: SurplusTableProps) {
	if (items.length === 0) {
		return <div className="px-4 py-3 text-xs text-zinc-600">No surplus co-products</div>;
	}
	const totalVolume = items.reduce((sum, item) => (item.volume < 0 ? sum : sum + item.volume), 0);
	const hasMissing = items.some((item) => item.volume < 0);
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<th className="px-4 py-2 text-left">Item</th>
					<th className="px-4 py-2 text-left">Source</th>
					<th className="px-4 py-2 text-right">Quantity</th>
					<th className="px-4 py-2 text-right">Volume (m³)</th>
				</tr>
			</thead>
			<tbody>
				{items.map((item) => (
					<tr key={item.typeId} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
						<td className="px-4 py-2 text-zinc-200">
							<span className="flex items-center gap-2">
								<ItemIcon typeId={item.typeId} />
								{item.typeName}
								{consumerLabelsByType?.get(item.typeId) && (
									<span className="shrink-0 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
										used by {consumerLabelsByType.get(item.typeId)}
									</span>
								)}
							</span>
						</td>
						<td className="px-4 py-2 text-xs text-zinc-500">{item.source ?? "--"}</td>
						<td className="px-4 py-2 text-right font-mono text-zinc-400">
							{item.quantity.toLocaleString()}
						</td>
						<td className="px-4 py-2 text-right font-mono text-zinc-400">
							{item.volume < 0 ? (
								<span className="inline-flex items-center gap-1 text-amber-400">
									<AlertTriangle size={12} />
									<span className="text-xs">??</span>
								</span>
							) : (
								item.volume.toLocaleString(undefined, { maximumFractionDigits: 1 })
							)}
						</td>
					</tr>
				))}
			</tbody>
			<tfoot>
				<tr className="border-t border-zinc-700">
					<td className="px-4 py-2 text-xs font-medium text-zinc-400" colSpan={3}>
						Total
					</td>
					<td className="px-4 py-2 text-right font-mono text-sm text-zinc-200">
						{totalVolume.toLocaleString(undefined, { maximumFractionDigits: 1 })}
						{hasMissing && (
							<span className="ml-1 text-amber-400" title="Some items have missing volume">
								*
							</span>
						)}
					</td>
				</tr>
			</tfoot>
		</table>
	);
}
