// Unified production-order build tree -- plan 44. ONE grid per order: the authored Target jobs are
// the root rows (draggable between orders, runs/split/move/remove inline), expandable to their full
// derived/raw build path. Columns: Build # (queue-wide Target sequence) | Production # (per-order
// build sequence, deepest dependency first) | Item | Source/Recipe | Required | Have | Built | Need
// | Volume. Rows are CSS-grid divs (not a <table>) so dnd-kit transforms, editable cells, and
// full-width drill-down sub-rows compose cleanly. The same component renders the global-mode
// queue-level tree (no drag -- it lives outside the DndContext; Target roots get an "Order N" tag).

import { ItemIcon } from "@/components/ItemIcon";
import { OutputDestControl } from "@/components/buildqueue/OutputDestControl";
import { RecipeAlternatives } from "@/components/buildqueue/RecipeAlternatives";
import { RowSourceControl } from "@/components/buildqueue/RowSourceControl";
import { SourceSitesPopover } from "@/components/buildqueue/SourceSitesPopover";
import {
	type OrderRef,
	type QueueBlueprintData,
	isRecipeSteered,
} from "@/components/buildqueue/shared";
import {
	RecipeDropdown,
	RecipeIconLabel,
	formatOptionLabel,
	getFacilityLabel,
	resolveEffectiveFacility,
} from "@/components/industry/RecipeDropdown";
import type {
	BuildQueue,
	ContainerRef,
	ContainerSourceConfig,
	JobOverrides,
	Order,
	RecipeLockEntry,
	SourceLockEntry,
} from "@/lib/buildQueueTypes";
import type { BuildTreeNode, BuildTreeOrder } from "@/lib/buildTree";
import { buildOrderTree } from "@/lib/buildTree";
import type { LandscapeData, LandscapeMaterialSource } from "@/lib/landscapeData";
import { useLandscapeData } from "@/lib/landscapeData";
import { nearestSourceSites } from "@/lib/proximity";
import type { ContainerDraw } from "@/lib/queueResolver";
import { containerRefKey, mergeLocks, resolveEffectiveOverrides } from "@/lib/queueResolver";
import type { ContainerOption } from "@/lib/sourcingPlan";
import {
	clearOrderRecipeLock,
	clearOrderSourceLock,
	clearRecipeLock,
	moveJob,
	removeJob,
	setJobBlueprint,
	setJobOverrides,
	setJobRuns,
	setOrderRecipeLock,
	setOrderSourceLock,
	setRecipeLock,
	splitOrder,
} from "@/stores/buildQueueStore";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	GripVertical,
	Scissors,
	Trash2,
	Warehouse,
} from "lucide-react";
import { Fragment, memo, useMemo, useState } from "react";

interface BuildTreeProps {
	order: BuildTreeOrder;
	data: QueueBlueprintData;
	queueId: string;
	orderId?: string | null;
	queue?: BuildQueue;
	rawOrder?: Order;
	queueLocks: RecipeLockEntry[];
	orderLocks?: RecipeLockEntry[];
	containers?: ContainerOption[];
	containerJumps?: Map<string, number | undefined>;
	/**
	 * Post-solve container attribution for this order (typeId -> the named storage each drawn type was
	 * pulled from). Rows that draw from stock (`have > 0`) show that storage as their source instead of a
	 * recipe/gather label.
	 */
	draws?: Map<number, ContainerDraw[]>;
	/** containerRefKey -> display label + solar system, to name (and locate) the sourced-from storage. */
	containerInfo?: Map<string, { label: string; systemId?: number }>;
	orderSourceLocks?: SourceLockEntry[];
	phaseLabelForOrderIds?: (orderIds: string[]) => string;
	sourceSystemId?: number | null;
	systemNames?: Map<number, string>;
	/** Order refs for the Target rows' move-to-order select. */
	orders?: OrderRef[];
	/** True when the tree renders inside a jobs SortableContext (per-order mode): Target roots drag. */
	sortableTargets?: boolean;
	/** Suppress the built-in column header -- the unified grid renders ONE shared header up top. */
	hideHeader?: boolean;
}

/**
 * Shared column template -- the queue-level header row and every tree row (across every Order in the
 * single unified grid) use the same fixed template so columns stay aligned without <table> semantics
 * (which fight dnd-kit transforms and full-width sub-rows). Exported so the view can render ONE
 * column header above all the Order group bands (plan 44 unified grid).
 * Build # | Item | Source | Required | Have | Built | Need | Volume.
 */
export const GRID_COLS =
	"3.5rem minmax(15rem,2fr) minmax(13rem,2.5fr) 5.5rem 5rem 5rem 5.5rem 6rem";

