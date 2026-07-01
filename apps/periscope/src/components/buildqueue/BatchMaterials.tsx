// Per-batch materials summary -- plan 36 (industry-build-queue), Phase 7; Queue / Batch / Job (plan 39).
// Compact gather (raws) / build (intermediates) / from-upstream / surplus lists for one batch.
// Phase 7 makes the build + gather sections interactive: the build list is the either/or recipe
// drill-down (BuildChoiceTable -> RecipeAlternatives, lock/prefer/eliminate). From-upstream and
// surplus stay read-only (reused SurplusTable). The build subsection's hint counts the inputs that
// still have an OPEN either/or choice (more than one recipe, not yet steered). Build rows are the
// optimizer-DERIVED intermediates (authored Target jobs live in the batch card's job rows).

import { ItemIcon } from "@/components/ItemIcon";
import { DepositsTable, projectBatchDeposits } from "@/components/buildqueue/DepositsTable";
import { BuildChoiceTable, RawSourceTable } from "@/components/buildqueue/InputDrillDown";
import { SourcingPlanTable } from "@/components/buildqueue/SourcingPlanTable";
import {
	type QueueBlueprintData,
	batchOpenChoiceCount,
	formatVolume,
} from "@/components/buildqueue/shared";
import { SurplusTable } from "@/components/industry/SurplusTable";
import type { RecipeLockEntry, SourceLockEntry } from "@/lib/buildQueueTypes";
import { type BatchResult, mergeLocks } from "@/lib/queueResolver";
import type { ContainerOption, MaterialSourcingPlan } from "@/lib/sourcingPlan";
import { useActiveQueue } from "@/stores/buildQueueStore";

interface BatchMaterialsProps {
	batch: BatchResult;
	queueId: string;
	data: QueueBlueprintData;
	/** Queue-global recipe locks (the default lock scope). */
	recipeLocks: RecipeLockEntry[];
	/** This batch's per-batch lock overrides, if any (F2 -- override queue locks per type). */
	batchLocks: RecipeLockEntry[] | undefined;
	/** True when the queue is in global re-optimization mode (per-batch material lists are empty). */
	globalMode: boolean;
	/** Post-solve per-material container allocation for this batch (Phase 4b). */
	sourcingPlan?: MaterialSourcingPlan[];
	/** Selectable containers for the per-row Derived sourcing override. */
	containers: ContainerOption[];
	/** containerRefKey -> display label for the sourcing plan table. */
	containerLabels: Map<string, string>;
	/** Gate-jump distance per container (containerRefKey -> jumps) for the Derived source-priority badges. */
	containerJumps?: Map<string, number | undefined>;
	/** This batch's per-typeId source locks (cascade layer 4 -- written by the Derived row control). */
	batchSourceLocks?: SourceLockEntry[];
	/** Per-unit item volume (m3) by typeId -- with haulJumps, costs the sourcing-plan haul (plan 41 B4). */
	volumeMap?: Map<number, number>;
	/** Gate-jumps from THIS batch's location (else the queue) to each container, for the haul readout. */
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

export function BatchMaterials({
	batch,
	queueId,
	data,
	recipeLocks,
	batchLocks,
	globalMode,
	sourcingPlan,
	containers,
	containerLabels,
	containerJumps,
	batchSourceLocks,
	volumeMap,
	haulJumps,
}: BatchMaterialsProps) {
	// EFFECTIVE locks (batch overrides queue per type) so the open-choice hint reflects batch-level steers.
	const mergedLocks = mergeLocks(recipeLocks, batchLocks);
	const openChoiceCount = batchOpenChoiceCount(batch, mergedLocks);
	const buildHint =
		openChoiceCount > 0
			? `${openChoiceCount} choice${openChoiceCount === 1 ? "" : "s"} to make`
			: undefined;

	// Deposits projection (plan 41 B0): where this batch's outputs land (effective outputDest cascade).
	// BatchMaterials only renders within the active queue's batches, so the active queue IS this batch's
	// queue -- we read it reactively to resolve the cascade (BatchResult alone lacks the queue/job scopes).
	// Suppressed in global mode (per-batch lists are queue-level there; the queue-total summary covers it).
	const activeQueue = useActiveQueue();
	const rawBatch =
		activeQueue?.id === queueId
			? activeQueue.batches.find((b) => b.id === batch.batchId)
			: undefined;
	const deposits =
		!globalMode && activeQueue && rawBatch
			? projectBatchDeposits(batch, activeQueue, rawBatch)
			: [];

	const hasSourcingPlan = (sourcingPlan?.length ?? 0) > 0;
	const hasAnything =
		batch.gather.length > 0 ||
		batch.build.length > 0 ||
		batch.fromUpstream.length > 0 ||
		batch.surplus.length > 0 ||
		hasSourcingPlan ||
		deposits.length > 0;

	if (!hasAnything) {
		// In global mode the per-batch lists are intentionally empty (the plan is queue-level), so the
		// "fully covered" wording would be misleading -- point the user to the queue-level plan instead.
		return (
			<div className="px-4 py-3 text-xs text-zinc-600">
				{globalMode
					? "Materials are shown in the queue-level plan above (global mode)."
					: "No additional materials -- this batch's inputs are fully covered."}
			</div>
		);
	}

	return (
		<div className="space-y-3 px-4 pb-4">
			{batch.gather.length > 0 && (
				<Subsection title="Gather (raw materials)" count={batch.gather.length}>
					<RawSourceTable items={batch.gather} typeGroups={data.typeGroups} />
				</Subsection>
			)}

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

			{batch.build.length > 0 && (
				<Subsection
					title="Build (derived intermediates)"
					count={batch.build.length}
					hint={buildHint}
				>
					<BuildChoiceTable
						items={batch.build}
						data={data}
						queueId={queueId}
						batchId={batch.batchId}
						queueLocks={recipeLocks}
						batchLocks={batchLocks}
						containers={containers}
						containerJumps={containerJumps}
						batchSourceLocks={batchSourceLocks}
					/>
				</Subsection>
			)}

			{batch.fromUpstream.length > 0 && (
				<Subsection title="From upstream (earlier batches)" count={batch.fromUpstream.length}>
					<table className="w-full text-sm">
						<thead>
							<tr className="border-t border-zinc-800 text-xs text-zinc-500">
								<th className="px-4 py-2 text-left">Item</th>
								<th className="px-4 py-2 text-right">Quantity</th>
								<th className="px-4 py-2 text-right">Volume (m³)</th>
							</tr>
						</thead>
						<tbody>
							{batch.fromUpstream.map((item) => (
								<tr key={item.typeId} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
									<td className="px-4 py-2 text-zinc-200">
										<span className="flex items-center gap-2">
											<ItemIcon typeId={item.typeId} />
											{item.typeName}
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

			{batch.surplus.length > 0 && (
				<Subsection
					title="Surplus (rolls into next batch)"
					count={batch.surplus.length}
					hint="available to later batches"
				>
					<SurplusTable items={batch.surplus} />
				</Subsection>
			)}
		</div>
	);
}
