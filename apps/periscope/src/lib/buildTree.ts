import type { Blueprint, BomLineItem, ProductionSplit } from "@/lib/bomTypes";
import type { BatchBuildItem, BatchResult, FromUpstreamItem, JobResult } from "@/lib/queueResolver";

export interface BuildTreeData {
	blueprints: Record<string, Blueprint>;
	outputToBlueprints: Map<number, Blueprint[]>;
	defaultRecipes: Map<number, number>;
	rawMaterialIds: Set<number>;
	gatherableLeafIds: Set<number>;
	volumeMap: Map<number, number>;
	typeGroups: Map<number, string>;
}

export interface BuildTreeBatch {
	jobs: JobResult[];
	gather: BomLineItem[];
	build: BatchBuildItem[];
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
	volume: number;
	volumeMissing: boolean;
	isGatherableLeaf: boolean;
	siteSourceTypeId?: number;
	sourceGroup?: string;
	sourceBatchIds?: string[];
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
	sourceBatchIds?: string[];
}

interface AllocationState {
	haveRemaining: number;
	stillRemaining: number;
	totalHave: number;
	totalStill: number;
	seen: number;
	sourceBatchIds?: string[];
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
		sourceBatchIds: item.sourceBatchIds,
	};
}

function flatLineMaps(batch: BuildTreeBatch) {
	const lines = new Map<number, FlatLine>();
	const reconcileLines = new Map<number, FlatLine>();

	for (const item of batch.gather) {
		lines.set(item.typeId, item);
		reconcileLines.set(item.typeId, item);
	}
	for (const item of batch.build) {
		lines.set(item.typeId, item);
		reconcileLines.set(item.typeId, item);
	}
	for (const item of batch.fromUpstream ?? []) {
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
	sourceBatchIds?: string[];
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
		sourceBatchIds: have > 0 ? state.sourceBatchIds : undefined,
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
			sourceBatchIds: line.sourceBatchIds,
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
		// reconstruction of what the LP solved globally, and known gaps remain (e.g. cross-batch /
		// split recipe edges). Warn loudly instead of throwing so a display-accounting mismatch never
		// crashes the Build Queue UI; the flat BOM tables remain the source of truth regardless.
		console.error(`Build tree reconciliation mismatch:\n${errors.join("\n")}`);
	}
}

export function buildBatchTree(batch: BatchResult, data: BuildTreeData): BuildTreeNode[];
export function buildBatchTree(batch: BuildTreeBatch, data: BuildTreeData): BuildTreeNode[];
export function buildBatchTree(batch: BuildTreeBatch, data: BuildTreeData): BuildTreeNode[] {
	const buildByType = new Map<number, BatchBuildItem>();
	for (const item of batch.build) buildByType.set(item.typeId, item);

	const { lines, reconcileLines } = flatLineMaps(batch);
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
				? { have: 0, still: 0, stockShownElsewhere: false, sourceBatchIds: undefined }
				: allocateForType(typeId, needPerEdge, allocationStates);
		const { volume, volumeMissing } = volumeFor(typeId, needPerEdge, data);
		const nodeName = nameForType(typeId, typeName ?? line?.typeName ?? buildItem?.typeName, data);
		const sourceGroup = data.typeGroups.get(typeId);

		let children: BuildTreeNode[] = [];
		// A producible child can need recursion even when its type isn't in `batch.build` -- e.g. an
		// intermediate that's ALSO an authored Job's own primary output gets merged out of
		// `batch.build` (see bomToDisplayLists' provenance merge), but still needs its own recipe
		// expanded when a DIFFERENT job/recipe consumes it as an ingredient here. Any non-raw child
		// reached via a real recursive call already carries genuine demand from its parent, so gating
		// on `buildItem`/`rootBlueprint` presence is unnecessary and was silently truncating that
		// subtree (dropping nested demand, e.g. for a byproduct-masked raw leaf several levels down).
		const canRecurse =
			!rawLike &&
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
				const runs = Math.ceil(needPerEdge / outputQuantity(selectedBlueprint, typeId));
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
			volume,
			volumeMissing,
			isGatherableLeaf,
			siteSourceTypeId: tier === "raw" ? typeId : undefined,
			sourceGroup,
			sourceBatchIds: allocation.sourceBatchIds,
			stockShownElsewhere: allocation.stockShownElsewhere,
			children,
			path,
		};
	}

	const roots: BuildTreeNode[] = batch.jobs.map((job) =>
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

	for (const item of batch.build) {
		if (emittedBuildTypes.has(item.typeId)) continue;
		roots.push(
			makeNode(item.typeId, item.typeName, item.quantity, `derived:${item.typeId}`, new Set()),
		);
	}

	assertReconciled(roots, reconcileLines);
	return roots;
}
