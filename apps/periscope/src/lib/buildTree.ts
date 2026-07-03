import type { Blueprint, BomLineItem, ProductionSplit } from "@/lib/bomTypes";
import type { FromUpstreamItem, JobResult, OrderBuildItem, OrderResult } from "@/lib/queueResolver";

export interface BuildTreeData {
	blueprints: Record<string, Blueprint>;
	outputToBlueprints: Map<number, Blueprint[]>;
	defaultRecipes: Map<number, number>;
	rawMaterialIds: Set<number>;
	gatherableLeafIds: Set<number>;
	volumeMap: Map<number, number>;
	typeGroups: Map<number, string>;
}

export interface BuildTreeOrder {
	jobs: JobResult[];
	gather: BomLineItem[];
	build: OrderBuildItem[];
	fromUpstream?: FromUpstreamItem[];
}

export interface BuildTreeNode {
	jobId?: string;
	typeId: number;
	typeName: string;
	tier: "final" | "intermediate" | "raw";
	blueprintId?: number;
	splits?: ProductionSplit[];
	alternativeBlueprintIds: number[];
	excludedFacilities?: string[];
	needPerEdge: number;
	have: number;
	still: number;
	/**
	 * Units of this type this order produces on this edge = `needPerEdge - have` (demand net of
	 * stock). 0 for raw leaves (gathered) and for from-upstream items (fully stock-covered); the
	 * batch quantity for a Target root; the shortfall for a derived intermediate. SHARED
	 * intermediates carry the order total in `orderTotals` instead. Plan 44 Decision 12.
	 */
	built?: number;
	/**
	 * Per-order 1-based build-sequence index (dependency order, deepest first) over build jobs --
	 * derived intermediates AND Targets -- deduped by typeId to the canonical occurrence.
	 * Undefined on raw rows and on items not built this order. Plan 44 Decision 3.
	 */
	productionIndex?: number;
	/**
	 * Set on duplicate occurrences of a shared build intermediate: the canonical occurrence's
	 * productionIndex, so the row can render as a "shared -- see #N" reference (Decision 14).
	 */
	sharedProductionIndex?: number;
	/**
	 * Order-total quantities for the canonical occurrence of a SHARED build intermediate -- the
	 * node's own need/have/still only cover this edge's slice (Decision 14).
	 */
	orderTotals?: {
		required: number;
		have: number;
		built: number;
		need: number;
		volume: number;
		volumeMissing: boolean;
	};
	volume: number;
	volumeMissing: boolean;
	isGatherableLeaf: boolean;
	siteSourceTypeId?: number;
	sourceGroup?: string;
	sourceOrderIds?: string[];
	stockShownElsewhere: boolean;
	children: BuildTreeNode[];
	path: string;
}

interface FlatLine {
	typeId: number;
	typeName: string;
	quantity: number;
	stockQty: number;
	stillNeed: number;
	volume: number;
	volumeMissing: boolean;
	tier: "raw" | "intermediate" | "final";
	blueprintId?: number;
	splits?: ProductionSplit[];
	sourceOrderIds?: string[];
}

interface AllocationState {
	haveRemaining: number;
	stillRemaining: number;
	totalHave: number;
	totalStill: number;
	seen: number;
	sourceOrderIds?: string[];
}

const MAX_TREE_DEPTH = 48;

function outputQuantity(bp: Blueprint, typeId: number): number {
	return bp.outputs.find((out) => out.typeID === typeId)?.quantity ?? 1;
}

function jobOutputQuantity(job: JobResult): number {
	return (
		job.outputs.find((out) => out.typeId === job.blueprint.primaryTypeID)?.quantity ?? job.runs
	);
}

function volumeFor(typeId: number, quantity: number, data: BuildTreeData) {
	const unit = data.volumeMap.get(typeId);
	return {
		volume: unit == null ? -1 : unit * quantity,
		volumeMissing: unit == null,
	};
}

function nameForType(typeId: number, fallback: string | undefined, data: BuildTreeData): string {
	if (fallback) return fallback;
	for (const bp of Object.values(data.blueprints)) {
		for (const input of bp.inputs) if (input.typeID === typeId) return input.typeName;
		for (const output of bp.outputs) if (output.typeID === typeId) return output.typeName;
	}
	return `Type ${typeId}`;
}

function makeFromUpstreamLine(item: FromUpstreamItem): FlatLine {
	return {
		typeId: item.typeId,
		typeName: item.typeName,
		quantity: item.quantity,
		stockQty: item.quantity,
		stillNeed: 0,
		volume: item.volume,
		volumeMissing: item.volume < 0,
		tier: "intermediate",
		sourceOrderIds: item.sourceOrderIds,
	};
}

