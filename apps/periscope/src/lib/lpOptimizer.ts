import solver from "javascript-lp-solver";
import type { Blueprint, BomOrderItem, RecipePin } from "./bomTypes";

// ── Types ──────────────────────────────────────────────────────────────────

export interface LpSolution {
	feasible: boolean;
	/** Map of blueprintID -> number of runs (continuous) */
	runs: Map<number, number>;
	objectiveValue: number;
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
): LpSolution {
	const { blueprints, outputToBlueprints } = blueprintData;

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

	// Build pin lookup: typeId -> RecipePin
	const pinByType = new Map<number, RecipePin>();
	for (const pin of recipePins) {
		pinByType.set(pin.typeId, pin);
	}

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

	// 1. Add demand constraints for each producible type
	for (const typeId of producibleTypes) {
		const demandQty = orderDemand.get(typeId) ?? 0;
		const stock = stockMap.get(typeId) ?? 0;
		// Do NOT clamp -- negative RHS is correct (allows consuming stock)
		constraints[`demand_${typeId}`] = { min: demandQty - stock };
	}

	// 2. Add raw material constraints
	for (const rawId of rawTypeIds) {
		const stock = stockMap.get(rawId) ?? 0;
		constraints[`raw_${rawId}`] = { min: -stock };
	}

	// 3. Add excess variables for raw materials (objective targets)
	for (const rawId of rawTypeIds) {
		const varName = `excess_${rawId}`;
		variables[varName] = {
			objective: 1,
			[`raw_${rawId}`]: 1,
		};
	}

	// 4. Add blueprint variables
	for (const bp of Object.values(blueprints)) {
		const varName = `bp_${bp.blueprintID}`;
		const coeffs: Record<string, number> = { objective: 0 };

		// Outputs contribute positively to demand constraints
		for (const out of bp.outputs) {
			if (producibleTypes.has(out.typeID)) {
				coeffs[`demand_${out.typeID}`] = (coeffs[`demand_${out.typeID}`] ?? 0) + out.quantity;
			}
		}

		// Inputs consume from demand constraints (producible) or raw constraints
		for (const inp of bp.inputs) {
			if (producibleTypes.has(inp.typeID)) {
				coeffs[`demand_${inp.typeID}`] = (coeffs[`demand_${inp.typeID}`] ?? 0) - inp.quantity;
			} else if (rawTypeIds.has(inp.typeID)) {
				coeffs[`raw_${inp.typeID}`] = (coeffs[`raw_${inp.typeID}`] ?? 0) - inp.quantity;
			}
		}

		variables[varName] = coeffs;
	}

	// 5. Apply pin constraints
	for (const pin of recipePins) {
		const producers = outputToBlueprints.get(pin.typeId);
		if (!producers || producers.length === 0) continue;

		if (pin.kind === "exclusive") {
			// Zero out all non-pinned blueprints that produce this type
			for (const bp of producers) {
				if (bp.blueprintID !== pin.blueprintId) {
					const constraintName = `pin_${bp.blueprintID}_for_${pin.typeId}`;
					constraints[constraintName] = { equal: 0 };
					const varName = `bp_${bp.blueprintID}`;
					if (variables[varName]) {
						variables[varName][constraintName] = 1;
					}
				}
			}
		} else if (pin.kind === "split") {
			// Fix runs for each pinned blueprint, zero out others
			const pinnedBpIds = new Set(pin.splits.map((s) => s.blueprintId));

			for (const split of pin.splits) {
				const bp = blueprints[String(split.blueprintId)];
				if (!bp) continue;
				const outputQty = bp.outputs.find((o) => o.typeID === pin.typeId)?.quantity ?? 1;
				const runs = Math.ceil(split.quantity / outputQty);
				const constraintName = `pin_${split.blueprintId}_for_${pin.typeId}`;
				constraints[constraintName] = { equal: runs };
				const varName = `bp_${split.blueprintId}`;
				if (variables[varName]) {
					variables[varName][constraintName] = 1;
				}
			}

			// Zero out non-pinned blueprints for this type
			for (const bp of producers) {
				if (!pinnedBpIds.has(bp.blueprintID)) {
					const constraintName = `pin_${bp.blueprintID}_for_${pin.typeId}`;
					constraints[constraintName] = { equal: 0 };
					const varName = `bp_${bp.blueprintID}`;
					if (variables[varName]) {
						variables[varName][constraintName] = 1;
					}
				}
			}
		}
	}

	// 6. Solve
	const model = {
		optimize: "objective",
		opType: "min" as const,
		constraints,
		variables,
	};

	const solution = solver.Solve(model);

	// 7. Extract results
	const runs = new Map<number, number>();
	for (const [key, value] of Object.entries(solution)) {
		if (key.startsWith("bp_") && typeof value === "number" && value > 0) {
			const bpId = Number.parseInt(key.slice(3), 10);
			if (!Number.isNaN(bpId)) {
				runs.set(bpId, value);
			}
		}
	}

	return {
		feasible: solution.feasible,
		runs,
		objectiveValue: typeof solution.result === "number" ? solution.result : 0,
	};
}

// ── Ceiling ────────────────────────────────────────────────────────────────

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
