import { ItemIcon } from "@/components/ItemIcon";
import {
	HaveCell,
	NeedCell,
	StillNeedCell,
	VolumeCell,
} from "@/components/buildqueue/InputDrillDown";
import { OutputDestControl } from "@/components/buildqueue/OutputDestControl";
import { RecipeAlternatives } from "@/components/buildqueue/RecipeAlternatives";
import { RowSourceControl } from "@/components/buildqueue/RowSourceControl";
import { type QueueBlueprintData, isRecipeSteered } from "@/components/buildqueue/shared";
import {
	RecipeDropdown,
	formatOptionLabel,
	getFacilityLabel,
} from "@/components/industry/RecipeDropdown";
import type {
	ContainerRef,
	ContainerSourceConfig,
	RecipeLockEntry,
	SourceLockEntry,
} from "@/lib/buildQueueTypes";
import type { BuildTreeBatch, BuildTreeNode } from "@/lib/buildTree";
import { buildBatchTree } from "@/lib/buildTree";
import { mergeLocks } from "@/lib/queueResolver";
import type { ContainerOption } from "@/lib/sourcingPlan";
import {
	clearBatchSourceLock,
	setBatchRecipeLock,
	setBatchSourceLock,
	setRecipeLock,
} from "@/stores/buildQueueStore";
import { ChevronDown, ChevronRight, GitFork } from "lucide-react";
import { Fragment, memo, useMemo, useState } from "react";

interface BuildTreeProps {
	batch: BuildTreeBatch;
	data: QueueBlueprintData;
	queueId: string;
	batchId?: string | null;
	queueLocks: RecipeLockEntry[];
	batchLocks?: RecipeLockEntry[];
	containers?: ContainerOption[];
	containerJumps?: Map<string, number | undefined>;
	batchSourceLocks?: SourceLockEntry[];
	phaseLabelForBatchIds?: (batchIds: string[]) => string;
}

function formatQty(value: number): string {
	return value.toLocaleString();
}

function splitSourceLabel(
	node: BuildTreeNode,
	split: NonNullable<BuildTreeNode["splits"]>[number],
	data: QueueBlueprintData,
): string {
	const bp = data.blueprints[String(split.blueprintId)];
	if (!bp) return `BP #${split.blueprintId}`;
	const defaultBpId = data.defaultRecipes.get(node.typeId);
	if (split.blueprintId === defaultBpId) return getFacilityLabel(bp, data.blueprintFacilities);
	const stockInput = bp.inputs.find(
		(input) => data.rawMaterialIds.has(input.typeID) || data.gatherableLeafIds.has(input.typeID),
	);
	return stockInput?.typeName ?? getFacilityLabel(bp, data.blueprintFacilities);
}

function SplitSummary({ node, data }: { node: BuildTreeNode; data: QueueBlueprintData }) {
	const splits = node.splits?.filter((split) => split.quantity > 0);
	if (!splits || splits.length === 0) return null;
	const defaultBpId = data.defaultRecipes.get(node.typeId);
	const pieces = splits.map((split) => {
		const stockTag = split.blueprintId !== defaultBpId ? " (your stock)" : "";
		return `${formatQty(split.quantity)} from ${splitSourceLabel(node, split, data)}${stockTag}`;
	});
	return <div className="mt-1 text-[11px] text-zinc-500">{pieces.join(", ")}</div>;
}

function writeExclusiveLock(
	queueId: string,
	batchId: string | null | undefined,
	typeId: number,
	blueprintId: number,
) {
	const entry: RecipeLockEntry = {
		typeId,
		pin: { typeId, kind: "exclusive", blueprintId },
	};
	if (batchId) setBatchRecipeLock(queueId, batchId, entry);
	else setRecipeLock(queueId, entry);
}

interface TreeRowProps {
	node: BuildTreeNode;
	depth: number;
	data: QueueBlueprintData;
	queueId: string;
	batchId?: string | null;
	queueLocks: RecipeLockEntry[];
	batchLocks?: RecipeLockEntry[];
	mergedLocks: RecipeLockEntry[];
	containers?: ContainerOption[];
	containerJumps?: Map<string, number | undefined>;
	batchSourceLocks?: SourceLockEntry[];
	phaseLabelForBatchIds?: (batchIds: string[]) => string;
	collapsedPaths: Set<string>;
	toggleCollapsed: (path: string) => void;
	detailPaths: Set<string>;
	toggleDetails: (path: string) => void;
}

