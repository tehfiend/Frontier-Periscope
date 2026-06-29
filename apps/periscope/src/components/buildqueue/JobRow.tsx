// Job row -- plan 36 (industry-build-queue), Phase 6.
// One job in a step: a drag handle (drag to reorder within / move between steps), blueprint name +
// runs input (-> units), an optional recipe dropdown for the job's own top-level blueprint (only
// when its product has >1 producer), a "split after" control, a move-to-step picker, and a remove
// control. The drag handle is sortable via @dnd-kit (the DndContext lives in BuildQueue); the
// move-to-step <select> stays as the non-DnD grouping fallback. Recipe changes keep the job's
// position via setJobBlueprint. All edits go straight to the buildQueueStore.

import { ItemIcon } from "@/components/ItemIcon";
import {
	type QueueBlueprintData,
	type StepRef,
	outputPerRun,
} from "@/components/buildqueue/shared";
import {
	RecipeDropdown,
	formatOptionLabel,
	getFacilityLabel,
} from "@/components/industry/RecipeDropdown";
import type { BuildJob } from "@/lib/buildQueueTypes";
import { moveJob, removeJob, setJobBlueprint, setJobRuns, splitStep } from "@/stores/buildQueueStore";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Scissors, Trash2 } from "lucide-react";

interface JobRowProps {
	queueId: string;
	stepId: string;
	job: BuildJob;
	jobIndex: number;
	jobCount: number;
	data: QueueBlueprintData;
	steps: StepRef[];
}

export function JobRow({ queueId, stepId, job, jobIndex, jobCount, data, steps }: JobRowProps) {
	const bp = data.blueprints[String(job.blueprintId)];
	const name = bp?.primaryTypeName ?? `Blueprint #${job.blueprintId}`;
	const productTypeId = bp?.primaryTypeID;
	const producers = productTypeId != null ? (data.outputToBlueprints.get(productTypeId) ?? []) : [];
	const hasMultiple = producers.length > 1;
	const units = job.runs * outputPerRun(bp);

	// Sortable: stable id within the DndContext (blueprintId is unique within a step, so this never
	// collides across steps). data lets BuildQueue resolve the move on drag end without a closure.
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
		useSortable({
			id: `job:${stepId}:${job.blueprintId}`,
			data: { type: "job", stepId, jobIndex, blueprintId: job.blueprintId, name },
		});
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : undefined,
	};

	function changeBlueprint(newBpId: number) {
		if (newBpId === job.blueprintId) return;
		// Swap the top-level recipe in place (setJobBlueprint preserves position + runs).
		setJobBlueprint(queueId, stepId, jobIndex, newBpId);
	}

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
				title="Drag to reorder or move to another step"
				aria-label={`Drag to move ${name}`}
			>
				<GripVertical size={14} />
			</button>

			<span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-zinc-200">
				{productTypeId != null && <ItemIcon typeId={productTypeId} size={24} />}
				<span className="truncate">{name}</span>
			</span>

			{hasMultiple && productTypeId != null && (
				<RecipeDropdown
					typeId={productTypeId}
					producers={producers}
					currentBpId={job.blueprintId}
					isOverridden={false}
					outputToBlueprints={data.outputToBlueprints}
					rawMaterialIds={data.rawMaterialIds}
					salvageMaterialIds={data.salvageMaterialIds}
					onSelect={changeBlueprint}
					formatOptionLabel={(b, typeId) => formatOptionLabel(b, typeId, data.blueprintFacilities)}
					getFacilityLabel={(b) => getFacilityLabel(b, data.blueprintFacilities)}
				/>
			)}

			<label className="flex items-center gap-1 text-xs text-zinc-500">
				<span>runs</span>
				<input
					type="number"
					min={1}
					value={job.runs}
					onChange={(e) => setJobRuns(queueId, stepId, jobIndex, Number.parseInt(e.target.value) || 1)}
					className="w-16 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-center text-xs text-zinc-100 focus:border-violet-600 focus:outline-none"
				/>
			</label>
			<span className="w-24 text-right font-mono text-xs text-zinc-500" title="Output units">
				{units.toLocaleString()} units
			</span>

			{jobIndex < jobCount - 1 && (
				<button
					type="button"
					onClick={() => splitStep(queueId, stepId, jobIndex)}
					className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-cyan-300"
					title="Split into a new step after this job"
					aria-label="Split step after this job"
				>
					<Scissors size={14} />
				</button>
			)}

			{steps.length > 1 && (
				<select
					value={stepId}
					onChange={(e) => moveJob(queueId, stepId, jobIndex, e.target.value)}
					className="max-w-[8rem] rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400 focus:border-violet-600 focus:outline-none"
					title="Move job to another step"
				>
					{steps.map((s) => (
						<option key={s.id} value={s.id}>
							{s.label}
						</option>
					))}
				</select>
			)}

			<button
				type="button"
				onClick={() => removeJob(queueId, stepId, jobIndex)}
				className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-red-400"
				title="Remove job"
			>
				<Trash2 size={14} />
			</button>
		</div>
	);
}
