import solver, { type Model } from "javascript-lp-solver";
import type { Blueprint, BomOrderItem, RecipePin } from "./bomTypes";

// ── Types ──────────────────────────────────────────────────────────────────

export interface LpSolution {
	feasible: boolean;
	/** Map of blueprintID -> number of runs (continuous, or integer when integer:true) */
	runs: Map<number, number>;
	objectiveValue: number;
}

export interface LpSolveOptions {
	/** Solve as a mixed-integer program (whole blueprint runs) instead of continuous. */
	integer?: boolean;
	/** Objective weight on overproduction of any producible type (breaks degeneracy). 0 = off. */
	penalty?: number;
	/** Time budget (ms) for the integer branch-and-bound solve. */
	timeoutMs?: number;
	/** Per-raw-material objective weight (default 1 for every raw). Lets the UI steer sourcing. */
	rawWeights?: Map<number, number>;
}

// ── Demand cone ──────────────────────────────────────────────────────────────

/**
 * Recipes (and the types they touch) backward-reachable from the order items.
 * Starting from the ordered typeIds, repeatedly add every non-excluded producer of
 * a needed type and enqueue that recipe's inputs. Co-products (a recipe's other
 * outputs) are recorded so they get demand/overproduction constraints, but are NOT
 * enqueued -- we never expand the graph just to make a byproduct.
 *
 * Restricting the LP to this cone is provably safe: it only drops recipes whose
 * entire output is irrelevant to the order, so it can never remove a useful recipe
 * or change feasibility. It also shrinks the model from ~all blueprints to a handful,
 * which is what makes the integer solve fast, and it deterministically eliminates
 * unrelated "junk" recipes (e.g. ammo) that a degenerate objective could otherwise pick.
 */
function computeDemandCone(
	orderItems: BomOrderItem[],
	outputToBlueprints: Map<number, Blueprint[]>,
	excludedBpIds: Set<number>,
): { bpIds: Set<number>; coneTypes: Set<number> } {
	const bpIds = new Set<number>();
	const coneTypes = new Set<number>();
	const expanded = new Set<number>();
	const queue: number[] = [];
	for (const item of orderItems) {
		coneTypes.add(item.typeId);
		queue.push(item.typeId);
	}
	while (queue.length > 0) {
		const typeId = queue.pop();
		if (typeId === undefined || expanded.has(typeId)) continue;
		expanded.add(typeId);
		const producers = outputToBlueprints.get(typeId);
		if (!producers) continue;
		for (const bp of producers) {
			if (excludedBpIds.has(bp.blueprintID)) continue;
			if (bpIds.has(bp.blueprintID)) continue;
			bpIds.add(bp.blueprintID);
			for (const out of bp.outputs) coneTypes.add(out.typeID);
			for (const inp of bp.inputs) {
				coneTypes.add(inp.typeID);
				if (!expanded.has(inp.typeID)) queue.push(inp.typeID);
			}
		}
	}
	return { bpIds, coneTypes };
}

// ── Solve LP ───────────────────────────────────────────────────────────────

