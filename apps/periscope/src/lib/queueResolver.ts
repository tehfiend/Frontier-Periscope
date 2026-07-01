// Queue resolver -- plan 36 (industry-build-queue), Phase 4.
//
// Solves a BuildQueue as a SEQUENTIAL PIPELINE: each batch is solved on its own with the LP
// optimizer, and the outputs (plus uncredited co-products) of earlier batches flow forward as
// available stock for later batches. The user owns the top-level plan (which blueprint, how many
// runs, the order and grouping); the optimizer only sources the INPUTS each batch's jobs need.
//
// TRADEOFF (documented per the plan): per-batch greedy solves are NOT guaranteed globally optimal
// versus collapsing the whole queue into one big solve -- a later batch might have steered an
// earlier batch's recipe choice differently to share a co-product. We accept that on purpose: the
// point of a build queue is a legible, executable per-batch plan that respects the user's chosen
// build order. Queue-global recipe locks (merged into each batch) keep recipe choices consistent
// across batches so the plan does not flip-flop between batches.
//
// F3 adds an OPT-IN escape hatch: `queue.reoptMode === "global"` collapses the whole queue into one
// solve (see resolveQueueGlobal) for cross-batch optimality, surfacing the result as a queue-level
// plan instead of per-batch rows. "perStep" stays the default so existing callers are unchanged.

import { type BomResult, buildBomFromLp, resolveBom } from "@/lib/bomResolver";
import type {
	Blueprint,
	BomLineItem,
	BomOrderItem,
	BomSurplus,
	RecipeOverride,
	RecipePin,
} from "@/lib/bomTypes";
import type {
	Batch,
	BuildQueue,
	ContainerRef,
	ContainerSourceConfig,
	JobOverrides,
	RecipeLockEntry,
} from "@/lib/buildQueueTypes";
import {
	type LpSolution,
	ceilLpSolution,
	computeDemandCone,
	isIntegralAndConsistent,
	roundSolution,
	solveLp,
} from "@/lib/lpOptimizer";

// ── Tuning constants ─────────────────────────────────────────────────────────
// Mirror IndustryCalculator's LP tuning so per-batch solves behave like the flat-list solve.

/** Objective weight on overproduction of any producible type (breaks objective degeneracy). */
const LP_OVERPRODUCTION_PENALTY = 0.1;
/** Time budget (ms) for each integer branch-and-bound solve. */
const LP_SOLVE_BUDGET_MS = 1500;
/**
 * Objective weight added to the NON-preferred producers of a type when a recipe lock marks one or
 * more producers as `prefer`. The preferred producers keep weight 0 (the lower weight), so the
 * solver favours them; the alternatives are softly de-prioritised but NOT removed, so the plan
 * falls back to them gracefully if the preferred path cannot satisfy demand.
 *
 * This is a SOFT tie-breaker, not a guarantee: it nudges the objective by a fixed +100 per run, so a
 * sufficiently large raw-cost gap between recipes (or source-pref weighting) can still outweigh it and
 * pick a non-preferred producer. Use `pin` (exclusive) for a hard recipe choice and `exclude` to
 * remove a producer outright. Phase 7 may tune this weight.
 */
const PREFER_DEPRIORITIZE_WEIGHT = 100;

// ── Public result types (Phase 5 consumes these) ─────────────────────────────

/**
 * Job provenance (plan 39, decision 5):
 * - "Target"  -- an authored Job the user added to a batch; its stable identity is `Job.id`.
 * - "Derived" -- an optimizer-spawned intermediate the user never authored; its stable identity is
 *                its `typeId`.
 * These are the keys the Phase 4 sourcing-override cascade uses (Job.id for Target, typeId for
 * Derived). The two are orthogonal to the item TIER (final / intermediate / raw).
 */
export type Provenance = "Target" | "Derived";

/** A resolved job: the user's chosen blueprint + runs, and the outputs that produces. Always "Target"
 *  provenance -- an authored Job in some batch (its `jobId` keys the Phase 4 cascade). */
export interface JobResult {
	/** Stable identity of the authored Job (`Job.id`) -- the Phase 4 cascade's Target override key. */
	jobId: string;
	/** Provenance of this resolved row -- always "Target" for an authored job. */
	provenance: "Target";
	blueprintId: number;
	runs: number;
	/** The resolved blueprint (for label / recipe display; `primaryTypeID` is the produced typeId). */
	blueprint: Blueprint;
	/** This job's outputs scaled by runs (primary output + co-products). */
	outputs: BomOrderItem[];
}

/** An intermediate the batch builds, plus the either/or alternatives so Phase 7 can offer a swap.
 *  Always "Derived" provenance -- an optimizer-spawned intermediate (its `typeId`, from BomLineItem,
 *  is the Phase 4 cascade's Derived override key). Intermediates that are ALSO an authored Job output
 *  in the same batch are merged away (they surface as the Target job row instead -- decision 5). */
export interface BatchBuildItem extends BomLineItem {
	/** Provenance of this resolved row -- always "Derived" for an optimizer-built intermediate. */
	provenance: "Derived";
	/**
	 * Every blueprintId that can produce this type (from outputToBlueprints), INCLUDING the chosen
	 * one (`blueprintId`). `length > 1` means an either/or choice exists for this input.
	 */
	alternativeBlueprintIds: number[];
}

/** Top-level demand a batch satisfied from the carry-forward pool / base stock (nothing built). */
export interface FromUpstreamItem {
	typeId: number;
	typeName: string;
	/** Quantity drawn from the pool for this type. */
	quantity: number;
	/** m3 (-1 when the type's volume is unknown). */
	volume: number;
	/** Earlier batches whose deposited output contributed to this draw, FIFO by execution order. */
	sourceBatchIds?: string[];
}

/**
 * One named container's share of a single type's stock draw (plan 41 B1). This is the recorded,
 * post-solve attribution the sourcing plan renders. Only breakdown containers ever appear here -- the
 * reserved Unassigned bucket and cross-queue stock are deliberately NOT recorded (matching Option A,
 * which left that stock unattributed).
 */
export interface ContainerDraw {
	ref: ContainerRef;
	qty: number;
}

/**
 * One recorded deposit (plan 41 B1): a produced type landing in its effective `outputDest` container.
 * `dest` is the reserved `{ kind: "unassigned" }` ref when nothing in the cascade routed the output
 * (Q1a). Deposits are merged per (typeId, dest) within a batch.
 */
export interface DepositRecord {
	typeId: number;
	typeName: string;
	dest: ContainerRef;
	qty: number;
	/** Later batches that consumed some of this deposited output. Informational only. */
	consumerBatchIds?: string[];
}

/**
 * The container-keyed carry-forward pool (plan 41 B1): `containerRefKey -> (typeId -> qty)`. The LP
 * never sees this; each batch flattens it to one scalar `Map<typeId, qty>` (flattenPool) before solving,
 * so the solver stays frozen / anonymous and Option B is purely an attribution layer over Option A.
 */
export type ContainerPool = Map<string, Map<number, number>>;

interface ProvenanceLedgerEntry {
	batchId: string;
	remaining: number;
	record: DepositRecord;
}

type ProvenanceLedger = Map<number, ProvenanceLedgerEntry[]>;

/**
 * The reserved terminal deposit bucket (plan 41, decision Q1a). Un-routed outputs land here; it sits at
 * the bottom of the job -> batch -> queue `outputDest` cascade and is never a user-selectable source.
 * Flattened, it is exactly Option A's anonymous pool, so a queue with NO `outputDest` set anywhere
 * resolves bit-identically to today.
 */
export const UNASSIGNED_REF: ContainerRef = { kind: "unassigned" };
/** `containerRefKey(UNASSIGNED_REF)` as a literal -- the Unassigned bucket's key in the pool. */
const UNASSIGNED_KEY = "unassigned";

/** Everything a single build batch resolves to. */
export interface BatchResult {
	batchId: string;
	label?: string;
	/** The batch's jobs resolved to blueprint + runs + outputs (each tagged "Target" provenance). */
	jobs: JobResult[];
	/** Raw materials this batch needs (each line carries quantity / stockQty / stillNeed). */
	gather: BomLineItem[];
	/** Intermediates produced this batch (each tagged "Derived"), with chosen recipe + alternatives. */
	build: BatchBuildItem[];
	/** Demand satisfied by the carry-forward pool / base stock (producible types, qty from pool). */
	fromUpstream: FromUpstreamItem[];
	/** Uncredited co-products produced this batch (carried into the next batch's pool). */
	surplus: BomSurplus[];
	/** Seconds: this batch's job run time + the run time of the intermediates it builds. */
	time: number;
	/** m3: total material volume for this batch (raw + intermediate; -1 entries excluded). */
	volume: number;
	/** m3: raw-material volume only. */
	rawVolume: number;
	/** True when the LP produced a clean, consistent integer plan for this batch. */
	feasible: boolean;
	/** True when the batch had to relax a source exclusion (e.g. Salvage) to be buildable. */
	usedExcludedSources: boolean;
	/**
	 * The batch's own per-batch recipe locks (copied straight from Batch.recipeLocks). Carried on the
	 * result so the UI can merge them with the queue-global locks per batch (e.g. queueOpenChoiceCount).
	 */
	recipeLocks?: RecipeLockEntry[];
	/**
	 * Plan 41 B1 -- the SINGLE source of truth for post-solve container attribution (sourcingPlan.ts
	 * consumes these instead of re-walking its own inventory). `draws` maps each drawn typeId to the
	 * named breakdown containers it was pulled from, in cascade + spillover order. The Unassigned bucket
	 * and cross-queue stock are intentionally absent (only named containers are attributed, as before).
	 */
	draws: Map<number, ContainerDraw[]>;
	/**
	 * Plan 41 B1 -- where this batch's net leftover outputs + surplus co-products were deposited. Each
	 * job's outputs land in its single effective `outputDest` (Q5a); un-routed outputs fall to the
	 * reserved Unassigned bucket (Q1a). These are the REAL recorded deposits the Deposits table renders.
	 */
	deposits: DepositRecord[];
}

