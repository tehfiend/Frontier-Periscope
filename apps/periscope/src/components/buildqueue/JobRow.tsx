// Job row -- plan 36 (industry-build-queue), Phase 6; Queue / Order / Job (plan 39).
// One job in an order: a drag handle (drag to reorder within / move between orders), blueprint name +
// runs input (-> units), an optional recipe dropdown for the job's own top-level blueprint (only
// when its product has >1 producer), a "split after" control, a move-to-order picker, and a remove
// control. The drag handle is sortable via @dnd-kit (the DndContext lives in BuildQueue); the
// move-to-order <select> stays as the non-DnD grouping fallback. Recipe changes keep the job's
// position via setJobBlueprint. All edits go straight to the buildQueueStore. Every job row is a
// "Target" (authored) production row -- its stable identity is the persisted Job.id.

import { ItemIcon } from "@/components/ItemIcon";
import { FacilityAvailabilityBadge } from "@/components/buildqueue/FacilityPreferencePanel";
import { OutputDestControl } from "@/components/buildqueue/OutputDestControl";
import { RowSourceControl } from "@/components/buildqueue/RowSourceControl";
import {
	type OrderRef,
	type QueueBlueprintData,
	outputPerRun,
} from "@/components/buildqueue/shared";
import {
	RecipeDropdown,
	facilityRecipeLabel,
	formatOptionLabel,
	getFacilityLabel,
	resolveEffectiveFacility,
} from "@/components/industry/RecipeDropdown";
import type {
	BuildQueue,
	ContainerRef,
	ContainerSourceConfig,
	Job,
	JobOverrides,
	Order,
} from "@/lib/buildQueueTypes";
import { resolveEffectiveOverrides } from "@/lib/queueResolver";
import type { ContainerOption } from "@/lib/sourcingPlan";
import {
	moveJob,
	removeJob,
	setJobBlueprint,
	setJobOverrides,
	setJobRuns,
	splitOrder,
} from "@/stores/buildQueueStore";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Scissors, Trash2 } from "lucide-react";

interface JobRowProps {
	queueId: string;
	/** The persisted queue + order -- needed to resolve this job's effective (cascaded) output dest. */
	queue: BuildQueue;
	order: Order;
	orderId: string;
	job: Job;
	jobIndex: number;
	jobCount: number;
	data: QueueBlueprintData;
	orders: OrderRef[];
	/** Selectable containers for the per-job sourcing override (Phase 4b -- Target key = Job.id). */
	containers: ContainerOption[];
	/** Gate-jump distance per container (containerRefKey -> jumps) for the source-priority badges. */
	containerJumps?: Map<string, number | undefined>;
}