export function solveLp(
	orderItems: BomOrderItem[],
	blueprintData: {
		blueprints: Record<string, Blueprint>;
		outputToBlueprints: Map<number, Blueprint[]>;
		defaultRecipes: Map<number, number>;
	},
	recipePins: RecipePin[],
	stockMap: Map<number, number>,
	salvageMaterialIds?: Set<number>,
	opts: LpSolveOptions = {},
): LpSolution {
	const { blueprints, outputToBlueprints } = blueprintData;
	const penalty = opts.penalty ?? 0;

	// Identify raw materials: inputs that are never outputs of any blueprint
	const allOutputIds = new Set<number>();
	const allInputIds = new Set<number>();
	for (const bp of Object.values(blueprints)) {
		for (const out of bp.outputs) allOutputIds.add(out.typeID);
		for (const inp of bp.inputs) allInputIds.add(inp.typeID);
	}
	const rawTypeIds = new Set<number>();
	for (const id of allInputIds) {
		if (!allOutputIds.has(id)) rawTypeIds.add(id);
	}

	// Exclude salvage blueprints unless the player has stock of each specific
	// salvage material the blueprint requires. A blueprint is only included if
	// ALL of its salvage inputs have stock > 0.
	const excludedBpIds = new Set<number>();
	if (salvageMaterialIds != null && salvageMaterialIds.size > 0) {
		for (const bp of Object.values(blueprints)) {
			const salvageInputs = bp.inputs.filter((inp) => salvageMaterialIds.has(inp.typeID));
			if (salvageInputs.length > 0) {
				const hasAllSalvageStock = salvageInputs.every(
					(inp) => (stockMap.get(inp.typeID) ?? 0) > 0,
				);
				if (!hasAllSalvageStock) {
					excludedBpIds.add(bp.blueprintID);
				}
			}
		}
	}

	// Restrict the model to the demand cone of the order (see computeDemandCone).
	const { bpIds: coneBpIds, coneTypes } = computeDemandCone(
		orderItems,
		outputToBlueprints,
		excludedBpIds,
	);

	// Build LP model
	const constraints: Record<string, { min?: number; max?: number; equal?: number }> = {};
	const variables: Record<string, Record<string, number>> = {};

	// Track which producible types exist (output of at least one blueprint)
	const producibleTypes = new Set<number>();
	for (const typeId of outputToBlueprints.keys()) {
		producibleTypes.add(typeId);
	}

	// Order demand lookup
	const orderDemand = new Map<number, number>();
	for (const item of orderItems) {
		orderDemand.set(item.typeId, (orderDemand.get(item.typeId) ?? 0) + item.quantity);
	}

	// 1. Add demand constraints for each producible type in the cone
	for (const typeId of producibleTypes) {
		if (!coneTypes.has(typeId)) continue;
		const demandQty = orderDemand.get(typeId) ?? 0;
		const stock = stockMap.get(typeId) ?? 0;
		// Do NOT clamp -- negative RHS is correct (allows consuming stock)
		constraints[`demand_${typeId}`] = { min: demandQty - stock };
	}

	// 2. Add raw material constraints (cone only)
	for (const rawId of rawTypeIds) {
		if (!coneTypes.has(rawId)) continue;
		const stock = stockMap.get(rawId) ?? 0;
		constraints[`raw_${rawId}`] = { min: -stock };
	}

	// 3. Add excess variables for raw materials (objective targets, optionally weighted)
	for (const rawId of rawTypeIds) {
		if (!coneTypes.has(rawId)) continue;
		// Require a finite, positive weight: a negative weight would reward unbounded excess
		// (unbounded LP) and NaN/0 would poison the objective. Fall back to the default 1.
		const rawWeight = opts.rawWeights?.get(rawId) ?? 1;
		const safeWeight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;
		variables[`excess_${rawId}`] = {
			objective: safeWeight,
			[`raw_${rawId}`]: 1,
		};
	}

	// 3b. Overproduction penalty: for each producible cone type add an `over` slack var
	// (objective weight `penalty`) bounded so it captures any surplus beyond demand:
	//   produced - consumed - over <= demand  =>  over >= produced - consumed - demand.
	// Minimizing `penalty * over` breaks the equal-weight objective's degeneracy and
	// steers selection toward low-waste recipes.
	if (penalty > 0) {
		for (const typeId of producibleTypes) {
			if (!coneTypes.has(typeId)) continue;
			const demandQty = orderDemand.get(typeId) ?? 0;
			// RHS is bare demand (not demand - stock) so the penalty tracks the SAME surplus
			// buildBomFromLp displays (produced - consumed - demand), independent of stock.
			constraints[`over_${typeId}`] = { max: demandQty };
			variables[`over_${typeId}`] = {
				objective: penalty,
				[`over_${typeId}`]: -1,
			};
		}
	}

	// 4. Add blueprint variables (cone only; skip excluded salvage-path blueprints)
	for (const bp of Object.values(blueprints)) {
		if (excludedBpIds.has(bp.blueprintID)) continue;
		if (!coneBpIds.has(bp.blueprintID)) continue;
		const varName = `bp_${bp.blueprintID}`;
		const coeffs: Record<string, number> = { objective: 0 };

		// Outputs contribute positively to demand (and overproduction) constraints
		for (const out of bp.outputs) {
			if (producibleTypes.has(out.typeID) && coneTypes.has(out.typeID)) {
				coeffs[`demand_${out.typeID}`] = (coeffs[`demand_${out.typeID}`] ?? 0) + out.quantity;
				if (penalty > 0) {
					coeffs[`over_${out.typeID}`] = (coeffs[`over_${out.typeID}`] ?? 0) + out.quantity;
				}
			}
		}

		// Inputs consume from demand (and overproduction) constraints, or raw constraints
		for (const inp of bp.inputs) {
			if (producibleTypes.has(inp.typeID) && coneTypes.has(inp.typeID)) {
				coeffs[`demand_${inp.typeID}`] = (coeffs[`demand_${inp.typeID}`] ?? 0) - inp.quantity;
				if (penalty > 0) {
					coeffs[`over_${inp.typeID}`] = (coeffs[`over_${inp.typeID}`] ?? 0) - inp.quantity;
				}
			} else if (rawTypeIds.has(inp.typeID) && coneTypes.has(inp.typeID)) {
				coeffs[`raw_${inp.typeID}`] = (coeffs[`raw_${inp.typeID}`] ?? 0) - inp.quantity;
			}
		}

		variables[varName] = coeffs;
	}

	// 4b. Cap salvage consumption to actual stock
	if (salvageMaterialIds != null && salvageMaterialIds.size > 0) {
		// For each salvage material, total consumption across all blueprints <= stock
		for (const salvageId of salvageMaterialIds) {
			const stock = stockMap.get(salvageId) ?? 0;
			if (stock <= 0) continue;
			const constraintName = `salvage_cap_${salvageId}`;
			// Add coefficients for every in-cone blueprint that uses this salvage input
			let hasConsumer = false;
			for (const bp of Object.values(blueprints)) {
				if (excludedBpIds.has(bp.blueprintID)) continue;
				const inp = bp.inputs.find((i) => i.typeID === salvageId);
				if (inp) {
					const varName = `bp_${bp.blueprintID}`;
					if (variables[varName]) {
						variables[varName][constraintName] = inp.quantity;
						hasConsumer = true;
					}
				}
			}
			// Only emit the cap when an in-cone blueprint actually consumes this salvage id;
			// otherwise the constraint is harmless but pointless.
			if (hasConsumer) {
				constraints[constraintName] = { max: stock };
			}
		}
	}

	// 5. Apply pin constraints
	// Track blueprint variables that carry a min-run/forced constraint from a split pin. A
	// co-product blueprint can be force-run by one type's split pin while another type's
	// exclusive pin (or fully-covered split) tries to zero that same blueprint, yielding
	// contradictory `bp >= n` and `bp = 0` -- which makes the WHOLE LP infeasible. The
	// pre-pass below collects every force-run blueprint up front (independent of pin order),
	// so the zeroing loops skip them and two individually-valid pins can coexist.
	const forcedBpVars = new Set<string>();
	for (const pin of recipePins) {
		if (pin.kind !== "split") continue;
		for (const split of pin.splits) {
			if (!blueprints[String(split.blueprintId)]) continue;
			const varName = `bp_${split.blueprintId}`;
			if (variables[varName]) forcedBpVars.add(varName);
		}
	}
	for (const pin of recipePins) {
		const producers = outputToBlueprints.get(pin.typeId);
		if (!producers || producers.length === 0) continue;

		if (pin.kind === "exclusive") {
			// If the pinned blueprint isn't available (excluded source / not in cone), ignore
			// the pin rather than zeroing every other producer (which forces infeasibility).
			if (!variables[`bp_${pin.blueprintId}`]) continue;
			// Zero out all non-pinned blueprints that produce this type
			for (const bp of producers) {
				if (bp.blueprintID !== pin.blueprintId) {
					const varName = `bp_${bp.blueprintID}`;
					// Skip blueprints already forced to run by another type's pin; zeroing them
					// here would contradict that min-run and make the whole LP infeasible.
					if (forcedBpVars.has(varName)) continue;
					const constraintName = `pin_${bp.blueprintID}_for_${pin.typeId}`;
					constraints[constraintName] = { equal: 0 };
					if (variables[varName]) {
						variables[varName][constraintName] = 1;
					}
				}
			}
		} else if (pin.kind === "split") {
			// Set minimum runs for each pinned blueprint (lower bound, not exact)
			const pinnedBpIds = new Set(pin.splits.map((s) => s.blueprintId));
			let totalPinnedQty = 0;

			for (const split of pin.splits) {
				const bp = blueprints[String(split.blueprintId)];
				if (!bp) continue;
				const varName = `bp_${split.blueprintId}`;
				// Skip pins whose blueprint isn't in the cone: a min-constraint with no backing
				// variable makes the WHOLE model infeasible (orphan 0 >= runs).
				if (!variables[varName]) continue;
				const outputQty = bp.outputs.find((o) => o.typeID === pin.typeId)?.quantity ?? 1;
				totalPinnedQty += split.quantity;
				const runs = Math.ceil(split.quantity / outputQty);
				const constraintName = `pin_${split.blueprintId}_for_${pin.typeId}`;
				constraints[constraintName] = { min: runs };
				variables[varName][constraintName] = 1;
				// Remember this blueprint is force-run so a later pin won't zero it.
				forcedBpVars.add(varName);
			}

			// Only zero out non-pinned blueprints when splits fully cover demand
			const demand = orderDemand.get(pin.typeId) ?? 0;
			if (totalPinnedQty >= demand) {
				for (const bp of producers) {
					if (!pinnedBpIds.has(bp.blueprintID)) {
						const varName = `bp_${bp.blueprintID}`;
						// Skip blueprints already forced to run by another type's pin; zeroing
						// them here would contradict that min-run and make the LP infeasible.
						if (forcedBpVars.has(varName)) continue;
						const constraintName = `pin_${bp.blueprintID}_for_${pin.typeId}`;
						constraints[constraintName] = { equal: 0 };
						if (variables[varName]) {
							variables[varName][constraintName] = 1;
						}
					}
				}
			}
		}
	}

	// 6. Solve
	const model: Model = {
		optimize: "objective",
		opType: "min",
		constraints,
		variables,
	};
	if (opts.integer) {
		const ints: Record<string, number> = {};
		for (const key of Object.keys(variables)) {
			if (key.startsWith("bp_")) ints[key] = 1;
		}
		model.ints = ints;
		model.options = { timeout: opts.timeoutMs ?? 1500 };
	}

	const solution = solver.Solve(model);

	// 7. Extract results
	const runs = new Map<number, number>();
	for (const [key, value] of Object.entries(solution)) {
		if (key.startsWith("bp_") && typeof value === "number" && value > 0) {
			const bpId = Number.parseInt(key.slice(3), 10);
			if (Number.isNaN(bpId)) continue;
			// Store the RAW solver value -- do NOT round here. A timed-out integer solve can
			// return a genuinely fractional incumbent; isIntegralAndConsistent must see that
			// to reject it and trigger the fallback. Round only after validation (roundSolution).
			runs.set(bpId, value);
		}
	}

	return {
		feasible: solution.feasible,
		runs,
		objectiveValue: typeof solution.result === "number" ? solution.result : 0,
	};
}

