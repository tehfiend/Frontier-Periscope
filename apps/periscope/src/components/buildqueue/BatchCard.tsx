// Batch card -- plan 36 (industry-build-queue), Phase 6; Queue / Batch / Job (plan 39).
// One card per build batch: header (drag handle, collapse, editable label, per-batch totals,
// merge/reorder/delete) and body (jobs, add-job search, per-batch materials summary). The card is a
// sortable item in the batches SortableContext (the DndContext lives in BuildQueue); its jobs are a
// nested SortableContext so jobs can be dragged within and between batches. Up/down buttons and the
// per-job move-to-batch dropdown remain as the non-DnD (and keyboard-trivial) fallbacks. Every op
// delegates to the store mutations (reorderBatches / moveJob / mergeBatches / splitBatch / ...).

import { SystemSearch } from "@/components/SystemSearch";
import { BatchMaterials } from "@/components/buildqueue/BatchMaterials";
import { EditableText } from "@/components/buildqueue/EditableText";
import { FacilityPreferencePanel } from "@/components/buildqueue/FacilityPreferencePanel";
import { JobRow } from "@/components/buildqueue/JobRow";
import {
	type BatchRef,
	type QueueBlueprintData,
	batchOpenChoiceCount,
	formatTime,
	formatVolume,
	resolveBlueprintForProduct,
} from "@/components/buildqueue/shared";
import { ProducibleItemSearch } from "@/components/industry/ProducibleItemSearch";
import type { SolarSystem } from "@/db/types";
import type { Batch, BuildQueue, RecipeLockEntry } from "@/lib/buildQueueTypes";
import { type BatchResult, mergeLocks } from "@/lib/queueResolver";
import type { ContainerOption, MaterialSourcingPlan } from "@/lib/sourcingPlan";
import {
	addJob,
	mergeBatches,
	removeBatch,
	reorderBatches,
	setBatchCollapsed,
	setBatchFacilityExclude,
	setBatchLabel,
	setBatchLocation,
} from "@/stores/buildQueueStore";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Clock,
	Combine,
	GitFork,
	GripVertical,
	Layers,
	Trash2,
} from "lucide-react";

interface BatchCardProps {
	queueId: string;
	/** The persisted queue -- threaded to job rows so each can resolve its effective output dest. */
	queue: BuildQueue;
	batch: Batch;
	result: BatchResult | undefined;
	index: number;
	totalBatches: number;
	batches: BatchRef[];
	data: QueueBlueprintData;
	recipeLocks: RecipeLockEntry[];
	/** True when the queue is in global re-optimization mode (per-batch material lists are empty). */
	globalMode: boolean;
	/** Post-solve per-material container allocation for this batch (Phase 4b). */
	sourcingPlan?: MaterialSourcingPlan[];
	/** Selectable containers for the per-row sourcing overrides. */
	containers: ContainerOption[];
	/** containerRefKey -> display label for the sourcing plan + override controls. */
	containerLabels: Map<string, string>;
	/** Gate-jump distance per container (containerRefKey -> jumps) for the source-priority badges. */
	containerJumps?: Map<string, number | undefined>;
	/** Solar systems for the per-batch location picker (plan 41 B4 -- reuses the queue SystemSearch). */
	systems: SolarSystem[];
	/** Solar system id -> display name for source-site details. */
	systemNames?: Map<number, string>;
	/** Per-unit item volume (m3) by typeId -- with haulJumps, costs this batch's sourcing-plan haul (B4). */
	volumeMap: Map<number, number>;
	/** Gate-jumps from THIS batch's location (else the queue) to each container, for the haul readout. */
	haulJumps?: Map<string, number | undefined>;
}