function flatLineMaps(order: BuildTreeOrder) {
	const lines = new Map<number, FlatLine>();
	const reconcileLines = new Map<number, FlatLine>();

	for (const item of order.gather) {
		lines.set(item.typeId, item);
		reconcileLines.set(item.typeId, item);
	}
	for (const item of order.build) {
		lines.set(item.typeId, item);
		reconcileLines.set(item.typeId, item);
	}
	for (const item of order.fromUpstream ?? []) {
		const line = makeFromUpstreamLine(item);
		lines.set(item.typeId, line);
	}

	return { lines, reconcileLines };
}

function sortedSplits(splits: ProductionSplit[] | undefined): ProductionSplit[] | undefined {
	if (!splits || splits.length === 0) return undefined;
	return [...splits].sort((a, b) => {
		if (b.quantity !== a.quantity) return b.quantity - a.quantity;
		return a.blueprintId - b.blueprintId;
	});
}

function getSelectedBlueprint(
	typeId: number,
	data: BuildTreeData,
	line: FlatLine | undefined,
	rootBlueprint: Blueprint | undefined,
): Blueprint | undefined {
	if (rootBlueprint) return rootBlueprint;
	const bpId = line?.blueprintId ?? data.defaultRecipes.get(typeId);
	if (bpId != null) {
		const bp = data.blueprints[String(bpId)];
		if (bp?.outputs.some((out) => out.typeID === typeId)) return bp;
	}
	return data.outputToBlueprints.get(typeId)?.[0];
}

function allocateForType(
	typeId: number,
	need: number,
	states: Map<number, AllocationState>,
): {
	have: number;
	still: number;
	stockShownElsewhere: boolean;
	sourceOrderIds?: string[];
} {
	const state = states.get(typeId);
	if (!state) return { have: 0, still: 0, stockShownElsewhere: false };

	const stockShownElsewhere = state.seen > 0 && (state.totalHave > 0 || state.totalStill > 0);
	const have = Math.min(state.haveRemaining, need);
	state.haveRemaining -= have;

	const uncovered = Math.max(0, need - have);
	const still = Math.min(state.stillRemaining, uncovered);
	state.stillRemaining -= still;
	state.seen += 1;

	return {
		have,
		still,
		stockShownElsewhere,
		sourceOrderIds: have > 0 ? state.sourceOrderIds : undefined,
	};
}

function isRawLike(typeId: number, data: BuildTreeData): boolean {
	return (
		data.rawMaterialIds.has(typeId) ||
		data.gatherableLeafIds.has(typeId) ||
		!data.outputToBlueprints.has(typeId)
	);
}

function buildAllocationStates(lines: Map<number, FlatLine>): Map<number, AllocationState> {
	const states = new Map<number, AllocationState>();
	for (const line of lines.values()) {
		states.set(line.typeId, {
			haveRemaining: line.stockQty,
			stillRemaining: line.stillNeed,
			totalHave: line.stockQty,
			totalStill: line.stillNeed,
			seen: 0,
			sourceOrderIds: line.sourceOrderIds,
		});
	}
	return states;
}

function assertReconciled(roots: BuildTreeNode[], reconcileLines: Map<number, FlatLine>) {
	if (!import.meta.env.DEV) return;

	const actual = new Map<number, number>();
	const visit = (node: BuildTreeNode) => {
		if (reconcileLines.has(node.typeId)) {
			actual.set(node.typeId, (actual.get(node.typeId) ?? 0) + node.still);
		}
		for (const child of node.children) visit(child);
	};
	for (const root of roots) visit(root);

	const errors: string[] = [];
	for (const line of reconcileLines.values()) {
		const got = actual.get(line.typeId) ?? 0;
		if (Math.abs(got - line.stillNeed) > 1e-6) {
			errors.push(
				`${line.typeName} (${line.typeId}): tree still ${got}, flat still ${line.stillNeed}`,
			);
		}
	}
	if (errors.length > 0) {
		// A best-effort dev sanity check, not a runtime guarantee -- the tree is a local, path-based
		// reconstruction of what the LP solved globally, and known gaps remain (e.g. cross-order /
		// split recipe edges). Warn loudly instead of throwing so a display-accounting mismatch never
		// crashes the Build Queue UI; the flat BOM tables remain the source of truth regardless.
		console.error(`Build tree reconciliation mismatch:\n${errors.join("\n")}`);
	}
}

