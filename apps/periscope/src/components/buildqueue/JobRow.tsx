// Job row -- plan 36 (industry-build-queue), Phase 6; Queue / Batch / Job (plan 39).
// One job in a batch: a drag handle (drag to reorder within / move between batches), blueprint name +
// runs input (-> units), an optional recipe dropdown for the job's own top-level blueprint (only
// when its product has >1 producer), a "split after" control, a move-to-batch picker, and a remove
// control. The drag handle is sortable via @dnd-kit (the DndContext lives in BuildQueue); the
// move-to-batch <select> stays as the non-DnD grouping fallback. Recipe changes keep the job's
// position via setJobBlueprint. All edits go straight to the buildQueueStore. Every job row is a
// "Target" (authored) production row -- its stable identity is the persisted Job.id.

import { ItemIcon } from "@/components/ItemIcon";
import { OutputDestControl } from "@/components/buildqueue/OutputDestControl";
import { RowSourceControl } from "@/components/buildqueue/RowSourceControl";
import {
	type BatchRef,
	type QueueBlueprintData,
	outputPerRun,
} from "@/components/buildqueue/shared";
import {
	RecipeDropdown,
	formatOptionLabel,
	getFacilityLabel,
} from "@/components/industry/RecipeDropdown";
import type {
	Batch,
	BuildQueue,
	ContainerRef,
	ContainerSourceConfig,
	Job,
	JobOverrides,
} from "@/lib/buildQueueTypes";
import { resolveEffectiveOverrides } from "@/lib/queueResolver";
import type { ContainerOption } from "@/lib/sourcingPlan";
import {
	moveJob,
	removeJob,
	setJobBlueprint,
	setJobOverrides,
	setJobRuns,
	splitBatch,
} from "@/stores/buildQueueStore";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Scissors, Trash2 } from "lucide-react";

interface JobRowProps {
	queueId: string;
	/** The persisted queue + batch -- needed to resolve this job's effective (cascaded) output dest. */
	queue: BuildQueue;
	batch: Batch;
	batchId: string;
	job: Job;
	jobIndex: number;
	jobCount: number;
	data: QueueBlueprintData;
	batches: BatchRef[];
	/** Selectable containers for the per-job sourcing override (Phase 4b -- Target key = Job.id). */
	containers: ContainerOption[];
	/** Gate-jump distance per container (containerRefKey -> jumps) for the source-priority badges. */
	containerJumps?: Map<string, number | undefined>;
}