const TreeRow = memo(function TreeRow({
	node,
	depth,
	data,
	queueId,
	batchId,
	queueLocks,
	batchLocks,
	mergedLocks,
	containers,
	containerJumps,
	batchSourceLocks,
	phaseLabelForBatchIds,
	collapsedPaths,
	toggleCollapsed,
	detailPaths,
	toggleDetails,
}: TreeRowProps) {
	const producers = data.outputToBlueprints.get(node.typeId) ?? [];
	const chosenBp =
		producers.find((bp) => bp.blueprintID === node.blueprintId) ??
		(node.blueprintId == null ? undefined : data.blueprints[String(node.blueprintId)]);
	const selectedBpId = node.blueprintId ?? chosenBp?.blueprintID;
	const queueEntry = queueLocks.find((lock) => lock.typeId === node.typeId);
	const batchEntry = batchLocks?.find((lock) => lock.typeId === node.typeId);
	const steered = isRecipeSteered(node.typeId, mergedLocks);
	const hasAlternatives = producers.length > 1;
	const isCollapsed = collapsedPaths.has(node.path);
	const detailsOpen = detailPaths.has(node.path);
	const canShowRecipe = node.tier !== "raw" && chosenBp != null;
	const canInlineChange = node.tier !== "final" && producers.length > 1;
	const reprocessableRaw = node.tier === "raw" && producers.length > 0;

	const sourceLock = batchSourceLocks?.find((lock) => lock.typeId === node.typeId);
	function handleSourcesChange(sources: ContainerSourceConfig | undefined) {
		if (!batchId) return;
		const next: SourceLockEntry = { ...sourceLock, typeId: node.typeId };
		if (sources) next.sources = sources;
		else next.sources = undefined;
		if (next.sources || next.outputDest) setBatchSourceLock(queueId, batchId, next);
		else clearBatchSourceLock(queueId, batchId, node.typeId);
	}
	function handleOutputChange(outputDest: ContainerRef | undefined) {
		if (!batchId) return;
		const next: SourceLockEntry = { ...sourceLock, typeId: node.typeId, outputDest };
		if (next.sources || next.outputDest) setBatchSourceLock(queueId, batchId, next);
		else clearBatchSourceLock(queueId, batchId, node.typeId);
	}

	const phaseLabel =
		node.sourceBatchIds && node.sourceBatchIds.length > 0
			? phaseLabelForBatchIds?.(node.sourceBatchIds)
			: undefined;

	return (
		<Fragment>
			<tr className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
				<td className="py-2 pr-4 text-zinc-200" style={{ paddingLeft: 16 + depth * 18 }}>
					<span className="flex min-w-0 items-center gap-2">
						{node.children.length > 0 ? (
							<button
								type="button"
								onClick={() => toggleCollapsed(node.path)}
								className="shrink-0 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
								title={isCollapsed ? "Expand build path" : "Collapse build path"}
							>
								{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
							</button>
						) : (
							<span className="w-[17px] shrink-0" />
						)}
						<ItemIcon typeId={node.typeId} />
						<span className="min-w-0 truncate">{node.typeName}</span>
						{node.tier === "final" && (
							<span className="shrink-0 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
								Target
							</span>
						)}
						{node.tier === "intermediate" && (
							<span className="shrink-0 rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
								Derived
							</span>
						)}
						{node.stockShownElsewhere && (
							<span
								className="shrink-0 rounded border border-zinc-700 px-1 py-0.5 text-[10px] text-zinc-500"
								title="This type is also used elsewhere; stock and remaining need are allocated once in tree order."
							>
								shared
							</span>
						)}
						{phaseLabel && (
							<span className="shrink-0 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
								from {phaseLabel}
							</span>
						)}
					</span>
				</td>
				<td className="px-4 py-2">
					<div className="flex flex-wrap items-center gap-2">
						{node.tier === "raw" ? (
							<span
								className="truncate text-xs text-zinc-500"
								title={`Source: ${node.sourceGroup ?? "Other"}`}
							>
								Source: {node.sourceGroup ?? "Other"}
							</span>
						) : canInlineChange ? (
							<RecipeDropdown
								typeId={node.typeId}
								producers={producers}
								currentBpId={selectedBpId}
								isOverridden={steered}
								onSelect={(blueprintId) =>
									writeExclusiveLock(queueId, batchId, node.typeId, blueprintId)
								}
								formatOptionLabel={(bp, typeId) =>
									formatOptionLabel(bp, typeId, data.blueprintFacilities)
								}
								getFacilityLabel={(bp) => getFacilityLabel(bp, data.blueprintFacilities)}
								onSplitRequest={() => toggleDetails(node.path)}
							/>
						) : canShowRecipe && chosenBp ? (
							<span
								className="shrink-0 truncate rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-500"
								title={`Recipe: ${formatOptionLabel(chosenBp, node.typeId, data.blueprintFacilities)}`}
							>
								{getFacilityLabel(chosenBp, data.blueprintFacilities)}
							</span>
						) : (
							<span className="text-xs text-zinc-600">--</span>
						)}

						{hasAlternatives && node.tier !== "final" && (
							<button
								type="button"
								onClick={() => toggleDetails(node.path)}
								className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
									steered
										? "border-cyan-600/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
										: "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-amber-500/50 hover:text-amber-300"
								}`}
								title={
									steered
										? "Recipe is overridden; click to review or change"
										: "Showing the default recipe; click to change"
								}
								aria-expanded={detailsOpen}
							>
								<GitFork size={10} />
								{steered ? "changed" : "default"}
							</button>
						)}

						{reprocessableRaw && (
							<button
								type="button"
								onClick={() =>
									writeExclusiveLock(queueId, batchId, node.typeId, producers[0].blueprintID)
								}
								className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-violet-500/50 hover:text-violet-300"
								title="Pin this raw leaf to its first reprocessing recipe instead of direct gathering"
							>
								also obtainable by reprocessing
							</button>
						)}

						{node.tier === "intermediate" && batchId && containers && containers.length > 0 && (
							<>
								<RowSourceControl
									containers={containers}
									config={sourceLock?.sources}
									onChange={handleSourcesChange}
									scopeLabel="this item"
									jumps={containerJumps}
									note="Container priority for this item steers which storage it is pulled from when it is sourced from stock. It does not change the optimizer's build-vs-buy math."
								/>
								<OutputDestControl
									containers={containers}
									value={sourceLock?.outputDest}
									onChange={handleOutputChange}
									scopeLabel="this item"
								/>
							</>
						)}
					</div>
					<SplitSummary node={node} data={data} />
				</td>
				<NeedCell value={node.needPerEdge} />
				<HaveCell value={node.have} />
				<StillNeedCell value={node.still} />
				<VolumeCell item={node} />
			</tr>

			{detailsOpen && producers.length > 0 && node.tier !== "final" && (
				<tr className="border-t border-zinc-800/30">
					<td colSpan={6} className="px-4 py-2">
						<RecipeAlternatives
							queueId={queueId}
							batchId={batchId ?? undefined}
							typeId={node.typeId}
							producers={producers}
							chosenBpId={selectedBpId}
							queueEntry={queueEntry}
							batchEntry={batchEntry}
							demandQuantity={node.needPerEdge}
							currentSplits={node.splits}
							blueprintFacilities={data.blueprintFacilities}
						/>
					</td>
				</tr>
			)}

			{!isCollapsed &&
				node.children.map((child) => (
					<TreeRow
						key={child.path}
						node={child}
						depth={depth + 1}
						data={data}
						queueId={queueId}
						batchId={batchId}
						queueLocks={queueLocks}
						batchLocks={batchLocks}
						mergedLocks={mergedLocks}
						containers={containers}
						containerJumps={containerJumps}
						batchSourceLocks={batchSourceLocks}
						phaseLabelForBatchIds={phaseLabelForBatchIds}
						collapsedPaths={collapsedPaths}
						toggleCollapsed={toggleCollapsed}
						detailPaths={detailPaths}
						toggleDetails={toggleDetails}
					/>
				))}
		</Fragment>
	);
});

export function BuildTree({
	batch,
	data,
	queueId,
	batchId,
	queueLocks,
	batchLocks,
	containers,
	containerJumps,
	batchSourceLocks,
	phaseLabelForBatchIds,
}: BuildTreeProps) {
	const nodes = useMemo(() => buildBatchTree(batch, data), [batch, data]);
	const mergedLocks = useMemo(() => mergeLocks(queueLocks, batchLocks), [queueLocks, batchLocks]);
	const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
	const [detailPaths, setDetailPaths] = useState<Set<string>>(() => new Set());

	function toggleCollapsed(path: string) {
		setCollapsedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}

	function toggleDetails(path: string) {
		setDetailPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}

	if (nodes.length === 0) {
		return <div className="px-4 py-3 text-xs text-zinc-600">None</div>;
	}

	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<th className="px-4 py-2 text-left">Item</th>
					<th className="px-4 py-2 text-left">Source / Recipe</th>
					<th className="px-4 py-2 text-right">Need</th>
					<th className="px-4 py-2 text-right">Have</th>
					<th className="px-4 py-2 text-right">Still Need</th>
					<th className="px-4 py-2 text-right">Volume (m³)</th>
				</tr>
			</thead>
			<tbody>
				{nodes.map((node) => (
					<TreeRow
						key={node.path}
						node={node}
						depth={0}
						data={data}
						queueId={queueId}
						batchId={batchId}
						queueLocks={queueLocks}
						batchLocks={batchLocks}
						mergedLocks={mergedLocks}
						containers={containers}
						containerJumps={containerJumps}
						batchSourceLocks={batchSourceLocks}
						phaseLabelForBatchIds={phaseLabelForBatchIds}
						collapsedPaths={collapsedPaths}
						toggleCollapsed={toggleCollapsed}
						detailPaths={detailPaths}
						toggleDetails={toggleDetails}
					/>
				))}
			</tbody>
		</table>
	);
}