// ── Ceiling (fallback path) ──────────────────────────────────────────────────

export function ceilLpSolution(solution: LpSolution): LpSolution {
	const ceiledRuns = new Map<number, number>();
	for (const [bpId, runCount] of solution.runs) {
		ceiledRuns.set(bpId, Math.ceil(runCount));
	}
	return {
		feasible: solution.feasible,
		runs: ceiledRuns,
		objectiveValue: solution.objectiveValue,
	};
}

/**
 * Round each run to the nearest whole number. Apply ONLY after isIntegralAndConsistent
 * has confirmed an integer solve's runs are genuinely (near-)integral -- this just cleans
 * up solver float noise (e.g. 9.9999999 -> 10) so downstream quantities are exact.
 */
export function roundSolution(solution: LpSolution): LpSolution {
	const roundedRuns = new Map<number, number>();
	for (const [bpId, runCount] of solution.runs) {
		const rounded = Math.round(runCount);
		if (rounded > 0) roundedRuns.set(bpId, rounded);
	}
	return {
		feasible: solution.feasible,
		runs: roundedRuns,
		objectiveValue: solution.objectiveValue,
	};
}

// ── Consistency check ─────────────────────────────────────────────────────────

/**
 * True if the solution's runs are whole numbers AND the plan is internally consistent
 * (no producible type is consumed beyond what is produced + stock + demand-offset).
 *
 * The integer solver can return a fractional incumbent when it times out on a hard
 * instance; callers use this to decide whether to trust the integer result or fall
 * back to the continuous + ceil path. Raw materials are exempt (they are meant to be
 * consumed); only producible types must balance.
 */