export function JobRow({
	queueId,
	queue,
	batch,
	batchId,
	job,
	jobIndex,
	jobCount,
	data,
	batches,
	containers,
	containerJumps,
}: JobRowProps) {
	const bp = data.blueprints[String(job.blueprintId)];
	const name = bp?.primaryTypeName ?? `Blueprint #${job.blueprintId}`;
	const productTypeId = bp?.primaryTypeID;
	const producers = productTypeId != null ? (data.outputToBlueprints.get(productTypeId) ?? []) : [];
	const hasMultiple = producers.length > 1;
	const units = job.runs * outputPerRun(bp);

	// Sortable: stable id within the DndContext (blueprintId is unique within a batch, so this never
	// collides across batches). data lets BuildQueue resolve the move on drag end without a closure.
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: `job:${batchId}:${job.blueprintId}`,
		data: { type: "job", batchId, jobIndex, blueprintId: job.blueprintId, name },
	});
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : undefined,
	};

	function changeBlueprint(newBpId: number) {
		if (newBpId === job.blueprintId) return;
		// Swap the top-level recipe in place (setJobBlueprint preserves position + runs).
		setJobBlueprint(queueId, batchId, jobIndex, newBpId);
	}

	// Per-job sourcing override (cascade layer 5 -- keyed by Job.id). Preserve any output destination.
	function handleSourcesChange(sources: ContainerSourceConfig | undefined) {
		const next: JobOverrides = { ...job.overrides, sources };
		setJobOverrides(queueId, batchId, jobIndex, next.sources || next.outputDest ? next : undefined);
	}

	// Per-job deposit destination (cascade layer 5). Live as of plan 41 B1 -- the job's leftover outputs
	// land in this container in the carry-forward pool, so later batches source them from named storage.
	// Preserve any sourcing override already on the job.
	function handleOutputChange(outputDest: ContainerRef | undefined) {
		const next: JobOverrides = { ...job.overrides, outputDest };
		setJobOverrides(queueId, batchId, jobIndex, next.sources || next.outputDest ? next : undefined);
	}

	// The cascade-resolved deposit destination for this job (queue/batch defaults + per-typeId locks +
	// this job's own override). Shown as the inherited hint when the job sets nothing itself.
	const effectiveOutput =
		productTypeId != null
			? resolveEffectiveOverrides(queue, batch, productTypeId, job.overrides).outputDest
			: undefined;

	return (
		<div
			ref={setNodeRef}
			style={style}
			className="flex items-center gap-2 border-t border-zinc-800/50 px-4 py-2 first:border-t-0 hover:bg-zinc-800/30"
		>
			<button
				type="button"
				ref={setActivatorNodeRef}
				{...attributes}
				{...listeners}
				className="shrink-0 cursor-grab touch-none rounded p-0.5 text-zinc-600 hover:text-zinc-300 active:cursor-grabbing"
				title="Drag to reorder or move to another batch"
				aria-label={`Drag to move ${name}`}
			>
				<GripVertical size={14} />
			</button>

			<span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-zinc-200">
				{productTypeId != null && <ItemIcon typeId={productTypeId} size={24} />}
				<span className="truncate">{name}</span>
				<span
					className="shrink-0 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
					title="Authored job -- a Target build you added to this batch"
				>
					Target
				</span>
			</span>

			{hasMultiple && productTypeId != null ? (
				<RecipeDropdown
					typeId={productTypeId}
					producers={producers}
					currentBpId={job.blueprintId}
					isOverridden={false}
					onSelect={changeBlueprint}
					formatOptionLabel={(b, typeId) => formatOptionLabel(b, typeId, data.blueprintFacilities)}
					getFacilityLabel={(b) => getFacilityLabel(b, data.blueprintFacilities)}
				/>
			) : (
				bp && (
					<span
						className="shrink-0 truncate rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-500"
						title={`Recipe: ${formatOptionLabel(bp, bp.primaryTypeID, data.blueprintFacilities)}`}
					>
						{getFacilityLabel(bp, data.blueprintFacilities)}
					</span>
				)
			)}

			<RowSourceControl
				containers={containers}
				config={job.overrides?.sources}
				onChange={handleSourcesChange}
				scopeLabel="this job"
				jumps={containerJumps}
				note="Per-job source priority is recorded. The live plan still sources raw materials by the queue/batch container priority, not per job."
			/>

			<OutputDestControl
				containers={containers}
				value={job.overrides?.outputDest}
				onChange={handleOutputChange}
				effective={effectiveOutput}
				scopeLabel="this job"
			/>

			<label className="flex items-center gap-1 text-xs text-zinc-500">
				<span>runs</span>
				<input
					type="number"
					min={1}
					value={job.runs}
					onChange={(e) =>
						setJobRuns(queueId, batchId, jobIndex, Number.parseInt(e.target.value) || 1)
					}
					className="w-16 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-center text-xs text-zinc-100 focus:border-violet-600 focus:outline-none"
				/>
			</label>
			<span className="w-24 text-right font-mono text-xs text-zinc-500" title="Output units">
				{units.toLocaleString()} units
			</span>

			{jobIndex < jobCount - 1 && (
				<button
					type="button"
					onClick={() => splitBatch(queueId, batchId, jobIndex)}
					className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-cyan-300"
					title="Split into a new batch after this job"
					aria-label="Split batch after this job"
				>
					<Scissors size={14} />
				</button>
			)}

			{batches.length > 1 && (
				<select
					value={batchId}
					onChange={(e) => moveJob(queueId, batchId, jobIndex, e.target.value)}
					className="max-w-[8rem] rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400 focus:border-violet-600 focus:outline-none"
					title="Move job to another batch"
				>
					{batches.map((b) => (
						<option key={b.id} value={b.id}>
							{b.label}
						</option>
					))}
				</select>
			)}

			<button
				type="button"
				onClick={() => removeJob(queueId, batchId, jobIndex)}
				className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-red-400"
				title="Remove job"
			>
				<Trash2 size={14} />
			</button>
		</div>
	);
}