/**
 * Assign per-order Production #s (Plan 44 Decisions 3 + 14): a post-order walk (children before
 * parents, roots in order) numbers every build job 1..m in the order it must be built -- so the
 * deepest dependency gets #1 and the Targets get the last numbers. Build jobs are Targets
 * (tier "final") and derived intermediates present in the order's build list; raws and
 * upstream-covered types stay unnumbered. A typeId is numbered ONCE at its first (canonical)
 * occurrence -- the tree duplicates a shared subtree under every consumer, and construction order
 * matches walk order, so first-seen here is the `stockShownElsewhere === false` occurrence.
 * Duplicates get `sharedProductionIndex` (reference rows); when a shared build item occurs more
 * than once, the canonical node also gets `orderTotals` (its per-edge numbers only cover one
 * consumer's slice).
 */
function assignProductionIndices(
	roots: BuildTreeNode[],
	buildByType: Map<number, OrderBuildItem>,
	data: BuildTreeData,
) {
	const occurrences = new Map<number, number>();
	const count = (node: BuildTreeNode) => {
		if (node.tier !== "raw" && buildByType.has(node.typeId)) {
			occurrences.set(node.typeId, (occurrences.get(node.typeId) ?? 0) + 1);
		}
		for (const child of node.children) count(child);
	};
	for (const root of roots) count(root);

	let next = 1;
	const assigned = new Map<number, number>();
	const visit = (node: BuildTreeNode) => {
		for (const child of node.children) visit(child);
		const isBuildJob =
			node.tier === "final" || (node.tier === "intermediate" && buildByType.has(node.typeId));
		if (!isBuildJob) return;

		const existing = assigned.get(node.typeId);
		if (existing != null) {
			// Same-type Targets share the type-level number; shared derived duplicates become
			// "see #N" reference rows.
			if (node.tier === "final") node.productionIndex = existing;
			else node.sharedProductionIndex = existing;
			return;
		}
		node.productionIndex = next;
		assigned.set(node.typeId, next);
		next += 1;

		const buildItem = buildByType.get(node.typeId);
		if (node.tier === "intermediate" && buildItem && (occurrences.get(node.typeId) ?? 0) > 1) {
			const { volume, volumeMissing } = volumeFor(node.typeId, buildItem.quantity, data);
			node.orderTotals = {
				required: buildItem.quantity,
				have: buildItem.stockQty,
				built: buildItem.stillNeed,
				need: buildItem.stillNeed,
				volume,
				volumeMissing,
			};
		}
	};
	for (const root of roots) visit(root);
}