/** The single shared column header for the unified production grid (rendered once, at the top). */
export function ProductionGridHeader() {
	return (
		<div
			className="grid items-center border-b border-zinc-800 bg-zinc-900/60 text-xs text-zinc-500"
			style={{ gridTemplateColumns: GRID_COLS }}
		>
			<div className="px-3 py-2 text-right" title="Queue-wide build sequence of the Target items">
				Build #
			</div>
			<div className="py-2 pl-2 pr-2 text-left">Item</div>
			<div className="px-2 py-2 text-left">Source</div>
			<div className="px-2 py-2 text-right">Required</div>
			<div className="px-2 py-2 text-right">Have</div>
			<div className="px-2 py-2 text-right" title="Produced by derived jobs, net of stock">
				Built
			</div>
			<div className="px-2 py-2 text-right">Need</div>
			<div className="whitespace-nowrap px-2 py-2 text-right">Volume (m³)</div>
		</div>
	);
}

function formatQty(value: number): string {
	return value.toLocaleString();
}

/** Build # / Production # sequence cell (Plan 44 Decisions 2-3). Blank where unnumbered. */
function IndexCell({ value, accent }: { value: number | undefined; accent?: boolean }) {
	return (
		<div
			className={`px-3 py-2 text-right font-mono text-xs ${
				accent ? "text-emerald-300/90" : "text-zinc-400"
			}`}
		>
			{value ?? ""}
		</div>
	);
}

function RequiredCell({ value }: { value: number }) {
	return <div className="px-2 py-2 text-right font-mono text-zinc-400">{formatQty(value)}</div>;
}

function HaveQtyCell({ value }: { value: number }) {
	return (
		<div className="px-2 py-2 text-right font-mono text-cyan-400">
			{value > 0 ? formatQty(value) : "--"}
		</div>
	);
}

/** Built column (Plan 44 Decision 12): "--" for Targets, 0 for raws, stillNeed for derived. */
function BuiltCell({ value }: { value: number | undefined }) {
	if (value == null) {
		return <div className="px-2 py-2 text-right font-mono text-zinc-600">--</div>;
	}
	return (
		<div
			className={`px-2 py-2 text-right font-mono ${value === 0 ? "text-zinc-600" : "text-sky-300"}`}
		>
			{formatQty(value)}
		</div>
	);
}

function NeedQtyCell({ value }: { value: number }) {
	return (
		<div
			className={`px-2 py-2 text-right font-mono ${
				value === 0 ? "text-green-400" : "text-amber-400"
			}`}
		>
			{value === 0 ? "0" : formatQty(value)}
		</div>
	);
}

function VolumeQtyCell({ volume, volumeMissing }: { volume: number; volumeMissing: boolean }) {
	return (
		<div className="px-2 py-2 text-right">
			{volumeMissing ? (
				<span
					className="inline-flex items-center gap-1 text-amber-400"
					title="Volume data missing for this item"
				>
					<AlertTriangle size={12} />
					<span className="text-xs">??</span>
				</span>
			) : (
				<span className="font-mono text-zinc-400">
					{volume.toLocaleString(undefined, { maximumFractionDigits: 1 })}
				</span>
			)}
		</div>
	);
}

function splitSourceLabel(
	node: BuildTreeNode,
	split: NonNullable<BuildTreeNode["splits"]>[number],
	data: QueueBlueprintData,
): string {
	const bp = data.blueprints[String(split.blueprintId)];
	if (!bp) return `BP #${split.blueprintId}`;
	const defaultBpId = data.defaultRecipes.get(node.typeId);
	if (split.blueprintId === defaultBpId) return getFacilityLabel(bp, data.blueprintFacilities);
	const stockInput = bp.inputs.find(
		(input) => data.rawMaterialIds.has(input.typeID) || data.gatherableLeafIds.has(input.typeID),
	);
	return stockInput?.typeName ?? getFacilityLabel(bp, data.blueprintFacilities);
}

function SplitSummary({ node, data }: { node: BuildTreeNode; data: QueueBlueprintData }) {
	const splits = node.splits?.filter((split) => split.quantity > 0);
	if (!splits || splits.length === 0) return null;
	const defaultBpId = data.defaultRecipes.get(node.typeId);
	const pieces = splits.map((split) => {
		const stockTag = split.blueprintId !== defaultBpId ? " (your stock)" : "";
		return `${formatQty(split.quantity)} from ${splitSourceLabel(node, split, data)}${stockTag}`;
	});
	return <div className="mt-1 text-[11px] text-zinc-500">{pieces.join(", ")}</div>;
}

function formatJumpLabel(jumps: number | undefined): string {
	if (jumps == null) return "unreachable";
	return `${jumps} jump${jumps === 1 ? "" : "s"}`;
}

function systemLabel(systemId: number, systemNames?: Map<number, string>): string {
	return systemNames?.get(systemId) ?? `#${systemId}`;
}

