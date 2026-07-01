// Container sourcing overrides panel -- plan 39 Phase 4b (decision 8).
// One place to see/manage every configured sourcing override: the queue-level container priority
// (sourcesDefault), plus each per-typeId sourceLock (queue + batch scope) and per-job override. An
// override whose typeId / Job.id no longer appears in the resolved plan is ORPHANED -- rendered greyed
// "inactive" and kept (never auto-deleted; it reactivates if its target reappears). A manual clear is
// offered so users can tidy up. Editing the active queue-default uses the shared RowSourceControl.

import { OutputDestControl } from "@/components/buildqueue/OutputDestControl";
import { RowSourceControl } from "@/components/buildqueue/RowSourceControl";
import type { BuildQueue, ContainerRef, ContainerSourceConfig } from "@/lib/buildQueueTypes";
import { type QueueResolveResult, containerRefKey } from "@/lib/queueResolver";
import {
	type ContainerOption,
	batchResolvedTypeIds,
	formatContainerRef,
	resolvedJobIds,
	resolvedTypeIds,
	sourceConfigSummary,
} from "@/lib/sourcingPlan";
import {
	clearBatchSourceLock,
	clearQueueSourceLock,
	setJobOverrides,
	setQueueOutputDefault,
	setQueueSourcesDefault,
} from "@/stores/buildQueueStore";
import { PackageOpen, Trash2 } from "lucide-react";

interface SourceOverridesPanelProps {
	queue: BuildQueue;
	resolved: QueueResolveResult;
	containers: ContainerOption[];
	containerLabels: Map<string, string>;
	/** Gate-jump distance per container (containerRefKey -> jumps) for the source-priority badges. */
	containerJumps?: Map<string, number | undefined>;
	/** Resolve a material/product typeId to a display name (for per-typeId source locks). */
	nameFor: (typeId: number) => string;
	/** Resolve a blueprintId to its product name (for per-job overrides). */
	blueprintName: (blueprintId: number) => string;
}

interface OverrideEntry {
	key: string;
	scope: string;
	title: string;
	sources: ContainerSourceConfig | undefined;
	/** Effective deposit destination set at this scope (raw ref -- rendered + keyed in the Deposit column). */
	outputDest?: ContainerRef;
	/** Projected qty the live plan deposits into `outputDest` for this entry's item(s) (plan 41 B1). */
	depositQty: number;
	active: boolean;
	onClear: () => void;
}

