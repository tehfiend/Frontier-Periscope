// Step card -- plan 36 (industry-build-queue), Phase 6.
// One card per build step: header (drag handle, collapse, editable label, per-step totals,
// merge/reorder/delete) and body (jobs, add-job search, per-step materials summary). The card is a
// sortable item in the steps SortableContext (the DndContext lives in BuildQueue); its jobs are a
// nested SortableContext so jobs can be dragged within and between steps. Up/down buttons and the
// per-job move-to-step dropdown remain as the non-DnD (and keyboard-trivial) fallbacks. Every op
// delegates to the store mutations (reorderSteps / moveJob / mergeSteps / splitStep / ...).

import { EditableText } from "@/components/buildqueue/EditableText";
import { JobRow } from "@/components/buildqueue/JobRow";
import { StepMaterials } from "@/components/buildqueue/StepMaterials";
import {
	type QueueBlueprintData,
	type StepRef,
	formatTime,
	formatVolume,
	resolveBlueprintForProduct,
	stepOpenChoiceCount,
} from "@/components/buildqueue/shared";
import { ProducibleItemSearch } from "@/components/industry/ProducibleItemSearch";
import type { BuildStep, RecipeLockEntry } from "@/lib/buildQueueTypes";
import { type StepResult, mergeLocks } from "@/lib/queueResolver";
import type { SourcePref } from "@/lib/sourcePrefs";
import {
	addJob,
	mergeSteps,
	removeStep,
	reorderSteps,
	setStepCollapsed,
	setStepLabel,
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

interface StepCardProps {
	queueId: string;
	step: BuildStep;
	result: StepResult | undefined;
	index: number;
	totalSteps: number;
	steps: StepRef[];
	data: QueueBlueprintData;
	recipeLocks: RecipeLockEntry[];
	sourcePrefs: Record<string, SourcePref>;
	/** True when the queue is in global re-optimization mode (per-step material lists are empty). */
	globalMode: boolean;
}

export function StepCard({
	queueId,
	step,
	result,
	index,
	totalSteps,
	steps,
	data,
	recipeLocks,
	sourcePrefs,
	globalMode,
}: StepCardProps) {
	const collapsed = step.collapsed ?? false;
	const label = step.label?.trim() ? step.label : `Step ${index + 1}`;
	const prevStepId = index > 0 ? steps[index - 1]?.id : undefined;
	// EFFECTIVE locks (this step's per-step overrides on top of the queue-global locks) so the badge
	// counts only inputs still on the optimizer's auto pick after any step-level steer (F2).
	const mergedLocks = mergeLocks(recipeLocks, step.recipeLocks);
	const openChoices = result ? stepOpenChoiceCount(result, mergedLocks) : 0;

	// The card is a sortable item; its data lets BuildQueue resolve a step drop on drag end.
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
		useSortable({ id: step.id, data: { type: "step", label } });
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : undefined,
	};

	// Job sortable ids -- stable per step (blueprintId is unique within a step).
	const jobIds = step.jobs.map((j) => `job:${step.id}:${j.blueprintId}`);

	function handleAddJob(typeId: number) {
		const bpId = resolveBlueprintForProduct(typeId, data);
		if (bpId == null) return;
		addJob(queueId, step.id, { blueprintId: bpId, runs: 1 });
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
					title="Drag to reorder step"
					aria-label={`Drag to reorder ${label}`}
				>
					<GripVertical size={16} />
				</button>

				<button
					type="button"
					onClick={() => setStepCollapsed(queueId, step.id, !collapsed)}
					className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
					title={collapsed ? "Expand step" : "Collapse step"}
				>
					{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
				</button>

				<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 text-[11px] font-medium text-zinc-400">
					{index + 1}
				</span>

				<EditableText
					value={label}
					onCommit={(next) => setStepLabel(queueId, step.id, next)}
					placeholder="Step label"
					className="min-w-0 flex-1 truncate text-left text-sm font-medium text-zinc-200 hover:text-cyan-300"
					inputClassName="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-sm font-medium text-zinc-100 focus:border-cyan-500 focus:outline-none"
				/>

				{/* Per-step totals */}
				<div className="flex shrink-0 items-center gap-3 text-xs text-zinc-500">
					{openChoices > 0 && (
						<span
							className="flex items-center gap-1 text-amber-400"
							title="Producible inputs with more than one recipe still on the optimizer's auto pick -- expand the step to choose"
						>
							<GitFork size={11} />
							{openChoices} choice{openChoices === 1 ? "" : "s"}
						</span>
					)}
					{result && !result.feasible && (
						<span
							className="flex items-center gap-1 text-amber-400"
							title="The optimizer could not find a clean integer plan for this step"
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

				{/* Step controls */}
				<div className="flex shrink-0 items-center gap-0.5 border-l border-zinc-800 pl-2">
					<button
						type="button"
						disabled={!prevStepId}
						onClick={() => prevStepId && mergeSteps(queueId, prevStepId, step.id)}
						className="rounded p-1 text-zinc-500 enabled:hover:text-cyan-300 disabled:opacity-30"
						title="Merge into previous step"
						aria-label="Merge into previous step"
					>
						<Combine size={14} />
					</button>
					<button
						type="button"
						disabled={index === 0}
						onClick={() => reorderSteps(queueId, index, index - 1)}
						className="rounded p-1 text-zinc-500 enabled:hover:text-zinc-200 disabled:opacity-30"
						title="Move step up"
						aria-label="Move step up"
					>
						<ChevronUp size={14} />
					</button>
					<button
						type="button"
						disabled={index === totalSteps - 1}
						onClick={() => reorderSteps(queueId, index, index + 1)}
						className="rounded p-1 text-zinc-500 enabled:hover:text-zinc-200 disabled:opacity-30"
						title="Move step down"
						aria-label="Move step down"
					>
						<ChevronDown size={14} />
					</button>
					<button
						type="button"
						onClick={() => removeStep(queueId, step.id)}
						className="rounded p-1 text-zinc-600 hover:text-red-400"
						title="Delete step"
						aria-label="Delete step"
					>
						<Trash2 size={14} />
					</button>
				</div>
			</div>

			{!collapsed && (
				<div className="border-t border-zinc-800">
					{/* Jobs */}
					{step.jobs.length > 0 ? (
						<SortableContext items={jobIds} strategy={verticalListSortingStrategy}>
							<div>
								{step.jobs.map((job, i) => (
									<JobRow
										key={`job:${step.id}:${job.blueprintId}`}
										queueId={queueId}
										stepId={step.id}
										job={job}
										jobIndex={i}
										jobCount={step.jobs.length}
										data={data}
										steps={steps}
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
							placeholder="Add a blueprint to this step..."
						/>
					</div>

					{/* Materials summary */}
					{result && (
						<div className="border-t border-zinc-800/50 pt-3">
							<StepMaterials
								step={result}
								queueId={queueId}
								data={data}
								recipeLocks={recipeLocks}
								stepLocks={step.recipeLocks}
								sourcePrefs={sourcePrefs}
								globalMode={globalMode}
							/>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
