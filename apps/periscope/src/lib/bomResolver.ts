import type { Blueprint, BomLineItem, BomOrderItem, BomSurplus, RecipeOverride } from "./bomTypes";

// ── Result type ─────────────────────────────────────────────────────────────

export interface BomResult {
	rawMaterials: BomLineItem[];
	intermediates: BomLineItem[];
	finals: BomLineItem[];
	surplus: BomSurplus[];
	totals: {
		rawVolume: number;
		intermediateVolume: number;
		totalVolume: number;
		totalTime: number;
		iterations: number;
	};
}

// ── Internal types ──────────────────────────────────────────────────────────

interface QueueItem {
	typeId: number;
	quantity: number;
	isOrderItem: boolean;
}

interface ExpandResult {
	rawTotals: Map<number, number>;
	intermediateTotals: Map<number, number>;
	finalTotals: Map<number, number>;
	coProductYields: Map<number, number>;
	/** co-product typeID -> source recipe name (primary output) */
	coProductSources: Map<number, string>;
	totalTime: number;
}

interface BlueprintLookup {
	blueprints: Record<string, Blueprint>;
	outputToBlueprints: Map<number, Blueprint[]>;
	defaultRecipes: Map<number, number>;
}

// ── Name lookup ─────────────────────────────────────────────────────────────

function buildNameMap(blueprints: Record<string, Blueprint>): Map<number, string> {
	const names = new Map<number, string>();
	for (const bp of Object.values(blueprints)) {
		for (const i of bp.inputs) names.set(i.typeID, i.typeName);
		for (const o of bp.outputs) names.set(o.typeID, o.typeName);
	}
	return names;
}

// ── Blueprint lookup ────────────────────────────────────────────────────────

function findBlueprintFor(
	typeId: number,
	lookup: BlueprintLookup,
	overrides: Map<number, number>,
): Blueprint | null {
	// Check overrides first -- validate the blueprint actually produces this type
	const overrideBpId = overrides.get(typeId);
	if (overrideBpId !== undefined) {
		const bp = lookup.blueprints[String(overrideBpId)];
		if (bp && bp.outputs.some((o) => o.typeID === typeId)) return bp;
		// Invalid/stale override -- discard it
		overrides.delete(typeId);
	}

	// Fall back to default recipe
	const defaultBpId = lookup.defaultRecipes.get(typeId);
	if (defaultBpId !== undefined) {
		const bp = lookup.blueprints[String(defaultBpId)];
		if (bp) return bp;
	}

	// Try outputToBlueprints as last resort
	const producers = lookup.outputToBlueprints.get(typeId);
	if (producers && producers.length > 0) return producers[0];

	return null;
}

// ── Expand demand (topological) ─────────────────────────────────────────────
//
// Uses Kahn's algorithm to process types in dependency order, ensuring all
// demand for a type is aggregated before stock or co-product credits are
// applied. This makes results deterministic regardless of input ordering.