export function isIntegralAndConsistent(
	solution: LpSolution,
	blueprintData: { blueprints: Record<string, Blueprint> },
	orderItems: BomOrderItem[],
	stockMap: Map<number, number>,
): boolean {
	const { blueprints } = blueprintData;

	for (const [, runCount] of solution.runs) {
		if (Math.abs(runCount - Math.round(runCount)) > 1e-6) return false;
	}

	const producible = new Set<number>();
	for (const bp of Object.values(blueprints)) {
		for (const out of bp.outputs) producible.add(out.typeID);
	}

	const produced = new Map<number, number>();
	const consumed = new Map<number, number>();
	for (const [bpId, runRaw] of solution.runs) {
		const runCount = Math.round(runRaw);
		if (runCount <= 0) continue;
		const bp = blueprints[String(bpId)];
		if (!bp) continue;
		for (const out of bp.outputs) {
			produced.set(out.typeID, (produced.get(out.typeID) ?? 0) + out.quantity * runCount);
		}
		for (const inp of bp.inputs) {
			consumed.set(inp.typeID, (consumed.get(inp.typeID) ?? 0) + inp.quantity * runCount);
		}
	}

	const demand = new Map<number, number>();
	for (const item of orderItems) {
		demand.set(item.typeId, (demand.get(item.typeId) ?? 0) + item.quantity);
	}

	const allTypes = new Set<number>([
		...produced.keys(),
		...consumed.keys(),
		...demand.keys(),
	]);
	for (const typeId of allTypes) {
		if (!producible.has(typeId)) continue; // raws are meant to be consumed
		const balance =
			(produced.get(typeId) ?? 0) -
			(consumed.get(typeId) ?? 0) -
			(demand.get(typeId) ?? 0) +
			(stockMap.get(typeId) ?? 0);
		if (balance < -1e-6) return false;
	}

	return true;
}
