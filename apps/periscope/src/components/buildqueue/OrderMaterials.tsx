// Per-Order summaries -- plan 36 (industry-build-queue), Phase 7; Queue / Order / Job (plan 39);
// unified tree (plan 44). The build path itself now renders as the unified production-order tree in
// OrderCard -- this component keeps the supporting per-order summaries: sourcing plan (pull from
// storage), deposits (push to storage), from-upstream, and surplus. All read-only.

import { ItemIcon } from "@/components/ItemIcon";
import { DepositsTable, projectOrderDeposits } from "@/components/buildqueue/DepositsTable";
import { SourcingPlanTable } from "@/components/buildqueue/SourcingPlanTable";
import { formatVolume } from "@/components/buildqueue/shared";
import { SurplusTable } from "@/components/industry/SurplusTable";
import type { OrderResult } from "@/lib/queueResolver";
import type { MaterialSourcingPlan } from "@/lib/sourcingPlan";
import { useActiveQueue } from "@/stores/buildQueueStore";

interface OrderMaterialsProps {
	order: OrderResult;
	queueId: string;
	/** Post-solve per-material container allocation for this order (Phase 4b). */
	sourcingPlan?: MaterialSourcingPlan[];
	/** containerRefKey -> display label for the sourcing plan table. */
	containerLabels: Map<string, string>;
	/** Per-unit item volume (m3) by typeId -- with haulJumps, costs the sourcing-plan haul (plan 41 B4). */
	volumeMap?: Map<number, number>;
	/** Gate-jumps from THIS order's location (else the queue) to each container, for the haul readout. */
	haulJumps?: Map<string, number | undefined>;
}

function Subsection({
	title,
	count,
	hint,
	children,
}: {
	title: string;
	count: number;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="overflow-hidden rounded border border-zinc-800 bg-zinc-900/40">
			<div className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-400">
				{title}
				<span className="text-zinc-600">({count})</span>
				{hint && <span className="ml-auto text-[11px] font-normal text-amber-400/80">{hint}</span>}
			</div>
			{children}
		</div>
	);
}

export function OrderMaterials({
	order,
	queueId,
	sourcingPlan,
	containerLabels,
	volumeMap,
	haulJumps,
}: OrderMaterialsProps) {
	// Deposits projection (plan 41 B0): where this order's outputs land (effective outputDest cascade).
	// OrderMaterials only renders within the active queue's orders, so the active queue IS this order's
	// queue -- we read it reactively to resolve the cascade (OrderResult alone lacks the queue/job scopes).
	const activeQueue = useActiveQueue();
	const rawOrder =
		activeQueue?.id === queueId
			? activeQueue.batches.find((b) => b.id === order.orderId)
			: undefined;
	const deposits =
		activeQueue && rawOrder ? projectOrderDeposits(order, activeQueue, rawOrder) : [];
	const phaseLabelForOrderIds = (orderIds: string[]): string => {
		const indexes = orderIds
			.map((id) => activeQueue?.batches.findIndex((b) => b.id === id) ?? -1)
			.filter((index) => index >= 0)
			.map((index) => index + 1);
		if (indexes.length === 0) return "earlier phase";
		if (indexes.length === 1) return `phase ${indexes[0]}`;
		return `phases ${indexes.join(", ")}`;
	};
	const surplusConsumersByType = new Map<number, string>();
	for (const surplus of order.surplus) {
		const consumerIds = new Set<string>();
		for (const deposit of order.deposits) {
			if (deposit.typeId !== surplus.typeId) continue;
			for (const id of deposit.consumerOrderIds ?? []) consumerIds.add(id);
		}
		if (consumerIds.size > 0) {
			surplusConsumersByType.set(surplus.typeId, phaseLabelForOrderIds([...consumerIds]));
		}
	}

	const hasSourcingPlan = (sourcingPlan?.length ?? 0) > 0;
	const hasAnything =
		order.fromUpstream.length > 0 ||
		order.surplus.length > 0 ||
		hasSourcingPlan ||
		deposits.length > 0;

	// The build path (and its materials) render in the unified tree above -- when there is no extra
	// sourcing/deposit/upstream/surplus detail, say so (the Details section is always expandable).
	if (!hasAnything) {
		return (
			<div className="px-4 py-3 text-xs text-zinc-600">
				No additional sourcing, deposit, or surplus details for this order.
			</div>
		);
	}

	return (
		<div className="space-y-3 px-4 pb-4">
			{hasSourcingPlan && sourcingPlan && (
				<Subsection
					title="Sourcing plan (pull from storage)"
					count={sourcingPlan.length}
					hint="ranked containers + spillover"
				>
					<SourcingPlanTable
						plans={sourcingPlan}
						containerLabels={containerLabels}
						volumeMap={volumeMap}
						haulJumps={haulJumps}
					/>
				</Subsection>
			)}

			{deposits.length > 0 && (
				<Subsection
					title="Deposits (push to storage)"
					count={deposits.length}
					hint="projected from outputs"
				>
					<DepositsTable rows={deposits} containerLabels={containerLabels} />
				</Subsection>
			)}

			{order.fromUpstream.length > 0 && (
				<Subsection title="From upstream (earlier orders)" count={order.fromUpstream.length}>
					<table className="w-full text-sm">
						<thead>
							<tr className="border-t border-zinc-800 text-xs text-zinc-500">
								<th className="px-4 py-2 text-left">Item</th>
								<th className="px-4 py-2 text-right">Quantity</th>
								<th className="px-4 py-2 text-right">Volume (m³)</th>
							</tr>
						</thead>
						<tbody>
							{order.fromUpstream.map((item) => (
								<tr key={item.typeId} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
									<td className="px-4 py-2 text-zinc-200">
										<span className="flex items-center gap-2">
											<ItemIcon typeId={item.typeId} />
											{item.typeName}
											{item.sourceOrderIds && item.sourceOrderIds.length > 0 && (
												<span className="shrink-0 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
													from {phaseLabelForOrderIds(item.sourceOrderIds)}
												</span>
											)}
										</span>
									</td>
									<td className="px-4 py-2 text-right font-mono text-cyan-400">
										{item.quantity.toLocaleString()}
									</td>
									<td className="px-4 py-2 text-right font-mono text-zinc-400">
										{item.volume < 0 ? "??" : formatVolume(item.volume)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</Subsection>
			)}

			{order.surplus.length > 0 && (
				<Subsection
					title="Surplus (rolls into next order)"
					count={order.surplus.length}
					hint="available to later orders"
				>
					<SurplusTable items={order.surplus} consumerLabelsByType={surplusConsumersByType} />
				</Subsection>
			)}
		</div>
	);
}