function RawSourceDetail({
	node,
	sourceSystemId,
	systemNames,
	landscapeData,
}: {
	node: BuildTreeNode;
	sourceSystemId?: number | null;
	systemNames?: Map<number, string>;
	landscapeData: LandscapeData | null;
}) {
	const sourceTypeId = node.siteSourceTypeId ?? node.typeId;
	const source: LandscapeMaterialSource | undefined = landscapeData?.materials.get(sourceTypeId);
	const nearest = useMemo(
		() =>
			sourceSystemId != null && source
				? nearestSourceSites(sourceSystemId, [source.typeId])[0]
				: undefined,
		[sourceSystemId, source],
	);

	if (!source) {
		return <span className="text-[11px] text-zinc-600">source unknown</span>;
	}

	if (source.tier === "tier3") {
		return <span className="text-[11px] text-zinc-600">source unknown</span>;
	}

	if (source.tier === "tier2") {
		const target = nearest
			? `${systemLabel(nearest.systemId, systemNames)} · ${formatJumpLabel(nearest.jumps)}`
			: sourceSystemId == null
				? "set build location for nearest sites"
				: "no reachable source system";
		return (
			<span className="text-[11px] text-amber-300/70" title={source.caveat ?? source.label}>
				{source.label}: {target}
			</span>
		);
	}

	const target = nearest
		? `${systemLabel(nearest.systemId, systemNames)} · ${formatJumpLabel(nearest.jumps)}`
		: sourceSystemId == null
			? "set build location for nearest sites"
			: "no reachable source system";
	const ecosystems = nearest?.ecosystems
		.slice(0, 2)
		.map((e) => e.name)
		.join(", ");
	const tags = nearest?.gradeTags.slice(0, 2).join(", ");
	const detail = [ecosystems, tags].filter(Boolean).join(" · ");

	return (
		<span className="text-[11px] text-zinc-400" title={source.label}>
			Nearest: {target}
			{detail ? ` · ${detail}` : ""}
		</span>
	);
}

/**
 * The storage a stock-covered row is sourced FROM. When the resolver drew this type from one or more
 * named containers (`draws`), list each container and the solar system it sits in -- so an item you
 * already hold shows "pull from <storage> · <system>" instead of the recipe/gather label it would build
 * from. Renders nothing when the row draws no stock or the stock was unattributed (e.g. carry-forward
 * from an earlier order, which surfaces via the "from phase N" badge instead).
 */
function StorageSourceDetail({
	node,
	draws,
	containerInfo,
	systemNames,
}: {
	node: BuildTreeNode;
	draws?: Map<number, ContainerDraw[]>;
	containerInfo?: Map<string, { label: string; systemId?: number }>;
	systemNames?: Map<number, string>;
}) {
	if (node.have <= 0) return null;
	const allocations = draws?.get(node.typeId);
	if (!allocations || allocations.length === 0) return null;

	return (
		<span className="flex min-w-0 flex-col gap-0.5">
			{allocations.map((draw) => {
				const key = containerRefKey(draw.ref);
				const info = containerInfo?.get(key);
				const label = info?.label ?? key;
				const systemName =
					info?.systemId != null ? (systemNames?.get(info.systemId) ?? `#${info.systemId}`) : null;
				return (
					<span
						key={key}
						className="flex min-w-0 items-center gap-1 text-xs text-emerald-300/90"
						title={`Sourced from ${label}${systemName ? ` in ${systemName}` : ""} -- ${formatQty(draw.qty)} on hand`}
					>
						<Warehouse size={11} className="shrink-0 text-emerald-400/80" />
						<span className="truncate">{label}</span>
						{systemName && <span className="shrink-0 text-zinc-500">· {systemName}</span>}
					</span>
				);
			})}
		</span>
	);
}

function writeExclusiveLock(
	queueId: string,
	orderId: string | null | undefined,
	typeId: number,
	blueprintId: number,
) {
	const entry: RecipeLockEntry = {
		typeId,
		pin: { typeId, kind: "exclusive", blueprintId },
	};
	if (orderId) setOrderRecipeLock(queueId, orderId, entry);
	else setRecipeLock(queueId, entry);
}

const ROW_CLASS = "grid items-center border-t border-zinc-800/50 hover:bg-zinc-800/30";
// Target (final-tier) roots headline each Order's subtree -- an emerald left accent + faint tint
// (matching the "Target" badge) sets them apart from the derived/raw rows beneath them.
const TARGET_ROW_CLASS =
	"grid items-center border-t border-zinc-800/50 border-l-2 border-l-emerald-500/60 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12]";

/**
 * Sortable shell for a draggable Target root: the row div is the sortable node; the drag handle is
 * handed to the cell renderer so it can sit inline in the item cell (plan 44 OQ-1). Mounted ONLY
 * for draggable Targets so useSortable never runs outside a DndContext (the global-mode tree).
 */
function SortableTargetRow({
	sortId,
	orderId,
	jobIndex,
	blueprintId,
	name,
	className,
	children,
}: {
	sortId: string;
	orderId: string;
	jobIndex: number;
	blueprintId: number;
	name: string;
	className: string;
	children: (dragHandle: React.ReactNode) => React.ReactNode;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: sortId,
		data: { type: "job", orderId, jobIndex, blueprintId, name },
	});
	const dragHandle = (
		<button
			type="button"
			ref={setActivatorNodeRef}
			{...attributes}
			{...listeners}
			className="shrink-0 cursor-grab touch-none rounded p-0.5 text-zinc-600 hover:text-zinc-300 active:cursor-grabbing"
			title="Drag to reorder or move to another order"
			aria-label={`Drag to move ${name}`}
		>
			<GripVertical size={13} />
		</button>
	);
	return (
		<div
			ref={setNodeRef}
			className={className}
			style={{
				gridTemplateColumns: GRID_COLS,
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.4 : undefined,
			}}
		>
			{children(dragHandle)}
		</div>
	);
}

