// Build Queue view -- plan 36 (industry-build-queue); Queue / Batch / Job (plan 39).
// Renders the active build queue as an ordered list of batch cards. The queue is solved as a
// sequential pipeline by resolveQueue (per-batch LP solve + carry-forward stock pool); this view
// assembles the blueprint context + base stock and wires the store mutations to the UI.
//
// It reuses the extracted industry / build-queue components (ProducibleItemSearch, RecipeDropdown,
// SurplusTable, the InputDrillDown tables) and the BomStockPanel for stock. Drag/drop reordering, the
// either/or recipe drill-down, and the container-sourcing UI are all live here. This view also
// hosts the queue-level extras: F3 global re-optimization (a single whole-queue solve surfaced via
// resolved.global) and F6 live drag reflow (a transient batch order fed to the SortableContext during
// a drag).

import { BomStockPanel, type SsuInventory } from "@/components/BomStockPanel";
import { ItemIcon } from "@/components/ItemIcon";
import { BatchCard } from "@/components/buildqueue/BatchCard";
import { BuildTree } from "@/components/buildqueue/BuildTree";
import {
	type DepositRow,
	DepositsTable,
	depositRowsFromRecords,
} from "@/components/buildqueue/DepositsTable";
import { QueueHeader } from "@/components/buildqueue/QueueHeader";
import { ScratchPadPanel } from "@/components/buildqueue/ScratchPadPanel";
import { SourceOverridesPanel } from "@/components/buildqueue/SourceOverridesPanel";
import { SourcingPlanTable } from "@/components/buildqueue/SourcingPlanTable";
import {
	type BatchRef,
	type QueueBlueprintData,
	formatTime,
	formatVolume,
	isRecipeSteered,
	queueOpenChoiceCount,
	resolveBlueprintForProduct,
} from "@/components/buildqueue/shared";
import { ProducibleItemSearch } from "@/components/industry/ProducibleItemSearch";
import { SurplusTable } from "@/components/industry/SurplusTable";
import { db } from "@/db";
import { CHAIN_ENABLED } from "@/featureFlags";
import {
	computeDefaultRecipes,
	findRawMaterials,
	useBlueprintData,
} from "@/hooks/useBlueprintData";
import type { Blueprint } from "@/lib/bomTypes";
import type { Batch, BuildQueue as BuildQueueModel, ContainerRef } from "@/lib/buildQueueTypes";
import type { BuildTreeBatch } from "@/lib/buildTree";
import {
	buildGateGraph,
	containerJumpDistances,
	gateJumpsBetween,
	sortContainersByDistance,
} from "@/lib/distance";
import {
	type BatchResult,
	type QueueResolveContext,
	type QueueResolveResult,
	type StockBreakdown,
	containerRefKey,
	mergeStockMaps,
	resolveQueue,
	scratchInventory,
} from "@/lib/queueResolver";
import {
	type ContainerOption,
	type QueueSourcingPlan,
	buildQueueSourcingPlan,
} from "@/lib/sourcingPlan";
import {
	addBatch,
	addJob,
	createQueue,
	moveJob,
	reorderBatches,
	setActiveQueue,
	useActiveQueue,
	useActiveQueueId,
	useBuildQueues,
} from "@/stores/buildQueueStore";
import {
	DndContext,
	type DragEndEvent,
	type DragOverEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	Clock,
	Factory,
	Info,
	Layers,
	Plus,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Every container a queue routes output INTO, across the whole outputDest cascade (queue default + locks,
 * batch default + locks, per-job overrides). Used to seed empty deposit-target containers into the stock
 * breakdown (plan 41 B1): a field unit chosen as an outputDest but with no pasted snapshot is skipped by
 * fieldStorageBreakdown, so without this it would not exist as a container and routed deposits could not
 * land there (nor be sourceable by later batches).
 */
function collectOutputDestRefs(queue: BuildQueueModel): ContainerRef[] {
	const refs: ContainerRef[] = [];
	const push = (r?: ContainerRef) => {
		if (r) refs.push(r);
	};
	push(queue.outputDefault);
	for (const l of queue.sourceLocks ?? []) push(l.outputDest);
	for (const b of queue.batches) {
		push(b.outputDefault);
		for (const l of b.sourceLocks ?? []) push(l.outputDest);
		for (const j of b.jobs) push(j.overrides?.outputDest);
	}
	return refs;
}

/**
 * Minimal collapsible section for queue-level panels. Mirrors IndustryCalculator's local
 * CollapsibleSection (which is not exported) for consistent framing.
 */
function CollapsibleSection({
	title,
	count,
	defaultOpen = false,
	collapsedSummary,
	children,
}: {
	title: string;
	count?: number;
	defaultOpen?: boolean;
	collapsedSummary?: string;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-300 hover:bg-zinc-800/30"
			>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				{title}
				{count !== undefined && <span className="text-xs text-zinc-500">({count})</span>}
				{!open && collapsedSummary && (
					<span className="ml-2 text-xs font-normal text-zinc-500">{collapsedSummary}</span>
				)}
			</button>
			{open && children}
		</div>
	);
}

/**
 * Section frame for the F3 global-plan tables. Mirrors BatchMaterials' (non-exported) Subsection so
 * the queue-level gather / build / from-stock / surplus lists read identically to the per-batch ones.
 */
function PlanSubsection({
	title,
	count,
	children,
}: {
	title: string;
	count: number;
	children: React.ReactNode;
}) {
	return (
		<div className="overflow-hidden rounded border border-zinc-800 bg-zinc-900/40">
			<div className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-400">
				{title}
				<span className="text-zinc-600">({count})</span>
			</div>
			{children}
		</div>
	);
}

export function BuildQueue() {
	const {
		blueprints,
		outputToBlueprints,
		buildableBlueprintIds,
		salvageMaterialIds,
		rawMaterialIds,
		gatherableLeafIds,
		volumeMap,
		typeGroups,
		blueprintFacilities,
		typeList,
		isLoading,
	} = useBlueprintData();

	const queues = useBuildQueues();
	const activeQueueId = useActiveQueueId();
	const activeQueue = useActiveQueue();
	const queueCount = useLiveQuery(() => db.buildQueues.count());

	// Per-SSU live inventories from the BomStockPanel (plan 41 B5). Each selected on-chain storage unit is
	// its own container in the per-container breakdown -- keeping its real objectId + solar system -- so it
	// can be a deposit / source target and be distance-ranked individually (no more anonymous aggregate).
	// Part of the resolver's baseStock (the carry-forward pool is seeded from it). The old flat localStorage
	// `bom-manual-stock` manual path was removed in plan 39 Phase 7 -- field storage containers and the
	// queue-local scratch pad now cover manual stock. Stays empty when chain is off.
	const [ssuInventories, setSsuInventories] = useState<SsuInventory[]>([]);
	const handleSsuStockChange = useCallback((s: SsuInventory[]) => setSsuInventories(s), []);

	// Field storage containers as build-queue stock (plan 39 Phase 4a). Each field storage unit's LATEST
	// snapshot becomes one container in the per-container breakdown; its quantities also fold into the flat
	// baseStock below. The breakdown is threaded into resolveQueue so it is echoed on the result for the
	// Phase 4b allocator (which attributes each material's demand back to specific containers). The chain
	// SSUs (when enabled) enter the breakdown as one container PER SSU in the resolved memo below (plan 41
	// B5); the `bom-manual-stock` manual path was removed in Phase 7 -- field storage + the scratch pad now
	// cover manual stock.
	const fieldStorageBreakdown = useLiveQuery<StockBreakdown>(async () => {
		const units = await db.fieldStorageUnits.toArray();
		const breakdown: StockBreakdown = [];
		for (const unit of units) {
			const snaps = await db.fieldStorageSnapshots
				.where("containerId")
				.equals(unit.id)
				.sortBy("timestamp");
			const latest = snaps[snaps.length - 1];
			if (!latest) continue;
			const items = new Map<number, number>();
			for (const it of latest.items) items.set(it.typeId, (items.get(it.typeId) ?? 0) + it.qty);
			breakdown.push({ ref: { kind: "field", id: unit.id }, items });
		}
		return breakdown;
	}, []);

	// Field storage units (all of them, even empty) -> selectable containers + display labels for the
	// Phase 4b sourcing plan and per-row/queue source-priority controls. The scratch pad and the aggregate
	// chain SSU stock are appended in containerEntries below. Each entry carries its solar system so the
	// source list can be distance-sorted against the queue location (plan 39 Phase 5).
	const fieldUnits = useLiveQuery(() => db.fieldStorageUnits.toArray(), []);
	const solarSystems = useLiveQuery(() => db.solarSystems.toArray(), []) ?? [];
	const jumps = useLiveQuery(() => db.jumps.toArray(), []);

	// Static gate graph (db.jumps) for container distance ranking (plan 39 Phase 5). Built once per data
	// load; null until the jump table is available.
	const gateGraph = useMemo(() => (jumps ? buildGateGraph(jumps) : null), [jumps]);
	const queueSystemId = activeQueue?.location?.systemId ?? null;

	// Whether the queue-local scratch pad currently holds any stock (plan 39 Phase 6). Gates whether the
	// scratch container is offered for ranking/exclude and folded into the breakdown below.
	const scratchHasItems = activeQueue?.scratch?.some((s) => s.qty > 0) ?? false;

	// Selectable containers paired with their solar system (for distance) + display label. The
	// queue-local scratch pad (plan 39 Phase 6) is appended as the { kind: "scratch" } container when it
	// holds anything, and each selected chain SSU as its own { kind: "chain", id } container carrying its
	// real system (plan 41 B5); all rank like any container, and (having no system) sort last (decision 11).
	const containerEntries = useMemo(() => {
		const entries: Array<{ ref: ContainerRef; label: string; systemId?: number }> = [];
		for (const unit of fieldUnits ?? []) {
			// The dedicated Ship Cargo Hold (kind "ship") is still a field unit ({ kind: "field", id }) for
			// all sourcing/breakdown/deposit logic, but is labelled by name only -- it has no "#seq".
			let label: string;
			if (unit.kind === "ship") label = unit.name?.trim() || "Ship Cargo Hold";
			else label = unit.name?.trim() ? `#${unit.seq} ${unit.name.trim()}` : `#${unit.seq}`;
			entries.push({ ref: { kind: "field", id: unit.id }, label, systemId: unit.systemId });
		}
		if (scratchHasItems) entries.push({ ref: { kind: "scratch" }, label: "Scratch" });
		for (const ssu of ssuInventories) {
			entries.push({
				ref: { kind: "chain", id: ssu.objectId },
				label: ssu.name,
				systemId: ssu.systemId,
			});
		}
		return entries;
	}, [fieldUnits, scratchHasItems, ssuInventories]);

	// Gate-jump distance from the queue location to each container (containerRefKey -> jumps|undefined).
	// Undefined when there is no queue location, the container has no system, or the two are unreachable.
	const containerJumps = useMemo(() => {
		if (!gateGraph) return new Map<string, number | undefined>();
		return containerJumpDistances(containerEntries, queueSystemId, gateGraph);
	}, [containerEntries, queueSystemId, gateGraph]);

	// Per-batch haul anchor (plan 41 B4). The costed haul readout measures gate-jumps from each source
	// container to the CONSUMING location -- a batch's own location when set, else the queue location.
	// Batches that inherit the queue location reuse the queue-anchored containerJumps as-is; only batches
	// with their own location re-anchor (one gateJumpsBetween per container -- few containers, memoized,
	// and only for the batches that override). Keyed by batchId. Distance never enters the LP (B6).
	const haulJumpsByBatch = useMemo(() => {
		const map = new Map<string, Map<string, number | undefined>>();
		for (const b of activeQueue?.batches ?? []) {
			const sys = b.location?.systemId;
			if (sys == null || sys === queueSystemId || !gateGraph) {
				map.set(b.id, containerJumps); // inherits the queue anchor (or no graph yet)
				continue;
			}
			const m = new Map<string, number | undefined>();
			for (const e of containerEntries) {
				m.set(containerRefKey(e.ref), gateJumpsBetween(gateGraph, e.systemId, sys));
			}
			map.set(b.id, m);
		}
		return map;
	}, [activeQueue, containerEntries, containerJumps, gateGraph, queueSystemId]);

	// Source list sorted by distance: nearest containers first, unknown-distance ones last (decision 11).
	const sortedEntries = useMemo(
		() => sortContainersByDistance(containerEntries, containerJumps),
		[containerEntries, containerJumps],
	);
	const containerOptions = useMemo<ContainerOption[]>(
		() => sortedEntries.map((e) => ({ ref: e.ref, label: e.label })),
		[sortedEntries],
	);
	const baseContainerLabels = useMemo(() => {
		const map = new Map<string, string>();
		for (const e of sortedEntries) map.set(containerRefKey(e.ref), e.label);
		return map;
	}, [sortedEntries]);

	// On first load with no active queue, auto-create "My Build Queue" (or adopt the most recent
	// existing one) and select it. The ref guards the gap before the active-id selection propagates.
	const creatingRef = useRef(false);
	useEffect(() => {
		if (queueCount === undefined) return; // dexie still loading
		if (activeQueueId) return; // already have an active queue
		if (creatingRef.current) return;
		creatingRef.current = true;
		(async () => {
			try {
				if (queueCount > 0) {
					const recent = await db.buildQueues.orderBy("updatedAt").reverse().first();
					if (recent) {
						await setActiveQueue(recent.id);
						return;
					}
				}
				const created = await createQueue("My Build Queue");
				await setActiveQueue(created.id);
			} finally {
				creatingRef.current = false;
			}
		})();
	}, [queueCount, activeQueueId]);

	// Buildable-only blueprint maps -- mirrors IndustryCalculator so the solver never sources an
	// intermediate through a removed-facility recipe. (No facility-filter toolbar in Phase 5.)
	const filteredBlueprints = useMemo(() => {
		const result: Record<string, Blueprint> = {};
		for (const [id, bp] of Object.entries(blueprints)) {
			if (buildableBlueprintIds.has(bp.blueprintID)) result[id] = bp;
		}
		return result;
	}, [blueprints, buildableBlueprintIds]);

	const filteredOutputToBlueprints = useMemo(() => {
		const map = new Map<number, Blueprint[]>();
		for (const [typeId, bps] of outputToBlueprints) {
			const f = bps.filter((bp) => buildableBlueprintIds.has(bp.blueprintID));
			if (f.length > 0) map.set(typeId, f);
		}
		return map;
	}, [outputToBlueprints, buildableBlueprintIds]);

	const filteredDefaultRecipes = useMemo(() => {
		const filteredRaw = findRawMaterials(filteredBlueprints, gatherableLeafIds);
		return computeDefaultRecipes(filteredOutputToBlueprints, filteredRaw);
	}, [filteredBlueprints, filteredOutputToBlueprints, gatherableLeafIds]);

	// Buildable producible products (outputs), for the add-job search.
	const producibleItems = useMemo(() => {
		const seen = new Set<number>();
		const items: Array<{ typeId: number; typeName: string }> = [];
		for (const bp of Object.values(blueprints)) {
			if (!buildableBlueprintIds.has(bp.blueprintID)) continue;
			for (const out of bp.outputs) {
				if (!seen.has(out.typeID)) {
					seen.add(out.typeID);
					items.push({ typeId: out.typeID, typeName: out.typeName });
				}
			}
		}
		items.sort((a, b) => a.typeName.localeCompare(b.typeName));
		return items;
	}, [blueprints, buildableBlueprintIds]);

	// Resolver context (field mapping straight from useBlueprintData; rawMaterialIds/typeGroups are
	// the FULL sets so source-pref grouping matches IndustryCalculator).
	const ctx = useMemo<QueueResolveContext>(
		() => ({
			blueprints: filteredBlueprints,
			outputToBlueprints: filteredOutputToBlueprints,
			defaultRecipes: filteredDefaultRecipes,
			volumeMap,
			rawMaterialIds,
			gatherableLeafIds,
			typeGroups,
			salvageMaterialIds,
		}),
		[
			filteredBlueprints,
			filteredOutputToBlueprints,
			filteredDefaultRecipes,
			volumeMap,
			rawMaterialIds,
			gatherableLeafIds,
			typeGroups,
			salvageMaterialIds,
		],
	);

	// Blueprint data threaded to the batch/job components.
	const data = useMemo<QueueBlueprintData>(
		() => ({
			blueprints: filteredBlueprints,
			outputToBlueprints: filteredOutputToBlueprints,
			defaultRecipes: filteredDefaultRecipes,
			rawMaterialIds,
			gatherableLeafIds,
			salvageMaterialIds,
			volumeMap,
			blueprintFacilities,
			typeGroups,
			producibleItems,
		}),
		[
			filteredBlueprints,
			filteredOutputToBlueprints,
			filteredDefaultRecipes,
			rawMaterialIds,
			gatherableLeafIds,
			salvageMaterialIds,
			volumeMap,
			blueprintFacilities,
			typeGroups,
			producibleItems,
		],
	);

	// Full name map for the sourcing-overrides panel (all blueprints, unfiltered).
	const fullNameMap = useMemo(() => {
		const names = new Map<number, string>();
		for (const bp of Object.values(blueprints)) {
			for (const i of bp.inputs) names.set(i.typeID, i.typeName);
			for (const o of bp.outputs) names.set(o.typeID, o.typeName);
		}
		return names;
	}, [blueprints]);

	// Solve the active queue (memoized over queue + context + base stock). `activeQueue` is reactive
	// (useActiveQueue -> useLiveQuery), so recipe-lock and sourcing writes re-fire this memo and the
	// BOM updates.
	const resolved = useMemo<QueueResolveResult | null>(() => {
		if (!activeQueue || Object.keys(ctx.blueprints).length === 0) return null;
		// Per-container stock breakdown the Phase 4b allocator attributes demand to: each field-storage
		// unit's latest snapshot, the queue-local scratch pad (plan 39 Phase 6), and one container per
		// selected chain SSU's live inventory (plan 41 B5). Sorted nearest-first by gate distance so the
		// default spillover order honors the queue location -- the LP only sees the flattened baseStock and
		// the carry-forward pool is order-independent, so reordering the breakdown is safe.
		const scratch = scratchInventory(activeQueue);
		const breakdown: StockBreakdown = [];
		for (const c of fieldStorageBreakdown ?? []) breakdown.push(c);
		if (scratch) breakdown.push(scratch);
		for (const ssu of ssuInventories) {
			breakdown.push({ ref: { kind: "chain", id: ssu.objectId }, items: ssu.items });
		}
		const present = new Set(breakdown.map((c) => containerRefKey(c.ref)));
		// Seed a container for a field unit chosen as an active-queue outputDest but with no snapshot
		// (B1 -- so routed deposits land + are sourceable). An empty seed adds nothing to baseStock but
		// makes the deposit target a real, sourceable + attributable breakdown container.
		const ensureRefs: ContainerRef[] = [];
		for (const ref of collectOutputDestRefs(activeQueue)) {
			// Seed every NAMED outputDest (field / chain / scratch) -- never the reserved Unassigned bucket
			// (that lives only inside the resolver's pool). An empty seed adds nothing to baseStock but makes
			// the deposit target a real, sourceable + attributable breakdown container.
			if (ref.kind !== "unassigned") ensureRefs.push(ref);
		}
		for (const ref of ensureRefs) {
			const key = containerRefKey(ref);
			if (present.has(key)) continue;
			present.add(key);
			breakdown.push({ ref, items: new Map() });
		}
		breakdown.sort((a, b) => {
			const ja = containerJumps.get(containerRefKey(a.ref));
			const jb = containerJumps.get(containerRefKey(b.ref));
			if (ja == null && jb == null) return 0;
			if (ja == null) return 1;
			if (jb == null) return -1;
			return ja - jb;
		});
		const baseStock = mergeStockMaps(...breakdown.map((c) => c.items));
		return resolveQueue(activeQueue, ctx, baseStock, breakdown);
	}, [activeQueue, ctx, ssuInventories, fieldStorageBreakdown, containerJumps]);

	const resultByBatch = useMemo(() => {
		const map = new Map<string, BatchResult>();
		if (resolved) for (const b of resolved.batches) map.set(b.batchId, b);
		return map;
	}, [resolved]);

	// Phase 4b -- post-solve container allocation (per material -> ordered containers + spillover). Pure
	// function of (queue, resolved): the breakdown rides on resolved.stockBreakdown. Informational only.
	const sourcingPlan = useMemo<QueueSourcingPlan | null>(() => {
		if (!resolved) return null;
		return buildQueueSourcingPlan(resolved);
	}, [resolved]);

	// Queue-total deposits (plan 41 B1) -- only used in global mode, where the per-batch material lists
	// (and their per-batch Deposits tables) are empty. Global mode has no batch order to route along, so
	// the resolver deposits everything to the reserved Unassigned bucket (decision 9); this renders those
	// recorded deposits straight from the global plan.
	const globalDeposits = useMemo<DepositRow[]>(() => {
		if (!resolved?.global) return [];
		return depositRowsFromRecords(resolved.global.deposits);
	}, [resolved]);

	// Whether any container-sourcing override is configured anywhere (gates the overrides panel so it
	// only shows once the user has containers to manage or overrides to surface/clean up).
	const hasSourceConfig = useMemo(() => {
		if (!activeQueue) return false;
		if ((activeQueue.sourceLocks?.length ?? 0) > 0 || activeQueue.sourcesDefault) return true;
		return activeQueue.batches.some(
			(b) =>
				(b.sourceLocks?.length ?? 0) > 0 || b.sourcesDefault || b.jobs.some((j) => j.overrides),
		);
	}, [activeQueue]);

	// Name resolvers for the sourcing-overrides panel (type/material name; job product name).
	const typeNameFor = useCallback(
		(typeId: number) => fullNameMap.get(typeId) ?? `Type ${typeId}`,
		[fullNameMap],
	);
	const blueprintNameFor = useCallback(
		(bpId: number) => blueprints[String(bpId)]?.primaryTypeName ?? `Blueprint #${bpId}`,
		[blueprints],
	);

	// Queue-wide count of producible inputs that still have an open either/or choice (on auto pick).
	const openChoiceCount = useMemo(() => {
		if (!resolved || !activeQueue) return 0;
		// Global mode empties the per-batch build lists, so count either/or choices from the single
		// queue-level plan (resolved.global.build) instead -- otherwise the badge would read 0.
		if (resolved.global) {
			return resolved.global.build.filter(
				(b) =>
					b.alternativeBlueprintIds.length > 1 &&
					!isRecipeSteered(b.typeId, activeQueue.recipeLocks),
			).length;
		}
		return queueOpenChoiceCount(resolved.batches, activeQueue.recipeLocks);
	}, [resolved, activeQueue]);

	const globalTreeBatch = useMemo<BuildTreeBatch | null>(() => {
		if (!resolved?.global) return null;
		return {
			jobs: resolved.batches.flatMap((batch) => batch.jobs),
			gather: resolved.global.gather,
			build: resolved.global.build,
			fromUpstream: resolved.global.fromUpstream,
		};
	}, [resolved]);

	const batchRefs = useMemo<BatchRef[]>(
		() =>
			(activeQueue?.batches ?? []).map((b, i) => ({
				id: b.id,
				label: b.label?.trim() ? b.label : `Batch ${i + 1}`,
			})),
		[activeQueue],
	);

	const handleAddBatch = useCallback(() => {
		if (activeQueue) addBatch(activeQueue.id);
	}, [activeQueue]);

	// Empty-state add: ensure a batch exists, then append the resolved job to it.
	const handleAddFirstJob = useCallback(
		async (typeId: number) => {
			if (!activeQueue) return;
			const bpId = resolveBlueprintForProduct(typeId, data);
			if (bpId == null) return;
			let batchId = activeQueue.batches[activeQueue.batches.length - 1]?.id;
			if (!batchId) batchId = await addBatch(activeQueue.id);
			await addJob(activeQueue.id, batchId, { blueprintId: bpId, runs: 1 });
		},
		[activeQueue, data],
	);

	// ── Drag and drop ────────────────────────────────────────────────────────────
	// PointerSensor with a small distance so clicks on the handle don't start spurious drags;
	// KeyboardSensor (with sortableKeyboardCoordinates) makes reorder/move fully keyboard-driven --
	// focus a grip handle, Space to pick up, arrows to move, Space to drop.
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	// Minimal info for the drag overlay (no live store mutation during drag; the store stays the
	// source of truth and commits only on drag end).
	const [activeDrag, setActiveDrag] = useState<{ type: string; label: string } | null>(null);

	// F6 -- transient batch order during a drag. Null except while a BATCH is being dragged; updated in
	// onDragOver so the batches list opens a gap LIVE (Dexie is only written on drag end). Job reordering
	// inside a batch already reflows via the sortable strategy; cross-batch job moves still commit on
	// drag end (the per-job sortable ids are batch-scoped, so a live cross-batch gap would need a stable
	// queue-wide job id -- a BatchCard / data-model change that is out of scope here).
	const [dragBatchOrder, setDragBatchOrder] = useState<string[] | null>(null);

	// Batches in their live (preview) order: the transient drag order while a batch is dragged, otherwise
	// the persisted order. Drives BOTH the SortableContext items and the rendered cards so the
	// gap-opening animation matches the order eventually committed on drag end.
	const orderedBatches = useMemo<Batch[]>(() => {
		const batches = activeQueue?.batches ?? [];
		if (!dragBatchOrder) return batches;
		const byId = new Map(batches.map((b) => [b.id, b]));
		const reordered = dragBatchOrder.map((id) => byId.get(id)).filter((b): b is Batch => b != null);
		// Fall back to the persisted order if the preview drifted out of sync (e.g. a batch vanished).
		return reordered.length === batches.length ? reordered : batches;
	}, [activeQueue, dragBatchOrder]);

	const batchIds = useMemo(() => orderedBatches.map((b) => b.id), [orderedBatches]);

	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			const d = event.active.data.current as
				| { type?: string; label?: string; name?: string }
				| undefined;
			if (d?.type === "batch") {
				setActiveDrag({ type: "batch", label: d.label ?? "Batch" });
				// Seed the transient order so the gap opens from the current layout.
				setDragBatchOrder((activeQueue?.batches ?? []).map((b) => b.id));
			} else if (d?.type === "job") {
				setActiveDrag({ type: "job", label: d.name ?? "Job" });
			} else {
				setActiveDrag(null);
			}
		},
		[activeQueue],
	);

	// F6 -- live reflow for BATCH drags: map the over target (which may be a job inside another batch)
	// to its parent batch and arrayMove the transient order. No store write happens here; the order is
	// committed once on drag end. Job drags are intentionally ignored (see dragBatchOrder note).
	const handleDragOver = useCallback(
		(event: DragOverEvent) => {
			const { active, over } = event;
			if (!over || !activeQueue) return;
			const a = active.data.current as { type?: string } | undefined;
			if (a?.type !== "batch") return;
			const o = over.data.current as { type?: string; batchId?: string } | undefined;
			const overBatchId = o?.type === "job" ? o.batchId : String(over.id);
			if (!overBatchId) return;
			setDragBatchOrder((prev) => {
				const base = prev ?? activeQueue.batches.map((b) => b.id);
				const fromIndex = base.indexOf(String(active.id));
				const toIndex = base.indexOf(overBatchId);
				if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
				return arrayMove(base, fromIndex, toIndex);
			});
		},
		[activeQueue],
	);

	// The DnD layer is THIN: it resolves from/to from the live preview (batches) or the active+over data
	// (jobs) and delegates to the store mutations (reorderBatches / moveJob). It never mutates queue
	// state directly during the drag -- only on drag end.
	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveDrag(null);
			const committedOrder = dragBatchOrder; // capture this render's preview before clearing
			setDragBatchOrder(null);
			const { active, over } = event;
			if (!over || !activeQueue) return;
			const queueId = activeQueue.id;
			const a = active.data.current as
				| { type?: string; batchId?: string; jobIndex?: number }
				| undefined;
			const o = over.data.current as
				| { type?: string; batchId?: string; jobIndex?: number }
				| undefined;

			// Reorder batches: commit the live preview order when present (it is exactly what the user
			// saw); otherwise resolve the destination from the over target (e.g. a keyboard path that
			// did not stream onDragOver). over may be a batch or a job inside one.
			if (a?.type === "batch") {
				const fromIndex = activeQueue.batches.findIndex((b) => b.id === active.id);
				let toIndex: number;
				if (committedOrder) {
					toIndex = committedOrder.indexOf(String(active.id));
				} else {
					const overBatchId = o?.type === "job" ? o.batchId : String(over.id);
					toIndex = activeQueue.batches.findIndex((b) => b.id === overBatchId);
				}
				if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
					reorderBatches(queueId, fromIndex, toIndex);
				}
				return;
			}

			// Move a job: within a batch (reorder) or across batches (regroup). Dropping over a job
			// inserts before it; dropping over a batch container appends to that batch.
			if (a?.type === "job" && a.batchId != null && a.jobIndex != null) {
				let toBatchId: string | undefined;
				let toIndex: number | undefined;
				if (o?.type === "job" && o.batchId != null) {
					toBatchId = o.batchId;
					toIndex = o.jobIndex;
				} else if (o?.type === "batch") {
					toBatchId = String(over.id);
					toIndex = undefined; // append to the batch
				} else {
					return;
				}
				if (a.batchId === toBatchId && a.jobIndex === toIndex) return;
				moveJob(queueId, a.batchId, a.jobIndex, toBatchId, toIndex);
			}
		},
		[activeQueue, dragBatchOrder],
	);

	// Drag cancelled (Esc / dropped on nothing): drop the transient preview so the list snaps back.
	const handleDragCancel = useCallback(() => {
		setActiveDrag(null);
		setDragBatchOrder(null);
	}, []);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-zinc-500">Loading blueprint data...</p>
			</div>
		);
	}

	if (!activeQueue) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-zinc-500">Preparing your build queue...</p>
			</div>
		);
	}

	const totals = resolved?.totals;
	const globalPlan = resolved?.global;

	return (
		<div className="flex h-full flex-col">
			{/* Page header */}
			<div className="border-b border-zinc-800 px-5 py-3">
				<div className="flex items-center gap-2">
					<Factory size={18} className="text-violet-500" />
					<h1 className="text-base font-semibold text-zinc-100">Build Queue</h1>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto p-6">
				<QueueHeader
					queue={activeQueue}
					queues={queues}
					openChoiceCount={openChoiceCount}
					systems={solarSystems}
				/>

				{/* Chain SSU stock -- selected on-chain storage units feed their live inventory into
				    baseStock. Only rendered when chain features are enabled (the panel is purely
				    chain-backed now; manual stock moved to field storage + the scratch pad). */}
				{CHAIN_ENABLED && (
					<div className="mb-4">
						<BomStockPanel onBreakdownChange={handleSsuStockChange} />
					</div>
				)}

				{/* Queue-local scratch pad -- speculative what-if stock for THIS queue only (plan 39 Phase
				    6). Folds into the solve as the { kind: "scratch" } container; rank/exclude it under
				    Container sourcing. Never surfaced in Assets, never selectable by other queues. */}
				<div className="mb-4">
					<ScratchPadPanel queue={activeQueue} typeList={typeList} volumeMap={volumeMap} />
				</div>

				{/* Container sourcing -- queue-level priority + per-item/per-job overrides (greying any
				    orphaned override whose target left the resolved plan). Drives the sourcing plan below. */}
				{resolved && (containerOptions.length > 0 || hasSourceConfig) && (
					<div className="mb-4">
						<CollapsibleSection
							title="Container sourcing"
							defaultOpen={hasSourceConfig}
							collapsedSummary="rank or exclude storage containers; review overrides"
						>
							<SourceOverridesPanel
								queue={activeQueue}
								resolved={resolved}
								containers={containerOptions}
								containerLabels={baseContainerLabels}
								containerJumps={containerJumps}
								nameFor={typeNameFor}
								blueprintName={blueprintNameFor}
							/>
						</CollapsibleSection>
					</div>
				)}

				{/* Queue totals */}
				{totals && activeQueue.batches.length > 0 && (
					<div className="mb-4 flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-xs text-zinc-400">
						<span className="font-medium text-zinc-300">Queue total</span>
						<span className="flex items-center gap-1" title="Total build time">
							<Clock size={12} />
							{formatTime(totals.time)}
						</span>
						<span className="flex items-center gap-1" title="Total material volume">
							<Layers size={12} />
							{formatVolume(totals.volume)} m³
						</span>
						<span className="text-zinc-600">raw {formatVolume(totals.rawVolume)} m³</span>
						{!totals.feasible && (
							<span className="ml-auto flex items-center gap-1 text-amber-400">
								<AlertTriangle size={12} />
								{globalPlan ? "no clean integer plan" : "some batches need attention"}
							</span>
						)}
					</div>
				)}

				{/* F3 -- global re-optimization plan. Rendered only in "global" mode: this single
				    whole-queue plan replaces the per-batch material breakdown (batches below still list
				    their jobs). The totals bar above already reflects globalPlan.time / volume. */}
				{globalPlan && activeQueue.batches.length > 0 && (
					<div className="mb-4 space-y-3">
						<div className="flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-3 text-xs text-violet-200/90">
							<Info size={14} className="mt-0.5 shrink-0 text-violet-300" />
							<div className="space-y-1">
								<div className="flex items-center gap-1.5 font-medium text-violet-200">
									<Zap size={13} />
									Global re-optimization
								</div>
								<p className="text-violet-200/80">
									Sourcing is optimized across the whole queue as one solve, so a recipe choice in
									one batch can share a co-product needed by another. Per-batch recipe locks are
									ignored in this mode and the per-batch material breakdown is omitted -- this
									single queue-level plan (gather / build / surplus) covers the whole queue, while
									each batch below still lists its jobs. Switch back to Per-batch for legible
									per-batch gather/build lists.
								</p>
								<p className="text-violet-200/80">
									This plan assumes free build ordering, so the batch order listed below may not be
									executable as written if a later batch's co-product feeds an earlier batch.
								</p>
							</div>
						</div>

						{globalTreeBatch &&
							(globalPlan.gather.length > 0 ||
								globalPlan.build.length > 0 ||
								globalPlan.fromUpstream.length > 0) && (
								<PlanSubsection title="Build path" count={globalTreeBatch.jobs.length}>
									<BuildTree
										batch={globalTreeBatch}
										data={data}
										queueId={activeQueue.id}
										batchId={null}
										queueLocks={activeQueue.recipeLocks}
									/>
								</PlanSubsection>
							)}

						{sourcingPlan?.global && sourcingPlan.global.length > 0 && (
							<PlanSubsection
								title="Sourcing plan (pull from storage)"
								count={sourcingPlan.global.length}
							>
								<SourcingPlanTable
									plans={sourcingPlan.global}
									containerLabels={baseContainerLabels}
									volumeMap={volumeMap}
									haulJumps={containerJumps}
								/>
							</PlanSubsection>
						)}

						{globalPlan.fromUpstream.length > 0 && (
							<PlanSubsection title="From stock" count={globalPlan.fromUpstream.length}>
								<table className="w-full text-sm">
									<thead>
										<tr className="border-t border-zinc-800 text-xs text-zinc-500">
											<th className="px-4 py-2 text-left">Item</th>
											<th className="px-4 py-2 text-right">Quantity</th>
											<th className="px-4 py-2 text-right">Volume (m³)</th>
										</tr>
									</thead>
									<tbody>
										{globalPlan.fromUpstream.map((item) => (
											<tr
												key={item.typeId}
												className="border-t border-zinc-800/50 hover:bg-zinc-800/30"
											>
												<td className="px-4 py-2 text-zinc-200">
													<span className="flex items-center gap-2">
														<ItemIcon typeId={item.typeId} />
														{item.typeName}
													</span>
												</td>
												<td className="px-4 py-2 text-right font-mono text-cyan-400">
													{item.quantity.toLocaleString()}
												</td>
												<td className="px-4 py-2 text-right font-mono text-zinc-400">
													{item.volume < 0 ? "??" : formatVolume(item.volume)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</PlanSubsection>
						)}

						{globalPlan.surplus.length > 0 && (
							<PlanSubsection title="Surplus (co-products)" count={globalPlan.surplus.length}>
								<SurplusTable items={globalPlan.surplus} />
							</PlanSubsection>
						)}

						{globalDeposits.length > 0 && (
							<PlanSubsection title="Deposits (push to storage)" count={globalDeposits.length}>
								<DepositsTable rows={globalDeposits} containerLabels={baseContainerLabels} />
							</PlanSubsection>
						)}
					</div>
				)}

				{/* Batches */}
				{activeQueue.batches.length === 0 ? (
					<div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/30 p-8 text-center">
						<Factory size={28} className="mx-auto mb-3 text-zinc-600" />
						<h2 className="mb-1 text-sm font-medium text-zinc-300">Your build queue is empty</h2>
						<p className="mb-4 text-xs text-zinc-500">
							Search for something to build, or add an empty batch to organize jobs yourself. You
							can also add blueprints straight from the Blueprint Library.
						</p>
						<div className="mx-auto max-w-md">
							<ProducibleItemSearch
								producibleItems={producibleItems}
								onSelect={(typeId) => handleAddFirstJob(typeId)}
								placeholder="Search for your first build..."
							/>
						</div>
						<button
							type="button"
							onClick={handleAddBatch}
							className="mt-4 inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-cyan-500/60 hover:text-cyan-300"
						>
							<Plus size={12} />
							Add empty batch
						</button>
					</div>
				) : (
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragStart={handleDragStart}
						onDragOver={handleDragOver}
						onDragEnd={handleDragEnd}
						onDragCancel={handleDragCancel}
					>
						<div className="space-y-3">
							<SortableContext items={batchIds} strategy={verticalListSortingStrategy}>
								{orderedBatches.map((batch, index) => (
									<BatchCard
										key={batch.id}
										queueId={activeQueue.id}
										queue={activeQueue}
										batch={batch}
										result={resultByBatch.get(batch.id)}
										index={index}
										totalBatches={orderedBatches.length}
										batches={batchRefs}
										data={data}
										recipeLocks={activeQueue.recipeLocks}
										globalMode={!!globalPlan}
										sourcingPlan={sourcingPlan?.byBatch.get(batch.id)}
										containers={containerOptions}
										containerLabels={baseContainerLabels}
										containerJumps={containerJumps}
										systems={solarSystems}
										volumeMap={volumeMap}
										haulJumps={haulJumpsByBatch.get(batch.id)}
									/>
								))}
							</SortableContext>
							<button
								type="button"
								onClick={handleAddBatch}
								className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-700 py-2.5 text-xs text-zinc-500 hover:border-cyan-500/50 hover:text-cyan-300"
							>
								<Plus size={14} />
								Add batch
							</button>
						</div>
						<DragOverlay>
							{activeDrag ? (
								<div className="rounded-lg border border-cyan-500/60 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 shadow-xl">
									{activeDrag.label}
								</div>
							) : null}
						</DragOverlay>
					</DndContext>
				)}
			</div>
		</div>
	);
}
