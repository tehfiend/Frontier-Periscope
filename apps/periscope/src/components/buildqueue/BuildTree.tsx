import { ItemIcon } from "@/components/ItemIcon";
import { FacilityAvailabilityBadge } from "@/components/buildqueue/FacilityPreferencePanel";
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
	facilityRecipeLabel,
	formatOptionLabel,
	getFacilityLabel,
	resolveEffectiveFacility,
} from "@/components/industry/RecipeDropdown";
import type {
	Batch,
	BuildQueue,
	ContainerRef,
	ContainerSourceConfig,
	JobOverrides,
	RecipeLockEntry,
	SourceLockEntry,
} from "@/lib/buildQueueTypes";
import type { BuildTreeBatch, BuildTreeNode } from "@/lib/buildTree";
import { buildBatchTree } from "@/lib/buildTree";
import type { LandscapeData, LandscapeMaterialSource } from "@/lib/landscapeData";
import { useLandscapeData } from "@/lib/landscapeData";
import { nearestSourceSites } from "@/lib/proximity";
import { mergeLocks } from "@/lib/queueResolver";
import type { ContainerOption } from "@/lib/sourcingPlan";
import {
	clearBatchSourceLock,
	setBatchRecipeLock,
	setBatchSourceLock,
	setJobBlueprint,
	setJobOverrides,
	setRecipeLock,
} from "@/stores/buildQueueStore";
import { ChevronDown, ChevronRight, GitFork } from "lucide-react";
import { Fragment, memo, useMemo, useState } from "react";

