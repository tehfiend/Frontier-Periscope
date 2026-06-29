// Queue resolver -- plan 36 (industry-build-queue), Phase 4.
//
// Solves a BuildQueue as a SEQUENTIAL PIPELINE: each step is solved on its own with the LP
// optimizer, and the outputs (plus uncredited co-products) of earlier steps flow forward as
// available stock for later steps. The user owns the top-level plan (which blueprint, how many
// runs, the order and grouping); the optimizer only sources the INPUTS each step's jobs need.
//
// TRADEOFF (documented per the plan): per-step greedy solves are NOT guaranteed globally optimal
// versus collapsing the whole queue into one big solve -- a later step might have steered an
// earlier step's recipe choice differently to share a co-product. We accept that on purpose: the
// point of a build queue is a legible, executable per-step plan that respects the user's chosen
// build order. Queue-global recipe locks (merged into each step) keep recipe choices consistent
// across steps so the plan does not flip-flop between steps.
//
// F3 adds an OPT-IN escape hatch: `queue.reoptMode === "global"` collapses the whole queue into one
// solve (see resolveQueueGlobal) for cross-step optimality, surfacing the result as a queue-level
// plan instead of per-step rows. "perStep" stays the default so existing callers are unchanged.

import { type BomResult, buildBomFromLp, resolveBom } from "@/lib/bomResolver";
import type {
	Blueprint,
	BomLineItem,
	BomOrderItem,
	BomSurplus,
	RecipeOverride,
	RecipePin,
} from "@/lib/bomTypes";
import type { BuildQueue, BuildStep, RecipeLockEntry } from "@/lib/buildQueueTypes";
import {
	ceilLpSolution,
	isIntegralAndConsistent,
	roundSolution,
	solveLp,
} from "@/lib/lpOptimizer";
import { SOURCE_PREF_WEIGHT, type SourcePref, defaultSourcePref } from "@/lib/sourcePrefs";

// ── Tuning constants ─────────────────────────────────────────────────────────
// Mirror IndustryCalculator's LP tuning so per-step solves behave like the flat-list solve.

/** Objective weight on overproduction of any producible type (breaks objective degeneracy). */
const LP_OVERPRODUCTION_PENALTY = 0.1;
/** Time budget (ms) for each integer branch-and-bound solve. */
const LP_SOLVE_BUDGET_MS = 1500;
/** Weight placed on a previously-excluded raw when relaxing exclusions to keep an order buildable. */
const LP_EXCLUDED_RELAX_WEIGHT = 1000;
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

/** A resolved job: the user's chosen blueprint + runs, and the outputs that produces. */
export interface StepJobResult {
	blueprintId: number;
	runs: number;
	/** The resolved blueprint (for label / recipe display). */
	blueprint: Blueprint;
	/** This job's outputs scaled by runs (primary output + co-products). */
	outputs: BomOrderItem[];
}

/** An intermediate the step builds, plus the either/or alternatives so Phase 7 can offer a swap. */
export interface StepBuildItem extends BomLineItem {
	/**
	 * Every blueprintId that can produce this type (from outputToBlueprints), INCLUDING the chosen
	 * one (`blueprintId`). `length > 1` means an either/or choice exists for this input.
	 */
	alternativeBlueprintIds: number[];
}

/** Top-level demand a step satisfied from the carry-forward pool / base stock (nothing built). */
export interface FromUpstreamItem {
	typeId: number;
	typeName: string;
	/** Quantity drawn from the pool for this type. */
	quantity: number;
	/** m3 (-1 when the type's volume is unknown). */
	volume: number;
}

