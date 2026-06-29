// Build Queue view -- plan 36 (industry-build-queue).
// Renders the active build queue as an ordered list of step cards. The queue is solved as a
// sequential pipeline by resolveQueue (per-step LP solve + carry-forward stock pool); this view
// assembles the blueprint context + base stock and wires the store mutations to the UI.
//
// It reuses the extracted industry / build-queue components (ProducibleItemSearch, RecipeDropdown,
// SurplusTable, the InputDrillDown tables) and the BomStockPanel for stock. Drag/drop reordering, the
// either/or recipe drill-down, and the source-pref steering UI are all live here. This view also
// hosts the queue-level extras: F3 global re-optimization (a single whole-queue solve surfaced via
// resolved.global), F4 cross-queue stock (folding other queues' resolved finalPool into baseStock),
// and F6 live drag reflow (a transient step order fed to the SortableContext during a drag).

import { BomStockPanel } from "@/components/BomStockPanel";
import { ItemIcon } from "@/components/ItemIcon";
import { BuildChoiceTable, RawSourceTable } from "@/components/buildqueue/InputDrillDown";
import { QueueHeader } from "@/components/buildqueue/QueueHeader";
import { StepCard } from "@/components/buildqueue/StepCard";
import {
	type QueueBlueprintData,
	type StepRef,
	formatTime,
	formatVolume,
	isRecipeSteered,
	queueOpenChoiceCount,
	resolveBlueprintForProduct,
} from "@/components/buildqueue/shared";
import { ProducibleItemSearch } from "@/components/industry/ProducibleItemSearch";
import { SourcePrefsPanel } from "@/components/industry/SourcePrefsPanel";
import { SurplusTable } from "@/components/industry/SurplusTable";
import { db } from "@/db";
import {
	computeDefaultRecipes,
	findRawMaterials,
	useBlueprintData,
} from "@/hooks/useBlueprintData";
import type { Blueprint } from "@/lib/bomTypes";
import type { BuildStep } from "@/lib/buildQueueTypes";
import {
	type QueueResolveContext,
	type QueueResolveResult,
	type StepResult,
	mergeStockMaps,
	resolveQueue,
} from "@/lib/queueResolver";
import {
	addJob,
	addStep,
	addStockSource,
	createQueue,
	moveJob,
	removeStockSource,
	reorderSteps,
	resetSourcePrefs,
	setActiveQueue,
	setSourcePref,
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
	Boxes,
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
 * Minimal collapsible section for the queue-level Sources panel. Mirrors IndustryCalculator's local
 * CollapsibleSection (which is not exported) so the Build Queue view can frame the reused
 * SourcePrefsPanel the same way without reaching into IndustryCalculator.
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
 * Section frame for the F3 global-plan tables. Mirrors StepMaterials' (non-exported) Subsection so
 * the queue-level gather / build / from-stock / surplus lists read identically to the per-step ones.
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

	// Stock pool from the BomStockPanel (SSU inventory + manual entries). This is the resolver's
	// baseStock -- the carry-forward pool is seeded from it. SSU + manual stock are both handled by
	// the reused BomStockPanel; no Build-Queue-specific stock follow-up is needed.
	const [stockMap, setStockMap] = useState<Map<number, number>>(new Map());
	const handleStockChange = useCallback((m: Map<number, number>) => setStockMap(m), []);

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
		const filteredRaw = findRawMaterials(filteredBlueprints);
		return computeDefaultRecipes(filteredOutputToBlueprints, filteredRaw, salvageMaterialIds);
	}, [filteredBlueprints, filteredOutputToBlueprints, salvageMaterialIds]);

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
			typeGroups,
			salvageMaterialIds,
		}),
		[
			filteredBlueprints,
			filteredOutputToBlueprints,
			filteredDefaultRecipes,
			volumeMap,
			rawMaterialIds,
			typeGroups,
			salvageMaterialIds,
		],
	);

	// Blueprint data threaded to the step/job components.
	const data = useMemo<QueueBlueprintData>(
		() => ({
			blueprints: filteredBlueprints,
			outputToBlueprints: filteredOutputToBlueprints,
			defaultRecipes: filteredDefaultRecipes,
			rawMaterialIds,
			salvageMaterialIds,
			blueprintFacilities,
			typeGroups,
			producibleItems,
		}),
		[
			filteredBlueprints,
			filteredOutputToBlueprints,
			filteredDefaultRecipes,
			rawMaterialIds,
			salvageMaterialIds,
			blueprintFacilities,
			typeGroups,
			producibleItems,
		],
	);

	// Source groups for the queue-level Sources panel (group raws by source, mirrors
	// IndustryCalculator). The full-set rawMaterialIds/typeGroups make grouping match the resolver.
	const sourceGroups = useMemo(() => {
		const groupToIds = new Map<string, number[]>();
		for (const rawId of rawMaterialIds) {
			const group = typeGroups.get(rawId) ?? "Other";
			const arr = groupToIds.get(group);
			if (arr) arr.push(rawId);
			else groupToIds.set(group, [rawId]);
		}
		return [...groupToIds.entries()]
			.map(([group, ids]) => ({ group, ids }))
			.sort((a, b) => a.group.localeCompare(b.group));
	}, [rawMaterialIds, typeGroups]);

	// Full name map for the Sources panel's per-group sample tooltip (all blueprints, unfiltered).
	const fullNameMap = useMemo(() => {
		const names = new Map<number, string>();
		for (const bp of Object.values(blueprints)) {
			for (const i of bp.inputs) names.set(i.typeID, i.typeName);
			for (const o of bp.outputs) names.set(o.typeID, o.typeName);
		}
		return names;
	}, [blueprints]);

	// F4 -- cross-queue stock. For each id in activeQueue.stockFromQueueIds, resolve that queue ONE
	// LEVEL DEEP in per-step mode (forcing perStep regardless of its own mode) against an EMPTY base
	// stock -- so its leftover output (totals.finalPool) is exactly what THAT queue produces, with no
	// double-counting of the user's stock. The resolver never reads stockFromQueueIds, so this never
	// recurses into a source queue's own sources; the self-guard + missing-queue guard close the rest
	// of the cycle surface. The pools are merged into baseStock below before solving the active queue.
	// F4 perf -- key the cross-queue resolve on a stable signature of just the SOURCE queues (their ids
	// + updatedAt), not the whole `queues`/`activeQueue` (which get a new reference on ANY queue write).
	// Because the active queue is guarded out of its own sources, editing it leaves srcSig unchanged, so
	// the (potentially multi-second) source resolves do NOT re-run on every active-queue edit.
	const byId = useMemo(() => new Map(queues.map((q) => [q.id, q])), [queues]);
	const sourceQueueIds = activeQueue?.stockFromQueueIds ?? [];
	const srcSig = sourceQueueIds.map((id) => `${id}:${byId.get(id)?.updatedAt ?? 0}`).join("|");
	// srcSig captures the source ids + their updatedAt; byId / sourceQueueIds / activeQueueId are all
	// read through that signature, so listing them as deps would re-run on every active-queue edit and
	// defeat the perf fix -- hence the narrow suppression below.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional -- recompute only when source queues change (srcSig)
	const crossQueueStock = useMemo(() => {
		if (!activeQueueId || sourceQueueIds.length === 0) return null;
		if (Object.keys(ctx.blueprints).length === 0) return null;
		const empty = new Map<number, number>();
		const finalPools: Array<Map<number, number>> = [];
		const contributing: Array<{ id: string; name: string; itemCount: number }> = [];
		for (const id of sourceQueueIds) {
			if (id === activeQueueId) continue; // never source from self
			const src = byId.get(id);
			if (!src) continue; // queue was deleted / not loaded
			// Force perStep + empty base: one level deep, no nested stock sources -> no cycles.
			const srcResolved = resolveQueue({ ...src, reoptMode: "perStep" }, ctx, empty);
			const pool = srcResolved.totals.finalPool;
			finalPools.push(pool);
			let itemCount = 0;
			for (const qty of pool.values()) if (qty > 0) itemCount++;
			contributing.push({ id, name: src.name, itemCount });
		}
		if (finalPools.length === 0) return null;
		return { finalPools, contributing };
	}, [srcSig, ctx]);

	// Solve the active queue (memoized over queue + context + base stock). `activeQueue` is reactive
	// (useActiveQueue -> useLiveQuery), so any recipe-lock / source-pref write re-fires this memo and
	// the BOM updates -- the Phase 7 lock/prefer/eliminate + source controls flow straight through.
	// When F4 stock sources are set, their resolved finalPools are merged into the base stock first;
	// changing the sources re-fires this memo (crossQueueStock dep) so the plan re-resolves.
	const resolved = useMemo<QueueResolveResult | null>(() => {
		if (!activeQueue || Object.keys(ctx.blueprints).length === 0) return null;
		const baseStock = crossQueueStock
			? mergeStockMaps(stockMap, ...crossQueueStock.finalPools)
			: stockMap;
		return resolveQueue(activeQueue, ctx, baseStock);
	}, [activeQueue, ctx, stockMap, crossQueueStock]);

	const resultByStep = useMemo(() => {
		const map = new Map<string, StepResult>();
		if (resolved) for (const s of resolved.steps) map.set(s.stepId, s);
		return map;
	}, [resolved]);

	// Queue-wide count of producible inputs that still have an open either/or choice (on auto pick).
	const openChoiceCount = useMemo(() => {
		if (!resolved || !activeQueue) return 0;
		// Global mode empties the per-step build lists, so count either/or choices from the single
		// queue-level plan (resolved.global.build) instead -- otherwise the badge would read 0.
		if (resolved.global) {
			return resolved.global.build.filter(
				(b) =>
					b.alternativeBlueprintIds.length > 1 && !isRecipeSteered(b.typeId, activeQueue.recipeLocks),
			).length;
		}
		return queueOpenChoiceCount(resolved.steps, activeQueue.recipeLocks);
	}, [resolved, activeQueue]);

	const stepRefs = useMemo<StepRef[]>(
		() =>
			(activeQueue?.steps ?? []).map((s, i) => ({
				id: s.id,
				label: s.label?.trim() ? s.label : `Step ${i + 1}`,
			})),
		[activeQueue],
	);

	// F4 -- the other saved queues that can act as stock sources (everything but the active one), and
	// a lookup of how many distinct item types each currently-selected source is contributing.
	const otherQueues = useMemo(
		() => queues.filter((q) => q.id !== activeQueue?.id),
		[queues, activeQueue],
	);
	const stockContribById = useMemo(() => {
		const m = new Map<string, number>();
		if (crossQueueStock) for (const c of crossQueueStock.contributing) m.set(c.id, c.itemCount);
		return m;
	}, [crossQueueStock]);

	const handleAddStep = useCallback(() => {
		if (activeQueue) addStep(activeQueue.id);
	}, [activeQueue]);

	// Empty-state add: ensure a step exists, then append the resolved job to it.
	const handleAddFirstJob = useCallback(
		async (typeId: number) => {
			if (!activeQueue) return;
			const bpId = resolveBlueprintForProduct(typeId, data);
			if (bpId == null) return;
			let stepId = activeQueue.steps[activeQueue.steps.length - 1]?.id;
			if (!stepId) stepId = await addStep(activeQueue.id);
			await addJob(activeQueue.id, stepId, { blueprintId: bpId, runs: 1 });
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

	// F6 -- transient step order during a drag. Null except while a STEP is being dragged; updated in
	// onDragOver so the steps list opens a gap LIVE (Dexie is only written on drag end). Job reordering
	// inside a step already reflows via the sortable strategy; cross-step job moves still commit on
	// drag end (the per-job sortable ids are step-scoped, so a live cross-step gap would need a stable
	// queue-wide job id -- a StepCard / data-model change that is out of scope here).
	const [dragStepOrder, setDragStepOrder] = useState<string[] | null>(null);

	// Steps in their live (preview) order: the transient drag order while a step is dragged, otherwise
	// the persisted order. Drives BOTH the SortableContext items and the rendered cards so the
	// gap-opening animation matches the order eventually committed on drag end.
	const orderedSteps = useMemo<BuildStep[]>(() => {
		const steps = activeQueue?.steps ?? [];
		if (!dragStepOrder) return steps;
		const byId = new Map(steps.map((s) => [s.id, s]));
		const reordered = dragStepOrder
			.map((id) => byId.get(id))
			.filter((s): s is BuildStep => s != null);
		// Fall back to the persisted order if the preview drifted out of sync (e.g. a step vanished).
		return reordered.length === steps.length ? reordered : steps;
	}, [activeQueue, dragStepOrder]);

	const stepIds = useMemo(() => orderedSteps.map((s) => s.id), [orderedSteps]);

	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			const d = event.active.data.current as
				| { type?: string; label?: string; name?: string }
				| undefined;
			if (d?.type === "step") {
				setActiveDrag({ type: "step", label: d.label ?? "Step" });
				// Seed the transient order so the gap opens from the current layout.
				setDragStepOrder((activeQueue?.steps ?? []).map((s) => s.id));
			} else if (d?.type === "job") {
				setActiveDrag({ type: "job", label: d.name ?? "Job" });
			} else {
				setActiveDrag(null);
			}
		},
		[activeQueue],
	);

	// F6 -- live reflow for STEP drags: map the over target (which may be a job inside another step)
	// to its parent step and arrayMove the transient order. No store write happens here; the order is
	// committed once on drag end. Job drags are intentionally ignored (see dragStepOrder note).
	const handleDragOver = useCallback(
		(event: DragOverEvent) => {
			const { active, over } = event;
			if (!over || !activeQueue) return;
			const a = active.data.current as { type?: string } | undefined;
			if (a?.type !== "step") return;
			const o = over.data.current as { type?: string; stepId?: string } | undefined;
			const overStepId = o?.type === "job" ? o.stepId : String(over.id);
			if (!overStepId) return;
			setDragStepOrder((prev) => {
				const base = prev ?? activeQueue.steps.map((s) => s.id);
				const fromIndex = base.indexOf(String(active.id));
				const toIndex = base.indexOf(overStepId);
				if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
				return arrayMove(base, fromIndex, toIndex);
			});
		},
		[activeQueue],
	);

	// The DnD layer is THIN: it resolves from/to from the live preview (steps) or the active+over data
	// (jobs) and delegates to the store mutations (reorderSteps / moveJob). It never mutates queue
	// state directly during the drag -- only on drag end.
	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveDrag(null);
			const committedOrder = dragStepOrder; // capture this render's preview before clearing
			setDragStepOrder(null);
			const { active, over } = event;
			if (!over || !activeQueue) return;
			const queueId = activeQueue.id;
			const a = active.data.current as
				| { type?: string; stepId?: string; jobIndex?: number }
				| undefined;
			const o = over.data.current as
				| { type?: string; stepId?: string; jobIndex?: number }
				| undefined;

			// Reorder steps: commit the live preview order when present (it is exactly what the user
			// saw); otherwise resolve the destination from the over target (e.g. a keyboard path that
			// did not stream onDragOver). over may be a step or a job inside one.
			if (a?.type === "step") {
				const fromIndex = activeQueue.steps.findIndex((s) => s.id === active.id);
				let toIndex: number;
				if (committedOrder) {
					toIndex = committedOrder.indexOf(String(active.id));
				} else {
					const overStepId = o?.type === "job" ? o.stepId : String(over.id);
					toIndex = activeQueue.steps.findIndex((s) => s.id === overStepId);
				}
				if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
					reorderSteps(queueId, fromIndex, toIndex);
				}
				return;
			}

			// Move a job: within a step (reorder) or across steps (regroup). Dropping over a job
			// inserts before it; dropping over a step container appends to that step.
			if (a?.type === "job" && a.stepId != null && a.jobIndex != null) {
				let toStepId: string | undefined;
				let toIndex: number | undefined;
				if (o?.type === "job" && o.stepId != null) {
					toStepId = o.stepId;
					toIndex = o.jobIndex;
				} else if (o?.type === "step") {
					toStepId = String(over.id);
					toIndex = undefined; // append to the step
				} else {
					return;
				}
				if (a.stepId === toStepId && a.jobIndex === toIndex) return;
				moveJob(queueId, a.stepId, a.jobIndex, toStepId, toIndex);
			}
		},
		[activeQueue, dragStepOrder],
	);

	// Drag cancelled (Esc / dropped on nothing): drop the transient preview so the list snaps back.
	const handleDragCancel = useCallback(() => {
		setActiveDrag(null);
		setDragStepOrder(null);
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
	const selectedSourceIds = activeQueue.stockFromQueueIds ?? [];
	const selectedSourceSet = new Set(selectedSourceIds);

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
				<QueueHeader queue={activeQueue} queues={queues} openChoiceCount={openChoiceCount} />

				<div className="mb-4">
					<BomStockPanel onStockChange={handleStockChange} typeList={typeList} />
				</div>

				{/* F4 -- stock from other queues: treat another saved queue's resolved output as available
				    stock for this one (its finalPool is merged into baseStock before solving). */}
				{otherQueues.length > 0 && (
					<div className="mb-4">
						<CollapsibleSection
							title="Stock from other queues"
							count={selectedSourceIds.length}
							defaultOpen={selectedSourceIds.length > 0}
							collapsedSummary={
								crossQueueStock
									? `drawing stock from ${crossQueueStock.contributing.length} queue${
											crossQueueStock.contributing.length === 1 ? "" : "s"
										}`
									: "treat another queue's output as available stock"
							}
						>
							<div className="space-y-1 px-4 pb-4">
								<p className="pb-1 pt-1 text-[11px] text-zinc-500">
									Each selected queue is resolved on its own (per-step, no nested sources) and its
									leftover output is added to this queue's available stock.
								</p>
								{otherQueues.map((q) => {
									const on = selectedSourceSet.has(q.id);
									const contrib = stockContribById.get(q.id);
									return (
										<label
											key={q.id}
											className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-800/40"
										>
											<input
												type="checkbox"
												checked={on}
												onChange={() =>
													on
														? removeStockSource(activeQueue.id, q.id)
														: addStockSource(activeQueue.id, q.id)
												}
												className="accent-cyan-500"
											/>
											<Boxes size={13} className="shrink-0 text-zinc-600" />
											<span className="min-w-0 flex-1 truncate text-zinc-200">{q.name}</span>
											<span className="shrink-0 text-[11px] text-zinc-600">
												{q.steps.length} step{q.steps.length === 1 ? "" : "s"}
											</span>
											{on && contrib !== undefined && (
												<span
													className="shrink-0 text-[11px] text-cyan-400"
													title="Distinct item types this queue contributes to stock"
												>
													+{contrib} item{contrib === 1 ? "" : "s"}
												</span>
											)}
										</label>
									);
								})}
							</div>
						</CollapsibleSection>
					</div>
				)}

				{/* Sources -- steer which raw materials the optimizer draws on (queue-global). */}
				{sourceGroups.length > 0 && (
					<div className="mb-4">
						<CollapsibleSection
							title="Sources"
							count={sourceGroups.length}
							defaultOpen={false}
							collapsedSummary="control how raw materials are sourced"
						>
							<SourcePrefsPanel
								sourceGroups={sourceGroups}
								sourcePrefs={activeQueue.sourcePrefs}
								onSetSourcePref={(group, pref) => setSourcePref(activeQueue.id, group, pref)}
								onReset={() => resetSourcePrefs(activeQueue.id)}
								fullNameMap={fullNameMap}
							/>
						</CollapsibleSection>
					</div>
				)}

				{/* Queue totals */}
				{totals && activeQueue.steps.length > 0 && (
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
						<span className="text-zinc-600">
							raw {formatVolume(totals.rawVolume)} m³
						</span>
						{!totals.feasible && (
							<span className="ml-auto flex items-center gap-1 text-amber-400">
								<AlertTriangle size={12} />
								{globalPlan ? "no clean integer plan" : "some steps need attention"}
							</span>
						)}
					</div>
				)}

				{/* F3 -- global re-optimization plan. Rendered only in "global" mode: this single
				    whole-queue plan replaces the per-step material breakdown (steps below still list
				    their jobs). The totals bar above already reflects globalPlan.time / volume. */}
				{globalPlan && activeQueue.steps.length > 0 && (
					<div className="mb-4 space-y-3">
						<div className="flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-3 text-xs text-violet-200/90">
							<Info size={14} className="mt-0.5 shrink-0 text-violet-300" />
							<div className="space-y-1">
								<div className="flex items-center gap-1.5 font-medium text-violet-200">
									<Zap size={13} />
									Global re-optimization
								</div>
								<p className="text-violet-200/80">
									Sourcing is optimized across the whole queue as one solve, so a recipe choice in one
									step can share a co-product needed by another. Per-step recipe locks are ignored in
									this mode and the per-step material breakdown is omitted -- this single queue-level
									plan (gather / build / surplus) covers the whole queue, while each step below still
									lists its jobs. Switch back to Per-step for legible per-step gather/build lists.
								</p>
								<p className="text-violet-200/80">
									This plan assumes free build ordering, so the step order listed below may not be
									executable as written if a later step's co-product feeds an earlier step.
								</p>
							</div>
						</div>

						{globalPlan.gather.length > 0 && (
							<PlanSubsection title="Gather (raw materials)" count={globalPlan.gather.length}>
								<RawSourceTable
									items={globalPlan.gather}
									typeGroups={data.typeGroups}
									sourcePrefs={activeQueue.sourcePrefs}
									queueId={activeQueue.id}
								/>
							</PlanSubsection>
						)}

						{globalPlan.build.length > 0 && (
							<PlanSubsection title="Build (intermediates)" count={globalPlan.build.length}>
								<BuildChoiceTable
									items={globalPlan.build}
									data={data}
									queueId={activeQueue.id}
									queueLocks={activeQueue.recipeLocks}
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
					</div>
				)}

				{/* Steps */}
				{activeQueue.steps.length === 0 ? (
					<div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/30 p-8 text-center">
						<Factory size={28} className="mx-auto mb-3 text-zinc-600" />
						<h2 className="mb-1 text-sm font-medium text-zinc-300">Your build queue is empty</h2>
						<p className="mb-4 text-xs text-zinc-500">
							Search for something to build, or add an empty step to organize jobs yourself. You can
							also add blueprints straight from the Blueprint Library.
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
							onClick={handleAddStep}
							className="mt-4 inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-cyan-500/60 hover:text-cyan-300"
						>
							<Plus size={12} />
							Add empty step
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
							<SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
								{orderedSteps.map((step, index) => (
									<StepCard
										key={step.id}
										queueId={activeQueue.id}
										step={step}
										result={resultByStep.get(step.id)}
										index={index}
										totalSteps={orderedSteps.length}
										steps={stepRefs}
										data={data}
										recipeLocks={activeQueue.recipeLocks}
										sourcePrefs={activeQueue.sourcePrefs}
										globalMode={!!globalPlan}
									/>
								))}
							</SortableContext>
							<button
								type="button"
								onClick={handleAddStep}
								className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-700 py-2.5 text-xs text-zinc-500 hover:border-cyan-500/50 hover:text-cyan-300"
							>
								<Plus size={14} />
								Add step
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
