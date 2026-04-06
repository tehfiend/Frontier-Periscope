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
	// Check overrides first
	const overrideBpId = overrides.get(typeId);
	if (overrideBpId !== undefined) {
		const bp = lookup.blueprints[String(overrideBpId)];
		if (bp) return bp;
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

// ── Phase 1: Expand demand ──────────────────────────────────────────────────

function expandDemand(
	demands: QueueItem[],
	coProductCredits: Map<number, number>,
	lookup: BlueprintLookup,
	overrides: Map<number, number>,
): ExpandResult {
	const rawTotals = new Map<number, number>();
	const intermediateTotals = new Map<number, number>();
	const finalTotals = new Map<number, number>();
	const coProductYields = new Map<number, number>();
	let totalTime = 0;

	const queue: QueueItem[] = [...demands];

	while (queue.length > 0) {
		const item = queue.pop() as QueueItem;
		const blueprint = findBlueprintFor(item.typeId, lookup, overrides);

		if (blueprint === null) {
			// Raw material -- no blueprint can produce it
			rawTotals.set(item.typeId, (rawTotals.get(item.typeId) ?? 0) + item.quantity);
			continue;
		}

		// Apply co-product credits to reduce demand
		const credit = coProductCredits.get(item.typeId) ?? 0;
		const effectiveQty = Math.max(0, item.quantity - credit);
		if (effectiveQty === 0) continue;

		const outputEntry = blueprint.outputs.find((o) => o.typeID === item.typeId);
		const outputPerRun = outputEntry?.quantity ?? 1;
		const runs = Math.ceil(effectiveQty / outputPerRun);
		totalTime += blueprint.runTime * runs;

		if (item.isOrderItem) {
			finalTotals.set(item.typeId, (finalTotals.get(item.typeId) ?? 0) + item.quantity);
		} else {
			intermediateTotals.set(
				item.typeId,
				(intermediateTotals.get(item.typeId) ?? 0) + item.quantity,
			);
		}

		// Track co-product yields (outputs other than the target)
		for (const output of blueprint.outputs) {
			if (output.typeID !== item.typeId) {
				coProductYields.set(
					output.typeID,
					(coProductYields.get(output.typeID) ?? 0) + output.quantity * runs,
				);
			}
		}

		// Queue up input requirements
		for (const input of blueprint.inputs) {
			queue.push({
				typeId: input.typeID,
				quantity: input.quantity * runs,
				isOrderItem: false,
			});
		}
	}

	return { rawTotals, intermediateTotals, finalTotals, coProductYields, totalTime };
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

	const nameMap = buildNameMap(lookup.blueprints);

	const demands: QueueItem[] = orderItems.map((i) => ({
		typeId: i.typeId,
		quantity: i.quantity,
		isOrderItem: true,
	}));

	// Phase 2: Iterative co-product convergence
	let coProductCredits = new Map<number, number>();
	let prevTotalRaw = Number.POSITIVE_INFINITY;
	const maxIterations = 10;
	let result: ExpandResult = expandDemand(demands, coProductCredits, lookup, overrides);
	let iterations = 1;

	for (let iter = 1; iter <= maxIterations; iter++) {
		result = expandDemand(demands, coProductCredits, lookup, overrides);
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
			});
		}
	}

	// Build line items with stock application
	function buildLineItem(
		typeId: number,
		quantity: number,
		tier: "raw" | "intermediate" | "final",
	): BomLineItem {
		const unitVol = volumeMap.get(typeId);
		const volumeMissing = unitVol === undefined;
		const volume = volumeMissing ? -1 : quantity * unitVol;
		const stockQty = stockMap.get(typeId) ?? 0;
		const stillNeed = Math.max(0, quantity - stockQty);
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
			stockQty,
			stillNeed,
		};
	}

	const rawMaterials: BomLineItem[] = [];
	for (const [typeId, qty] of result.rawTotals) {
		if (qty > 0) rawMaterials.push(buildLineItem(typeId, qty, "raw"));
	}
	rawMaterials.sort((a, b) => a.typeName.localeCompare(b.typeName));

	const intermediates: BomLineItem[] = [];
	for (const [typeId, qty] of result.intermediateTotals) {
		if (qty > 0) intermediates.push(buildLineItem(typeId, qty, "intermediate"));
	}
	intermediates.sort((a, b) => a.typeName.localeCompare(b.typeName));

	const finals: BomLineItem[] = [];
	for (const [typeId, qty] of result.finalTotals) {
		if (qty > 0) finals.push(buildLineItem(typeId, qty, "final"));
	}
	finals.sort((a, b) => a.typeName.localeCompare(b.typeName));

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
