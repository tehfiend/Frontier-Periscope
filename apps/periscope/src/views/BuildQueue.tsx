// Production Orders view -- plan 36 (industry-build-queue); Queue / Order / Job (plan 39); unified
// production-order grid (plan 44). Renders the active queue as ONE grid: a single shared column
// header, each Order a draggable group band with its OWN nested build tree, and the Queue BOM as the
// footer. The queue is solved as a sequential per-order pipeline by resolveQueue (per-order LP solve
// + carry-forward stock pool); this view assembles the blueprint context + base stock and wires the
// store mutations to the UI. Drag/drop reordering, the either/or recipe drill-down, and the
// container-sourcing UI are all live here. (Global re-optimization mode was removed in plan 44 --
// every Order always keeps its own nested tree; F6 live drag reflow feeds a transient order sequence
// to the SortableContext during a drag.)

import { ItemIcon } from "@/components/ItemIcon";
import { facilityNamesFromBlueprintFacilities } from "@/components/buildqueue/FacilityPreferencePanel";
import { OrderCard } from "@/components/buildqueue/OrderCard";
import { QueueHeader } from "@/components/buildqueue/QueueHeader";
import { SourceOverridesPanel } from "@/components/buildqueue/SourceOverridesPanel";
import { StockPanel, type SsuInventory } from "@/components/buildqueue/StockPanel";
import {
	type OrderRef,
	type QueueBlueprintData,
	formatTime,
	formatVolume,
	queueOpenChoiceCount,
	resolveBlueprintForProduct,
} from "@/components/buildqueue/shared";
import { ProducibleItemSearch } from "@/components/industry/ProducibleItemSearch";
import { db } from "@/db";
import {
	computeDefaultRecipes,
	findRawMaterials,
	useBlueprintData,
} from "@/hooks/useBlueprintData";
import { useCharacterRecentSystems } from "@/hooks/useCharacterRecentSystems";
import type { Blueprint } from "@/lib/bomTypes";
import type { BuildQueue as BuildQueueModel, ContainerRef, Order } from "@/lib/buildQueueTypes";
import {
	buildGateGraph,
	containerJumpDistances,
	gateJumpsBetween,
	sortContainersByDistance,
} from "@/lib/distance";
import {
	type OrderResult,
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
	addJob,
	addOrder,
	createQueue,
	moveJob,
	reorderOrders,
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
	Layers,
	Plus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Every container a queue routes output INTO, across the whole outputDest cascade (queue default + locks,
 * order default + locks, per-job overrides). Used to seed empty deposit-target containers into the stock
 * breakdown (plan 41 B1): a field unit chosen as an outputDest but with no pasted snapshot is skipped by
 * fieldStorageBreakdown, so without this it would not exist as a container and routed deposits could not
 * land there (nor be sourceable by later orders).
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

	// Per-SSU live inventories from the StockPanel (plan 41 B5). Each enabled on-chain storage unit is
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
	// Recently visited systems for the active character -- computed once, shared by the queue and
	// every order location picker as their quick-select list.
	const recentSystems = useCharacterRecentSystems(solarSystems);
	const jumps = useLiveQuery(() => db.jumps.toArray(), []);
	const systemNames = useMemo(
		() => new Map(solarSystems.map((system) => [system.id, system.name ?? `#${system.id}`])),
		[solarSystems],
	);

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

	// Per-Order haul anchor (plan 41 B4). The costed haul readout measures gate-jumps from each source
	// container to the CONSUMING location -- an order's own location when set, else the queue location.
	// Orders that inherit the queue location reuse the queue-anchored containerJumps as-is; only orders
	// with their own location re-anchor (one gateJumpsBetween per container -- few containers, memoized,
	// and only for the orders that override). Keyed by orderId. Distance never enters the LP (B6).
	const haulJumpsByOrder = useMemo(() => {
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
	// Container display info (label + solar system) keyed by containerRefKey -- lets the build tree name
	// the storage an already-held item is sourced FROM, and the system that storage sits in, instead of
	// the recipe/gather data it would otherwise show for stock-covered rows.
	const containerInfo = useMemo(() => {
		const map = new Map<string, { label: string; systemId?: number }>();
		for (const e of sortedEntries) {
			map.set(containerRefKey(e.ref), { label: e.label, systemId: e.systemId });
		}
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

	const facilityNames = useMemo(
		() => facilityNamesFromBlueprintFacilities(blueprintFacilities),
		[blueprintFacilities],
	);

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

	// Blueprint data threaded to the order/job components.
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
			facilityNames,
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
			facilityNames,
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
		// Unified stock list (plan: unified storage). The queue's persisted stockSources sets each
		// container's enabled state (a disabled one contributes NO inventory) and its sourcing priority
		// (list order). Field storage + scratch default enabled; SSUs only reach ssuInventories when
		// enabled (the panel fetches only ticked units), so they are always included here.
		const stockOrderIndex = new Map(
			(activeQueue.stockSources ?? []).map((s, i) => [containerRefKey(s.ref), i] as const),
		);
		const stockEnabledByKey = new Map(
			(activeQueue.stockSources ?? []).map((s) => [containerRefKey(s.ref), s.enabled] as const),
		);
		const isStockEnabled = (ref: ContainerRef) =>
			stockEnabledByKey.get(containerRefKey(ref)) ?? true;

		const scratch = scratchInventory(activeQueue);
		const breakdown: StockBreakdown = [];
		for (const c of fieldStorageBreakdown ?? []) if (isStockEnabled(c.ref)) breakdown.push(c);
		if (scratch && isStockEnabled(scratch.ref)) breakdown.push(scratch);
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
		// Priority: the user's explicit stock-list order first; distance from the queue location breaks
		// ties among containers the user has not manually arranged (unknown-distance ones sort last).
		breakdown.sort((a, b) => {
			const ia = stockOrderIndex.get(containerRefKey(a.ref)) ?? Number.POSITIVE_INFINITY;
			const ib = stockOrderIndex.get(containerRefKey(b.ref)) ?? Number.POSITIVE_INFINITY;
			if (ia !== ib) return ia - ib;
			const ja = containerJumps.get(containerRefKey(a.ref));
			const jb = containerJumps.get(containerRefKey(b.ref));
			if (ja == null && jb == null) return 0;
			if (ja == null) return 1;
			if (jb == null) return -1;
			return ja - jb;
		});
		const baseStock = mergeStockMaps(...breakdown.map((c) => c.items));
		// Global re-optimization mode was removed (plan 44) -- always solve per-order so every Order
		// keeps its own nested build tree. Any queue with a stale persisted `reoptMode: "global"` is
		// coerced back to per-order here (the field is left untouched; it is simply never honored).
		return resolveQueue({ ...activeQueue, reoptMode: "perStep" }, ctx, baseStock, breakdown);
	}, [activeQueue, ctx, ssuInventories, fieldStorageBreakdown, containerJumps]);

	const resultByOrder = useMemo(() => {
		const map = new Map<string, OrderResult>();
		if (resolved) for (const b of resolved.orders) map.set(b.orderId, b);
		return map;
	}, [resolved]);

	// Phase 4b -- post-solve container allocation (per material -> ordered containers + spillover). Pure
	// function of (queue, resolved): the breakdown rides on resolved.stockBreakdown. Informational only.
	const sourcingPlan = useMemo<QueueSourcingPlan | null>(() => {
		if (!resolved) return null;
		return buildQueueSourcingPlan(resolved);
	}, [resolved]);

	// Whether any container-sourcing override is configured anywhere (gates the overrides panel so it
	// only shows once the user has containers to manage or overrides to surface/clean up).
	const hasSourceConfig = useMemo(() => {
		if (!activeQueue) return false;
		if (
			(activeQueue.sourceLocks?.length ?? 0) > 0 ||
			activeQueue.sourcesDefault ||
			activeQueue.outputDefault ||
			activeQueue.facilityExclude !== undefined
		) {
			return true;
		}
		return activeQueue.batches.some(
			(b) =>
				(b.sourceLocks?.length ?? 0) > 0 ||
				b.sourcesDefault ||
				b.outputDefault ||
				b.facilityExclude !== undefined ||
				b.jobs.some(
					(j) =>
						j.overrides?.sources ||
						j.overrides?.outputDest ||
						j.overrides?.facilityExclude !== undefined,
				),
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
		return queueOpenChoiceCount(resolved.orders, activeQueue.recipeLocks);
	}, [resolved, activeQueue]);

	// Queue-level BOM roll-up (plan 44, OQ-3): SUM each order's already-resolved net need (post-stock,
	// post-carry-forward stillNeed) across the whole queue -- never gross demand, so an intermediate
	// covered by an earlier order's surplus does not reappear here.
	const queueRollup = useMemo(() => {
		if (!resolved) return null;
		const acc = new Map<number, { typeId: number; typeName: string; qty: number; raw: boolean }>();
		const add = (item: { typeId: number; typeName: string; stillNeed: number }, raw: boolean) => {
			if (item.stillNeed <= 0) return;
			const entry = acc.get(item.typeId) ?? {
				typeId: item.typeId,
				typeName: item.typeName,
				qty: 0,
				raw,
			};
			entry.qty += item.stillNeed;
			acc.set(item.typeId, entry);
		};
		for (const order of resolved.orders) {
			for (const g of order.gather) add(g, true);
			for (const b of order.build) add(b, false);
		}
		const rows = [...acc.values()].sort(
			(a, b) => Number(a.raw) - Number(b.raw) || a.typeName.localeCompare(b.typeName),
		);
		return rows.length > 0 ? rows : null;
	}, [resolved]);

	const orderRefs = useMemo<OrderRef[]>(
		() =>
			(activeQueue?.batches ?? []).map((b, i) => ({
				id: b.id,
				label: b.label?.trim() ? b.label : `Order ${i + 1}`,
			})),
		[activeQueue],
	);

	const handleAddOrder = useCallback(() => {
		if (activeQueue) addOrder(activeQueue.id);
	}, [activeQueue]);

	// Empty-state add: ensure an order exists, then append the resolved job to it.
	const handleAddFirstJob = useCallback(
		async (typeId: number) => {
			if (!activeQueue) return;
			const bpId = resolveBlueprintForProduct(typeId, data);
			if (bpId == null) return;
			let orderId = activeQueue.batches[activeQueue.batches.length - 1]?.id;
			if (!orderId) orderId = await addOrder(activeQueue.id);
			await addJob(activeQueue.id, orderId, { blueprintId: bpId, runs: 1 });
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

	// Queue-level BOM footer band (plan 44) -- collapsed by default.
	const [queueBomOpen, setQueueBomOpen] = useState(false);

	// F6 -- transient order sequence during a drag. Null except while an order is being dragged; updated in
	// onDragOver so the orders list opens a gap LIVE (Dexie is only written on drag end). Job reordering
	// inside an order already reflows via the sortable strategy; cross-order job moves still commit on
	// drag end (the per-job sortable ids are order-scoped, so a live cross-order gap would need a stable
	// queue-wide job id -- an OrderCard / data-model change that is out of scope here).
	const [dragOrderSequence, setDragOrderSequence] = useState<string[] | null>(null);

	// Orders in their live (preview) order: the transient drag order while an order is dragged, otherwise
	// the persisted order. Drives BOTH the SortableContext items and the rendered cards so the
	// gap-opening animation matches the order eventually committed on drag end.
	const orderedOrders = useMemo<Order[]>(() => {
		const orders = activeQueue?.batches ?? [];
		if (!dragOrderSequence) return orders;
		const byId = new Map(orders.map((b) => [b.id, b]));
		const reordered = dragOrderSequence
			.map((id) => byId.get(id))
			.filter((b): b is Order => b != null);
		// Fall back to the persisted order if the preview drifted out of sync (e.g. an order vanished).
		return reordered.length === orders.length ? reordered : orders;
	}, [activeQueue, dragOrderSequence]);

	const orderIds = useMemo(() => orderedOrders.map((b) => b.id), [orderedOrders]);

	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			const d = event.active.data.current as
				| { type?: string; label?: string; name?: string }
				| undefined;
			if (d?.type === "order") {
				setActiveDrag({ type: "order", label: d.label ?? "Order" });
				// Seed the transient order so the gap opens from the current layout.
				setDragOrderSequence((activeQueue?.batches ?? []).map((b) => b.id));
			} else if (d?.type === "job") {
				setActiveDrag({ type: "job", label: d.name ?? "Job" });
			} else {
				setActiveDrag(null);
			}
		},
		[activeQueue],
	);

	// F6 -- live reflow for ORDER drags: map the over target (which may be a job inside another order)
	// to its parent order and arrayMove the transient order. No store write happens here; the order is
	// committed once on drag end. Job drags are intentionally ignored (see dragOrderSequence note).
	const handleDragOver = useCallback(
		(event: DragOverEvent) => {
			const { active, over } = event;
			if (!over || !activeQueue) return;
			const a = active.data.current as { type?: string } | undefined;
			if (a?.type !== "order") return;
			const o = over.data.current as { type?: string; orderId?: string } | undefined;
			const overOrderId = o?.type === "job" ? o.orderId : String(over.id);
			if (!overOrderId) return;
			setDragOrderSequence((prev) => {
				const base = prev ?? activeQueue.batches.map((b) => b.id);
				const fromIndex = base.indexOf(String(active.id));
				const toIndex = base.indexOf(overOrderId);
				if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
				return arrayMove(base, fromIndex, toIndex);
			});
		},
		[activeQueue],
	);

	// The DnD layer is THIN: it resolves from/to from the live preview (orders) or the active+over data
	// (jobs) and delegates to the store mutations (reorderOrders / moveJob). It never mutates queue
	// state directly during the drag -- only on drag end.
	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveDrag(null);
			const committedOrder = dragOrderSequence; // capture this render's preview before clearing
			setDragOrderSequence(null);
			const { active, over } = event;
			if (!over || !activeQueue) return;
			const queueId = activeQueue.id;
			const a = active.data.current as
				| { type?: string; orderId?: string; jobIndex?: number }
				| undefined;
			const o = over.data.current as
				| { type?: string; orderId?: string; jobIndex?: number }
				| undefined;

			// Reorder orders: commit the live preview order when present (it is exactly what the user
			// saw); otherwise resolve the destination from the over target (e.g. a keyboard path that
			// did not stream onDragOver). over may be an order or a job inside one.
			if (a?.type === "order") {
				const fromIndex = activeQueue.batches.findIndex((b) => b.id === active.id);
				let toIndex: number;
				if (committedOrder) {
					toIndex = committedOrder.indexOf(String(active.id));
				} else {
					const overOrderId = o?.type === "job" ? o.orderId : String(over.id);
					toIndex = activeQueue.batches.findIndex((b) => b.id === overOrderId);
				}
				if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
					reorderOrders(queueId, fromIndex, toIndex);
				}
				return;
			}

			// Move a job: within an order (reorder) or across orders (regroup). Dropping over a job
			// inserts before it; dropping over an order container appends to that order.
			if (a?.type === "job" && a.orderId != null && a.jobIndex != null) {
				let toOrderId: string | undefined;
				let toIndex: number | undefined;
				if (o?.type === "job" && o.orderId != null) {
					toOrderId = o.orderId;
					toIndex = o.jobIndex;
				} else if (o?.type === "order") {
					toOrderId = String(over.id);
					toIndex = undefined; // append to the order
				} else {
					return;
				}
				if (a.orderId === toOrderId && a.jobIndex === toIndex) return;
				moveJob(queueId, a.orderId, a.jobIndex, toOrderId, toIndex);
			}
		},
		[activeQueue, dragOrderSequence],
	);

	// Drag cancelled (Esc / dropped on nothing): drop the transient preview so the list snaps back.
	const handleDragCancel = useCallback(() => {
		setActiveDrag(null);
		setDragOrderSequence(null);
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

	// Queue BOM footer band -- the footer of the single production-order grid (plan 44).
	const queueBomFooter = queueRollup ? (
		<div className="border-t border-zinc-800 bg-zinc-900/60">
			<button
				type="button"
				onClick={() => setQueueBomOpen((o) => !o)}
				className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-zinc-300 hover:bg-zinc-800/30"
				aria-expanded={queueBomOpen}
			>
				{queueBomOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				Queue BOM (all orders)
				<span className="text-zinc-500">({queueRollup.length})</span>
				{!queueBomOpen && (
					<span className="ml-2 font-normal text-zinc-500">
						net need summed across every order, post-stock and carry-forward
					</span>
				)}
			</button>
			{queueBomOpen && (
				<table className="w-full text-sm">
					<thead>
						<tr className="border-t border-zinc-800 text-xs text-zinc-500">
							<th className="px-4 py-2 text-left">Item</th>
							<th className="px-4 py-2 text-left">Kind</th>
							<th className="px-4 py-2 text-right">Need</th>
							<th className="px-4 py-2 text-right">Volume (m³)</th>
						</tr>
					</thead>
					<tbody>
						{queueRollup.map((row) => {
							const unit = volumeMap.get(row.typeId);
							return (
								<tr key={row.typeId} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
									<td className="px-4 py-2 text-zinc-200">
										<span className="flex items-center gap-2">
											<ItemIcon typeId={row.typeId} />
											{row.typeName}
										</span>
									</td>
									<td className="px-4 py-2">
										{row.raw ? (
											<span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
												Gather
											</span>
										) : (
											<span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
												Build
											</span>
										)}
									</td>
									<td className="px-4 py-2 text-right font-mono text-violet-300">
										{row.qty.toLocaleString()}
									</td>
									<td className="px-4 py-2 text-right font-mono text-zinc-400">
										{unit == null ? "??" : formatVolume(unit * row.qty)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}
		</div>
	) : null;

	return (
		<div className="flex h-full flex-col">
			{/* Page header */}
			<div className="border-b border-zinc-800 px-5 py-3">
				<div className="flex items-center gap-2">
					<Factory size={18} className="text-violet-500" />
					<h1 className="text-base font-semibold text-zinc-100">Industry Calculator</h1>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto p-6">
				<QueueHeader
					queue={activeQueue}
					queues={queues}
					openChoiceCount={openChoiceCount}
					systems={solarSystems}
					recentSystems={recentSystems}
				/>

				{/* Unified stock -- one card for every source feeding this queue's baseStock: field storage +
				    ship cargo (auto-included), the on-chain SSUs (selectable; each pick fetches live chain
				    inventory), and the queue-local scratch pad (what-if stock). */}
				<div className="mb-4">
					<StockPanel
						queue={activeQueue}
						typeList={typeList}
						volumeMap={volumeMap}
						systemNames={systemNames}
						recentSystems={recentSystems}
						onSsuStockChange={handleSsuStockChange}
					/>
				</div>

				{/* Container sourcing -- queue-level priority + per-item/per-job overrides (greying any
				    orphaned override whose target left the resolved plan). Drives the sourcing plan below. */}
				{resolved &&
					(containerOptions.length > 0 || facilityNames.length > 0 || hasSourceConfig) && (
						<div className="mb-4">
							<CollapsibleSection
								title="Build preferences"
								defaultOpen={hasSourceConfig}
								collapsedSummary="facility availability, storage priority, and overrides"
							>
								<SourceOverridesPanel
									queue={activeQueue}
									resolved={resolved}
									containers={containerOptions}
									containerLabels={baseContainerLabels}
									containerJumps={containerJumps}
									facilityNames={facilityNames}
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
								some orders need attention
							</span>
						)}
					</div>
				)}

				{/* Orders -- ONE unified grid in BOTH modes (plan 44). Per-order mode groups Targets under
				    draggable Order bands; global mode shows the single shared-solve tree (Order-tagged) and
				    moves order editing into a "Manage orders" settings panel. Empty state is shared. */}
				{activeQueue.batches.length === 0 ? (
					<div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/30 p-8 text-center">
						<Factory size={28} className="mx-auto mb-3 text-zinc-600" />
						<h2 className="mb-1 text-sm font-medium text-zinc-300">Your build queue is empty</h2>
						<p className="mb-4 text-xs text-zinc-500">
							Search for something to build, or add an empty order to organize jobs yourself. You
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
							onClick={handleAddOrder}
							className="mt-4 inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-cyan-500/60 hover:text-cyan-300"
						>
							<Plus size={12} />
							Add empty order
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
						{/* Single production-order grid (plan 44): each Order is a draggable group band with
						    its OWN nested build tree + column header, and the Queue BOM is the footer. */}
						<div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
							<SortableContext items={orderIds} strategy={verticalListSortingStrategy}>
								{orderedOrders.map((order, index) => (
									<OrderCard
										key={order.id}
										queueId={activeQueue.id}
										queue={activeQueue}
										order={order}
										result={resultByOrder.get(order.id)}
										index={index}
										totalOrders={orderedOrders.length}
										orders={orderRefs}
										data={data}
										recipeLocks={activeQueue.recipeLocks}
										sourcingPlan={sourcingPlan?.byOrder.get(order.id)}
										containers={containerOptions}
										containerLabels={baseContainerLabels}
										containerInfo={containerInfo}
										containerJumps={containerJumps}
										systems={solarSystems}
										recentSystems={recentSystems}
										systemNames={systemNames}
										volumeMap={volumeMap}
										haulJumps={haulJumpsByOrder.get(order.id)}
									/>
								))}
							</SortableContext>

							<button
								type="button"
								onClick={handleAddOrder}
								className="flex w-full items-center justify-center gap-1 border-t border-zinc-800 py-2.5 text-xs text-zinc-500 hover:bg-zinc-800/40 hover:text-cyan-300"
							>
								<Plus size={14} />
								Add order
							</button>

							{queueBomFooter}
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