export function JobRow({
	queueId,
	queue,
	order,
	orderId,
	job,
	jobIndex,
	jobCount,
	data,
	orders,
	containers,
	containerJumps,
}: JobRowProps) {
	const bp = data.blueprints[String(job.blueprintId)];
	const name = bp?.primaryTypeName ?? `Blueprint #${job.blueprintId}`;
	const productTypeId = bp?.primaryTypeID;
	const producers = productTypeId != null ? (data.outputToBlueprints.get(productTypeId) ?? []) : [];
	const optionCount = producers.reduce(
		(sum, producer) =>
			sum + Math.max(1, (data.blueprintFacilities.get(producer.blueprintID) ?? []).length),
		0,
	);
	const units = job.runs * outputPerRun(bp);
	const facilityNames = bp ? (data.blueprintFacilities.get(bp.blueprintID) ?? []) : [];

	// Sortable: stable id within the DndContext (blueprintId is unique within an order, so this never
	// collides across orders). data lets BuildQueue resolve the move on drag end without a closure.
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: `job:${orderId}:${job.blueprintId}`,
		data: { type: "job", orderId, jobIndex, blueprintId: job.blueprintId, name },
	});
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : undefined,
	};

	function persistOverrides(next: JobOverrides) {
		const hasOverrides =
			next.sources ||
			next.outputDest ||
			next.facilityExclude !== undefined ||
			next.facilityPick !== undefined;
		setJobOverrides(queueId, orderId, jobIndex, hasOverrides ? next : undefined);
	}

	function handleRecipeFacilitySelect(bpId: number, facility: string | undefined) {
		if (bpId !== job.blueprintId) setJobBlueprint(queueId, orderId, jobIndex, bpId);
		persistOverrides({ ...job.overrides, facilityPick: facility });
	}

	function handleFacilityReset() {
		persistOverrides({ ...job.overrides, facilityPick: undefined });
	}

	// Per-job sourcing override (cascade layer 5 -- keyed by Job.id). Preserve any output destination.
	function handleSourcesChange(sources: ContainerSourceConfig | undefined) {
		const next: JobOverrides = { ...job.overrides, sources };
		persistOverrides(next);
	}

	// Per-job deposit destination (cascade layer 5). Live as of plan 41 B1 -- the job's leftover outputs
	// land in this container in the carry-forward pool, so later orders source them from named storage.
	// Preserve any sourcing override already on the job.
	function handleOutputChange(outputDest: ContainerRef | undefined) {
		const next: JobOverrides = { ...job.overrides, outputDest };
		persistOverrides(next);
	}

	// The cascade-resolved deposit destination for this job (queue/order defaults + per-typeId locks +
	// this job's own override). Shown as the inherited hint when the job sets nothing itself.
	const effectiveOverrides =
		productTypeId != null
			? resolveEffectiveOverrides(queue, order, productTypeId, job.overrides)
			: undefined;
	const effectiveOutput = effectiveOverrides?.outputDest;
	const effectiveExcludedFacilities = effectiveOverrides?.excludedFacilities ?? [];
	const excludedSet = new Set(effectiveExcludedFacilities);
	const pick = job.overrides?.facilityPick;

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
				title="Drag to reorder or move to another order"
				aria-label={`Drag to move ${name}`}
			>
				<GripVertical size={14} />
			</button>

			<span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-zinc-200">
				{productTypeId != null && <ItemIcon typeId={productTypeId} size={24} />}
				<span className="truncate">{name}</span>
				<span
					className="shrink-0 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
					title="Authored job -- a Target build you added to this order"
				>
					Target
				</span>
			</span>

			{optionCount > 1 && productTypeId != null ? (
				<RecipeDropdown
					typeId={productTypeId}
					producers={producers}
					currentBpId={job.blueprintId}
					isOverridden={false}
					onSelect={handleRecipeFacilitySelect}
					formatOptionLabel={(b, typeId) => formatOptionLabel(b, typeId, data.blueprintFacilities)}
					getFacilityLabel={(b) => getFacilityLabel(b, data.blueprintFacilities)}
					blueprintFacilities={data.blueprintFacilities}
					excludedFacilities={effectiveExcludedFacilities}
					pick={pick}
					onResetFacility={handleFacilityReset}
				/>
			) : (
				bp && (
					<span
						className="shrink-0 truncate rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-500"
						title={`Recipe: ${formatOptionLabel(bp, bp.primaryTypeID, data.blueprintFacilities)}`}
					>
						{facilityRecipeLabel(bp, resolveEffectiveFacility(facilityNames, excludedSet, pick))}
					</span>
				)
			)}

			<FacilityAvailabilityBadge
				facilityNames={facilityNames}
				excludedFacilities={effectiveExcludedFacilities}
			/>

			<RowSourceControl
				containers={containers}
				config={job.overrides?.sources}
				onChange={handleSourcesChange}
				scopeLabel="this job"
				jumps={containerJumps}
				note="Per-job source priority is recorded. The live plan still sources raw materials by the queue/order container priority, not per job."
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
						setJobRuns(queueId, orderId, jobIndex, Number.parseInt(e.target.value) || 1)
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
					onClick={() => splitOrder(queueId, orderId, jobIndex)}
					className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-cyan-300"
					title="Split into a new order after this job"
					aria-label="Split order after this job"
				>
					<Scissors size={14} />
				</button>
			)}

			{orders.length > 1 && (
				<select
					value={orderId}
					onChange={(e) => moveJob(queueId, orderId, jobIndex, e.target.value)}
					className="max-w-[8rem] rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400 focus:border-violet-600 focus:outline-none"
					title="Move job to another order"
				>
					{orders.map((b) => (
						<option key={b.id} value={b.id}>
							{b.label}
						</option>
					))}
				</select>
			)}

			<button
				type="button"
				onClick={() => removeJob(queueId, orderId, jobIndex)}
				className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-red-400"
				title="Remove job"
			>
				<Trash2 size={14} />
			</button>
		</div>
	);
}