/**
 * The single queue-level plan produced in "global" re-optimization mode (F3). Present on
 * QueueResolveResult.global ONLY when queue.reoptMode === "global". The whole queue's job-input
 * demand was solved as ONE LP against baseStock, so this gather/build is a queue-wide summary and is
 * NOT attributed back to individual batches (each batch's BatchResult.gather/build/fromUpstream/surplus
 * are left empty in this mode -- the view should render this object instead). Per-batch recipe locks
 * are NOT applied in global mode; only queue-global locks + source-prefs steer the solve.
 */
export interface QueueGlobalPlan {
	/** Raw materials gathered across the whole queue (single combined solve). */
	gather: BomLineItem[];
	/** Intermediates built across the whole queue (each tagged "Derived"), with recipe + alternatives. */
	build: BatchBuildItem[];
	/** Top-level producible job inputs met from base stock, queue-wide. */
	fromUpstream: FromUpstreamItem[];
	/** Uncredited co-products produced across the whole queue. */
	surplus: BomSurplus[];
	/** True when the global LP produced a clean, consistent integer plan. */
	feasible: boolean;
	/** True when the global solve had to relax a source exclusion to be buildable. */
	usedExcludedSources: boolean;
	/** Seconds: total job run time + intermediate build time across the whole queue. */
	time: number;
	/** m3: total material volume (raw + intermediate; -1 entries excluded). */
	volume: number;
	/** m3: raw-material volume only. */
	rawVolume: number;
	/**
	 * Plan 41 B1 -- recorded container attribution for the single global plan. `draws` attributes the
	 * queue-wide stockConsumed across the named breakdown containers via the QUEUE-scope cascade. Global
	 * mode has NO batch order to deposit along, so `deposits` are NOT routed -- every leftover output +
	 * surplus lands in the reserved Unassigned bucket (decision 9). Use per-batch mode for routed deposits.
	 */
	draws: Map<number, ContainerDraw[]>;
	deposits: DepositRecord[];
}

export interface QueueResolveResult {
	batches: BatchResult[];
	totals: {
		/** Sum of every batch's time (seconds). In global mode, the whole-queue plan time. */
		time: number;
		/** Sum of every batch's raw-material volume (m3). In global mode, the whole-queue raw volume. */
		rawVolume: number;
		/** Sum of every batch's total material volume (m3). In global mode, the whole-queue volume. */
		volume: number;
		/** True only when EVERY batch resolved to a clean LP plan (in global mode, the single solve). */
		feasible: boolean;
		/**
		 * The CONTAINER-KEYED carry-forward pool after the last batch (plan 41 B3 -- Q2a). Mirrors the B1
		 * `ContainerPool` (`containerRefKey -> typeId -> qty`): each named outputDest bucket holds the
		 * leftovers routed there, and the reserved `unassigned` bucket holds un-routed leftovers + surplus
		 * (exactly Option A's anonymous pool when nothing is routed). `flattenPool(finalPool)` reproduces the
		 * old flat `Map<typeId, qty>` byte-for-byte. Its one consumer -- the cross-queue (F4) projection --
		 * partitions these buckets so a source queue's leftovers overlay onto MATCHING containers in the
		 * active queue's breakdown (named) or fold flat into baseStock (unassigned). In global mode there is
		 * no batch order to route along (decision 9), so the whole pool sits in the single `unassigned` bucket.
		 */
		finalPool: ContainerPool;
	};
	/**
	 * Present ONLY when the queue resolved in "global" re-optimization mode (queue.reoptMode ===
	 * "global"). Undefined in the default per-batch mode. See QueueGlobalPlan.
	 */
	global?: QueueGlobalPlan;
	/**
	 * The ordered per-container stock breakdown the `baseStock` was assembled from (plan 39 Phase 4a),
	 * echoed straight from the optional `stockBreakdown` arg of resolveQueue. The LP flattens stock into
	 * one anonymized `baseStock: Map`, so the Phase 4b allocator reads per-container quantities here to
	 * attribute each raw material's demand back to specific containers (with spillover). Undefined when
	 * the caller passed only a flat baseStock (e.g. the cross-queue stock resolves).
	 */
	stockBreakdown?: StockBreakdown;
}

/** Everything the resolver needs from the loaded blueprint/game data. */
export interface QueueResolveContext {
	blueprints: Record<string, Blueprint>;
	outputToBlueprints: Map<number, Blueprint[]>;
	defaultRecipes: Map<number, number>;
	volumeMap: Map<number, number>;
	/** TypeIDs that are inputs but never outputs, plus directly-gatherable byproduct leaves. */
	rawMaterialIds: Set<number>;
	/** Directly-gatherable leaf typeIDs that may also appear as recipe byproducts. */
	gatherableLeafIds: Set<number>;
	/** typeID -> source group name (Comet Ores, Salvage, ...). */
	typeGroups: Map<number, string>;
	/** Salvage leaf typeIDs (looted, not mined). Resolver now treats them as ordinary raws. */
	salvageMaterialIds: Set<number>;
}

// ── Lock merging + steering translation ──────────────────────────────────────

/**
 * Merge queue-global recipe locks with a batch's optional per-batch overrides. Per typeId, a batch
 * entry FULLY overrides the queue entry for that type (replace, not union); otherwise the queue
 * entry applies. The Phase 7 UI writes both queue-global AND per-batch locks; this merge resolves the
 * two scopes per type (plan Open Question 3 -- hybrid).
 */
export function mergeLocks(
	queueLocks: RecipeLockEntry[],
	batchLocks?: RecipeLockEntry[],
): RecipeLockEntry[] {
	const byType = new Map<number, RecipeLockEntry>();
	for (const lock of queueLocks) byType.set(lock.typeId, lock);
	if (batchLocks) {
		for (const lock of batchLocks) byType.set(lock.typeId, lock);
	}
	return [...byType.values()];
}

/** The optimizer-steering inputs derived from a set of recipe locks. */
export interface LockSteering {
	pins: RecipePin[];
	excludeBpIds: Set<number>;
	bpWeights: Map<number, number>;
}

/**
 * Translate recipe locks into the optimizer's steering inputs:
 * - `pin`     -> pass through as the existing RecipePin (exclusive / split).
 * - `exclude` -> add to excludeBpIds (solveLp removes those producers entirely).
 * - `prefer`  -> de-prioritize the OTHER producers of that type via bpWeights, so the preferred
 *                producer keeps the lower (0) weight. Reuses solveLp's per-blueprint weight input.
 *                Soft tie-breaker only (see PREFER_DEPRIORITIZE_WEIGHT).
 */
export function locksToPins(
	locks: RecipeLockEntry[],
	outputToBlueprints: Map<number, Blueprint[]>,
): LockSteering {
	const pins: RecipePin[] = [];
	const excludeBpIds = new Set<number>();
	const bpWeights = new Map<number, number>();

	// D2 -- first pass: collect EVERY globally-preferred blueprintId across all locks. A blueprint
	// preferred for type X can also be a (non-preferred) co-producer of type Y; without this, Y's
	// lock would add +100 to it, so two prefer locks sharing a co-product would cancel out. Skipping
	// any globally-preferred id in the deprioritize loop keeps preferred producers at weight 0
	// regardless of co-product overlap.
	const globallyPreferred = new Set<number>();
	for (const lock of locks) {
		if (lock.prefer) {
			for (const id of lock.prefer) globallyPreferred.add(id);
		}
	}

	for (const lock of locks) {
		if (lock.pin) pins.push(lock.pin);
		if (lock.exclude) {
			for (const id of lock.exclude) excludeBpIds.add(id);
		}
		if (lock.prefer && lock.prefer.length > 0) {
			const producers = outputToBlueprints.get(lock.typeId) ?? [];
			for (const bp of producers) {
				// Never de-prioritize a blueprint preferred ANYWHERE (this lock or any other) -- that is
				// the D2 cross-penalty fix; `globallyPreferred` is a superset of this lock's own prefer set.
				if (globallyPreferred.has(bp.blueprintID)) continue;
				// Take the max so a producer de-prioritized by several types stays de-prioritized.
				const current = bpWeights.get(bp.blueprintID) ?? 0;
				bpWeights.set(bp.blueprintID, Math.max(current, PREFER_DEPRIORITIZE_WEIGHT));
			}
		}
	}

	return { pins, excludeBpIds, bpWeights };
}

// ── Cross-queue stock (F4) ────────────────────────────────────────────────────

/**
 * Merge several flat stock maps into one, summing quantities per typeId. Returns a NEW map; the inputs
 * are never mutated. The view assembles `baseStock` with this -- folding each breakdown container's items
 * plus the ANONYMOUS (Unassigned) portion of any cross-queue stock. As of B3 (Q2a) `totals.finalPool` is
 * container-keyed, so the view first partitions a source queue's leftovers: NAMED-container deposits
 * overlay onto matching breakdown containers (so they keep container identity), and only the un-routed
 * Unassigned remainder is folded flat here. The resolver itself never loads other queues, so it stays a
 * pure function of (queue, ctx, stock).
 */
export function mergeStockMaps(...maps: Array<Map<number, number>>): Map<number, number> {
	const merged = new Map<number, number>();
	for (const map of maps) {
		for (const [typeId, qty] of map) {
			merged.set(typeId, (merged.get(typeId) ?? 0) + qty);
		}
	}
	return merged;
}

// ── Container sourcing: baseStock breakdown (plan 39 Phase 4a) ────────────────

/** One container's contribution to stock: its ref and the typeId -> qty it currently holds. */
export interface ContainerInventory {
	ref: ContainerRef;
	items: Map<number, number>;
}

/**
 * The ordered per-container stock breakdown. Order is the caller's container order (chain SSUs +
 * field-storage latest snapshots + scratch). The Phase 4b allocator walks this to attribute demand to
 * specific containers; the LP only ever sees the flattened `baseStock` (see assembleBaseStock).
 */
export type StockBreakdown = ContainerInventory[];

