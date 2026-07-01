// Sourcing plan table -- plan 39 Phase 4b; costed haul readout plan 41 B4.
// Renders the post-solve per-material container allocation: where to pull each raw material from
// (in priority order, with spillover) and any shortfall the selected containers cannot cover. Shows
// "#seq" for field storage, the SSU name for chain, and "Scratch" for the queue-local pad (resolved
// via the containerLabels map; formatContainerRef falls back per kind). Matches the Need/Have table
// styling used across the build-queue material lists.
//
// When `volumeMap` + `haulJumps` are supplied (plan 41 B4, Q4b) it also costs each allocation's haul as
// volume (m3) x gate-jumps from that container to the consuming location -- a per-allocation jump badge,
// a per-material Haul column, and an aggregate per-plan logistics tally. Purely informational: the LP
// stays frozen and never sees hauling (the optimizer trade-off is deferred to B6).

import { ItemIcon } from "@/components/ItemIcon";
import { containerRefKey } from "@/lib/queueResolver";
import type { MaterialSourcingPlan } from "@/lib/sourcingPlan";
import { formatContainerRef } from "@/lib/sourcingPlan";

interface SourcingPlanTableProps {
	plans: MaterialSourcingPlan[];
	/** containerRefKey -> display label ("#42 Junk", an SSU name, ...). */
	containerLabels: Map<string, string>;
	/** Per-unit item volume (m3) keyed by typeId. Present (with haulJumps) enables the costed haul
	 *  readout (plan 41 B4); absent renders the plain Phase 4b table. */
	volumeMap?: Map<number, number>;
	/** Gate-jumps from the consuming location (this plan's batch, else the queue) to each container,
	 *  keyed by containerRefKey. Paired with volumeMap to cost each allocation's haul leg. */
	haulJumps?: Map<string, number | undefined>;
}

/** Round + thousands-format an m3-jumps haul cost. */
function formatHaul(cost: number): string {
	return `${Math.round(cost).toLocaleString()} m³·j`;
}

/** Per-material haul cost: sum of volume x gate-jumps over its allocations (unknown legs flagged). */
function planHaulCost(
	plan: MaterialSourcingPlan,
	volumeMap: Map<number, number>,
	haulJumps: Map<string, number | undefined>,
): { cost: number; hasUnknown: boolean } {
	const unitVol = volumeMap.get(plan.typeId) ?? 0;
	let cost = 0;
	let hasUnknown = false;
	for (const a of plan.allocations) {
		const j = haulJumps.get(containerRefKey(a.ref));
		if (j == null) {
			hasUnknown = true;
			continue;
		}
		cost += unitVol * a.qty * j;
	}
	return { cost, hasUnknown };
}

export function SourcingPlanTable({
	plans,
	containerLabels,
	volumeMap,
	haulJumps,
}: SourcingPlanTableProps) {
	if (plans.length === 0) {
		return (
			<div className="px-4 py-3 text-xs text-zinc-600">
				No materials are pulled from storage containers for this batch.
			</div>
		);
	}
	// Only surface the haul readout once there is an actual anchor to measure from: a location-less queue
	// (or one whose containers are all unreachable) leaves every leg unknown, so showing the column would
	// be pure noise. Gate on at least one container with a known gate distance.
	const showHaul =
		!!volumeMap &&
		!!haulJumps &&
		plans.some((p) => p.allocations.some((a) => haulJumps.get(containerRefKey(a.ref)) != null));
	const totalHaul = showHaul
		? plans.reduce((sum, p) => sum + planHaulCost(p, volumeMap, haulJumps).cost, 0)
		: 0;
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<th className="px-4 py-2 text-left">Item</th>
					<th className="px-4 py-2 text-left">Pull from</th>
					<th className="px-4 py-2 text-right">From stock</th>
					<th className="px-4 py-2 text-right">Shortfall</th>
					{showHaul && (
						<th
							className="px-4 py-2 text-right"
							title="Costed haul: item volume (m³) x gate-jumps from each container to this batch's location. Informational -- the optimizer does not trade off hauling (deferred)."
						>
							Haul
						</th>
					)}
				</tr>
			</thead>
			<tbody>
				{plans.map((plan) => {
					const haul = showHaul ? planHaulCost(plan, volumeMap, haulJumps) : null;
					return (
						<tr
							key={plan.typeId}
							className="border-t border-zinc-800/50 align-top hover:bg-zinc-800/30"
						>
							<td className="px-4 py-2 text-zinc-200">
								<span className="flex items-center gap-2">
									<ItemIcon typeId={plan.typeId} />
									{plan.typeName}
								</span>
							</td>
							<td className="px-4 py-2">
								<div className="flex flex-wrap gap-1.5">
									{plan.allocations.map((alloc) => {
										const jumps = showHaul ? haulJumps.get(containerRefKey(alloc.ref)) : undefined;
										return (
											<span
												key={containerRefKey(alloc.ref)}
												className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-300"
											>
												<span className="font-mono text-cyan-400">{alloc.qty.toLocaleString()}</span>
												<span className="text-zinc-500">from</span>
												<span className="text-zinc-200">
													{formatContainerRef(alloc.ref, containerLabels)}
												</span>
												{showHaul && (
													<span
														className={`ml-0.5 rounded px-1 font-mono ${
															jumps == null
																? "bg-zinc-800 text-zinc-500"
																: jumps === 0
																	? "bg-zinc-800 text-green-400"
																	: "bg-zinc-800 text-amber-300"
														}`}
														title={
															jumps == null
																? "No gate route from this container to the build location"
																: jumps === 0
																	? "Same system as the build location"
																	: `${jumps} gate jump${jumps === 1 ? "" : "s"} to the build location`
														}
													>
														{jumps == null ? "? j" : `${jumps} j`}
													</span>
												)}
											</span>
										);
									})}
								</div>
							</td>
							<td className="px-4 py-2 text-right font-mono text-cyan-400">
								{plan.fromStock.toLocaleString()}
							</td>
							<td className="px-4 py-2 text-right font-mono">
								{plan.shortfall === 0 ? (
									<span className="text-green-400">0</span>
								) : (
									<span
										className="text-amber-400"
										title="Not covered by the ranked storage containers -- comes from other stock or must be gathered/mined"
									>
										{plan.shortfall.toLocaleString()}
									</span>
								)}
							</td>
							{showHaul && haul && (
								<td className="px-4 py-2 text-right font-mono text-zinc-300">
									<span
										className={haul.cost === 0 ? "text-green-400" : undefined}
										title={
											haul.hasUnknown
												? "Excludes containers with no gate route to the build location"
												: "Item volume x gate-jumps over this material's allocations"
										}
									>
										{formatHaul(haul.cost)}
										{haul.hasUnknown && <span className="ml-0.5 text-zinc-500">*</span>}
									</span>
								</td>
							)}
						</tr>
					);
				})}
			</tbody>
			{showHaul && totalHaul > 0 && (
				<tfoot>
					<tr className="border-t border-zinc-800 text-xs text-zinc-400">
						<td className="px-4 py-2 font-medium" colSpan={4}>
							Total haul
						</td>
						<td className="px-4 py-2 text-right font-mono text-zinc-200">{formatHaul(totalHaul)}</td>
					</tr>
				</tfoot>
			)}
		</table>
	);
}