interface TreeRowProps {
	node: BuildTreeNode;
	depth: number;
	data: QueueBlueprintData;
	queueId: string;
	orderId?: string | null;
	queue?: BuildQueue;
	rawOrder?: Order;
	queueLocks: RecipeLockEntry[];
	orderLocks?: RecipeLockEntry[];
	mergedLocks: RecipeLockEntry[];
	containers?: ContainerOption[];
	containerJumps?: Map<string, number | undefined>;
	draws?: Map<number, ContainerDraw[]>;
	containerInfo?: Map<string, { label: string; systemId?: number }>;
	orderSourceLocks?: SourceLockEntry[];
	phaseLabelForOrderIds?: (orderIds: string[]) => string;
	sourceSystemId?: number | null;
	systemNames?: Map<number, string>;
	landscapeData: LandscapeData | null;
	/** Queue-wide 1-based Build # per authored Target job (Plan 44 Decision 2). */
	buildIndexByJobId: Map<string, number>;
	orders?: OrderRef[];
	sortableTargets?: boolean;
	collapsedPaths: Set<string>;
	toggleCollapsed: (path: string) => void;
	detailPaths: Set<string>;
	toggleDetails: (path: string) => void;
}

const TreeRow = memo(function TreeRow({
	node,
	depth,
	data,
	queueId,
	orderId,
	queue,
	rawOrder,
	queueLocks,
	orderLocks,
	mergedLocks,
	containers,
	containerJumps,
	draws,
	containerInfo,
	orderSourceLocks,
	phaseLabelForOrderIds,
	sourceSystemId,
	systemNames,
	landscapeData,
	buildIndexByJobId,
	orders,
	sortableTargets,
	collapsedPaths,
	toggleCollapsed,
	detailPaths,
	toggleDetails,
}: TreeRowProps) {
	const producers = data.outputToBlueprints.get(node.typeId) ?? [];
	const optionCount = producers.reduce(
		(sum, producer) =>
			sum + Math.max(1, (data.blueprintFacilities.get(producer.blueprintID) ?? []).length),
		0,
	);
	const chosenBp =
		producers.find((bp) => bp.blueprintID === node.blueprintId) ??
		(node.blueprintId == null ? undefined : data.blueprints[String(node.blueprintId)]);
	const selectedBpId = node.blueprintId ?? chosenBp?.blueprintID;
	const queueEntry = queueLocks.find((lock) => lock.typeId === node.typeId);
	const orderEntry = orderLocks?.find((lock) => lock.typeId === node.typeId);
	const steered = isRecipeSteered(node.typeId, mergedLocks);
	const isCollapsed = collapsedPaths.has(node.path);
	const detailsOpen = detailPaths.has(node.path);
	const canShowRecipe = node.tier !== "raw" && chosenBp != null;
	const reprocessableRaw = node.tier === "raw" && producers.length > 0;
	// A raw counts as "reprocessing" ONLY when an actual recipe pin steers it -- a leftover prefer/
	// exclude does not force reprocessing (the LP still gathers), so the default view stays "gather".
	const rawReprocessing =
		reprocessableRaw && mergedLocks.find((lock) => lock.typeId === node.typeId)?.pin != null;
	// Facility choice is independent of recipe choice -- the SAME blueprint can often run at more than
	// one facility type, so this is informational (which facilities work), not a selectable control.
	// Surfaced even for "final" (Target) nodes, whose recipe itself is locked to the authored Job.
	const facilityNames = chosenBp ? (data.blueprintFacilities.get(chosenBp.blueprintID) ?? []) : [];
	const excludedFacilities = node.excludedFacilities ?? [];
	const excludedSet = new Set(excludedFacilities);
	let targetOrder = rawOrder;
	let targetJobIndex =
		node.tier === "final" && node.jobId && rawOrder
			? rawOrder.jobs.findIndex((job) => job.id === node.jobId)
			: -1;
	if (node.tier === "final" && node.jobId && targetJobIndex < 0 && queue) {
		for (const order of queue.batches) {
			const index = order.jobs.findIndex((job) => job.id === node.jobId);
			if (index < 0) continue;
			targetOrder = order;
			targetJobIndex = index;
			break;
		}
	}
	const targetJob =
		targetOrder && targetJobIndex >= 0 ? targetOrder.jobs[targetJobIndex] : undefined;
	const sourceLock = orderSourceLocks?.find((lock) => lock.typeId === node.typeId);
	const derivedPick = sourceLock?.facilityPick;
	const targetPick = targetJob?.overrides?.facilityPick;
	const pick = node.tier === "final" ? targetPick : derivedPick;

	// A final-tier row is an authored Target job -- it carries the full authoring affordances folded
	// in from the retired JobRow (plan 44 Phase 3): runs, split, move-to-order, remove, drag.
	const isTarget = node.tier === "final" && targetJob != null && targetOrder != null;
	const canChangeFinalRecipe = isTarget && targetJobIndex >= 0;
	const canInlineChange =
		(node.tier === "intermediate" && optionCount > 1) || (canChangeFinalRecipe && optionCount > 1);
	// In the queue-level (global-mode) tree, tag each Target root with its owning order.
	const globalOrderIndex =
		orderId == null && isTarget && queue && targetOrder
			? queue.batches.findIndex((b) => b.id === targetOrder.id)
			: -1;
	const canDrag = Boolean(sortableTargets) && isTarget && orderId != null;

	function handleSourcesChange(sources: ContainerSourceConfig | undefined) {
		if (!orderId) return;
		const next: SourceLockEntry = { ...sourceLock, typeId: node.typeId };
		if (sources) next.sources = sources;
		else next.sources = undefined;
		if (next.sources || next.outputDest || next.facilityPick) {
			setOrderSourceLock(queueId, orderId, next);
		} else clearOrderSourceLock(queueId, orderId, node.typeId);
	}
	function handleOutputChange(outputDest: ContainerRef | undefined) {
		if (!orderId) return;
		const next: SourceLockEntry = { ...sourceLock, typeId: node.typeId, outputDest };
		if (next.sources || next.outputDest || next.facilityPick) {
			setOrderSourceLock(queueId, orderId, next);
		} else clearOrderSourceLock(queueId, orderId, node.typeId);
	}
	function handleDerivedSelect(bpId: number, facility: string | undefined) {
		if (bpId !== selectedBpId) writeExclusiveLock(queueId, orderId, node.typeId, bpId);
		if (!orderId) return;
		const next: SourceLockEntry = { ...sourceLock, typeId: node.typeId, facilityPick: facility };
		if (next.sources || next.outputDest || next.facilityPick) {
			setOrderSourceLock(queueId, orderId, next);
		} else clearOrderSourceLock(queueId, orderId, node.typeId);
	}
	function handleDerivedFacilityReset() {
		if (!orderId) return;
		const next: SourceLockEntry = { ...sourceLock, typeId: node.typeId, facilityPick: undefined };
		if (next.sources || next.outputDest) setOrderSourceLock(queueId, orderId, next);
		else clearOrderSourceLock(queueId, orderId, node.typeId);
	}
	// A raw leaf normally gathers directly (Source: <group>). Picking a producer here is an explicit
	// reprocess pin -- the SAME exclusive lock a derived recipe writes, which the resolver honors (soft
	// "prefer" in the drill-down did not force it). "Gather directly" clears the pin back to auto.
	function handleRawSelect(bpId: number) {
		writeExclusiveLock(queueId, orderId, node.typeId, bpId);
	}
	function handleRawGather() {
		if (orderId) clearOrderRecipeLock(queueId, orderId, node.typeId);
		else clearRecipeLock(queueId, node.typeId);
	}
	function persistJobOverrides(next: JobOverrides) {
		if (!targetOrder || targetJobIndex < 0) return;
		const hasOverrides =
			next.sources ||
			next.outputDest ||
			next.facilityExclude !== undefined ||
			next.facilityPick !== undefined;
		setJobOverrides(queueId, targetOrder.id, targetJobIndex, hasOverrides ? next : undefined);
	}
	function handleFinalSelect(bpId: number, facility: string | undefined) {
		if (!targetOrder || targetJobIndex < 0) return;
		if (bpId !== node.blueprintId) setJobBlueprint(queueId, targetOrder.id, targetJobIndex, bpId);
		persistJobOverrides({ ...targetJob?.overrides, facilityPick: facility });
	}
	function handleFinalFacilityReset() {
		persistJobOverrides({ ...targetJob?.overrides, facilityPick: undefined });
	}
	// Per-job sourcing / deposit overrides (cascade layer 5, keyed by the authored Job) -- folded in
	// from JobRow. Preserve whatever else is already on the job's overrides.
	function handleTargetSourcesChange(sources: ContainerSourceConfig | undefined) {
		persistJobOverrides({ ...targetJob?.overrides, sources });
	}
	function handleTargetOutputChange(outputDest: ContainerRef | undefined) {
		persistJobOverrides({ ...targetJob?.overrides, outputDest });
	}

	// The cascade-resolved deposit destination for this Target (queue/order defaults + per-typeId
	// locks + the job's own override). Shown as the inherited hint when the job sets nothing itself.
	const effectiveJobOverrides =
		isTarget && queue && targetOrder
			? resolveEffectiveOverrides(queue, targetOrder, node.typeId, targetJob?.overrides)
			: undefined;

	const phaseLabel =
		node.sourceOrderIds && node.sourceOrderIds.length > 0
			? phaseLabelForOrderIds?.(node.sourceOrderIds)
			: undefined;

	const buildIndex =
		node.tier === "final" && node.jobId ? buildIndexByJobId.get(node.jobId) : undefined;

	// The four quantity columns partition Required: Required = Have + Built + Need, where Need is what
	// still has to be SOURCED/gathered (0 once fully built). Every occurrence -- including a shared
	// type reached from more than one consumer -- shows its reconciled share of the plan totals
	// (see reconcileTreeToFlatTotals), so the rows for a type sum exactly to its BOM line below.
	const qtyRequired = node.reconciled?.required ?? node.needPerEdge;
	const qtyHave = node.reconciled?.have ?? node.have;
	const qtyBuilt = node.reconciled?.built ?? node.built ?? 0;
	const qtyNeed = Math.max(0, qtyRequired - qtyHave - qtyBuilt);

	// This row draws (some of) its need from a named storage container -- show that storage instead of
	// (fully covered) or alongside (partial) the recipe/gather label. `fullyFromStock` means the whole
	// edge is on hand, so no recipe/gather is needed at all.
	const hasStorageDraw = node.have > 0 && (draws?.get(node.typeId)?.length ?? 0) > 0;
	const fullyFromStock = hasStorageDraw && node.have >= node.needPerEdge;

	const cells = (dragHandle: React.ReactNode) => (
		<>
			<IndexCell value={buildIndex} accent />

			{/* Item + (for Targets) the inline authoring affordances (OQ-1) */}
			<div
				className="min-w-0 py-2 pr-2 text-sm text-zinc-200"
				style={{ paddingLeft: 8 + depth * 18 }}
			>
				<span className="flex min-w-0 flex-wrap items-center gap-2">
					{node.children.length > 0 ? (
						<button
							type="button"
							onClick={() => toggleCollapsed(node.path)}
							className="shrink-0 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
							title={isCollapsed ? "Expand build path" : "Collapse build path"}
						>
							{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
						</button>
					) : (
						<span className="w-[17px] shrink-0" />
					)}
					{dragHandle}
					<ItemIcon typeId={node.typeId} />
					<span
						className={`min-w-0 truncate ${
							node.tier === "final" ? "font-semibold text-zinc-50" : ""
						}`}
					>
						{node.typeName}
					</span>
					{node.tier === "final" && (
						<span className="shrink-0 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
							Target
						</span>
					)}
					{node.tier === "intermediate" && (
						<span className="shrink-0 rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
							Derived
						</span>
					)}
					{globalOrderIndex >= 0 && (
						<span className="shrink-0 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
							Order {globalOrderIndex + 1}
						</span>
					)}
					{node.stockShownElsewhere && (
						<span
							className="shrink-0 rounded border border-zinc-700 px-1 py-0.5 text-[10px] text-zinc-500"
							title="This type is also used elsewhere; the quantities shown are this row's share of the order totals."
						>
							shared
						</span>
					)}
					{phaseLabel && (
						<span className="shrink-0 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
							from {phaseLabel}
						</span>
					)}
					{isTarget && targetOrder && (
						<span className="ml-auto flex shrink-0 items-center gap-1.5">
							<label className="flex items-center gap-1 text-[11px] text-zinc-500">
								runs
								<input
									type="number"
									min={1}
									value={targetJob?.runs ?? 1}
									onChange={(e) =>
										setJobRuns(
											queueId,
											targetOrder.id,
											targetJobIndex,
											Number.parseInt(e.target.value) || 1,
										)
									}
									className="w-14 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-center text-xs text-zinc-100 focus:border-violet-600 focus:outline-none"
								/>
							</label>
							{targetJobIndex < targetOrder.jobs.length - 1 && (
								<button
									type="button"
									onClick={() => splitOrder(queueId, targetOrder.id, targetJobIndex)}
									className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-cyan-300"
									title="Split into a new order after this Target"
									aria-label="Split order after this Target"
								>
									<Scissors size={13} />
								</button>
							)}
							{orders && orders.length > 1 && (
								<select
									value={targetOrder.id}
									onChange={(e) =>
										moveJob(queueId, targetOrder.id, targetJobIndex, e.target.value)
									}
									className="max-w-[7rem] rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[11px] text-zinc-400 focus:border-violet-600 focus:outline-none"
									title="Move Target to another order"
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
								onClick={() => removeJob(queueId, targetOrder.id, targetJobIndex)}
								className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-red-400"
								title="Remove Target"
							>
								<Trash2 size={13} />
							</button>
						</span>
					)}
				</span>
			</div>

			{/* Source / Recipe */}
			<div className="min-w-0 px-2 py-2">
				{hasStorageDraw && (
					<div className={fullyFromStock ? undefined : "mb-1"}>
						<StorageSourceDetail
							node={node}
							draws={draws}
							containerInfo={containerInfo}
							systemNames={systemNames}
						/>
					</div>
				)}
				{!fullyFromStock && (
				<div className="flex flex-wrap items-center gap-2">
					{node.tier === "raw" ? (
						<span className="flex min-w-0 flex-col gap-1">
							{reprocessableRaw ? (
								// A raw with reprocessing producers gets the SAME selector as a build job: the
								// default is "Source: <group>" (gather), and each option is a reprocess recipe.
								<RecipeDropdown
									typeId={node.typeId}
									producers={producers}
									currentBpId={rawReprocessing ? selectedBpId : undefined}
									isOverridden={rawReprocessing}
									onSelect={(bpId) => handleRawSelect(bpId)}
									formatOptionLabel={(bp, typeId) =>
										formatOptionLabel(bp, typeId, data.blueprintFacilities)
									}
									getFacilityLabel={(bp) => getFacilityLabel(bp, data.blueprintFacilities)}
									blueprintFacilities={data.blueprintFacilities}
									gatherLabel={`Source: ${node.sourceGroup ?? "Other"}`}
									gathering={!rawReprocessing}
									onGather={handleRawGather}
								/>
							) : (
								<span
									className="truncate text-xs text-zinc-500"
									title={`Source: ${node.sourceGroup ?? "Other"}`}
								>
									Source: {node.sourceGroup ?? "Other"}
								</span>
							)}
							<div className="flex flex-wrap items-center gap-2">
								<RawSourceDetail
									node={node}
									sourceSystemId={sourceSystemId}
									systemNames={systemNames}
									landscapeData={landscapeData}
								/>
								<SourceSitesPopover
									typeId={node.siteSourceTypeId ?? node.typeId}
									resourceName={node.typeName}
									sourceSystemId={sourceSystemId}
									systemNames={systemNames}
								/>
							</div>
						</span>
					) : canInlineChange ? (
						<RecipeDropdown
							typeId={node.typeId}
							producers={producers}
							currentBpId={selectedBpId}
							isOverridden={node.tier === "final" ? false : steered}
							onSelect={node.tier === "final" ? handleFinalSelect : handleDerivedSelect}
							formatOptionLabel={(bp, typeId) =>
								formatOptionLabel(bp, typeId, data.blueprintFacilities)
							}
							getFacilityLabel={(bp) => getFacilityLabel(bp, data.blueprintFacilities)}
							blueprintFacilities={data.blueprintFacilities}
							excludedFacilities={excludedFacilities}
							pick={pick}
							onResetFacility={
								node.tier === "final" ? handleFinalFacilityReset : handleDerivedFacilityReset
							}
							onSplitRequest={node.tier === "final" ? undefined : () => toggleDetails(node.path)}
						/>
					) : canShowRecipe && chosenBp ? (
						<span
							className="shrink-0 truncate rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-500"
							title={`Recipe: ${formatOptionLabel(chosenBp, node.typeId, data.blueprintFacilities)}`}
						>
							<RecipeIconLabel
								bp={chosenBp}
								facility={resolveEffectiveFacility(facilityNames, excludedSet, pick)}
							/>
						</span>
					) : (
						<span className="text-xs text-zinc-600">--</span>
					)}

					{node.tier === "intermediate" && orderId && containers && containers.length > 0 && (
						<>
							<RowSourceControl
								containers={containers}
								config={sourceLock?.sources}
								onChange={handleSourcesChange}
								scopeLabel="this item"
								jumps={containerJumps}
								note="Container priority for this item steers which storage it is pulled from when it is sourced from stock. It does not change the optimizer's build-vs-buy math."
							/>
							<OutputDestControl
								containers={containers}
								value={sourceLock?.outputDest}
								onChange={handleOutputChange}
								scopeLabel="this item"
							/>
						</>
					)}

					{isTarget && containers && containers.length > 0 && (
						<>
							<RowSourceControl
								containers={containers}
								config={targetJob?.overrides?.sources}
								onChange={handleTargetSourcesChange}
								scopeLabel="this job"
								jumps={containerJumps}
								note="Per-job source priority is recorded. The live plan still sources raw materials by the queue/order container priority, not per job."
							/>
							<OutputDestControl
								containers={containers}
								value={targetJob?.overrides?.outputDest}
								onChange={handleTargetOutputChange}
								effective={effectiveJobOverrides?.outputDest}
								scopeLabel="this job"
							/>
						</>
					)}
				</div>
				)}
				<SplitSummary node={node} data={data} />
			</div>

			{/* Quantities -- each occurrence shows its reconciled share; rows sum to the BOM below. */}
			<RequiredCell value={qtyRequired} />
			<HaveQtyCell value={qtyHave} />
			<BuiltCell value={qtyBuilt} />
			<NeedQtyCell value={qtyNeed} />
			<VolumeQtyCell
				volume={node.reconciled?.volume ?? node.volume}
				volumeMissing={node.reconciled?.volumeMissing ?? node.volumeMissing}
			/>
		</>
	);

	const rowClass = node.tier === "final" ? TARGET_ROW_CLASS : ROW_CLASS;

	return (
		<Fragment>
			{canDrag && orderId && targetJob ? (
				<SortableTargetRow
					sortId={`job:${orderId}:${targetJob.blueprintId}`}
					orderId={orderId}
					jobIndex={targetJobIndex}
					blueprintId={targetJob.blueprintId}
					name={node.typeName}
					className={rowClass}
				>
					{cells}
				</SortableTargetRow>
			) : (
				<div className={rowClass} style={{ gridTemplateColumns: GRID_COLS }}>
					{cells(null)}
				</div>
			)}

			{detailsOpen && producers.length > 0 && node.tier !== "final" && (
				<div className="border-t border-zinc-800/30 px-4 py-2">
					<RecipeAlternatives
						queueId={queueId}
						orderId={orderId ?? undefined}
						typeId={node.typeId}
						producers={producers}
						chosenBpId={selectedBpId}
						queueEntry={queueEntry}
						orderEntry={orderEntry}
						demandQuantity={node.needPerEdge}
						currentSplits={node.splits}
						blueprintFacilities={data.blueprintFacilities}
					/>
				</div>
			)}

			{!isCollapsed &&
				node.children.map((child) => (
					<TreeRow
						key={child.path}
						node={child}
						depth={depth + 1}
						data={data}
						queueId={queueId}
						orderId={orderId}
						queue={queue}
						rawOrder={rawOrder}
						queueLocks={queueLocks}
						orderLocks={orderLocks}
						mergedLocks={mergedLocks}
						containers={containers}
						containerJumps={containerJumps}
						draws={draws}
						containerInfo={containerInfo}
						orderSourceLocks={orderSourceLocks}
						phaseLabelForOrderIds={phaseLabelForOrderIds}
						sourceSystemId={sourceSystemId}
						systemNames={systemNames}
						landscapeData={landscapeData}
						buildIndexByJobId={buildIndexByJobId}
						orders={orders}
						sortableTargets={sortableTargets}
						collapsedPaths={collapsedPaths}
						toggleCollapsed={toggleCollapsed}
						detailPaths={detailPaths}
						toggleDetails={toggleDetails}
					/>
				))}
		</Fragment>
	);
});

export function BuildTree({
	order,
	data,
	queueId,
	orderId,
	queue,
	rawOrder,
	queueLocks,
	orderLocks,
	containers,
	containerJumps,
	draws,
	containerInfo,
	orderSourceLocks,
	phaseLabelForOrderIds,
	sourceSystemId,
	systemNames,
	orders,
	sortableTargets,
	hideHeader,
}: BuildTreeProps) {
	const mergedLocks = useMemo(() => mergeLocks(queueLocks, orderLocks), [queueLocks, orderLocks]);
	// typeId -> the exclusively-pinned recipe, so the tree can honor a recipe override on a producible
	// type that never lands in `order.build` (e.g. a direct input of an authored job, which is top-level
	// demand rather than a Derived intermediate). Without this the tree falls back to the game default.
	const lockedRecipes = useMemo(() => {
		const map = new Map<number, number>();
		for (const lock of mergedLocks) {
			if (lock.pin?.kind === "exclusive") map.set(lock.pin.typeId, lock.pin.blueprintId);
		}
		return map;
	}, [mergedLocks]);
	const nodes = useMemo(
		() => buildOrderTree(order, data, lockedRecipes),
		[order, data, lockedRecipes],
	);
	// Build # (Plan 44 Decision 2): queue-wide 1-based sequence over the authored Target jobs in
	// (order order, target order) sequence. Derived from the raw queue here so BOTH call sites --
	// the per-order trees and the global-mode tree -- number identically without prop threading.
	const buildIndexByJobId = useMemo(() => {
		const map = new Map<string, number>();
		let next = 1;
		for (const queueOrder of queue?.batches ?? []) {
			for (const job of queueOrder.jobs) {
				map.set(job.id, next);
				next += 1;
			}
		}
		return map;
	}, [queue]);
	const landscapeData = useLandscapeData();
	const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
	const [detailPaths, setDetailPaths] = useState<Set<string>>(() => new Set());

	function toggleCollapsed(path: string) {
		setCollapsedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}

	function toggleDetails(path: string) {
		setDetailPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}

	if (nodes.length === 0) {
		return <div className="px-4 py-3 text-xs text-zinc-600">None</div>;
	}

	return (
		<div className="w-full text-sm">
			{!hideHeader && <ProductionGridHeader />}
			{nodes.map((node) => (
				<TreeRow
					key={node.path}
					node={node}
					depth={0}
					data={data}
					queueId={queueId}
					orderId={orderId}
					queue={queue}
					rawOrder={rawOrder}
					queueLocks={queueLocks}
					orderLocks={orderLocks}
					mergedLocks={mergedLocks}
					containers={containers}
					containerJumps={containerJumps}
					draws={draws}
					containerInfo={containerInfo}
					orderSourceLocks={orderSourceLocks}
					phaseLabelForOrderIds={phaseLabelForOrderIds}
					sourceSystemId={sourceSystemId}
					systemNames={systemNames}
					landscapeData={landscapeData}
					buildIndexByJobId={buildIndexByJobId}
					orders={orders}
					sortableTargets={sortableTargets}
					collapsedPaths={collapsedPaths}
					toggleCollapsed={toggleCollapsed}
					detailPaths={detailPaths}
					toggleDetails={toggleDetails}
				/>
			))}
		</div>
	);
}