interface BuildTreeProps {
	batch: BuildTreeBatch;
	data: QueueBlueprintData;
	queueId: string;
	batchId?: string | null;
	queue?: BuildQueue;
	rawBatch?: Batch;
	queueLocks: RecipeLockEntry[];
	batchLocks?: RecipeLockEntry[];
	containers?: ContainerOption[];
	containerJumps?: Map<string, number | undefined>;
	batchSourceLocks?: SourceLockEntry[];
	phaseLabelForBatchIds?: (batchIds: string[]) => string;
	sourceSystemId?: number | null;
	systemNames?: Map<number, string>;
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

function formatJumpLabel(jumps: number | undefined): string {
	if (jumps == null) return "unreachable";
	return `${jumps} jump${jumps === 1 ? "" : "s"}`;
}

function systemLabel(systemId: number, systemNames?: Map<number, string>): string {
	return systemNames?.get(systemId) ?? `#${systemId}`;
}

function RawSourceDetail({
	node,
	sourceSystemId,
	systemNames,
	landscapeData,
}: {
	node: BuildTreeNode;
	sourceSystemId?: number | null;
	systemNames?: Map<number, string>;
	landscapeData: LandscapeData | null;
}) {
	const sourceTypeId = node.siteSourceTypeId ?? node.typeId;
	const source: LandscapeMaterialSource | undefined = landscapeData?.materials.get(sourceTypeId);
	const nearest = useMemo(
		() =>
			sourceSystemId != null && source
				? nearestSourceSites(sourceSystemId, [source.typeId])[0]
				: undefined,
		[sourceSystemId, source],
	);

	if (!source) {
		return <span className="text-[11px] text-zinc-600">source unknown</span>;
	}

	if (source.tier === "tier3") {
		return <span className="text-[11px] text-zinc-600">source unknown</span>;
	}

	if (source.tier === "tier2") {
		const target = nearest
			? `${systemLabel(nearest.systemId, systemNames)} · ${formatJumpLabel(nearest.jumps)}`
			: sourceSystemId == null
				? "set build location for nearest sites"
				: "no reachable source system";
		return (
			<span className="text-[11px] text-amber-300/70" title={source.caveat ?? source.label}>
				{source.label}: {target}
			</span>
		);
	}

	const target = nearest
		? `${systemLabel(nearest.systemId, systemNames)} · ${formatJumpLabel(nearest.jumps)}`
		: sourceSystemId == null
			? "set build location for nearest sites"
			: "no reachable source system";
	const ecosystems = nearest?.ecosystems
		.slice(0, 2)
		.map((e) => e.name)
		.join(", ");
	const tags = nearest?.gradeTags.slice(0, 2).join(", ");
	const detail = [ecosystems, tags].filter(Boolean).join(" · ");

	return (
		<span className="text-[11px] text-zinc-400" title={source.label}>
			Nearest: {target}
			{detail ? ` · ${detail}` : ""}
		</span>
	);
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
	queue?: BuildQueue;
	rawBatch?: Batch;
	queueLocks: RecipeLockEntry[];
	batchLocks?: RecipeLockEntry[];
	mergedLocks: RecipeLockEntry[];
	containers?: ContainerOption[];
	containerJumps?: Map<string, number | undefined>;
	batchSourceLocks?: SourceLockEntry[];
	phaseLabelForBatchIds?: (batchIds: string[]) => string;
	sourceSystemId?: number | null;
	systemNames?: Map<number, string>;
	landscapeData: LandscapeData | null;
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
	queue,
	rawBatch,
	queueLocks,
	batchLocks,
	mergedLocks,
	containers,
	containerJumps,
	batchSourceLocks,
	phaseLabelForBatchIds,
	sourceSystemId,
	systemNames,
	landscapeData,
	collapsedPaths,
	toggleCollapsed,
	detailPaths,
	toggleDetails,
}: TreeRowProps) {
	const producers = data.outputToBlueprints.get(node.typeId) ?? [];
	const optionCount = producers.reduce(
		(sum, producer) =>
			sum + Math.max(1, (data.blueprintFacilities.get(producer.blueprintID) ?? []).length),
		0,
	);
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
	const reprocessableRaw = node.tier === "raw" && producers.length > 0;
	// Facility choice is independent of recipe choice -- the SAME blueprint can often run at more than
	// one facility type, so this is informational (which facilities work), not a selectable control.
	// Surfaced even for "final" (Target) nodes, whose recipe itself is locked to the authored Job.
	const facilityNames = chosenBp ? (data.blueprintFacilities.get(chosenBp.blueprintID) ?? []) : [];
	const excludedFacilities = node.excludedFacilities ?? [];
	const excludedSet = new Set(excludedFacilities);
	let targetBatch = rawBatch;
	let targetJobIndex =
		node.tier === "final" && node.jobId && rawBatch
			? rawBatch.jobs.findIndex((job) => job.id === node.jobId)
			: -1;
	if (node.tier === "final" && node.jobId && targetJobIndex < 0 && queue) {
		for (const batch of queue.batches) {
			const index = batch.jobs.findIndex((job) => job.id === node.jobId);
			if (index < 0) continue;
			targetBatch = batch;
			targetJobIndex = index;
			break;
		}
	}
	const targetJob =
		targetBatch && targetJobIndex >= 0 ? targetBatch.jobs[targetJobIndex] : undefined;
	const sourceLock = batchSourceLocks?.find((lock) => lock.typeId === node.typeId);
	const derivedPick = sourceLock?.facilityPick;
	const targetPick = targetJob?.overrides?.facilityPick;
	const pick = node.tier === "final" ? targetPick : derivedPick;

	// A final-tier row is an authored Target job -- changing its recipe goes straight to the Job
	// (setJobBlueprint), mirroring how a derived row steers via a recipe lock.
	const canChangeFinalRecipe = node.tier === "final" && targetJob != null && targetJobIndex >= 0;
	const canInlineChange =
		(node.tier === "intermediate" && optionCount > 1) || (canChangeFinalRecipe && optionCount > 1);

	function handleSourcesChange(sources: ContainerSourceConfig | undefined) {
		if (!batchId) return;
		const next: SourceLockEntry = { ...sourceLock, typeId: node.typeId };
		if (sources) next.sources = sources;
		else next.sources = undefined;
		if (next.sources || next.outputDest || next.facilityPick) {
			setBatchSourceLock(queueId, batchId, next);
		} else clearBatchSourceLock(queueId, batchId, node.typeId);
	}
	function handleOutputChange(outputDest: ContainerRef | undefined) {
		if (!batchId) return;
		const next: SourceLockEntry = { ...sourceLock, typeId: node.typeId, outputDest };
		if (next.sources || next.outputDest || next.facilityPick) {
			setBatchSourceLock(queueId, batchId, next);
		} else clearBatchSourceLock(queueId, batchId, node.typeId);
	}
	function handleDerivedSelect(bpId: number, facility: string | undefined) {
		if (bpId !== selectedBpId) writeExclusiveLock(queueId, batchId, node.typeId, bpId);
		if (!batchId) return;
		const next: SourceLockEntry = { ...sourceLock, typeId: node.typeId, facilityPick: facility };
		if (next.sources || next.outputDest || next.facilityPick) {
			setBatchSourceLock(queueId, batchId, next);
		} else clearBatchSourceLock(queueId, batchId, node.typeId);
	}
	function handleDerivedFacilityReset() {
		if (!batchId) return;
		const next: SourceLockEntry = { ...sourceLock, typeId: node.typeId, facilityPick: undefined };
		if (next.sources || next.outputDest) setBatchSourceLock(queueId, batchId, next);
		else clearBatchSourceLock(queueId, batchId, node.typeId);
	}
	function handleFinalSelect(bpId: number, facility: string | undefined) {
		if (!targetBatch || targetJobIndex < 0) return;
		if (bpId !== node.blueprintId) setJobBlueprint(queueId, targetBatch.id, targetJobIndex, bpId);
		const base = targetJob?.overrides ?? {};
		const next: JobOverrides = { ...base, facilityPick: facility };
		const hasOverrides =
			next.sources ||
			next.outputDest ||
			next.facilityExclude !== undefined ||
			next.facilityPick !== undefined;
		setJobOverrides(queueId, targetBatch.id, targetJobIndex, hasOverrides ? next : undefined);
	}
	function handleFinalFacilityReset() {
		if (!targetBatch || targetJobIndex < 0) return;
		const base = targetJob?.overrides ?? {};
		const next: JobOverrides = { ...base, facilityPick: undefined };
		const hasOverrides = next.sources || next.outputDest || next.facilityExclude !== undefined;
		setJobOverrides(queueId, targetBatch.id, targetJobIndex, hasOverrides ? next : undefined);
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
							<span className="flex min-w-0 flex-col">
								<span
									className="truncate text-xs text-zinc-500"
									title={`Source: ${node.sourceGroup ?? "Other"}`}
								>
									Source: {node.sourceGroup ?? "Other"}
								</span>
								<RawSourceDetail
									node={node}
									sourceSystemId={sourceSystemId}
									systemNames={systemNames}
									landscapeData={landscapeData}
								/>
							</span>
						) : canInlineChange ? (
							<RecipeDropdown
								typeId={node.typeId}
								producers={producers}
								currentBpId={selectedBpId}
								isOverridden={node.tier === "final" ? false : steered}
								onSelect={node.tier === "final" ? handleFinalSelect : handleDerivedSelect}
								formatOptionLabel={(bp, typeId) =>
									formatOptionLabel(bp, typeId, data.blueprintFacilities)
								}
								getFacilityLabel={(bp) => getFacilityLabel(bp, data.blueprintFacilities)}
								blueprintFacilities={data.blueprintFacilities}
								excludedFacilities={excludedFacilities}
								pick={pick}
								onResetFacility={
									node.tier === "final" ? handleFinalFacilityReset : handleDerivedFacilityReset
								}
								onSplitRequest={node.tier === "final" ? undefined : () => toggleDetails(node.path)}
							/>
						) : canShowRecipe && chosenBp ? (
							<span
								className="shrink-0 truncate rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-500"
								title={`Recipe: ${formatOptionLabel(chosenBp, node.typeId, data.blueprintFacilities)}`}
							>
								{facilityRecipeLabel(
									chosenBp,
									resolveEffectiveFacility(facilityNames, excludedSet, pick),
								)}
							</span>
						) : (
							<span className="text-xs text-zinc-600">--</span>
						)}

						<FacilityAvailabilityBadge
							facilityNames={facilityNames}
							excludedFacilities={excludedFacilities}
						/>

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
						queue={queue}
						rawBatch={rawBatch}
						queueLocks={queueLocks}
						batchLocks={batchLocks}
						mergedLocks={mergedLocks}
						containers={containers}
						containerJumps={containerJumps}
						batchSourceLocks={batchSourceLocks}
						phaseLabelForBatchIds={phaseLabelForBatchIds}
						sourceSystemId={sourceSystemId}
						systemNames={systemNames}
						landscapeData={landscapeData}
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
	queue,
	rawBatch,
	queueLocks,
	batchLocks,
	containers,
	containerJumps,
	batchSourceLocks,
	phaseLabelForBatchIds,
	sourceSystemId,
	systemNames,
}: BuildTreeProps) {
	const nodes = useMemo(() => buildBatchTree(batch, data), [batch, data]);
	const mergedLocks = useMemo(() => mergeLocks(queueLocks, batchLocks), [queueLocks, batchLocks]);
	const landscapeData = useLandscapeData();
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
						queue={queue}
						rawBatch={rawBatch}
						queueLocks={queueLocks}
						batchLocks={batchLocks}
						mergedLocks={mergedLocks}
						containers={containers}
						containerJumps={containerJumps}
						batchSourceLocks={batchSourceLocks}
						phaseLabelForBatchIds={phaseLabelForBatchIds}
						sourceSystemId={sourceSystemId}
						systemNames={systemNames}
						landscapeData={landscapeData}
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