/** Stable string key for a ContainerRef (scratch + the reserved Unassigned bucket have no id). */
export function containerRefKey(ref: ContainerRef): string {
	if (ref.kind === "scratch") return "scratch";
	if (ref.kind === "unassigned") return "unassigned";
	return `${ref.kind}:${ref.id}`;
}

/**
 * Flatten an ordered per-container breakdown into the single anonymized `baseStock: Map<typeId, qty>`
 * the LP consumes, while returning the breakdown itself for the Phase 4b allocator. Quantities <= 0 are
 * dropped from the flat map. The breakdown is returned as-is (ordered); callers pass it straight to
 * resolveQueue so it is echoed on the result (QueueResolveResult.stockBreakdown).
 */
export function assembleBaseStock(containers: StockBreakdown): {
	baseStock: Map<number, number>;
	breakdown: StockBreakdown;
} {
	const baseStock = new Map<number, number>();
	for (const c of containers) {
		for (const [typeId, qty] of c.items) {
			if (qty <= 0) continue;
			baseStock.set(typeId, (baseStock.get(typeId) ?? 0) + qty);
		}
	}
	return { baseStock, breakdown: containers };
}

/**
 * The queue-local scratch pad (plan 39 Phase 6, decision 18) as a stock container. Folds `queue.scratch`
 * into a `{ kind: "scratch" }` ContainerInventory so the pad ranks alongside chain/field containers in
 * both the flattened `baseStock` and the per-container breakdown the Phase 4b allocator walks. The
 * caller appends this to the breakdown (and merges its items into baseStock) before resolveQueue.
 * Queue-local: never surfaced in Assets, never selectable by other queues. Returns undefined when the
 * pad is empty so no phantom scratch container appears in the plan.
 */
export function scratchInventory(queue: BuildQueue): ContainerInventory | undefined {
	const items = queue.scratch;
	if (!items || items.length === 0) return undefined;
	const map = new Map<number, number>();
	for (const it of items) {
		if (it.qty <= 0) continue;
		map.set(it.typeId, (map.get(it.typeId) ?? 0) + it.qty);
	}
	if (map.size === 0) return undefined;
	return { ref: { kind: "scratch" }, items: map };
}

// ── Container sourcing: override cascade (plan 39 Phase 4a) ───────────────────
// NEW cascade, independent of the recipeLocks cascade (which keeps steering recipe choice). The two
// compose side by side. resolveEffectiveOverrides folds the five scopes for one job producing typeId T:
//   1. queue.sourcesDefault / queue.outputDefault          (widest)
//   2. queue.sourceLocks[typeId === T]
//   3. batch.sourcesDefault / batch.outputDefault
//   4. batch.sourceLocks[typeId === T]                     (finest grain for Derived jobs)
//   5. job.overrides                                       (Target jobs only -- narrowest)
// last-wins, scope-dominant: the NARROWEST scope that mentions a container sets its fate, so a narrow
// `order` re-include beats a wider `exclude`. Output destination is plain last-defined-wins.

/** The resolved overrides for one job after the 5-layer cascade. */
export interface EffectiveOverrides {
	/**
	 * Resolved container sourcing. `order` is the priority-ranked include list with excludes already
	 * removed (what the Phase 4b allocator pulls from, in order); `exclude` is the set of containers
	 * whose effective fate is excluded (for inspection / UI). Undefined when no scope set any sourcing.
	 */
	sources?: { order: ContainerRef[]; exclude: ContainerRef[] };
	/** Resolved deposit annotation -- the narrowest scope that defined one wins. */
	outputDest?: ContainerRef;
}

/**
 * Compose container sourcing across scopes. `layers` are ordered WIDEST -> NARROWEST. A container's
 * fate (include / exclude) is decided by the narrowest scope that MENTIONS it (in `order` or `exclude`);
 * within a single scope an `order` entry beats that same scope's `exclude`. Priority ordering takes the
 * narrowest scope's `order` first. Returns undefined when no layer specified any sourcing.
 */
function composeSources(
	layers: Array<ContainerSourceConfig | undefined>,
): { order: ContainerRef[]; exclude: ContainerRef[] } | undefined {
	if (!layers.some((l) => l && ((l.order?.length ?? 0) > 0 || (l.exclude?.length ?? 0) > 0))) {
		return undefined;
	}

	const refByKey = new Map<string, ContainerRef>();

	// Priority: narrowest scope's `order` ranks first. Walk narrowest -> widest, recording first sight.
	const priority: string[] = [];
	const seen = new Set<string>();
	for (let i = layers.length - 1; i >= 0; i--) {
		for (const ref of layers[i]?.order ?? []) {
			const k = containerRefKey(ref);
			refByKey.set(k, ref);
			if (!seen.has(k)) {
				seen.add(k);
				priority.push(k);
			}
		}
	}

	// Fate: narrowest mention wins. Walk widest -> narrowest so the last assignment (narrowest) sticks.
	// Within a layer apply `exclude` then `order`, so a same-scope include re-admits a same-scope exclude.
	const fate = new Map<string, "include" | "exclude">();
	for (const layer of layers) {
		if (!layer) continue;
		for (const ref of layer.exclude ?? []) {
			const k = containerRefKey(ref);
			refByKey.set(k, ref);
			fate.set(k, "exclude");
		}
		for (const ref of layer.order ?? []) {
			const k = containerRefKey(ref);
			refByKey.set(k, ref);
			fate.set(k, "include");
		}
	}

	const order: ContainerRef[] = [];
	for (const k of priority) {
		if (fate.get(k) === "include") {
			const ref = refByKey.get(k);
			if (ref) order.push(ref);
		}
	}
	const exclude: ContainerRef[] = [];
	for (const [k, f] of fate) {
		if (f === "exclude") {
			const ref = refByKey.get(k);
			if (ref) exclude.push(ref);
		}
	}
	return { order, exclude };
}

/**
 * Resolve the effective sourcing/output overrides for a job producing typeId `T`, composing the five
 * cascade scopes (see the section comment). Pass `jobOverrides` (a Target job's `overrides`) for layer 5;
 * omit it for Derived jobs, whose finest grain is the batch-scope source lock (layer 4). Pure function of
 * its inputs -- independent of the recipeLocks cascade.
 */
export function resolveEffectiveOverrides(
	queue: BuildQueue,
	batch: Batch,
	typeId: number,
	jobOverrides?: JobOverrides,
): EffectiveOverrides {
	const queueLock = queue.sourceLocks?.find((l) => l.typeId === typeId);
	const batchLock = batch.sourceLocks?.find((l) => l.typeId === typeId);

	// Widest -> narrowest (layers 1..5). jobOverrides is layer 5 (undefined for Derived jobs).
	const sourceLayers: Array<ContainerSourceConfig | undefined> = [
		queue.sourcesDefault,
		queueLock?.sources,
		batch.sourcesDefault,
		batchLock?.sources,
		jobOverrides?.sources,
	];
	const outputLayers: Array<ContainerRef | undefined> = [
		queue.outputDefault,
		queueLock?.outputDest,
		batch.outputDefault,
		batchLock?.outputDest,
		jobOverrides?.outputDest,
	];

	const sources = composeSources(sourceLayers);
	let outputDest: ContainerRef | undefined;
	for (const o of outputLayers) if (o) outputDest = o; // last (narrowest) defined wins

	const eff: EffectiveOverrides = {};
	if (sources) eff.sources = sources;
	if (outputDest) eff.outputDest = outputDest;
	return eff;
}

// ── Container draw + deposit (plan 41 B1) ─────────────────────────────────────
// The carry-forward pool is container-keyed (ContainerPool). Each batch DRAWS its `stockConsumed` from
// the source containers (priority cascade + spillover) and DEPOSITS its true leftover output into the
// effective `outputDest`. The LP never sees any of this -- it solves against flattenPool(pool), one
// anonymized scalar. These primitives moved here from sourcingPlan.ts (decision 5) so the resolver is
// the single source of truth and sourcingPlan.ts consumes the recorded allocations instead of re-walking.

/**
 * Flatten the container-keyed pool into the single scalar `Map<typeId, qty>` the LP consumes. Mirrors
 * assembleBaseStock: non-positive quantities are dropped. flattenPool(pool) at every step equals the old
 * anonymous scalar pool exactly, which is what keeps Option B a strict superset of Option A.
 */
export function flattenPool(pool: ContainerPool): Map<number, number> {
	const flat = new Map<number, number>();
	for (const bucket of pool.values()) {
		for (const [typeId, qty] of bucket) {
			if (qty <= 0) continue;
			flat.set(typeId, (flat.get(typeId) ?? 0) + qty);
		}
	}
	return flat;
}

/**
 * The ordered named containers a type should draw from, after the cascade. Any explicit `order` (an
 * include list) ranks first in its given priority; the remaining breakdown containers (neither ranked
 * nor excluded) follow as spillover, so the draw still covers the full named stock the LP consumed. With
 * no explicit order, the default is the breakdown order (already distance-sorted by the caller). Excludes
 * are honored at every position. NOTE: this returns ONLY breakdown containers -- the Unassigned bucket is
 * drained separately by the caller (it is never a named source).
 */
export function effectiveOrder(breakdown: StockBreakdown, eff: EffectiveOverrides): ContainerRef[] {
	const excludeKeys = new Set((eff.sources?.exclude ?? []).map(containerRefKey));
	const ranked = (eff.sources?.order ?? []).filter((r) => !excludeKeys.has(containerRefKey(r)));
	const rankedKeys = new Set(ranked.map(containerRefKey));
	const rest = breakdown
		.map((c) => c.ref)
		.filter((r) => {
			const k = containerRefKey(r);
			return !excludeKeys.has(k) && !rankedKeys.has(k);
		});
	return [...ranked, ...rest];
}

/**
 * Greedily draw `demand` of `typeId` across `order`, decrementing the running pool. Per-container draws
 * can legitimately exceed a single container's holdings -- spillover walks to the next container -- so the
 * clamp lives per container (`take = min(have, remaining)`), never per scalar type. Returns the recorded
 * allocations (named containers only) plus the total drawn from them (`fromStock`).
 */