export function buildOrderTree(order: OrderResult, data: BuildTreeData): BuildTreeNode[];
export function buildOrderTree(order: BuildTreeOrder, data: BuildTreeData): BuildTreeNode[];
export function buildOrderTree(order: BuildTreeOrder, data: BuildTreeData): BuildTreeNode[] {
	const buildByType = new Map<number, OrderBuildItem>();
	for (const item of order.build) buildByType.set(item.typeId, item);

	const { lines, reconcileLines } = flatLineMaps(order);
	const allocationStates = buildAllocationStates(lines);
	const emittedBuildTypes = new Set<number>();

	function makeNode(
		typeId: number,
		typeName: string | undefined,
		needPerEdge: number,
		path: string,
		ancestorTypes: Set<number>,
		rootBlueprint?: Blueprint,
		rootJobId?: string,
		rootExcludedFacilities?: string[],
	): BuildTreeNode {
		const line = lines.get(typeId);
		const buildItem = buildByType.get(typeId);
		if (buildItem) emittedBuildTypes.add(typeId);

		const rawLike = isRawLike(typeId, data);
		// A Job's own target can itself be a raw/gatherable material (e.g. a byproduct-masked ore
		// forced raw by Plan 42) -- treat it like any other raw leaf so its have/still is allocated
		// and counted in the reconciliation, rather than silently dropping its demand to zero.
		const tier: BuildTreeNode["tier"] = rawLike ? "raw" : rootBlueprint ? "final" : "intermediate";
		const isGatherableLeaf = rawLike;
		const selectedBlueprint = rawLike
			? undefined
			: getSelectedBlueprint(typeId, data, line ?? buildItem, rootBlueprint);
		const splits = sortedSplits(line?.splits ?? buildItem?.splits);
		const producers = data.outputToBlueprints.get(typeId) ?? [];
		const allocation =
			rootBlueprint && !rawLike
				? { have: 0, still: 0, stockShownElsewhere: false, sourceOrderIds: undefined }
				: allocateForType(typeId, needPerEdge, allocationStates);
		const { volume, volumeMissing } = volumeFor(typeId, needPerEdge, data);
		const nodeName = nameForType(typeId, typeName ?? line?.typeName ?? buildItem?.typeName, data);
		const sourceGroup = data.typeGroups.get(typeId);

		// Only the shortfall we actually BUILD on this edge consumes sub-materials -- stock-covered
		// units (allocation.have) do not. Expanding children from gross needPerEdge double-counts the
		// sub-tree for stock we already hold (e.g. 10 Printed Circuits in the scratch pad should pull
		// none of their inputs). Targets force have=0, so they still build their full authored output.
		const buildQty = rawLike ? 0 : Math.max(0, needPerEdge - allocation.have);

		let children: BuildTreeNode[] = [];
		// A producible child can need recursion even when its type isn't in `order.build` -- e.g. an
		// intermediate that's ALSO an authored Job's own primary output gets merged out of
		// `order.build` (see bomToDisplayLists' provenance merge), but still needs its own recipe
		// expanded when a DIFFERENT job/recipe consumes it as an ingredient here. Any non-raw child
		// reached via a real recursive call already carries genuine demand from its parent, so gating
		// on `buildItem`/`rootBlueprint` presence is unnecessary and was silently truncating that
		// subtree (dropping nested demand, e.g. for a byproduct-masked raw leaf several levels down).
		const canRecurse =
			!rawLike &&
			buildQty > 0 &&
			selectedBlueprint != null &&
			!ancestorTypes.has(typeId) &&
			ancestorTypes.size < MAX_TREE_DEPTH;

		if (canRecurse) {
			const nextAncestors = new Set(ancestorTypes);
			nextAncestors.add(typeId);

			const splitChildren =
				splits && splits.length > 1
					? splits.flatMap((split) => {
							const bp = data.blueprints[String(split.blueprintId)];
							if (!bp) return [];
							return bp.inputs.map((input, index) =>
								makeNode(
									input.typeID,
									input.typeName,
									input.quantity * split.runs,
									`${path}/split-${split.blueprintId}:${index}:${input.typeID}`,
									nextAncestors,
								),
							);
						})
					: undefined;

			if (splitChildren) {
				children = splitChildren;
			} else {
				const runs = Math.ceil(buildQty / outputQuantity(selectedBlueprint, typeId));
				children = selectedBlueprint.inputs.map((input, index) =>
					makeNode(
						input.typeID,
						input.typeName,
						input.quantity * runs,
						`${path}/${selectedBlueprint.blueprintID}:${index}:${input.typeID}`,
						nextAncestors,
					),
				);
			}
		}

		return {
			jobId: rootJobId,
			typeId,
			typeName: nodeName,
			tier,
			blueprintId: rootBlueprint?.blueprintID ?? line?.blueprintId ?? buildItem?.blueprintId,
			splits,
			alternativeBlueprintIds: producers.map((bp) => bp.blueprintID),
			excludedFacilities: rootExcludedFacilities ?? buildItem?.excludedFacilities,
			needPerEdge,
			have: allocation.have,
			still: allocation.still,
			// Built = how many this order produces on this edge = demand minus stock. Raws are gathered
			// (0); everything producible builds the shortfall (needPerEdge - have) -- a Target builds its
			// full authored output (have is 0), a from-upstream item builds 0 (fully covered by stock).
			// Derived rows read straight from this; SHARED intermediates override it with the order total
			// below. Deriving from the tree (not the build map) keeps producible intermediates that never
			// landed in order.build -- e.g. a single Printed Circuit under a Target -- from showing "--".
			built: buildQty,
			volume,
			volumeMissing,
			isGatherableLeaf,
			siteSourceTypeId: tier === "raw" ? typeId : undefined,
			sourceGroup,
			sourceOrderIds: allocation.sourceOrderIds,
			stockShownElsewhere: allocation.stockShownElsewhere,
			children,
			path,
		};
	}

	const roots: BuildTreeNode[] = order.jobs.map((job) =>
		makeNode(
			job.blueprint.primaryTypeID,
			job.blueprint.primaryTypeName,
			jobOutputQuantity(job),
			`job:${job.jobId}:${job.blueprint.primaryTypeID}`,
			new Set(),
			job.blueprint,
			job.jobId,
			job.excludedFacilities,
		),
	);

	for (const item of order.build) {
		if (emittedBuildTypes.has(item.typeId)) continue;
		roots.push(
			makeNode(item.typeId, item.typeName, item.quantity, `derived:${item.typeId}`, new Set()),
		);
	}

	assignProductionIndices(roots, buildByType, data);
	assertReconciled(roots, reconcileLines);
	return roots;
}
