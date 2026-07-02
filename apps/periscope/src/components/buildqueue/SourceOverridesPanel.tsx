// Container sourcing overrides panel -- plan 39 Phase 4b (decision 8).
// One place to see/manage every configured sourcing override: the queue-level container priority
// (sourcesDefault), plus each per-typeId sourceLock (queue + order scope) and per-job override. An
// override whose typeId / Job.id no longer appears in the resolved plan is ORPHANED -- rendered greyed
// "inactive" and kept (never auto-deleted; it reactivates if its target reappears). A manual clear is
// offered so users can tidy up. Editing the active queue-default uses the shared RowSourceControl.

import { FacilityPreferencePanel } from "@/components/buildqueue/FacilityPreferencePanel";
import { OutputDestControl } from "@/components/buildqueue/OutputDestControl";
import { RowSourceControl } from "@/components/buildqueue/RowSourceControl";
import type {
	BuildQueue,
	ContainerRef,
	ContainerSourceConfig,
	JobOverrides,
	SourceLockEntry,
} from "@/lib/buildQueueTypes";
import { type QueueResolveResult, containerRefKey } from "@/lib/queueResolver";
import {
	type ContainerOption,
	formatContainerRef,
	orderResolvedTypeIds,
	resolvedJobIds,
	resolvedTypeIds,
	sourceConfigSummary,
} from "@/lib/sourcingPlan";
import {
	clearOrderSourceLock,
	clearQueueSourceLock,
	setJobOverrides,
	setOrderSourceLock,
	setQueueFacilityExclude,
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
	/** All live build facility names from loaded blueprint data. */
	facilityNames: string[];
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
	facilityNames,
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
	for (const b of resolved.orders) {
		for (const j of b.jobs)
			jobOutputTypeIds.set(
				j.jobId,
				j.outputs.map((o) => o.typeId),
			);
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

	// Order-scope locks (layer 4) + per-job overrides (layer 5).
	for (let bi = 0; bi < queue.batches.length; bi++) {
		const order = queue.batches[bi];
		const orderLabel = order.label?.trim() ? order.label : `Order ${bi + 1}`;
		const orderTypeIds = orderResolvedTypeIds(resolved, order.id);
		for (const lock of order.sourceLocks ?? []) {
			const clearOrderSourceOutput = () => {
				const next: SourceLockEntry = {
					...lock,
					sources: undefined,
					outputDest: undefined,
				};
				if (next.facilityExclude !== undefined || next.facilityPick !== undefined) {
					setOrderSourceLock(queue.id, order.id, next);
				} else {
					clearOrderSourceLock(queue.id, order.id, lock.typeId);
				}
			};
			entries.push({
				key: `order:${order.id}:${lock.typeId}`,
				scope: orderLabel,
				title: nameFor(lock.typeId),
				sources: lock.sources,
				outputDest: lock.outputDest,
				depositQty: lock.outputDest ? depositQtyForType(lock.typeId, lock.outputDest) : 0,
				active: orderTypeIds.has(lock.typeId),
				onClear: clearOrderSourceOutput,
			});
		}
		for (let ji = 0; ji < order.jobs.length; ji++) {
			const job = order.jobs[ji];
			if (!job.overrides) continue;
			if (!job.overrides.sources && !job.overrides.outputDest) continue;
			// A job's co-products all land in its single effective outputDest (Q5a), keyed by each output
			// typeId -- sum those to report the projected qty this job deposits there.
			const jobDest = job.overrides.outputDest;
			const clearJobSourceOutput = () => {
				const next: JobOverrides = {
					...job.overrides,
					sources: undefined,
					outputDest: undefined,
				};
				const remaining: JobOverrides = {};
				if (next.facilityExclude !== undefined) remaining.facilityExclude = next.facilityExclude;
				if (next.facilityPick !== undefined) remaining.facilityPick = next.facilityPick;
				const hasRemaining =
					remaining.facilityExclude !== undefined || remaining.facilityPick !== undefined;
				setJobOverrides(queue.id, order.id, ji, hasRemaining ? remaining : undefined);
			};
			const outIds = jobOutputTypeIds.get(job.id) ?? [];
			entries.push({
				key: `job:${job.id}`,
				scope: orderLabel,
				title: blueprintName(job.blueprintId),
				sources: job.overrides.sources,
				outputDest: jobDest,
				depositQty: jobDest ? outIds.reduce((sum, t) => sum + depositQtyForType(t, jobDest), 0) : 0,
				active: activeJobIds.has(job.id),
				onClear: clearJobSourceOutput,
			});
		}
	}

	const hasContainers = containers.length > 0;
	const hasFacilities = facilityNames.length > 0;
	if (!hasContainers && !hasFacilities && entries.length === 0) return null;

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

			{hasFacilities && (
				<div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
					<span className="font-medium text-zinc-300">Queue facility availability</span>
					<FacilityPreferencePanel
						facilityNames={facilityNames}
						value={queue.facilityExclude}
						effectiveExcluded={queue.facilityExclude ?? []}
						onChange={(excluded) => setQueueFacilityExclude(queue.id, excluded)}
						scopeLabel="the whole queue"
					/>
					<span className="text-[11px] text-zinc-600">
						applies to every build unless an order or job replaces it
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
