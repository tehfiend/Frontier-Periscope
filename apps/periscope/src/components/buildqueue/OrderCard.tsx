// Order card -- plan 36 (industry-build-queue), Phase 6; Queue / Order / Job (plan 39).
// One card per build order: header (drag handle, collapse, editable label, per-order totals,
// merge/reorder/delete) and body (jobs, add-job search, per-order materials summary). The card is a
// sortable item in the orders SortableContext (the DndContext lives in BuildQueue); its jobs are a
// nested SortableContext so jobs can be dragged within and between orders. Up/down buttons and the
// per-job move-to-order dropdown remain as the non-DnD (and keyboard-trivial) fallbacks. Every op
// delegates to the store mutations (reorderOrders / moveJob / mergeOrders / splitOrder / ...).

import { SystemSearch } from "@/components/SystemSearch";
import { EditableText } from "@/components/buildqueue/EditableText";
import { FacilityPreferencePanel } from "@/components/buildqueue/FacilityPreferencePanel";
import { JobRow } from "@/components/buildqueue/JobRow";
import { OrderMaterials } from "@/components/buildqueue/OrderMaterials";
import {
	type OrderRef,
	type QueueBlueprintData,
	formatTime,
	formatVolume,
	orderOpenChoiceCount,
	resolveBlueprintForProduct,
} from "@/components/buildqueue/shared";
import { ProducibleItemSearch } from "@/components/industry/ProducibleItemSearch";
import type { SolarSystem } from "@/db/types";
import type { BuildQueue, Order, RecipeLockEntry } from "@/lib/buildQueueTypes";
import { type OrderResult, mergeLocks } from "@/lib/queueResolver";
import type { ContainerOption, MaterialSourcingPlan } from "@/lib/sourcingPlan";
import {
	addJob,
	mergeOrders,
	removeOrder,
	reorderOrders,
	setOrderCollapsed,
	setOrderFacilityExclude,
	setOrderLabel,
	setOrderLocation,
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

interface OrderCardProps {
	queueId: string;
	/** The persisted queue -- threaded to job rows so each can resolve its effective output dest. */
	queue: BuildQueue;
	order: Order;
	result: OrderResult | undefined;
	index: number;
	totalOrders: number;
	orders: OrderRef[];
	data: QueueBlueprintData;
	recipeLocks: RecipeLockEntry[];
	/** True when the queue is in global re-optimization mode (per-order material lists are empty). */
	globalMode: boolean;
	/** Post-solve per-material container allocation for this order (Phase 4b). */
	sourcingPlan?: MaterialSourcingPlan[];
	/** Selectable containers for the per-row sourcing overrides. */
	containers: ContainerOption[];
	/** containerRefKey -> display label for the sourcing plan + override controls. */
	containerLabels: Map<string, string>;
	/** Gate-jump distance per container (containerRefKey -> jumps) for the source-priority badges. */
	containerJumps?: Map<string, number | undefined>;
	/** Solar systems for the per-order location picker (plan 41 B4 -- reuses the queue SystemSearch). */
	systems: SolarSystem[];
	/** Solar system id -> display name for source-site details. */
	systemNames?: Map<number, string>;
	/** Per-unit item volume (m3) by typeId -- with haulJumps, costs this order's sourcing-plan haul (B4). */
	volumeMap: Map<number, number>;
	/** Gate-jumps from THIS order's location (else the queue) to each container, for the haul readout. */
	haulJumps?: Map<string, number | undefined>;
}

export function OrderCard({
	queueId,
	queue,
	order,
	result,
	index,
	totalOrders,
	orders,
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
}: OrderCardProps) {
	const collapsed = order.collapsed ?? false;
	const label = order.label?.trim() ? order.label : `Order ${index + 1}`;
	const prevOrderId = index > 0 ? orders[index - 1]?.id : undefined;
	// Queue location this order inherits when it sets none -- shown as the location picker's placeholder.
	const inheritedSystemId = queue.location?.systemId;
	const effectiveSystemId = order.location?.systemId ?? inheritedSystemId ?? null;
	const inheritedSystemName =
		inheritedSystemId != null
			? (systems.find((s) => s.id === inheritedSystemId)?.name ?? `#${inheritedSystemId}`)
			: null;
	const effectiveFacilityExclude = order.facilityExclude ?? queue.facilityExclude ?? [];
	// EFFECTIVE locks (this order's per-order overrides on top of the queue-global locks) so the badge
	// counts only inputs still on the optimizer's auto pick after any order-level steer (F2).
	const mergedLocks = mergeLocks(recipeLocks, order.recipeLocks);
	const openChoices = result ? orderOpenChoiceCount(result, mergedLocks) : 0;

	// The card is a sortable item; its data lets BuildQueue resolve an order drop on drag end.
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: order.id, data: { type: "order", label } });
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : undefined,
	};

	// Job sortable ids -- stable per order (blueprintId is unique within an order).
	const jobIds = order.jobs.map((j) => `job:${order.id}:${j.blueprintId}`);

	function handleAddJob(typeId: number) {
		const bpId = resolveBlueprintForProduct(typeId, data);
		if (bpId == null) return;
		addJob(queueId, order.id, { blueprintId: bpId, runs: 1 });
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
					title="Drag to reorder sequence"
					aria-label={`Drag to reorder ${label}`}
				>
					<GripVertical size={16} />
				</button>

				<button
					type="button"
					onClick={() => setOrderCollapsed(queueId, order.id, !collapsed)}
					className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
					title={collapsed ? "Expand order" : "Collapse order"}
				>
					{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
				</button>

				<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 text-[11px] font-medium text-zinc-400">
					{index + 1}
				</span>

				<EditableText
					value={label}
					onCommit={(next) => setOrderLabel(queueId, order.id, next)}
					placeholder="Order label"
					className="min-w-0 flex-1 truncate text-left text-sm font-medium text-zinc-200 hover:text-cyan-300"
					inputClassName="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-sm font-medium text-zinc-100 focus:border-cyan-500 focus:outline-none"
				/>

				{/* Per-Order totals */}
				<div className="flex shrink-0 items-center gap-3 text-xs text-zinc-500">
					{openChoices > 0 && (
						<span
							className="flex items-center gap-1 text-amber-400"
							title="Producible inputs with more than one recipe are showing the deterministic default -- expand the order to change them"
						>
							<GitFork size={11} />
							{openChoices} default{openChoices === 1 ? "" : "s"}
						</span>
					)}
					{result && !result.feasible && (
						<span
							className="flex items-center gap-1 text-amber-400"
							title="The optimizer could not find a clean integer plan for this order"
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

				{/* Order controls */}
				<div className="flex shrink-0 items-center gap-0.5 border-l border-zinc-800 pl-2">
					<button
						type="button"
						disabled={!prevOrderId}
						onClick={() => prevOrderId && mergeOrders(queueId, prevOrderId, order.id)}
						className="rounded p-1 text-zinc-500 enabled:hover:text-cyan-300 disabled:opacity-30"
						title="Merge into previous order"
						aria-label="Merge into previous order"
					>
						<Combine size={14} />
					</button>
					<button
						type="button"
						disabled={index === 0}
						onClick={() => reorderOrders(queueId, index, index - 1)}
						className="rounded p-1 text-zinc-500 enabled:hover:text-zinc-200 disabled:opacity-30"
						title="Move order up"
						aria-label="Move order up"
					>
						<ChevronUp size={14} />
					</button>
					<button
						type="button"
						disabled={index === totalOrders - 1}
						onClick={() => reorderOrders(queueId, index, index + 1)}
						className="rounded p-1 text-zinc-500 enabled:hover:text-zinc-200 disabled:opacity-30"
						title="Move order down"
						aria-label="Move order down"
					>
						<ChevronDown size={14} />
					</button>
					<button
						type="button"
						onClick={() => removeOrder(queueId, order.id)}
						className="rounded p-1 text-zinc-600 hover:text-red-400"
						title="Delete order"
						aria-label="Delete order"
					>
						<Trash2 size={14} />
					</button>
				</div>
			</div>

			{!collapsed && (
				<div className="border-t border-zinc-800">
					{/* Per-Order location (plan 41 B4) -- overrides the queue location as the distance anchor for
					    this order's costed haul readout. Inherits the queue location when unset. */}
					<div className="flex items-center gap-2 border-b border-zinc-800/50 px-4 py-2">
						<span className="shrink-0 text-[11px] font-medium text-zinc-500">Location</span>
						<div className="min-w-0 max-w-xs flex-1">
							<SystemSearch
								value={order.location?.systemId ?? null}
								onChange={(id) =>
									setOrderLocation(queueId, order.id, id == null ? undefined : { systemId: id })
								}
								systems={systems}
								placeholder={
									inheritedSystemName
										? `Inherits queue: ${inheritedSystemName}`
										: "Set a location for this order..."
								}
								compact
							/>
						</div>
						<span className="shrink-0 text-[11px] text-zinc-600">
							{order.location?.systemId != null
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
								value={order.facilityExclude}
								effectiveExcluded={effectiveFacilityExclude}
								onChange={(excluded) => setOrderFacilityExclude(queueId, order.id, excluded)}
								scopeLabel="this order"
								inheritedFromLabel="queue"
								align="left"
							/>
							<span className="shrink-0 text-[11px] text-zinc-600">
								{order.facilityExclude !== undefined
									? "order preference set"
									: "inherits the queue preference"}
							</span>
						</div>
					)}

					{/* Jobs */}
					{order.jobs.length > 0 ? (
						<SortableContext items={jobIds} strategy={verticalListSortingStrategy}>
							<div>
								{order.jobs.map((job, i) => (
									<JobRow
										key={`job:${order.id}:${job.blueprintId}`}
										queueId={queueId}
										queue={queue}
										order={order}
										orderId={order.id}
										job={job}
										jobIndex={i}
										jobCount={order.jobs.length}
										data={data}
										orders={orders}
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
							placeholder="Add a blueprint to this order..."
						/>
					</div>

					{/* Materials summary */}
					{result && (
						<div className="border-t border-zinc-800/50 pt-3">
							<OrderMaterials
								order={result}
								queueId={queueId}
								data={data}
								recipeLocks={recipeLocks}
								orderLocks={order.recipeLocks}
								globalMode={globalMode}
								sourcingPlan={sourcingPlan}
								containers={containers}
								containerLabels={containerLabels}
								containerJumps={containerJumps}
								orderSourceLocks={order.sourceLocks}
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