export function BatchCard({
	queueId,
	queue,
	batch,
	result,
	index,
	totalBatches,
	batches,
	data,
	recipeLocks,
	globalMode,
	sourcingPlan,
	containers,
	containerLabels,
	containerJumps,
	systems,
	systemNames,
	volumeMap,
	haulJumps,
}: BatchCardProps) {
	const collapsed = batch.collapsed ?? false;
	const label = batch.label?.trim() ? batch.label : `Batch ${index + 1}`;
	const prevBatchId = index > 0 ? batches[index - 1]?.id : undefined;
	// Queue location this batch inherits when it sets none -- shown as the location picker's placeholder.
	const inheritedSystemId = queue.location?.systemId;
	const effectiveSystemId = batch.location?.systemId ?? inheritedSystemId ?? null;
	const inheritedSystemName =
		inheritedSystemId != null
			? (systems.find((s) => s.id === inheritedSystemId)?.name ?? `#${inheritedSystemId}`)
			: null;
	const effectiveFacilityExclude = batch.facilityExclude ?? queue.facilityExclude ?? [];
	// EFFECTIVE locks (this batch's per-batch overrides on top of the queue-global locks) so the badge
	// counts only inputs still on the optimizer's auto pick after any batch-level steer (F2).
	const mergedLocks = mergeLocks(recipeLocks, batch.recipeLocks);
	const openChoices = result ? batchOpenChoiceCount(result, mergedLocks) : 0;

	// The card is a sortable item; its data lets BuildQueue resolve a batch drop on drag end.
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: batch.id, data: { type: "batch", label } });
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : undefined,
	};

	// Job sortable ids -- stable per batch (blueprintId is unique within a batch).
	const jobIds = batch.jobs.map((j) => `job:${batch.id}:${j.blueprintId}`);

	function handleAddJob(typeId: number) {
		const bpId = resolveBlueprintForProduct(typeId, data);
		if (bpId == null) return;
		addJob(queueId, batch.id, { blueprintId: bpId, runs: 1 });
	}

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`rounded-lg border bg-zinc-900/50 ${isDragging ? "border-cyan-500/50" : "border-zinc-800"}`}
		>
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2.5">
				<button
					type="button"
					ref={setActivatorNodeRef}
					{...attributes}
					{...listeners}
					className="shrink-0 cursor-grab touch-none rounded p-0.5 text-zinc-600 hover:text-zinc-300 active:cursor-grabbing"
					title="Drag to reorder batch"
					aria-label={`Drag to reorder ${label}`}
				>
					<GripVertical size={16} />
				</button>

				<button
					type="button"
					onClick={() => setBatchCollapsed(queueId, batch.id, !collapsed)}
					className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
					title={collapsed ? "Expand batch" : "Collapse batch"}
				>
					{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
				</button>

				<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 text-[11px] font-medium text-zinc-400">
					{index + 1}
				</span>

				<EditableText
					value={label}
					onCommit={(next) => setBatchLabel(queueId, batch.id, next)}
					placeholder="Batch label"
					className="min-w-0 flex-1 truncate text-left text-sm font-medium text-zinc-200 hover:text-cyan-300"
					inputClassName="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-sm font-medium text-zinc-100 focus:border-cyan-500 focus:outline-none"
				/>

				{/* Per-batch totals */}
				<div className="flex shrink-0 items-center gap-3 text-xs text-zinc-500">
					{openChoices > 0 && (
						<span
							className="flex items-center gap-1 text-amber-400"
							title="Producible inputs with more than one recipe are showing the deterministic default -- expand the batch to change them"
						>
							<GitFork size={11} />
							{openChoices} default{openChoices === 1 ? "" : "s"}
						</span>
					)}
					{result && !result.feasible && (
						<span
							className="flex items-center gap-1 text-amber-400"
							title="The optimizer could not find a clean integer plan for this batch"
						>
							<AlertTriangle size={12} />
							infeasible
						</span>
					)}
					<span className="flex items-center gap-1" title="Build time">
						<Clock size={11} />
						{formatTime(result?.time ?? 0)}
					</span>
					<span className="flex items-center gap-1" title="Total material volume">
						<Layers size={11} />
						{formatVolume(result?.volume ?? 0)} m³
					</span>
					<span title="Raw / intermediate item counts">
						{result?.gather.length ?? 0} gather · {result?.build.length ?? 0} build
					</span>
				</div>

				{/* Batch controls */}
				<div className="flex shrink-0 items-center gap-0.5 border-l border-zinc-800 pl-2">
					<button
						type="button"
						disabled={!prevBatchId}
						onClick={() => prevBatchId && mergeBatches(queueId, prevBatchId, batch.id)}
						className="rounded p-1 text-zinc-500 enabled:hover:text-cyan-300 disabled:opacity-30"
						title="Merge into previous batch"
						aria-label="Merge into previous batch"
					>
						<Combine size={14} />
					</button>
					<button
						type="button"
						disabled={index === 0}
						onClick={() => reorderBatches(queueId, index, index - 1)}
						className="rounded p-1 text-zinc-500 enabled:hover:text-zinc-200 disabled:opacity-30"
						title="Move batch up"
						aria-label="Move batch up"
					>
						<ChevronUp size={14} />
					</button>
					<button
						type="button"
						disabled={index === totalBatches - 1}
						onClick={() => reorderBatches(queueId, index, index + 1)}
						className="rounded p-1 text-zinc-500 enabled:hover:text-zinc-200 disabled:opacity-30"
						title="Move batch down"
						aria-label="Move batch down"
					>
						<ChevronDown size={14} />
					</button>
					<button
						type="button"
						onClick={() => removeBatch(queueId, batch.id)}
						className="rounded p-1 text-zinc-600 hover:text-red-400"
						title="Delete batch"
						aria-label="Delete batch"
					>
						<Trash2 size={14} />
					</button>
				</div>
			</div>

			{!collapsed && (
				<div className="border-t border-zinc-800">
					{/* Per-batch location (plan 41 B4) -- overrides the queue location as the distance anchor for
					    this batch's costed haul readout. Inherits the queue location when unset. */}
					<div className="flex items-center gap-2 border-b border-zinc-800/50 px-4 py-2">
						<span className="shrink-0 text-[11px] font-medium text-zinc-500">Location</span>
						<div className="min-w-0 max-w-xs flex-1">
							<SystemSearch
								value={batch.location?.systemId ?? null}
								onChange={(id) =>
									setBatchLocation(queueId, batch.id, id == null ? undefined : { systemId: id })
								}
								systems={systems}
								placeholder={
									inheritedSystemName
										? `Inherits queue: ${inheritedSystemName}`
										: "Set a location for this batch..."
								}
								compact
							/>
						</div>
						<span className="shrink-0 text-[11px] text-zinc-600">
							{batch.location?.systemId != null
								? "haul costed from here"
								: inheritedSystemName
									? "inherits the queue location"
									: "set the queue location to cost haul"}
						</span>
					</div>

					{data.facilityNames.length > 0 && (
						<div className="flex items-center gap-2 border-b border-zinc-800/50 px-4 py-2">
							<span className="shrink-0 text-[11px] font-medium text-zinc-500">Facilities</span>
							<FacilityPreferencePanel
								facilityNames={data.facilityNames}
								value={batch.facilityExclude}
								effectiveExcluded={effectiveFacilityExclude}
								onChange={(excluded) => setBatchFacilityExclude(queueId, batch.id, excluded)}
								scopeLabel="this batch"
								inheritedFromLabel="queue"
								align="left"
							/>
							<span className="shrink-0 text-[11px] text-zinc-600">
								{batch.facilityExclude !== undefined
									? "batch preference set"
									: "inherits the queue preference"}
							</span>
						</div>
					)}

					{/* Jobs */}
					{batch.jobs.length > 0 ? (
						<SortableContext items={jobIds} strategy={verticalListSortingStrategy}>
							<div>
								{batch.jobs.map((job, i) => (
									<JobRow
										key={`job:${batch.id}:${job.blueprintId}`}
										queueId={queueId}
										queue={queue}
										batch={batch}
										batchId={batch.id}
										job={job}
										jobIndex={i}
										jobCount={batch.jobs.length}
										data={data}
										batches={batches}
										containers={containers}
										containerJumps={containerJumps}
									/>
								))}
							</div>
						</SortableContext>
					) : (
						<div className="px-4 py-3 text-xs text-zinc-600">
							No jobs yet -- search below to add the first blueprint, or drag a job here.
						</div>
					)}

					{/* Add job */}
					<div className="border-t border-zinc-800/50 px-4 py-3">
						<ProducibleItemSearch
							producibleItems={data.producibleItems}
							onSelect={(typeId) => handleAddJob(typeId)}
							placeholder="Add a blueprint to this batch..."
						/>
					</div>

					{/* Materials summary */}
					{result && (
						<div className="border-t border-zinc-800/50 pt-3">
							<BatchMaterials
								batch={result}
								queueId={queueId}
								data={data}
								recipeLocks={recipeLocks}
								batchLocks={batch.recipeLocks}
								globalMode={globalMode}
								sourcingPlan={sourcingPlan}
								containers={containers}
								containerLabels={containerLabels}
								containerJumps={containerJumps}
								batchSourceLocks={batch.sourceLocks}
								volumeMap={volumeMap}
								haulJumps={haulJumps}
								sourceSystemId={effectiveSystemId}
								systemNames={systemNames}
							/>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
