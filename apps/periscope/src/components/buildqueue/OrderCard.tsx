// Order group -- plan 36 (industry-build-queue), Phase 6; Queue / Order / Job (plan 39); unified
// production-order grid (plan 44). Each Order is a full-width GROUP BAND inside the single shared
// grid (the column header + bordered frame live once in the view): a rich header band (drag handle,
// collapse, editable label, per-order totals, location, facilities, merge/reorder/delete) followed
// by the Order's slice of the unified tree (Target jobs as draggable root rows) and a collapsed
// per-order Details section (sourcing / deposits / upstream / surplus). The band is the sortable
// item in the orders SortableContext (the DndContext lives in BuildQueue); the tree's Target roots
// form a nested SortableContext so Targets drag within and between orders. Every op delegates to the
// store mutations (reorderOrders / moveJob / mergeOrders / ...).

import { SystemPicker } from "@/components/SystemPicker";
import { BuildTree, GRID_COLS } from "@/components/buildqueue/BuildTree";
import { EditableText } from "@/components/buildqueue/EditableText";
import { FacilityPreferencePanel } from "@/components/buildqueue/FacilityPreferencePanel";
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
import type { RecentSystem } from "@/hooks/useCharacterRecentSystems";
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
import { useState } from "react";

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
	/** Post-solve per-material container allocation for this order (Phase 4b). */
	sourcingPlan?: MaterialSourcingPlan[];
	/** Selectable containers for the per-row sourcing overrides. */
	containers: ContainerOption[];
	/** containerRefKey -> display label for the sourcing plan + override controls. */
	containerLabels: Map<string, string>;
	/** containerRefKey -> display label + solar system, for the tree's "sourced from storage" labels. */
	containerInfo?: Map<string, { label: string; systemId?: number }>;
	/** Gate-jump distance per container (containerRefKey -> jumps) for the source-priority badges. */
	containerJumps?: Map<string, number | undefined>;
	/** Solar systems for the per-order location picker (plan 41 B4). */
	systems: SolarSystem[];
	/** Recently visited systems for the active character -- the location picker's quick-select list. */
	recentSystems: RecentSystem[];
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
	sourcingPlan,
	containers,
	containerLabels,
	containerInfo,
	containerJumps,
	systems,
	recentSystems,
	systemNames,
	volumeMap,
	haulJumps,
}: OrderCardProps) {
	const collapsed = order.collapsed ?? false;
	const [detailsOpen, setDetailsOpen] = useState(false);
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

	// "from phase N" labels for the tree's upstream badges -- N = 1-based position in the queue.
	const phaseLabelForOrderIds = (orderIds: string[]): string => {
		const indexes = orderIds
			.map((id) => queue.batches.findIndex((b) => b.id === id))
			.filter((i) => i >= 0)
			.map((i) => i + 1);
		if (indexes.length === 0) return "earlier phase";
		if (indexes.length === 1) return `phase ${indexes[0]}`;
		return `phases ${indexes.join(", ")}`;
	};

	function handleAddJob(typeId: number) {
		const bpId = resolveBlueprintForProduct(typeId, data);
		if (bpId == null) return;
		addJob(queueId, order.id, { blueprintId: bpId, runs: 1 });
	}

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`border-t border-zinc-800 ${isDragging ? "bg-cyan-500/5" : ""}`}
		>
			{/* Order group band header (full-width; distinguishes each Order inside the shared grid) */}
			<div className="flex items-center gap-2 bg-zinc-900/60 px-3 py-2.5">
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

				{/* Per-Order location + facilities -- inline in the main row (plan 41 B4). Location is the
				    distance anchor for this order's haul readout (inherits the queue location); facilities is
				    the availability filter for this order (inherits the queue). */}
				<div className="flex shrink-0 items-center gap-2">
					<div
						className="w-44"
						title={
							order.location?.systemId != null
								? "Haul is costed from this system"
								: inheritedSystemName
									? `Inherits the queue location (${inheritedSystemName})`
									: "Set the queue location to cost haul"
						}
					>
						<SystemPicker
							value={effectiveSystemId}
							onChange={(id) =>
								setOrderLocation(queueId, order.id, id == null ? undefined : { systemId: id })
							}
							systems={systems}
							recent={recentSystems}
							inherited={order.location?.systemId == null && inheritedSystemId != null}
							placeholder={
								inheritedSystemName ? `Queue: ${inheritedSystemName}` : "Set location..."
							}
							compact
						/>
					</div>
					{data.facilityNames.length > 0 && (
						<FacilityPreferencePanel
							facilityNames={data.facilityNames}
							value={order.facilityExclude}
							effectiveExcluded={effectiveFacilityExclude}
							onChange={(excluded) => setOrderFacilityExclude(queueId, order.id, excluded)}
							scopeLabel="this order"
							inheritedFromLabel="queue"
							align="left"
						/>
					)}
				</div>

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
					{/* Column header for THIS order's tree, grid-aligned so the labels sit over their columns.
					    Location + facilities now live inline in the order's header row above. */}
					<div
						className="grid items-center border-b border-zinc-800 bg-zinc-900/40 text-[11px] text-zinc-500"
						style={{ gridTemplateColumns: GRID_COLS }}
					>
						<div
							className="px-2 py-1.5 text-right"
							title="Queue-wide build sequence of the Targets"
						>
							Build #
						</div>
						<div className="px-2 py-1.5 text-left">Item</div>
						<div className="px-2 py-1.5 text-left">Source</div>
						<div className="px-2 py-1.5 text-right">Required</div>
						<div className="px-2 py-1.5 text-right">Have</div>
						<div className="px-2 py-1.5 text-right" title="Units produced by this order">
							Built
						</div>
						<div className="px-2 py-1.5 text-right">Need</div>
						<div className="whitespace-nowrap px-2 py-1.5 text-right">Volume (m³)</div>
					</div>

					{/* Unified production-order tree (plan 44) -- Targets are the draggable root rows,
					    expandable to their derived/raw build path. */}
					{order.jobs.length === 0 ? (
						<div className="px-4 py-3 text-xs text-zinc-600">
							No Targets yet -- search below to add the first blueprint, or drag a Target here.
						</div>
					) : result ? (
						<SortableContext items={jobIds} strategy={verticalListSortingStrategy}>
							<BuildTree
								order={result}
								data={data}
								queueId={queueId}
								orderId={order.id}
								queue={queue}
								rawOrder={order}
								queueLocks={recipeLocks}
								orderLocks={order.recipeLocks}
								containers={containers}
								containerJumps={containerJumps}
								draws={result.draws}
								containerInfo={containerInfo}
								orderSourceLocks={order.sourceLocks}
								phaseLabelForOrderIds={phaseLabelForOrderIds}
								sourceSystemId={effectiveSystemId}
								systemNames={systemNames}
								orders={orders}
								sortableTargets
								hideHeader
							/>
						</SortableContext>
					) : (
						<div className="px-4 py-3 text-xs text-zinc-600">Resolving...</div>
					)}

					{/* Add Target */}
					<div className="border-t border-zinc-800/50 px-4 py-3">
						<ProducibleItemSearch
							producibleItems={data.producibleItems}
							onSelect={(typeId) => handleAddJob(typeId)}
							placeholder="Add a Target to this order..."
						/>
					</div>

					{/* Per-order Details (collapsed) -- sourcing plan / deposits / from-upstream / surplus.
					    The build path itself lives in the unified tree above (plan 44); this holds only the
					    supporting tables that don't fit the tree's columns. */}
					{result && (
						<div className="border-t border-zinc-800/50">
							<button
								type="button"
								onClick={() => setDetailsOpen((o) => !o)}
								className="flex w-full items-center gap-2 px-4 py-2 text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
								aria-expanded={detailsOpen}
							>
								{detailsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
								Details
								<span className="font-normal text-zinc-600">
									sourcing · deposits · upstream · surplus
								</span>
							</button>
							{detailsOpen && (
								<OrderMaterials
									order={result}
									queueId={queueId}
									sourcingPlan={sourcingPlan}
									containerLabels={containerLabels}
									volumeMap={volumeMap}
									haulJumps={haulJumps}
								/>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