/** Everything a single build step resolves to. */
export interface StepResult {
	stepId: string;
	label?: string;
	/** The step's jobs resolved to blueprint + runs + outputs. */
	jobs: StepJobResult[];
	/** Raw materials this step needs (each line carries quantity / stockQty / stillNeed). */
	gather: BomLineItem[];
	/** Intermediates produced this step, each with its chosen recipe + alternatives. */
	build: StepBuildItem[];
	/** Demand satisfied by the carry-forward pool / base stock (producible types, qty from pool). */
	fromUpstream: FromUpstreamItem[];
	/** Uncredited co-products produced this step (carried into the next step's pool). */
	surplus: BomSurplus[];
	/** Seconds: this step's job run time + the run time of the intermediates it builds. */
	time: number;
	/** m3: total material volume for this step (raw + intermediate; -1 entries excluded). */
	volume: number;
	/** m3: raw-material volume only. */
	rawVolume: number;
	/** True when the LP produced a clean, consistent integer plan for this step. */
	feasible: boolean;
	/** True when the step had to relax a source exclusion (e.g. Salvage) to be buildable. */
	usedExcludedSources: boolean;
	/**
	 * The step's own per-step recipe locks (copied straight from BuildStep.recipeLocks). Carried on the
	 * result so the UI can merge them with the queue-global locks per step (e.g. queueOpenChoiceCount).
	 */
	recipeLocks?: RecipeLockEntry[];
}

/**
 * The single queue-level plan produced in "global" re-optimization mode (F3). Present on
 * QueueResolveResult.global ONLY when queue.reoptMode === "global". The whole queue's job-input
 * demand was solved as ONE LP against baseStock, so this gather/build is a queue-wide summary and is
 * NOT attributed back to individual steps (each step's StepResult.gather/build/fromUpstream/surplus
 * are left empty in this mode -- the view should render this object instead). Per-step recipe locks
 * are NOT applied in global mode; only queue-global locks + source-prefs steer the solve.
 */
export interface QueueGlobalPlan {
	/** Raw materials gathered across the whole queue (single combined solve). */
	gather: BomLineItem[];
	/** Intermediates built across the whole queue, each with its chosen recipe + alternatives. */
	build: StepBuildItem[];
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
}

export interface QueueResolveResult {
	steps: StepResult[];
	totals: {
		/** Sum of every step's time (seconds). In global mode, the whole-queue plan time. */
		time: number;
		/** Sum of every step's raw-material volume (m3). In global mode, the whole-queue raw volume. */
		rawVolume: number;
		/** Sum of every step's total material volume (m3). In global mode, the whole-queue volume. */
		volume: number;
		/** True only when EVERY step resolved to a clean LP plan (in global mode, the single solve). */
		feasible: boolean;
		/** The carry-forward pool after the last step (surplus + leftover stock + final products). */
		finalPool: Map<number, number>;
	};
	/**
	 * Present ONLY when the queue resolved in "global" re-optimization mode (queue.reoptMode ===
	 * "global"). Undefined in the default per-step mode. See QueueGlobalPlan.
	 */
	global?: QueueGlobalPlan;
}

/** Everything the resolver needs from the loaded blueprint/game data. */
export interface QueueResolveContext {
	blueprints: Record<string, Blueprint>;
	outputToBlueprints: Map<number, Blueprint[]>;
	defaultRecipes: Map<number, number>;
	volumeMap: Map<number, number>;
	/** TypeIDs that are inputs but never outputs (leaf nodes) -- used for source-pref grouping. */
	rawMaterialIds: Set<number>;
	/** typeID -> source group name (Comet Ores, Salvage, ...) -- used for source-pref grouping. */
	typeGroups: Map<number, string>;
	/** Salvage leaf typeIDs (looted, not mined) -- gates salvage recipes / caps. */
	salvageMaterialIds: Set<number>;
}

// ── Lock merging + steering translation ──────────────────────────────────────

/**
 * Merge queue-global recipe locks with a step's optional per-step overrides. Per typeId, a step
 * entry FULLY overrides the queue entry for that type (replace, not union); otherwise the queue
 * entry applies. The Phase 7 UI writes both queue-global AND per-step locks; this merge resolves the
 * two scopes per type (plan Open Question 3 -- hybrid).
 */