function expandDemand(
	demands: QueueItem[],
	coProductCredits: Map<number, number>,
	lookup: BlueprintLookup,
	overrides: Map<number, number>,
	stockMap: Map<number, number>,
): ExpandResult {
	const rawTotals = new Map<number, number>();
	const intermediateTotals = new Map<number, number>();
	const finalTotals = new Map<number, number>();
	const coProductYields = new Map<number, number>();
	const coProductSources = new Map<number, string>();
	let totalTime = 0;

	// Phase A: Discover full production graph (blueprint per producible type)
	const typeBp = new Map<number, Blueprint>();
	{
		const visited = new Set<number>();
		const stack = demands.map((d) => d.typeId);
		while (stack.length > 0) {
			const typeId = stack.pop()!;
			if (visited.has(typeId)) continue;
			visited.add(typeId);
			const bp = findBlueprintFor(typeId, lookup, overrides);
			if (!bp) continue;
			typeBp.set(typeId, bp);
			for (const input of bp.inputs) stack.push(input.typeID);
		}
	}

	// Phase B: Compute in-degree (edges between producible types only)
	const inDegree = new Map<number, number>();
	for (const typeId of typeBp.keys()) inDegree.set(typeId, 0);
	for (const [, bp] of typeBp) {
		for (const input of bp.inputs) {
			if (typeBp.has(input.typeID)) {
				inDegree.set(input.typeID, (inDegree.get(input.typeID) ?? 0) + 1);
			}
		}
	}

	// Phase C: Topological processing -- stock applied per-type against aggregate demand
	const topoQueue: number[] = [];
	for (const [typeId, deg] of inDegree) {
		if (deg === 0) topoQueue.push(typeId);
	}

	// Separate demand maps to preserve provenance (order vs intermediate)
	const orderDemand = new Map<number, number>();
	const interDemand = new Map<number, number>();
	for (const d of demands) {
		if (d.isOrderItem) {
			orderDemand.set(d.typeId, (orderDemand.get(d.typeId) ?? 0) + d.quantity);
		} else {
			interDemand.set(d.typeId, (interDemand.get(d.typeId) ?? 0) + d.quantity);
		}
	}

	const availableStock = new Map(stockMap);

	while (topoQueue.length > 0) {
		const typeId = topoQueue.shift()!;
		const bp = typeBp.get(typeId)!;
		const orderQty = orderDemand.get(typeId) ?? 0;
		const interQty = interDemand.get(typeId) ?? 0;
		const qty = orderQty + interQty;

		// Record demand in the appropriate tier (a type can appear in both)
		if (orderQty > 0) {
			finalTotals.set(typeId, (finalTotals.get(typeId) ?? 0) + orderQty);
		}
		if (interQty > 0) {
			intermediateTotals.set(typeId, (intermediateTotals.get(typeId) ?? 0) + interQty);
		}

		// Apply co-product credits then stock against aggregate demand
		const credit = coProductCredits.get(typeId) ?? 0;
		let effectiveQty = Math.max(0, qty - credit);

		const stock = availableStock.get(typeId) ?? 0;
		if (stock > 0) {
			const consumed = Math.min(stock, effectiveQty);
			availableStock.set(typeId, stock - consumed);
			effectiveQty -= consumed;
		}

		if (effectiveQty > 0) {
			const outputEntry = bp.outputs.find((o) => o.typeID === typeId);
			const outputPerRun = outputEntry?.quantity ?? 1;
			const runs = Math.ceil(effectiveQty / outputPerRun);
			totalTime += bp.runTime * runs;

			for (const output of bp.outputs) {
				if (output.typeID !== typeId) {
					coProductYields.set(
						output.typeID,
						(coProductYields.get(output.typeID) ?? 0) + output.quantity * runs,
					);
					coProductSources.set(output.typeID, outputEntry?.typeName ?? bp.primaryTypeName);
				}
			}

			// Distribute input demand based on actual production runs
			for (const input of bp.inputs) {
				if (typeBp.has(input.typeID)) {
					interDemand.set(
						input.typeID,
						(interDemand.get(input.typeID) ?? 0) + input.quantity * runs,
					);
				} else {
					rawTotals.set(
						input.typeID,
						(rawTotals.get(input.typeID) ?? 0) + input.quantity * runs,
					);
				}
			}
		}

		// Decrement in-degree for producible children (even if no production needed)
		for (const input of bp.inputs) {
			if (typeBp.has(input.typeID)) {
				const newDeg = (inDegree.get(input.typeID) ?? 1) - 1;
				inDegree.set(input.typeID, newDeg);
				if (newDeg === 0) topoQueue.push(input.typeID);
			}
		}
	}

	// Handle non-producible demanded types (e.g. raw materials ordered directly)
	for (const d of demands) {
		if (!typeBp.has(d.typeId)) {
			rawTotals.set(d.typeId, (rawTotals.get(d.typeId) ?? 0) + d.quantity);
		}
	}

	return { rawTotals, intermediateTotals, finalTotals, coProductYields, coProductSources, totalTime };
}

// ── Main resolver ───────────────────────────────────────────────────────────