export function SourceOverridesPanel({
	queue,
	resolved,
	containers,
	containerLabels,
	containerJumps,
	nameFor,
	blueprintName,
}: SourceOverridesPanelProps) {
	const activeTypeIds = resolvedTypeIds(resolved);
	const activeJobIds = resolvedJobIds(resolved);

	// The resolver's REAL recorded deposits (plan 41 B1). Aggregate them so each override can show how
	// much output the live plan actually routes into its destination -- a PROJECTED figure, not measured
	// snapshot stock. `depositTotals` (destKey -> qty) feeds the queue picker's "+N projected" badges;
	// `depositByTypeDest` (`typeId|destKey` -> qty) feeds the per-override Deposit column.
	const depositTotals = new Map<string, number>();
	const depositByTypeDest = new Map<string, number>();
	const jobOutputTypeIds = new Map<string, number[]>();
	for (const b of resolved.batches) {
		for (const j of b.jobs) jobOutputTypeIds.set(j.jobId, j.outputs.map((o) => o.typeId));
		for (const rec of b.deposits) {
			const dk = containerRefKey(rec.dest);
			depositTotals.set(dk, (depositTotals.get(dk) ?? 0) + rec.qty);
			const k = `${rec.typeId}|${dk}`;
			depositByTypeDest.set(k, (depositByTypeDest.get(k) ?? 0) + rec.qty);
		}
	}
	for (const rec of resolved.global?.deposits ?? []) {
		const dk = containerRefKey(rec.dest);
		depositTotals.set(dk, (depositTotals.get(dk) ?? 0) + rec.qty);
		const k = `${rec.typeId}|${dk}`;
		depositByTypeDest.set(k, (depositByTypeDest.get(k) ?? 0) + rec.qty);
	}
	const depositQtyForType = (typeId: number, dest: ContainerRef) =>
		depositByTypeDest.get(`${typeId}|${containerRefKey(dest)}`) ?? 0;

	const entries: OverrideEntry[] = [];

	// Queue-scope per-typeId source locks (cascade layer 2).
	for (const lock of queue.sourceLocks ?? []) {
		entries.push({
			key: `queue:${lock.typeId}`,
			scope: "Queue",
			title: nameFor(lock.typeId),
			sources: lock.sources,
			outputDest: lock.outputDest,
			depositQty: lock.outputDest ? depositQtyForType(lock.typeId, lock.outputDest) : 0,
			active: activeTypeIds.has(lock.typeId),
			onClear: () => clearQueueSourceLock(queue.id, lock.typeId),
		});
	}

	// Batch-scope locks (layer 4) + per-job overrides (layer 5).
	for (let bi = 0; bi < queue.batches.length; bi++) {
		const batch = queue.batches[bi];
		const batchLabel = batch.label?.trim() ? batch.label : `Batch ${bi + 1}`;
		const batchTypeIds = batchResolvedTypeIds(resolved, batch.id);
		for (const lock of batch.sourceLocks ?? []) {
			entries.push({
				key: `batch:${batch.id}:${lock.typeId}`,
				scope: batchLabel,
				title: nameFor(lock.typeId),
				sources: lock.sources,
				outputDest: lock.outputDest,
				depositQty: lock.outputDest ? depositQtyForType(lock.typeId, lock.outputDest) : 0,
				active: batchTypeIds.has(lock.typeId),
				onClear: () => clearBatchSourceLock(queue.id, batch.id, lock.typeId),
			});
		}
		for (let ji = 0; ji < batch.jobs.length; ji++) {
			const job = batch.jobs[ji];
			if (!job.overrides) continue;
			// A job's co-products all land in its single effective outputDest (Q5a), keyed by each output
			// typeId -- sum those to report the projected qty this job deposits there.
			const jobDest = job.overrides.outputDest;
			const outIds = jobOutputTypeIds.get(job.id) ?? [];
			entries.push({
				key: `job:${job.id}`,
				scope: batchLabel,
				title: blueprintName(job.blueprintId),
				sources: job.overrides.sources,
				outputDest: jobDest,
				depositQty: jobDest
					? outIds.reduce((sum, t) => sum + depositQtyForType(t, jobDest), 0)
					: 0,
				active: activeJobIds.has(job.id),
				onClear: () => setJobOverrides(queue.id, batch.id, ji, undefined),
			});
		}
	}

	const hasContainers = containers.length > 0;
	if (!hasContainers && entries.length === 0) return null;

	const orphanCount = entries.filter((e) => !e.active).length;

	return (
		<div className="space-y-3 px-4 pb-4 pt-1">
			{hasContainers && (
				<div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
					<span className="font-medium text-zinc-300">Queue container priority</span>
					<RowSourceControl
						containers={containers}
						config={queue.sourcesDefault}
						onChange={(config) => setQueueSourcesDefault(queue.id, config)}
						scopeLabel="the whole queue"
						jumps={containerJumps}
					/>
					<OutputDestControl
						containers={containers}
						value={queue.outputDefault}
						onChange={(ref) => setQueueOutputDefault(queue.id, ref)}
						scopeLabel="the whole queue"
						projected={depositTotals}
					/>
					<span className="text-[11px] text-zinc-600">
						applies to every material unless a narrower scope overrides it
					</span>
				</div>
			)}

			{entries.length > 0 && (
				<div className="overflow-hidden rounded border border-zinc-800 bg-zinc-900/40">
					<div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-400">
						Per-item / per-job overrides
						<span className="text-zinc-600">({entries.length})</span>
						{orphanCount > 0 && (
							<span
								className="ml-auto text-[11px] font-normal text-zinc-500"
								title="Overrides whose target no longer appears in the resolved plan -- kept dormant, never deleted"
							>
								{orphanCount} inactive
							</span>
						)}
					</div>
					<div className="divide-y divide-zinc-800/50">
						{entries.map((entry) => (
							<div
								key={entry.key}
								className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
									entry.active ? "" : "opacity-50"
								}`}
							>
								<span
									className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
										entry.active ? "bg-zinc-800 text-zinc-400" : "bg-zinc-800/60 text-zinc-500"
									}`}
								>
									{entry.scope}
								</span>
								<span className="min-w-0 flex-1 truncate text-zinc-200">{entry.title}</span>
								<span className="shrink-0 text-zinc-500">{sourceConfigSummary(entry.sources)}</span>
								{entry.outputDest && (
									<span
										className="flex shrink-0 items-center gap-1 text-[11px]"
										title="Deposit destination (plan 41) -- the projected quantity the live plan routes here, not measured snapshot stock"
									>
										<PackageOpen size={10} className="text-emerald-500/70" />
										<span className="text-zinc-400">
											{formatContainerRef(entry.outputDest, containerLabels)}
										</span>
										{entry.depositQty > 0 && (
											<span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-300">
												+{entry.depositQty.toLocaleString()} projected
											</span>
										)}
									</span>
								)}
								{entry.active ? (
									<span className="shrink-0 text-[10px] text-emerald-400/80">active</span>
								) : (
									<span
										className="shrink-0 text-[10px] text-zinc-500"
										title="Target no longer in the plan -- kept dormant; reactivates if it reappears"
									>
										inactive
									</span>
								)}
								<button
									type="button"
									onClick={entry.onClear}
									className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-red-400"
									title="Clear this override"
									aria-label="Clear override"
								>
									<Trash2 size={12} />
								</button>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