export function mergeLocks(
	queueLocks: RecipeLockEntry[],
	stepLocks?: RecipeLockEntry[],
): RecipeLockEntry[] {
	const byType = new Map<number, RecipeLockEntry>();
	for (const lock of queueLocks) byType.set(lock.typeId, lock);
	if (stepLocks) {
		for (const lock of stepLocks) byType.set(lock.typeId, lock);
	}
	return [...byType.values()];
}

/** The optimizer-steering inputs derived from a set of recipe locks. */
interface LockSteering {
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

// ── Source preferences -> raw weights (replicates IndustryCalculator) ─────────

/**
 * Turn `Record<group, SourcePref>` + group membership into the `rawWeights` Map solveLp consumes
 * plus the hard-excluded raw id set. Replicates IndustryCalculator's prefs->weights logic so the
 * queue solve sources raws identically: excluded groups removed, others weighted by
 * SOURCE_PREF_WEIGHT, group default via defaultSourcePref (Salvage defaults to exclude).
 */
export function prefsToWeights(
	sourcePrefs: Record<string, SourcePref>,
	rawMaterialIds: Set<number>,
	typeGroups: Map<number, string>,
	salvageMaterialIds: Set<number>,
): { rawWeights: Map<number, number>; excludedRawIds: Set<number> } {
	const rawWeights = new Map<number, number>();
	const excludedRawIds = new Set<number>();

	// Group raw materials by their source group (Comet Ores, Salvage, ...).
	const groupToIds = new Map<string, number[]>();
	for (const rawId of rawMaterialIds) {
		const group = typeGroups.get(rawId) ?? "Other";
		const arr = groupToIds.get(group);
		if (arr) arr.push(rawId);
		else groupToIds.set(group, [rawId]);
	}

	// Before group data loads, keep the baseline salvage gating so the solver is never ungated.
	if (groupToIds.size === 0) {
		for (const id of salvageMaterialIds) excludedRawIds.add(id);
		return { rawWeights, excludedRawIds };
	}

	for (const [group, ids] of groupToIds) {
		const pref = sourcePrefs[group] ?? defaultSourcePref(group);
		for (const id of ids) {
			if (pref === "exclude") excludedRawIds.add(id);
			else rawWeights.set(id, SOURCE_PREF_WEIGHT[pref]);
		}
	}

	return { rawWeights, excludedRawIds };
}

// ── Cross-queue stock (F4) ────────────────────────────────────────────────────

/**
 * Merge several stock maps into one, summing quantities per typeId. Returns a NEW map; the inputs
 * are never mutated. The view uses this to fold the resolved totals.finalPool of any cross-queue
 * stock sources (queue.stockFromQueueIds) into the user's baseStock before calling resolveQueue --
 * the resolver itself does not load other queues, so it stays a pure function of (queue, ctx, stock).
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
function validatePins(pins: RecipePin[], outputToBlueprints: Map<number, Blueprint[]>): RecipePin[] {
	return pins.filter((pin) => {
		const producers = outputToBlueprints.get(pin.typeId);
		return producers != null && producers.length > 0;
	});
}

interface StepSolveOutput {
	bom: BomResult;
	feasible: boolean;
	usedExcludedSources: boolean;
}

/**
 * Solve one step's input demand against the carry-forward pool. Mirrors IndustryCalculator's
 * attemptSolve + two-pass relaxation: integer solve first, continuous+ceil fallback on timeout,
 * then a relaxed pass that re-admits excluded sources if the order is otherwise infeasible. On a
 * fully infeasible/unusable solve, falls back to the heuristic resolveBom honouring the pins.
 */
function solveStep(
	orderItems: BomOrderItem[],
	bpData: {
		blueprints: Record<string, Blueprint>;
		outputToBlueprints: Map<number, Blueprint[]>;
		defaultRecipes: Map<number, number>;
	},
	pool: Map<number, number>,
	steering: LockSteering,
	rawWeights: Map<number, number>,
	excludedRawIds: Set<number>,
	volumeMap: Map<number, number>,
	nameMap: Map<number, string>,
): StepSolveOutput {
	// `excludedRaws` is passed to solveLp's salvageMaterialIds slot: solveLp drops any blueprint that
	// needs an excluded raw it has no stock of, and caps consumption at stock. This is exactly how
	// IndustryCalculator hard-removes excluded raw sources (Salvage et al.) while still letting a
	// player burn down stock they already hold.
	const attemptSolve = (excludedRaws: Set<number>, weights: Map<number, number>) => {
		let sol = solveLp(orderItems, bpData, steering.pins, pool, excludedRaws, {
			integer: true,
			penalty: LP_OVERPRODUCTION_PENALTY,
			timeoutMs: LP_SOLVE_BUDGET_MS,
			rawWeights: weights,
			bpWeights: steering.bpWeights,
			excludeBpIds: steering.excludeBpIds,
		});
		if (sol.feasible && isIntegralAndConsistent(sol, bpData, orderItems, pool)) {
			return { sol: roundSolution(sol), usable: true };
		}
		sol = ceilLpSolution(
			solveLp(orderItems, bpData, steering.pins, pool, excludedRaws, {
				penalty: LP_OVERPRODUCTION_PENALTY,
				rawWeights: weights,
				bpWeights: steering.bpWeights,
				excludeBpIds: steering.excludeBpIds,
			}),
		);
		return { sol, usable: sol.feasible && isIntegralAndConsistent(sol, bpData, orderItems, pool) };
	};

	// Pass 1: honour the source exclusions (Salvage excluded by default).
	let { sol: solved, usable } = attemptSolve(excludedRawIds, rawWeights);
	let usedExcludedSources = false;

	// Pass 2: if infeasible under the exclusions, some input REQUIRES an excluded material with no
	// alternative. Relax the exclusions and re-solve, weighting the previously-excluded raws heavily
	// so the plan uses the minimum it cannot avoid rather than failing outright.
	if (!usable && excludedRawIds.size > 0) {
		const relaxedWeights = new Map(rawWeights);
		for (const id of excludedRawIds) relaxedWeights.set(id, LP_EXCLUDED_RELAX_WEIGHT);
		const relaxed = attemptSolve(new Set<number>(), relaxedWeights);
		if (relaxed.usable) {
			solved = relaxed.sol;
			usable = true;
			usedExcludedSources = true;
		}
	}

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

	const bom = buildBomFromLp(solved, bpData, orderItems, volumeMap, pool, nameMap);
	return { bom, feasible: true, usedExcludedSources };
}

/**
 * Turn a solved BOM into the display lists shared by both per-step and global resolution:
 *   gather       = raw materials (each line carries its own stockQty / stillNeed)
 *   build        = intermediates produced, each with its chosen recipe + either/or alternatives
 *   fromUpstream = top-level producible job INPUTS met from the pool (drawn from stock, nothing built)
 *
 * D4 -- a type already shown as a built intermediate (in `build`, with its own "Have"/stockQty
 * column) or as a gathered raw must NOT also appear in fromUpstream, or a partially-stocked
 * intermediate double-lists. fromUpstream therefore skips any typeId present in bom.intermediates or
 * bom.rawMaterials; only producible types that live solely in bom.finals (the step/queue's top-level
 * producible inputs covered from the pool) survive -- e.g. the "8 Capacitor -- from upstream" case.
 */
function bomToDisplayLists(
	bom: BomResult,
	outputToBlueprints: Map<number, Blueprint[]>,
	volumeMap: Map<number, number>,
	nameMap: Map<number, string>,
): { gather: BomLineItem[]; build: StepBuildItem[]; fromUpstream: FromUpstreamItem[] } {
	const gather = bom.rawMaterials;
	const build: StepBuildItem[] = bom.intermediates.map((item) => ({
		...item,
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
		});
	}
	fromUpstream.sort((a, b) => a.typeName.localeCompare(b.typeName));

	return { gather, build, fromUpstream };
}

// ── Main entry ─────────────────────────────────────────────────────────────────

/**
 * Resolve a whole BuildQueue into per-step plans with a carry-forward stock pool.
 *
 * For each step in order:
 *   demand   = sum over the step's jobs of runs * blueprint.inputs[].quantity   (Map<typeId, qty>)
 *   pins     = locksToPins(mergeLocks(queue.recipeLocks, step.recipeLocks))     (step overrides queue)
 *   sol      = solveLp(demand, ..., stockMap = pool, { rawWeights: prefsToWeights(...), integer })
 *   StepResult built from the BOM (gather = raws, build = intermediates + either/or alternatives,
 *              fromUpstream = pool-satisfied producible demand, surplus = co-products)
 *   pool     = max(0, pool - stockConsumed) + jobOutputs + surplus              (carry forward)
 *
 * The pool update uses the BOM's additive `stockConsumed` report-back (plan 36 Phase 4): a step
 * draws `stockConsumed` from the pool, then deposits the products its jobs build (`jobOutputs`) and
 * any uncredited co-products (`surplus`) for the next step to consume.
 *
 * @param queue      the saved build queue (ordered steps, source prefs, queue-global recipe locks)
 * @param ctx        loaded blueprint + game data (see QueueResolveContext)
 * @param baseStock  the user's starting stock (SSU inventory + manual entries), typeId -> qty
 */
export function resolveQueue(
	queue: BuildQueue,
	ctx: QueueResolveContext,
	baseStock: Map<number, number>,
): QueueResolveResult {
	const bpData = {
		blueprints: ctx.blueprints,
		outputToBlueprints: ctx.outputToBlueprints,
		defaultRecipes: ctx.defaultRecipes,
	};
	const nameMap = buildNameMap(ctx.blueprints);

	// Source-pref weighting is queue-global and identical for every step.
	const { rawWeights, excludedRawIds } = prefsToWeights(
		queue.sourcePrefs,
		ctx.rawMaterialIds,
		ctx.typeGroups,
		ctx.salvageMaterialIds,
	);

	// F3 -- opt-in global re-optimization. Default / "perStep" falls through to the per-step pipeline
	// below, so the existing resolveQueue(queue, ctx, stock) caller and its behavior are unchanged.
	if (queue.reoptMode === "global") {
		return resolveQueueGlobal(queue, bpData, ctx, baseStock, rawWeights, excludedRawIds, nameMap);
	}

	// The running carry-forward pool. Cloned so we never mutate the caller's baseStock.
	const pool = new Map(baseStock);

	const steps: StepResult[] = [];
	let totalTime = 0;
	let totalRawVolume = 0;
	let totalVolume = 0;
	let allFeasible = true;

	for (const step of queue.steps) {
		const stepResult = resolveStep(step, queue, bpData, ctx, pool, rawWeights, excludedRawIds, nameMap);
		steps.push(stepResult);
		totalTime += stepResult.time;
		totalRawVolume += stepResult.rawVolume;
		totalVolume += stepResult.volume;
		if (!stepResult.feasible) allFeasible = false;
	}

	return {
		steps,
		totals: {
			time: totalTime,
			rawVolume: totalRawVolume,
			volume: totalVolume,
			feasible: allFeasible,
			finalPool: pool,
		},
	};
}

/**
 * Resolve a single step and advance the carry-forward `pool` in place. Split out of resolveQueue so
 * the per-step accounting is easy to follow.
 */
function resolveStep(
	step: BuildStep,
	queue: BuildQueue,
	bpData: {
		blueprints: Record<string, Blueprint>;
		outputToBlueprints: Map<number, Blueprint[]>;
		defaultRecipes: Map<number, number>;
	},
	ctx: QueueResolveContext,
	pool: Map<number, number>,
	rawWeights: Map<number, number>,
	excludedRawIds: Set<number>,
	nameMap: Map<number, string>,
): StepResult {
	// 1. Resolve jobs -> demand (sum of inputs), jobOutputs (sum of outputs), job run time.
	const demand = new Map<number, number>();
	const jobOutputs = new Map<number, number>();
	const jobs: StepJobResult[] = [];
	let jobsTime = 0;

	for (const job of step.jobs) {
		const bp = bpData.blueprints[String(job.blueprintId)];
		if (!bp) continue; // stale blueprintId -- skip the job (cannot resolve its recipe)
		jobsTime += bp.runTime * job.runs;
		for (const inp of bp.inputs) {
			demand.set(inp.typeID, (demand.get(inp.typeID) ?? 0) + inp.quantity * job.runs);
		}
		for (const out of bp.outputs) {
			jobOutputs.set(out.typeID, (jobOutputs.get(out.typeID) ?? 0) + out.quantity * job.runs);
		}
		jobs.push({
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
	const mergedLocks = mergeLocks(queue.recipeLocks, step.recipeLocks);
	const steering = locksToPins(mergedLocks, bpData.outputToBlueprints);
	steering.pins = validatePins(steering.pins, bpData.outputToBlueprints);

	// D1 -- net intra-step job dependencies. A step is an UNORDERED pool of jobs: a component built by
	// one job covers a sibling job's consumption of that component FIRST, before anything is sourced.
	// Without this, `demand` sums every job's inputs with NO credit for sibling outputs, so a
	// producer+consumer grouped in one step double-builds the component (the solver sources it fresh
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

	// 3. Solve the step's NET input demand against the pool (or short-circuit when there is none). The
	// gather / build / fromUpstream lists below therefore all reflect the netted demand, not the gross.
	const orderItems: BomOrderItem[] = [...netDemand.entries()].map(([typeId, quantity]) => ({
		typeId,
		typeName: nameMap.get(typeId) ?? `Type ${typeId}`,
		quantity,
	}));

	let bom: BomResult;
	let feasible: boolean;
	let usedExcludedSources: boolean;
	if (orderItems.length === 0) {
		// No inputs to source (e.g. a step of pure raw->nothing jobs). Empty BOM; jobs still deposit.
		bom = emptyBom();
		feasible = true;
		usedExcludedSources = false;
	} else {
		const solved = solveStep(
			orderItems,
			bpData,
			pool,
			steering,
			rawWeights,
			excludedRawIds,
			ctx.volumeMap,
			nameMap,
		);
		bom = solved.bom;
		feasible = solved.feasible;
		usedExcludedSources = solved.usedExcludedSources;
	}

	// 4. Build the step's display lists from the BOM (gather / build / fromUpstream; D4 guard inside).
	const { gather, build, fromUpstream } = bomToDisplayLists(
		bom,
		bpData.outputToBlueprints,
		ctx.volumeMap,
		nameMap,
	);

	// 5. Advance the carry-forward pool: pool = max(0, pool - stockConsumed) + leftoverJobOutputs +
	// surplus, where leftoverJobOutputs = jobOutputs - internalUse (D1: the part of a job's output not
	// already consumed by a sibling job this step). stockConsumed never exceeds the pool (it is
	// allocated from it), so the subtraction stays >= 0; the max(0, ..) is a defensive clamp.
	// NOTE: when a co-product is overproduced for a type that is ALSO stocked, the BOM's `surplus`
	// (produced - consumed - demand) can under-report the leftover by up to the stock it ignores -- the
	// next step would then source a little extra. This is rare (stocked co-product overproduction) and
	// conservative (never negative, never over-credits).
	const stockConsumed = bom.stockConsumed ?? new Map<number, number>();
	const surplusMap = new Map<number, number>();
	for (const s of bom.surplus) surplusMap.set(s.typeId, s.quantity);
	const touched = new Set<number>([
		...stockConsumed.keys(),
		...jobOutputs.keys(),
		...surplusMap.keys(),
	]);
	for (const typeId of touched) {
		const before = pool.get(typeId) ?? 0;
		const drawn = stockConsumed.get(typeId) ?? 0;
		const leftoverOutput = (jobOutputs.get(typeId) ?? 0) - (internalUse.get(typeId) ?? 0);
		const produced = leftoverOutput + (surplusMap.get(typeId) ?? 0);
		pool.set(typeId, Math.max(0, before - drawn) + produced);
	}

	const rawVolume = bom.totals.rawVolume;
	const totalVolume = bom.totals.totalVolume;
	const intermediateTime = bom.totals.totalTime;

	return {
		stepId: step.id,
		label: step.label,
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
		recipeLocks: step.recipeLocks,
	};
}

// ── Global re-optimization (F3) ──────────────────────────────────────────────

/** An empty BOM (no inputs to source). Shared by the per-step and global no-demand short-circuits. */
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
 * Resolve the WHOLE queue as ONE solve (queue.reoptMode === "global"). Instead of the per-step
 * greedy pipeline, the union of every step's top-level job-input demand is collapsed into a single
 * solveLp against baseStock, finding cross-step optimality the per-step solve cannot see (a recipe
 * choice in one step that shares a co-product needed by another).
 *
 * TRADEOFF: this trades per-step legibility for cross-step optimality. The gather / build / fromUpstream
 * plan is a single QUEUE-LEVEL summary (returned on QueueResolveResult.global) and is NOT attributed
 * back to individual steps -- each StepResult keeps its jobs (and their outputs) but its gather / build /
 * fromUpstream / surplus are left EMPTY. Per-step recipe locks are a per-step-mode feature and are NOT
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
	rawWeights: Map<number, number>,
	excludedRawIds: Set<number>,
	nameMap: Map<number, string>,
): QueueResolveResult {
	// 1. Resolve every step's jobs; accumulate queue-wide demand, job outputs, and job run time. The
	// per-step rows are placeholders (jobs only) -- gather / build / fromUpstream / surplus stay empty
	// because the plan is queue-level in this mode.
	const globalDemand = new Map<number, number>();
	const globalJobOutputs = new Map<number, number>();
	const steps: StepResult[] = [];
	let globalJobTime = 0;

	for (const step of queue.steps) {
		const jobs: StepJobResult[] = [];
		let jobsTime = 0;
		for (const job of step.jobs) {
			const bp = bpData.blueprints[String(job.blueprintId)];
			if (!bp) continue; // stale blueprintId -- skip the job (cannot resolve its recipe)
			jobsTime += bp.runTime * job.runs;
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
		// Per-step time is this step's job run time only -- intermediate build time is queue-level (see
		// global.time). feasible/usedExcludedSources are refined from the single global solve below.
		steps.push({
			stepId: step.id,
			label: step.label,
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
			recipeLocks: step.recipeLocks,
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

	// Only queue-global locks steer the global solve (per-step locks are a per-step-mode feature).
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
		const solved = solveStep(
			orderItems,
			bpData,
			pool,
			steering,
			rawWeights,
			excludedRawIds,
			ctx.volumeMap,
			nameMap,
		);
		bom = solved.bom;
		feasible = solved.feasible;
		usedExcludedSources = solved.usedExcludedSources;
	}

	// 3. Queue-level display plan (D4 guard inside) + advance the pool to the final carry-forward.
	const { gather, build, fromUpstream } = bomToDisplayLists(
		bom,
		bpData.outputToBlueprints,
		ctx.volumeMap,
		nameMap,
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

	const rawVolume = bom.totals.rawVolume;
	const volume = bom.totals.totalVolume;
	const time = globalJobTime + bom.totals.totalTime;

	// Reflect the single solve's feasibility on every step so the UI can still flag the queue.
	for (const s of steps) {
		s.feasible = feasible;
		s.usedExcludedSources = usedExcludedSources;
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
	};

	return {
		steps,
		totals: { time, rawVolume, volume, feasible, finalPool: pool },
		global,
	};
}