export function resolveBom(
	orderItems: BomOrderItem[],
	blueprintData: {
		blueprints: Record<string, Blueprint>;
		outputToBlueprints: Map<number, Blueprint[]>;
		defaultRecipes: Map<number, number>;
	},
	recipeOverrides: RecipeOverride[],
	volumeMap: Map<number, number>,
	stockMap: Map<number, number>,
	externalNameMap?: Map<number, string>,
): BomResult {
	if (orderItems.length === 0) {
		return {
			rawMaterials: [],
			intermediates: [],
			finals: [],
			surplus: [],
			totals: { rawVolume: 0, intermediateVolume: 0, totalVolume: 0, totalTime: 0, iterations: 0 },
		};
	}

	const lookup: BlueprintLookup = {
		blueprints: blueprintData.blueprints,
		outputToBlueprints: blueprintData.outputToBlueprints,
		defaultRecipes: blueprintData.defaultRecipes,
	};

	const overrides = new Map<number, number>();
	for (const o of recipeOverrides) {
		overrides.set(o.typeId, o.blueprintId);
	}

	const nameMap = externalNameMap ?? buildNameMap(lookup.blueprints);

	const demands: QueueItem[] = orderItems.map((i) => ({
		typeId: i.typeId,
		quantity: i.quantity,
		isOrderItem: true,
	}));

	// Phase 2: Iterative co-product convergence
	let coProductCredits = new Map<number, number>();
	let prevTotalRaw = Number.POSITIVE_INFINITY;
	const maxIterations = 10;
	let result: ExpandResult = expandDemand(demands, coProductCredits, lookup, overrides, stockMap);
	let iterations = 1;

	for (let iter = 1; iter <= maxIterations; iter++) {
		result = expandDemand(demands, coProductCredits, lookup, overrides, stockMap);
		iterations = iter;

		// Update co-product credits for next iteration
		const newCredits = new Map<number, number>();
		for (const [typeId, yieldQty] of result.coProductYields) {
			const intermediateNeed = result.intermediateTotals.get(typeId) ?? 0;
			if (intermediateNeed > 0) {
				newCredits.set(typeId, Math.min(yieldQty, intermediateNeed));
			}
			// Also credit against raw totals
			const rawNeed = result.rawTotals.get(typeId) ?? 0;
			if (rawNeed > 0) {
				result.rawTotals.set(typeId, Math.max(0, rawNeed - yieldQty));
			}
		}

		const currentTotalRaw = sumValues(result.rawTotals);
		if (currentTotalRaw === prevTotalRaw) break;
		prevTotalRaw = currentTotalRaw;
		coProductCredits = newCredits;
	}

	// Phase 3: Compute surplus
	const surplus: BomSurplus[] = [];
	for (const [typeId, yieldQty] of result.coProductYields) {
		const credited = coProductCredits.get(typeId) ?? 0;
		const excess = yieldQty - credited;
		if (excess > 0) {
			const unitVol = volumeMap.get(typeId);
			surplus.push({
				typeId,
				typeName: nameMap.get(typeId) ?? `Type ${typeId}`,
				quantity: excess,
				volume: unitVol !== undefined ? excess * unitVol : -1,
				source: result.coProductSources.get(typeId),
			});
		}
	}

	// Build line items with stock allocation.
	// Uses a mutable pool so shared stock is allocated once across tiers.
	// Finals are built first so direct orders get stock priority.
	const stockPool = new Map(stockMap);

	function buildLineItem(
		typeId: number,
		quantity: number,
		tier: "raw" | "intermediate" | "final",
	): BomLineItem {
		const unitVol = volumeMap.get(typeId);
		const volumeMissing = unitVol === undefined;
		const volume = volumeMissing ? -1 : quantity * unitVol;
		const remaining = stockPool.get(typeId) ?? 0;
		const allocated = Math.min(remaining, quantity);
		stockPool.set(typeId, remaining - allocated);
		const bpId =
			tier !== "raw" ? findBlueprintFor(typeId, lookup, overrides)?.blueprintID : undefined;

		return {
			typeId,
			typeName: nameMap.get(typeId) ?? `Type ${typeId}`,
			quantity,
			volume,
			volumeMissing,
			tier,
			blueprintId: bpId,
			stockQty: allocated,
			stillNeed: quantity - allocated,
		};
	}

	// Finals first (order items get stock priority)
	const finals: BomLineItem[] = [];
	for (const [typeId, qty] of result.finalTotals) {
		if (qty > 0) finals.push(buildLineItem(typeId, qty, "final"));
	}
	finals.sort((a, b) => a.typeName.localeCompare(b.typeName));

	const intermediates: BomLineItem[] = [];
	for (const [typeId, qty] of result.intermediateTotals) {
		if (qty > 0) intermediates.push(buildLineItem(typeId, qty, "intermediate"));
	}
	intermediates.sort((a, b) => a.typeName.localeCompare(b.typeName));

	const rawMaterials: BomLineItem[] = [];
	for (const [typeId, qty] of result.rawTotals) {
		if (qty > 0) rawMaterials.push(buildLineItem(typeId, qty, "raw"));
	}
	rawMaterials.sort((a, b) => a.typeName.localeCompare(b.typeName));

	// Compute volume totals
	const rawVolume = rawMaterials.reduce((s, i) => s + (i.volumeMissing ? 0 : i.volume), 0);
	const intermediateVolume = intermediates.reduce(
		(s, i) => s + (i.volumeMissing ? 0 : i.volume),
		0,
	);

	return {
		rawMaterials,
		intermediates,
		finals,
		surplus,
		totals: {
			rawVolume,
			intermediateVolume,
			totalVolume: rawVolume + intermediateVolume,
			totalTime: result.totalTime,
			iterations,
		},
	};
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sumValues(map: Map<number, number>): number {
	let total = 0;
	for (const v of map.values()) total += v;
	return total;
}