export function allocate(
	typeId: number,
	demand: number,
	order: ContainerRef[],
	running: ContainerPool,
): { allocations: ContainerDraw[]; fromStock: number } {
	const allocations: ContainerDraw[] = [];
	let remaining = demand;
	let fromStock = 0;
	for (const ref of order) {
		if (remaining <= 0) break;
		const inv = running.get(containerRefKey(ref));
		if (!inv) continue;
		const have = inv.get(typeId) ?? 0;
		if (have <= 0) continue;
		const take = Math.min(have, remaining);
		inv.set(typeId, have - take);
		allocations.push({ ref, qty: take });
		remaining -= take;
		fromStock += take;
	}
	return { allocations, fromStock };
}

function appendUnique(list: string[] | undefined, value: string): string[] {
	if (!list) return [value];
	return list.includes(value) ? list : [...list, value];
}

function addDepositProvenance(
	ledger: ProvenanceLedger,
	batchId: string,
	typeId: number,
	qty: number,
	record: DepositRecord,
) {
	if (qty <= 0) return;
	let entries = ledger.get(typeId);
	if (!entries) {
		entries = [];
		ledger.set(typeId, entries);
	}
	entries.push({ batchId, remaining: qty, record });
}

function consumeDepositProvenance(
	ledger: ProvenanceLedger,
	consumerBatchId: string,
	typeId: number,
	qty: number,
): string[] | undefined {
	if (qty <= 0) return undefined;
	const entries = ledger.get(typeId);
	if (!entries || entries.length === 0) return undefined;

	const sourceBatchIds: string[] = [];
	let remaining = qty;
	while (remaining > 0 && entries.length > 0) {
		const entry = entries[0];
		const take = Math.min(entry.remaining, remaining);
		if (take > 0) {
			if (!sourceBatchIds.includes(entry.batchId)) sourceBatchIds.push(entry.batchId);
			entry.record.consumerBatchIds = appendUnique(entry.record.consumerBatchIds, consumerBatchId);
			entry.remaining -= take;
			remaining -= take;
		}
		if (entry.remaining <= 0) entries.shift();
		else break;
	}

	return sourceBatchIds.length > 0 ? sourceBatchIds : undefined;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildNameMap(blueprints: Record<string, Blueprint>): Map<number, string> {
	const names = new Map<number, string>();
	for (const bp of Object.values(blueprints)) {
		for (const i of bp.inputs) names.set(i.typeID, i.typeName);
		for (const o of bp.outputs) names.set(o.typeID, o.typeName);
	}
	return names;
}

/** Largest split (or the exclusive target) of each pin, as recipe overrides for the heuristic fallback. */
function pinsToOverrides(pins: RecipePin[]): RecipeOverride[] {
	const overrides: RecipeOverride[] = [];
	for (const pin of pins) {
		if (pin.kind === "exclusive") {
			overrides.push({ typeId: pin.typeId, blueprintId: pin.blueprintId });
		} else if (pin.kind === "split" && pin.splits.length > 0) {
			const best = pin.splits.reduce((a, b) => (b.quantity > a.quantity ? b : a));
			overrides.push({ typeId: pin.typeId, blueprintId: best.blueprintId });
		}
	}
	return overrides;
}

/** Keep only pins whose output type still has at least one producer (defensive). */
function validatePins(
	pins: RecipePin[],
	outputToBlueprints: Map<number, Blueprint[]>,
): RecipePin[] {
	return pins.filter((pin) => {
		const producers = outputToBlueprints.get(pin.typeId);
		return producers != null && producers.length > 0;
	});
}

function lockSteersType(typeId: number, locks: RecipeLockEntry[]): boolean {
	const entry = locks.find((lock) => lock.typeId === typeId);
	if (!entry) return false;
	return entry.pin != null || (entry.prefer?.length ?? 0) > 0 || (entry.exclude?.length ?? 0) > 0;
}

interface DefaultPinCandidate {
	typeId: number;
	defaultBpId: number;
	producers: Blueprint[];
}

interface StockPinCandidate {
	typeId: number;
	defaultBpId?: number;
	producers: Blueprint[];
	rawDefault: boolean;
}

function defaultPinCandidates(
	orderItems: BomOrderItem[],
	ctx: QueueResolveContext,
	mergedLocks: RecipeLockEntry[],
	steering: LockSteering,
): { candidates: DefaultPinCandidate[]; coneBpIds: Set<number>; coneTypes: Set<number> } {
	const { bpIds: coneBpIds, coneTypes } = computeDemandCone(
		orderItems,
		ctx.outputToBlueprints,
		steering.excludeBpIds,
	);
	const pinnedTypes = new Set(steering.pins.map((pin) => pin.typeId));
	const candidates: DefaultPinCandidate[] = [];

	for (const typeId of coneTypes) {
		const producers = ctx.outputToBlueprints.get(typeId);
		if (!producers || producers.length <= 1) continue;
		if (ctx.gatherableLeafIds.has(typeId) || ctx.rawMaterialIds.has(typeId)) continue;
		if (lockSteersType(typeId, mergedLocks) || pinnedTypes.has(typeId)) continue;
		const defaultBpId = ctx.defaultRecipes.get(typeId);
		if (defaultBpId == null) continue;
		if (steering.excludeBpIds.has(defaultBpId)) continue;
		if (!coneBpIds.has(defaultBpId)) continue;
		candidates.push({ typeId, defaultBpId, producers });
	}

	return { candidates, coneBpIds, coneTypes };
}

export function buildDefaultPins(
	orderItems: BomOrderItem[],
	ctx: QueueResolveContext,
	mergedLocks: RecipeLockEntry[],
	steering: LockSteering,
): RecipePin[] {
	return defaultPinCandidates(orderItems, ctx, mergedLocks, steering).candidates.map(
		({ typeId, defaultBpId }) => ({
			typeId,
			kind: "exclusive",
			blueprintId: defaultBpId,
		}),
	);
}

function pinnedBlueprintIds(pins: RecipePin[]): Set<number> {
	const ids = new Set<number>();
	for (const pin of pins) {
		if (pin.kind === "exclusive") {
			ids.add(pin.blueprintId);
		} else {
			for (const split of pin.splits) ids.add(split.blueprintId);
		}
	}
	return ids;
}

function rawOnlyProducerExcludes(ctx: QueueResolveContext, pins: RecipePin[]): Set<number> {
	const pinned = pinnedBlueprintIds(pins);
	const excludes = new Set<number>();
	for (const bp of Object.values(ctx.blueprints)) {
		if (pinned.has(bp.blueprintID)) continue;
		if (bp.outputs.length === 0) continue;
		if (bp.outputs.every((out) => ctx.rawMaterialIds.has(out.typeID))) {
			excludes.add(bp.blueprintID);
		}
	}
	return excludes;
}

function withRawOnlyProducerExcludes(
	steering: LockSteering,
	ctx: QueueResolveContext,
): LockSteering {
	const excludeBpIds = new Set(steering.excludeBpIds);
	for (const bpId of rawOnlyProducerExcludes(ctx, steering.pins)) excludeBpIds.add(bpId);
	return { ...steering, excludeBpIds };
}

function outputQuantity(bp: Blueprint, typeId: number): number {
	return bp.outputs.find((out) => out.typeID === typeId)?.quantity ?? 1;
}

function rawConsumptionFromSolution(
	solution: { runs: Map<number, number> },
	bpData: { blueprints: Record<string, Blueprint> },
	rawMaterialIds: Set<number>,
): Map<number, number> {
	const consumed = new Map<number, number>();
	for (const [bpId, runs] of solution.runs) {
		const bp = bpData.blueprints[String(bpId)];
		if (!bp || runs <= 0) continue;
		for (const inp of bp.inputs) {
			if (!rawMaterialIds.has(inp.typeID)) continue;
			consumed.set(inp.typeID, (consumed.get(inp.typeID) ?? 0) + inp.quantity * runs);
		}
	}
	return consumed;
}

function typeDemandFromSolution(
	solution: { runs: Map<number, number> },
	orderItems: BomOrderItem[],
	bpData: {
		blueprints: Record<string, Blueprint>;
		outputToBlueprints: Map<number, Blueprint[]>;
	},
	rawMaterialIds: Set<number>,
): Map<number, number> {
	const demand = new Map<number, number>();
	for (const item of orderItems) {
		demand.set(item.typeId, (demand.get(item.typeId) ?? 0) + item.quantity);
	}
	for (const [bpId, runs] of solution.runs) {
		const bp = bpData.blueprints[String(bpId)];
		if (!bp || runs <= 0) continue;
		for (const inp of bp.inputs) {
			if (rawMaterialIds.has(inp.typeID)) continue;
			if (!bpData.outputToBlueprints.has(inp.typeID)) continue;
			demand.set(inp.typeID, (demand.get(inp.typeID) ?? 0) + inp.quantity * runs);
		}
	}
	return demand;
}

function buildStockDrivenPins(
	orderItems: BomOrderItem[],
	ctx: QueueResolveContext,
	mergedLocks: RecipeLockEntry[],
	steering: LockSteering,
	pool: Map<number, number>,
	typeDemand: Map<number, number>,
	firstRawConsumption: Map<number, number>,
): { pins: RecipePin[]; stockCaps: Map<number, number> } {
	const {
		candidates: defaultCandidates,
		coneBpIds,
		coneTypes,
	} = defaultPinCandidates(orderItems, ctx, mergedLocks, steering);
	const pinnedTypes = new Set(steering.pins.map((pin) => pin.typeId));
	const candidates: StockPinCandidate[] = defaultCandidates.map((candidate) => ({
		...candidate,
		rawDefault: false,
	}));
	for (const typeId of coneTypes) {
		if (!ctx.gatherableLeafIds.has(typeId)) continue;
		if (lockSteersType(typeId, mergedLocks) || pinnedTypes.has(typeId)) continue;
		const producers = ctx.outputToBlueprints.get(typeId);
		if (!producers || producers.length === 0) continue;
		candidates.push({ typeId, producers, rawDefault: true });
	}
	const pins: RecipePin[] = [];
	const stockCaps = new Map<number, number>();

	for (const candidate of candidates) {
		const demand = typeDemand.get(candidate.typeId) ?? 0;
		if (demand <= 0) {
			if (!candidate.rawDefault && candidate.defaultBpId != null) {
				pins.push({
					typeId: candidate.typeId,
					kind: "exclusive",
					blueprintId: candidate.defaultBpId,
				});
			}
			continue;
		}

		const defaultBp =
			candidate.defaultBpId != null ? ctx.blueprints[String(candidate.defaultBpId)] : undefined;
		if (!candidate.rawDefault && (candidate.defaultBpId == null || !defaultBp)) {
			const defaultBpId = candidate.defaultBpId;
			if (defaultBpId == null) continue;
			pins.push({
				typeId: candidate.typeId,
				kind: "exclusive",
				blueprintId: defaultBpId,
			});
			continue;
		}
		const defaultInputIds = new Set(defaultBp?.inputs.map((inp) => inp.typeID) ?? []);
		let best:
			| {
					bp: Blueprint;
					stockSupported: number;
					rawIds: number[];
			  }
			| undefined;

		for (const alt of candidate.producers) {
			if (alt.blueprintID === candidate.defaultBpId) continue;
			if (!coneBpIds.has(alt.blueprintID) || steering.excludeBpIds.has(alt.blueprintID)) continue;
			const distinctiveRawInputs = new Map<number, number>();
			for (const inp of alt.inputs) {
				if (defaultInputIds.has(inp.typeID)) continue;
				if (!ctx.rawMaterialIds.has(inp.typeID)) continue;
				distinctiveRawInputs.set(
					inp.typeID,
					(distinctiveRawInputs.get(inp.typeID) ?? 0) + inp.quantity,
				);
			}
			if (distinctiveRawInputs.size === 0) continue;

			let supportedRuns = Number.POSITIVE_INFINITY;
			let uncapped = false;
			for (const [rawId, qtyPerRun] of distinctiveRawInputs) {
				const held = pool.get(rawId) ?? 0;
				if (held <= 0) {
					uncapped = true;
					break;
				}
				const firstConsumed = firstRawConsumption.get(rawId) ?? 0;
				const idleStock = held - firstConsumed;
				if (idleStock <= 0) {
					uncapped = true;
					break;
				}
				supportedRuns = Math.min(supportedRuns, Math.floor(idleStock / qtyPerRun));
			}
			if (uncapped || !Number.isFinite(supportedRuns) || supportedRuns <= 0) continue;

			const stockSupported = Math.min(
				demand,
				supportedRuns * outputQuantity(alt, candidate.typeId),
			);
			if (stockSupported <= 0) continue;
			if (
				!best ||
				stockSupported > best.stockSupported ||
				(stockSupported === best.stockSupported && alt.blueprintID < best.bp.blueprintID)
			) {
				best = { bp: alt, stockSupported, rawIds: [...distinctiveRawInputs.keys()] };
			}
		}

		if (!best) {
			if (!candidate.rawDefault && candidate.defaultBpId != null) {
				pins.push({
					typeId: candidate.typeId,
					kind: "exclusive",
					blueprintId: candidate.defaultBpId,
				});
			}
			continue;
		}

		for (const rawId of best.rawIds) {
			const held = pool.get(rawId) ?? 0;
			if (held > 0) stockCaps.set(rawId, held);
		}
		const remainder = Math.max(0, demand - best.stockSupported);
		const splits = [{ blueprintId: best.bp.blueprintID, quantity: best.stockSupported }];
		if (!candidate.rawDefault && candidate.defaultBpId != null && remainder > 0) {
			splits.push({ blueprintId: candidate.defaultBpId, quantity: remainder });
		}
		pins.push({ typeId: candidate.typeId, kind: "split", splits });
	}

	return { pins, stockCaps };
}

interface SolveOutput {
	bom: BomResult;
	feasible: boolean;
	usedExcludedSources: boolean;
	solution?: LpSolution;
}

/**
 * Solve one demand set (a batch's net input demand, or the whole queue's in global mode) against the
 * carry-forward pool. Integer solve runs first, with continuous+ceil fallback on timeout. Salvage/source
 * exclusions are now inert: solveLp's 5th slot is always an empty set, so every raw weighs 1.
 */
function solveDemand(
	orderItems: BomOrderItem[],
	bpData: {
		blueprints: Record<string, Blueprint>;
		outputToBlueprints: Map<number, Blueprint[]>;
		defaultRecipes: Map<number, number>;
	},
	pool: Map<number, number>,
	steering: LockSteering,
	volumeMap: Map<number, number>,
	nameMap: Map<number, string>,
	gatherableLeafIds: Set<number>,
	stockCaps?: Map<number, number>,
): SolveOutput {
	const inertExcludedRaws = new Set<number>();
	const attemptSolve = () => {
		let sol = solveLp(
			orderItems,
			bpData,
			steering.pins,
			pool,
			inertExcludedRaws,
			{
				integer: true,
				penalty: LP_OVERPRODUCTION_PENALTY,
				timeoutMs: LP_SOLVE_BUDGET_MS,
				bpWeights: steering.bpWeights,
				excludeBpIds: steering.excludeBpIds,
			},
			gatherableLeafIds,
			stockCaps,
		);
		if (sol.feasible && isIntegralAndConsistent(sol, bpData, orderItems, pool, gatherableLeafIds)) {
			return { sol: roundSolution(sol), usable: true };
		}
		sol = ceilLpSolution(
			solveLp(
				orderItems,
				bpData,
				steering.pins,
				pool,
				inertExcludedRaws,
				{
					penalty: LP_OVERPRODUCTION_PENALTY,
					bpWeights: steering.bpWeights,
					excludeBpIds: steering.excludeBpIds,
				},
				gatherableLeafIds,
				stockCaps,
			),
		);
		return {
			sol,
			usable:
				sol.feasible && isIntegralAndConsistent(sol, bpData, orderItems, pool, gatherableLeafIds),
		};
	};

	const { sol: solved, usable } = attemptSolve();

	if (!usable) {
		// Heuristic fallback: honour the pins as recipe overrides so user choices still land. prefer/
		// exclude steering is dropped here (resolveBom has no per-producer steering) -- rare path.
		const fallback = resolveBom(
			orderItems,
			bpData,
			pinsToOverrides(steering.pins),
			volumeMap,
			pool,
			nameMap,
		);
		return { bom: fallback, feasible: false, usedExcludedSources: false };
	}

	const bom = buildBomFromLp(
		solved,
		bpData,
		orderItems,
		volumeMap,
		pool,
		nameMap,
		undefined,
		gatherableLeafIds,
	);
	return { bom, feasible: true, usedExcludedSources: false, solution: solved };
}

function solveDemandWithDefaults(
	orderItems: BomOrderItem[],
	bpData: {
		blueprints: Record<string, Blueprint>;
		outputToBlueprints: Map<number, Blueprint[]>;
		defaultRecipes: Map<number, number>;
	},
	ctx: QueueResolveContext,
	pool: Map<number, number>,
	steering: LockSteering,
	mergedLocks: RecipeLockEntry[],
	preferStock: boolean,
	volumeMap: Map<number, number>,
	nameMap: Map<number, string>,
): SolveOutput {
	const defaultPins = buildDefaultPins(orderItems, ctx, mergedLocks, steering);
	const primarySteering: LockSteering = {
		pins: validatePins([...steering.pins, ...defaultPins], bpData.outputToBlueprints),
		excludeBpIds: steering.excludeBpIds,
		bpWeights: steering.bpWeights,
	};
	const primarySolveSteering = withRawOnlyProducerExcludes(primarySteering, ctx);
	const first = solveDemand(
		orderItems,
		bpData,
		pool,
		primarySolveSteering,
		volumeMap,
		nameMap,
		ctx.gatherableLeafIds,
	);

	if (!preferStock || !first.solution) return first;

	const typeDemand = typeDemandFromSolution(first.solution, orderItems, bpData, ctx.rawMaterialIds);
	const firstRawConsumption = rawConsumptionFromSolution(
		first.solution,
		bpData,
		ctx.rawMaterialIds,
	);
	const stockPlan = buildStockDrivenPins(
		orderItems,
		ctx,
		mergedLocks,
		steering,
		pool,
		typeDemand,
		firstRawConsumption,
	);
	if (stockPlan.stockCaps.size === 0 && stockPlan.pins.every((pin) => pin.kind === "exclusive")) {
		return first;
	}

	const stockSteering: LockSteering = {
		pins: validatePins([...steering.pins, ...stockPlan.pins], bpData.outputToBlueprints),
		excludeBpIds: steering.excludeBpIds,
		bpWeights: steering.bpWeights,
	};
	const stockSolveSteering = withRawOnlyProducerExcludes(stockSteering, ctx);
	return solveDemand(
		orderItems,
		bpData,
		pool,
		stockSolveSteering,
		volumeMap,
		nameMap,
		ctx.gatherableLeafIds,
		stockPlan.stockCaps,
	);
}

/**
 * Turn a solved BOM into the display lists shared by both per-batch and global resolution:
 *   gather       = raw materials (each line carries its own stockQty / stillNeed)
 *   build        = intermediates produced, each with its chosen recipe + either/or alternatives
 *   fromUpstream = top-level producible job INPUTS met from the pool (drawn from stock, nothing built)
 *
 * D4 -- a type already shown as a built intermediate (in `build`, with its own "Have"/stockQty
 * column) or as a gathered raw must NOT also appear in fromUpstream, or a partially-stocked
 * intermediate double-lists. fromUpstream therefore skips any typeId present in bom.intermediates or
 * bom.rawMaterials; only producible types that live solely in bom.finals (the batch/queue's top-level
 * producible inputs covered from the pool) survive -- e.g. the "8 Capacitor -- from upstream" case.
 */
function bomToDisplayLists(
	bom: BomResult,
	outputToBlueprints: Map<number, Blueprint[]>,
	volumeMap: Map<number, number>,
	nameMap: Map<number, string>,
	authoredProductTypeIds: Set<number>,
	sourceBatchIdsByType?: Map<number, string[]>,
): { gather: BomLineItem[]; build: BatchBuildItem[]; fromUpstream: FromUpstreamItem[] } {
	const gather = bom.rawMaterials;
	// Provenance merge (plan 39, decision 5): an intermediate the optimizer builds whose type is ALSO
	// an authored Job's primary output in this scope is NOT a separate Derived row -- it merges into the
	// Target job row (rendered from BatchResult.jobs). Drop it here; everything left is genuinely Derived.
	const build: BatchBuildItem[] = bom.intermediates
		.filter((item) => !authoredProductTypeIds.has(item.typeId))
		.map((item) => ({
			...item,
			provenance: "Derived" as const,
			alternativeBlueprintIds: (outputToBlueprints.get(item.typeId) ?? []).map(
				(p) => p.blueprintID,
			),
		}));

	// Types already carrying their own "Have" column (built intermediates + gathered raws). Raws are
	// also non-producible so the outputToBlueprints guard below skips them; intermediates are the case
	// D4 fixes (a producible type both built AND drawn from the pool).
	const builtOrRawTypeIds = new Set<number>();
	for (const item of bom.intermediates) builtOrRawTypeIds.add(item.typeId);
	for (const item of bom.rawMaterials) builtOrRawTypeIds.add(item.typeId);

	const stockConsumed = bom.stockConsumed ?? new Map<number, number>();
	const fromUpstream: FromUpstreamItem[] = [];
	for (const [typeId, qty] of stockConsumed) {
		if (qty <= 0) continue;
		if (!outputToBlueprints.has(typeId)) continue; // raws-from-pool show via gather.stockQty
		if (builtOrRawTypeIds.has(typeId)) continue; // built/raw rows already show their own Have column
		const unitVol = volumeMap.get(typeId);
		fromUpstream.push({
			typeId,
			typeName: nameMap.get(typeId) ?? `Type ${typeId}`,
			quantity: qty,
			volume: unitVol !== undefined ? qty * unitVol : -1,
			sourceBatchIds: sourceBatchIdsByType?.get(typeId),
		});
	}
	fromUpstream.sort((a, b) => a.typeName.localeCompare(b.typeName));

	return { gather, build, fromUpstream };
}

// ── Main entry ─────────────────────────────────────────────────────────────────

/**
 * Resolve a whole BuildQueue into per-batch plans with a carry-forward stock pool.
 *
 * For each batch in order:
 *   demand   = sum over the batch's jobs of runs * blueprint.inputs[].quantity  (Map<typeId, qty>)
 *   pins     = locksToPins(mergeLocks(queue.recipeLocks, batch.recipeLocks))    (batch overrides queue)
 *   sol      = solveLp(demand, ..., stockMap = pool, primary-output pins, integer)
 *   BatchResult built from the BOM (gather = raws, build = intermediates + either/or alternatives,
 *              fromUpstream = pool-satisfied producible demand, surplus = co-products)
 *   pool     = max(0, pool - stockConsumed) + jobOutputs + surplus              (carry forward)
 *
 * The pool update uses the BOM's additive `stockConsumed` report-back (plan 36 Phase 4): a batch
 * draws `stockConsumed` from the pool, then deposits the products its jobs build (`jobOutputs`) and
 * any uncredited co-products (`surplus`) for the next batch to consume.
 *
 * @param queue          the saved build queue (ordered batches, queue-global recipe locks)
 * @param ctx            loaded blueprint + game data (see QueueResolveContext)
 * @param baseStock      the user's starting stock (assembled from selected containers), typeId -> qty
 * @param stockBreakdown optional ordered per-container breakdown `baseStock` was assembled from (plan 39
 *                       Phase 4a). Echoed onto the result for the Phase 4b allocator; it does NOT affect
 *                       the solve (the LP only sees the flattened baseStock). Omit it (e.g. the
 *                       cross-queue stock resolves) to leave result.stockBreakdown undefined.
 */
export function resolveQueue(
	queue: BuildQueue,
	ctx: QueueResolveContext,
	baseStock: Map<number, number>,
	stockBreakdown?: StockBreakdown,
): QueueResolveResult {
	const bpData = {
		blueprints: ctx.blueprints,
		outputToBlueprints: ctx.outputToBlueprints,
		defaultRecipes: ctx.defaultRecipes,
	};
	const nameMap = buildNameMap(ctx.blueprints);

	const breakdown = stockBreakdown ?? [];

	// F3 -- opt-in global re-optimization. Default / "perStep" falls through to the per-batch pipeline
	// below, so the existing resolveQueue(queue, ctx, stock) caller and its behavior are unchanged.
	if (queue.reoptMode === "global") {
		const result = resolveQueueGlobal(queue, bpData, ctx, baseStock, nameMap, breakdown);
		return { ...result, stockBreakdown };
	}

	// Seed the container-keyed carry-forward pool (plan 41 B1). Each breakdown container becomes one
	// bucket; everything in baseStock that the breakdown does NOT account for (the ANONYMOUS / Unassigned
	// portion of cross-queue stock -- B3 overlays the NAMED portion onto the breakdown itself) seeds the
	// reserved Unassigned bucket. flattenPool(pool) therefore equals baseStock exactly on the normal path
	// (baseStock = crossQueueUnassigned + sum(breakdown) >= sum(breakdown)), so the LP sees the identical
	// scalar to Option A.
	const pool: ContainerPool = new Map();
	const sumBreakdown = new Map<number, number>();
	for (const c of breakdown) {
		const key = containerRefKey(c.ref);
		let bucket = pool.get(key);
		if (!bucket) {
			bucket = new Map<number, number>();
			pool.set(key, bucket);
		}
		for (const [typeId, qty] of c.items) {
			if (qty <= 0) continue;
			bucket.set(typeId, (bucket.get(typeId) ?? 0) + qty);
			sumBreakdown.set(typeId, (sumBreakdown.get(typeId) ?? 0) + qty);
		}
	}
	const unassigned = new Map<number, number>();
	for (const [typeId, qty] of baseStock) {
		const remainder = qty - (sumBreakdown.get(typeId) ?? 0);
		if (remainder > 0) unassigned.set(typeId, remainder);
	}
	pool.set(UNASSIGNED_KEY, unassigned);

	const batches: BatchResult[] = [];
	let totalTime = 0;
	let totalRawVolume = 0;
	let totalVolume = 0;
	let allFeasible = true;
	const provenanceLedger: ProvenanceLedger = new Map();

	for (const batch of queue.batches) {
		const batchResult = resolveBatch(
			batch,
			queue,
			bpData,
			ctx,
			pool,
			breakdown,
			nameMap,
			provenanceLedger,
		);
		batches.push(batchResult);
		totalTime += batchResult.time;
		totalRawVolume += batchResult.rawVolume;
		totalVolume += batchResult.volume;
		if (!batchResult.feasible) allFeasible = false;
	}

	return {
		batches,
		totals: {
			time: totalTime,
			rawVolume: totalRawVolume,
			volume: totalVolume,
			feasible: allFeasible,
			// B3 (Q2a) -- finalPool is the CONTAINER-KEYED pool itself (named outputDest buckets + the
			// reserved Unassigned bucket), the single source of truth for cross-queue projection. Flattened
			// (flattenPool) it is byte-identical to Option A's final pool, so nothing downstream regresses.
			finalPool: pool,
		},
		stockBreakdown,
	};
}

/**
 * Resolve a single batch and advance the carry-forward `pool` in place. Split out of resolveQueue so
 * the per-batch accounting is easy to follow.
 */
function resolveBatch(
	batch: Batch,
	queue: BuildQueue,
	bpData: {
		blueprints: Record<string, Blueprint>;
		outputToBlueprints: Map<number, Blueprint[]>;
		defaultRecipes: Map<number, number>;
	},
	ctx: QueueResolveContext,
	pool: ContainerPool,
	breakdown: StockBreakdown,
	nameMap: Map<number, string>,
	provenanceLedger: ProvenanceLedger,
): BatchResult {
	// 1. Resolve jobs -> demand (sum of inputs), jobOutputs (sum of outputs), job run time. Each
	// authored job becomes a "Target" JobResult keyed by its stable Job.id (the Phase 4 override key).
	const demand = new Map<number, number>();
	const jobOutputs = new Map<number, number>();
	const jobs: JobResult[] = [];
	// The primary-output typeIds of this batch's authored jobs -- the Target rows. A Derived
	// intermediate of one of these merges into the Target job row (see bomToDisplayLists).
	const authoredProductTypeIds = new Set<number>();
	let jobsTime = 0;

	for (const job of batch.jobs) {
		const bp = bpData.blueprints[String(job.blueprintId)];
		if (!bp) continue; // stale blueprintId -- skip the job (cannot resolve its recipe)
		jobsTime += bp.runTime * job.runs;
		authoredProductTypeIds.add(bp.primaryTypeID);
		for (const inp of bp.inputs) {
			demand.set(inp.typeID, (demand.get(inp.typeID) ?? 0) + inp.quantity * job.runs);
		}
		for (const out of bp.outputs) {
			jobOutputs.set(out.typeID, (jobOutputs.get(out.typeID) ?? 0) + out.quantity * job.runs);
		}
		jobs.push({
			jobId: job.id,
			provenance: "Target",
			blueprintId: job.blueprintId,
			runs: job.runs,
			blueprint: bp,
			outputs: bp.outputs.map((o) => ({
				typeId: o.typeID,
				typeName: o.typeName,
				quantity: o.quantity * job.runs,
			})),
		});
	}

	// 2. Translate the merged recipe locks into optimizer steering.
	const mergedLocks = mergeLocks(queue.recipeLocks, batch.recipeLocks);
	const steering = locksToPins(mergedLocks, bpData.outputToBlueprints);
	steering.pins = validatePins(steering.pins, bpData.outputToBlueprints);

	// D1 -- net intra-batch job dependencies. A batch is an UNORDERED pool of jobs: a component built by
	// one job covers a sibling job's consumption of that component FIRST, before anything is sourced.
	// Without this, `demand` sums every job's inputs with NO credit for sibling outputs, so a
	// producer+consumer grouped in one batch double-builds the component (the solver sources it fresh
	// AND the producer's output is left as phantom surplus). For each producible type we credit
	// internalUse = min(demand, jobOutputs): the solver sees only the shortfall (netDemand), and the
	// pool-advance below deposits only the true leftover (jobOutputs - internalUse). Conservative:
	// internalUse <= jobOutputs, so the leftover is never negative and never over-credited.
	const internalUse = new Map<number, number>();
	const netDemand = new Map<number, number>();
	for (const [typeId, qty] of demand) {
		const used = Math.min(qty, jobOutputs.get(typeId) ?? 0);
		if (used > 0) internalUse.set(typeId, used);
		const net = qty - used;
		if (net > 0) netDemand.set(typeId, net);
	}

	// 3. Solve the batch's NET input demand against the pool (or short-circuit when there is none). The
	// gather / build / fromUpstream lists below therefore all reflect the netted demand, not the gross.
	const orderItems: BomOrderItem[] = [...netDemand.entries()].map(([typeId, quantity]) => ({
		typeId,
		typeName: nameMap.get(typeId) ?? `Type ${typeId}`,
		quantity,
	}));

	// The LP stays FROZEN: it only ever sees the flattened scalar pool (plan 41 B1). The container
	// identity below is a post-solve attribution layer; flatPool is exactly the old anonymous baseStock.
	const flatPool = flattenPool(pool);

	let bom: BomResult;
	let feasible: boolean;
	let usedExcludedSources: boolean;
	if (orderItems.length === 0) {
		// No inputs to source (e.g. a batch of pure raw->nothing jobs). Empty BOM; jobs still deposit.
		bom = emptyBom();
		feasible = true;
		usedExcludedSources = false;
	} else {
		const solved = solveDemandWithDefaults(
			orderItems,
			bpData,
			ctx,
			flatPool,
			steering,
			mergedLocks,
			queue.preferStock !== false,
			ctx.volumeMap,
			nameMap,
		);
		bom = solved.bom;
		feasible = solved.feasible;
		usedExcludedSources = solved.usedExcludedSources;
	}

	const stockConsumed = bom.stockConsumed ?? new Map<number, number>();
	const sourceBatchIdsByType = new Map<number, string[]>();
	for (const [typeId, drawn] of stockConsumed) {
		const sourceBatchIds = consumeDepositProvenance(provenanceLedger, batch.id, typeId, drawn);
		if (sourceBatchIds) sourceBatchIdsByType.set(typeId, sourceBatchIds);
	}

	// 4. Build the batch's display lists from the BOM (gather / build / fromUpstream; D4 guard inside).
	// Derived intermediates that coincide with an authored Target job's output merge away here.
	const { gather, build, fromUpstream } = bomToDisplayLists(
		bom,
		bpData.outputToBlueprints,
		ctx.volumeMap,
		nameMap,
		authoredProductTypeIds,
		sourceBatchIdsByType,
	);

	// 5. Advance the container-keyed carry-forward pool (plan 41 B1). FLATTENED, this reproduces the old
	// scalar advance EXACTLY: pool[t] = max(0, before - drawn) + (jobOutputs[t] - internalUse[t]) +
	// surplus[t]. Option B only changes WHICH container holds each unit, never the per-type totals -- so
	// the LP (which only ever saw flatPool above) solves identically to Option A whether or not any
	// outputDest is set. stockConsumed never exceeds the pool total (it is allocated from it), so each
	// per-container draw sums to exactly `drawn` and the flattened result is `before_total - drawn`.
	// 5a. DRAW. Pull stockConsumed from the source containers (priority cascade + spillover), then drain
	// any remainder from the Unassigned bucket (cross-queue stock / un-routed prior deposits) so the pool
	// fully reflects the consumption. Only the named-container portion is RECORDED (the Unassigned draw is
	// invisible to the plan -- exactly as Option A left cross-queue stock unattributed). The clamp lives
	// PER CONTAINER (allocate's `min(have, remaining)`): a draw may legitimately span several containers.
	const draws = new Map<number, ContainerDraw[]>();
	for (const [typeId, drawn] of stockConsumed) {
		if (drawn <= 0) continue;
		const eff = resolveEffectiveOverrides(queue, batch, typeId);
		const order = effectiveOrder(breakdown, eff);
		const { allocations, fromStock } = allocate(typeId, drawn, order, pool);
		if (allocations.length > 0) draws.set(typeId, allocations);
		let remaining = drawn - fromStock;
		if (remaining > 0) {
			const unassigned = pool.get(UNASSIGNED_KEY);
			if (unassigned) {
				const have = unassigned.get(typeId) ?? 0;
				const take = Math.min(have, remaining);
				if (take > 0) unassigned.set(typeId, have - take);
				remaining -= take;
			}
		}
		// 5a-fallback. flattenPool(pool) -- the scalar the LP solved against -- counts EVERY bucket,
		// including containers the cascade above CANNOT reach: ones in eff.sources.exclude (dropped from
		// effectiveOrder) and named buckets created by a prior deposit that are absent from `breakdown`
		// (e.g. a cross-queue source queue resolved with no breakdown routing an intermediate via
		// outputDest). The LP can therefore set stockConsumed from stock that physically lives only in such
		// a bucket, leaving `remaining > 0` after the cascade + Unassigned drain. Drain that shortfall from
		// the remaining buckets as a last resort so the physical pool ALWAYS decrements by the full `drawn`
		// (the LP guarantees drawn <= flattenPool(pool), so the units exist somewhere). This is NOT recorded
		// in `draws` -- the exclude/order cascade is honored only for DISPLAY attribution, never the physical
		// decrement -- which keeps the carry-forward pool byte-equivalent to Option A's before_total - drawn.
		if (remaining > 0) {
			for (const bucket of pool.values()) {
				if (remaining <= 0) break;
				const have = bucket.get(typeId) ?? 0;
				if (have <= 0) continue;
				const take = Math.min(have, remaining);
				bucket.set(typeId, have - take);
				remaining -= take;
			}
		}
	}

	// 5b. DEPOSIT. Each job's TRUE leftover output -- its gross output minus the intra-batch internalUse a
	// sibling job already consumed (D1) -- lands in that job's SINGLE effective outputDest (Q5a); surplus
	// co-products are Derived (typeId cascade). The internalUse hand-off NEVER lands in any container: it
	// is passed sibling-to-sibling inside the batch and is deducted here (in job order) before deposit.
	// Un-routed outputs fall to the reserved Unassigned bucket (Q1a) -- Option A's anonymous pool.
	const deposits: DepositRecord[] = [];
	const depositAcc = new Map<string, DepositRecord>();
	const depositInto = (typeId: number, typeName: string, qty: number, dest: ContainerRef) => {
		if (qty <= 0) return;
		const destKey = containerRefKey(dest);
		let bucket = pool.get(destKey);
		if (!bucket) {
			bucket = new Map<number, number>();
			pool.set(destKey, bucket);
		}
		bucket.set(typeId, (bucket.get(typeId) ?? 0) + qty);
		const accKey = `${typeId}|${destKey}`;
		const existing = depositAcc.get(accKey);
		let record = existing;
		if (record) record.qty += qty;
		else {
			record = { typeId, typeName, dest, qty };
			depositAcc.set(accKey, record);
		}
		addDepositProvenance(provenanceLedger, batch.id, typeId, qty, record);
	};

	const deductRemaining = new Map(internalUse);
	for (const job of batch.jobs) {
		const bp = bpData.blueprints[String(job.blueprintId)];
		if (!bp) continue; // stale blueprintId -- skipped above too
		const dest =
			resolveEffectiveOverrides(queue, batch, bp.primaryTypeID, job.overrides).outputDest ??
			UNASSIGNED_REF;
		for (const out of bp.outputs) {
			let qty = out.quantity * job.runs;
			if (qty <= 0) continue;
			const ded = deductRemaining.get(out.typeID) ?? 0;
			if (ded > 0) {
				const take = Math.min(ded, qty);
				qty -= take;
				deductRemaining.set(out.typeID, ded - take);
			}
			depositInto(out.typeID, out.typeName, qty, dest);
		}
	}
	for (const s of bom.surplus) {
		if (s.quantity <= 0) continue;
		const dest = resolveEffectiveOverrides(queue, batch, s.typeId).outputDest ?? UNASSIGNED_REF;
		depositInto(s.typeId, s.typeName, s.quantity, dest);
	}
	deposits.push(...depositAcc.values());

	const rawVolume = bom.totals.rawVolume;
	const totalVolume = bom.totals.totalVolume;
	const intermediateTime = bom.totals.totalTime;

	return {
		batchId: batch.id,
		label: batch.label,
		jobs,
		gather,
		build,
		fromUpstream,
		surplus: bom.surplus,
		time: jobsTime + intermediateTime,
		volume: totalVolume,
		rawVolume,
		feasible,
		usedExcludedSources,
		recipeLocks: batch.recipeLocks,
		draws,
		deposits,
	};
}

// ── Global re-optimization (F3) ──────────────────────────────────────────────

/** An empty BOM (no inputs to source). Shared by the per-batch and global no-demand short-circuits. */
function emptyBom(): BomResult {
	return {
		rawMaterials: [],
		intermediates: [],
		finals: [],
		surplus: [],
		stockConsumed: new Map(),
		totals: { rawVolume: 0, intermediateVolume: 0, totalVolume: 0, totalTime: 0, iterations: 0 },
	};
}

/**
 * Resolve the WHOLE queue as ONE solve (queue.reoptMode === "global"). Instead of the per-batch
 * greedy pipeline, the union of every batch's top-level job-input demand is collapsed into a single
 * solveLp against baseStock, finding cross-batch optimality the per-batch solve cannot see (a recipe
 * choice in one batch that shares a co-product needed by another).
 *
 * TRADEOFF: this trades per-batch legibility for cross-batch optimality. The gather / build / fromUpstream
 * plan is a single QUEUE-LEVEL summary (returned on QueueResolveResult.global) and is NOT attributed
 * back to individual batches -- each BatchResult keeps its jobs (and their outputs) but its gather / build /
 * fromUpstream / surplus are left EMPTY. Per-batch recipe locks are a per-batch-mode feature and are NOT
 * applied here; only queue-global recipe locks + source-prefs steer the global solve.
 *
 * D1 netting is applied queue-wide: a component built by ANY job covers ANY sibling job's consumption
 * first (internalUse = min(globalDemand, globalJobOutputs)); the solver sources only the shortfall and
 * the final pool carries only the true leftover.
 */
function resolveQueueGlobal(
	queue: BuildQueue,
	bpData: {
		blueprints: Record<string, Blueprint>;
		outputToBlueprints: Map<number, Blueprint[]>;
		defaultRecipes: Map<number, number>;
	},
	ctx: QueueResolveContext,
	baseStock: Map<number, number>,
	nameMap: Map<number, string>,
	breakdown: StockBreakdown,
): QueueResolveResult {
	// 1. Resolve every batch's jobs; accumulate queue-wide demand, job outputs, and job run time. The
	// per-batch rows are placeholders (jobs only) -- gather / build / fromUpstream / surplus stay empty
	// because the plan is queue-level in this mode.
	const globalDemand = new Map<number, number>();
	const globalJobOutputs = new Map<number, number>();
	// Primary-output typeIds of every authored job across the queue -- the queue-wide Target set used to
	// merge coincident Derived intermediates out of the global plan (decision 5).
	const authoredProductTypeIds = new Set<number>();
	const batches: BatchResult[] = [];
	let globalJobTime = 0;

	for (const batch of queue.batches) {
		const jobs: JobResult[] = [];
		let jobsTime = 0;
		for (const job of batch.jobs) {
			const bp = bpData.blueprints[String(job.blueprintId)];
			if (!bp) continue; // stale blueprintId -- skip the job (cannot resolve its recipe)
			jobsTime += bp.runTime * job.runs;
			authoredProductTypeIds.add(bp.primaryTypeID);
			for (const inp of bp.inputs) {
				globalDemand.set(inp.typeID, (globalDemand.get(inp.typeID) ?? 0) + inp.quantity * job.runs);
			}
			for (const out of bp.outputs) {
				globalJobOutputs.set(
					out.typeID,
					(globalJobOutputs.get(out.typeID) ?? 0) + out.quantity * job.runs,
				);
			}
			jobs.push({
				jobId: job.id,
				provenance: "Target",
				blueprintId: job.blueprintId,
				runs: job.runs,
				blueprint: bp,
				outputs: bp.outputs.map((o) => ({
					typeId: o.typeID,
					typeName: o.typeName,
					quantity: o.quantity * job.runs,
				})),
			});
		}
		globalJobTime += jobsTime;
		// Per-batch time is this batch's job run time only -- intermediate build time is queue-level (see
		// global.time). feasible/usedExcludedSources are refined from the single global solve below.
		batches.push({
			batchId: batch.id,
			label: batch.label,
			jobs,
			gather: [],
			build: [],
			fromUpstream: [],
			surplus: [],
			time: jobsTime,
			volume: 0,
			rawVolume: 0,
			feasible: true,
			usedExcludedSources: false,
			recipeLocks: batch.recipeLocks,
			// Per-batch attribution is empty in global mode -- the single plan carries draws/deposits.
			draws: new Map(),
			deposits: [],
		});
	}

	// 2. Net queue-wide (D1 applied globally), then solve the whole queue's net demand at once.
	const internalUse = new Map<number, number>();
	const netDemand = new Map<number, number>();
	for (const [typeId, qty] of globalDemand) {
		const used = Math.min(qty, globalJobOutputs.get(typeId) ?? 0);
		if (used > 0) internalUse.set(typeId, used);
		const net = qty - used;
		if (net > 0) netDemand.set(typeId, net);
	}

	// Only queue-global locks steer the global solve (per-batch locks are a per-batch-mode feature).
	const steering = locksToPins(queue.recipeLocks, bpData.outputToBlueprints);
	steering.pins = validatePins(steering.pins, bpData.outputToBlueprints);

	const pool = new Map(baseStock); // cloned -- never mutate the caller's baseStock
	const orderItems: BomOrderItem[] = [...netDemand.entries()].map(([typeId, quantity]) => ({
		typeId,
		typeName: nameMap.get(typeId) ?? `Type ${typeId}`,
		quantity,
	}));

	let bom: BomResult;
	let feasible: boolean;
	let usedExcludedSources: boolean;
	if (orderItems.length === 0) {
		bom = emptyBom();
		feasible = true;
		usedExcludedSources = false;
	} else {
		const solved = solveDemandWithDefaults(
			orderItems,
			bpData,
			ctx,
			pool,
			steering,
			queue.recipeLocks,
			queue.preferStock !== false,
			ctx.volumeMap,
			nameMap,
		);
		bom = solved.bom;
		feasible = solved.feasible;
		usedExcludedSources = solved.usedExcludedSources;
	}

	// 3. Queue-level display plan (D4 guard inside) + advance the pool to the final carry-forward.
	// Derived intermediates coinciding with a queue-wide Target job output merge away (decision 5).
	const { gather, build, fromUpstream } = bomToDisplayLists(
		bom,
		bpData.outputToBlueprints,
		ctx.volumeMap,
		nameMap,
		authoredProductTypeIds,
	);

	const stockConsumed = bom.stockConsumed ?? new Map<number, number>();
	const surplusMap = new Map<number, number>();
	for (const s of bom.surplus) surplusMap.set(s.typeId, s.quantity);
	const touched = new Set<number>([
		...stockConsumed.keys(),
		...globalJobOutputs.keys(),
		...surplusMap.keys(),
	]);
	for (const typeId of touched) {
		const before = pool.get(typeId) ?? 0;
		const drawn = stockConsumed.get(typeId) ?? 0;
		const leftoverOutput = (globalJobOutputs.get(typeId) ?? 0) - (internalUse.get(typeId) ?? 0);
		const produced = leftoverOutput + (surplusMap.get(typeId) ?? 0);
		pool.set(typeId, Math.max(0, before - drawn) + produced);
	}

	// Plan 41 B1 -- recorded container attribution for the single global plan. Global mode has no batch
	// order to deposit along, so deposits are NOT routed: every leftover output + surplus lands in the
	// reserved Unassigned bucket (decision 9 -- a documented scoping limitation; use per-batch mode to
	// route deposits). Draws still attribute the queue-wide stockConsumed across the named breakdown
	// containers via the QUEUE-scope cascade (per-batch source locks do not apply in global mode); a fresh
	// running inventory cloned from the breakdown mirrors the old sourcingPlan global walk exactly.
	const emptyBatch: Batch = { id: "", jobs: [] };
	const globalRunning: ContainerPool = new Map();
	for (const c of breakdown) {
		const m = new Map<number, number>();
		for (const [t, q] of c.items) if (q > 0) m.set(t, (m.get(t) ?? 0) + q);
		globalRunning.set(containerRefKey(c.ref), m);
	}
	const globalDraws = new Map<number, ContainerDraw[]>();
	for (const [typeId, drawn] of stockConsumed) {
		if (drawn <= 0) continue;
		const order = effectiveOrder(breakdown, resolveEffectiveOverrides(queue, emptyBatch, typeId));
		const { allocations } = allocate(typeId, drawn, order, globalRunning);
		if (allocations.length > 0) globalDraws.set(typeId, allocations);
	}
	const globalDepositAcc = new Map<number, DepositRecord>();
	const globalDeduct = new Map(internalUse);
	for (const batch of queue.batches) {
		for (const job of batch.jobs) {
			const bp = bpData.blueprints[String(job.blueprintId)];
			if (!bp) continue;
			for (const out of bp.outputs) {
				let qty = out.quantity * job.runs;
				if (qty <= 0) continue;
				const ded = globalDeduct.get(out.typeID) ?? 0;
				if (ded > 0) {
					const take = Math.min(ded, qty);
					qty -= take;
					globalDeduct.set(out.typeID, ded - take);
				}
				if (qty <= 0) continue;
				const existing = globalDepositAcc.get(out.typeID);
				if (existing) existing.qty += qty;
				else
					globalDepositAcc.set(out.typeID, {
						typeId: out.typeID,
						typeName: out.typeName,
						dest: UNASSIGNED_REF,
						qty,
					});
			}
		}
	}
	for (const s of bom.surplus) {
		if (s.quantity <= 0) continue;
		const existing = globalDepositAcc.get(s.typeId);
		if (existing) existing.qty += s.quantity;
		else
			globalDepositAcc.set(s.typeId, {
				typeId: s.typeId,
				typeName: s.typeName,
				dest: UNASSIGNED_REF,
				qty: s.quantity,
			});
	}
	const globalDeposits = [...globalDepositAcc.values()];

	const rawVolume = bom.totals.rawVolume;
	const volume = bom.totals.totalVolume;
	const time = globalJobTime + bom.totals.totalTime;

	// Reflect the single solve's feasibility on every batch so the UI can still flag the queue.
	for (const b of batches) {
		b.feasible = feasible;
		b.usedExcludedSources = usedExcludedSources;
	}

	const global: QueueGlobalPlan = {
		gather,
		build,
		fromUpstream,
		surplus: bom.surplus,
		feasible,
		usedExcludedSources,
		time,
		volume,
		rawVolume,
		draws: globalDraws,
		deposits: globalDeposits,
	};

	// B3 (Q2a) -- finalPool must be container-keyed. Global mode routes nothing (decision 9), so the whole
	// flat carry-forward pool sits in the reserved Unassigned bucket; flattenPool reproduces `pool` exactly.
	const finalPool: ContainerPool = new Map([[UNASSIGNED_KEY, pool]]);

	return {
		batches,
		totals: { time, rawVolume, volume, feasible, finalPool },
		global,
	};
}
