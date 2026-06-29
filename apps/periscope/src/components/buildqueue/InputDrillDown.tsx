// Input drill-down tables -- plan 36 (industry-build-queue), Phase 7 + F2 + D9.
// The interactive material lists inside a step's materials summary:
//   - BuildChoiceTable: producible inputs. Each row shows the chosen-recipe chip (via
//     formatOptionLabel) -- or a "Split" chip when a split pin is set -- and, when more than one
//     recipe can build it, an "either/or" badge that expands to RecipeAlternatives (lock / prefer /
//     eliminate / split, scoped to this step or the whole queue -- see RecipeAlternatives + SplitEditor).
//   - RawSourceTable: raw / leaf inputs. Each row shows its source group with an inline
//     prefer/avoid/exclude control (RawSourceControl) that writes queue.sourcePrefs by GROUP -- so it
//     steers that whole source group across every step, not just this row (D9: label/tooltip say so).
// Each row keeps the Need / Have / Still Need / Volume columns so the numbers read at a glance.

import { ItemIcon } from "@/components/ItemIcon";
import { RawSourceControl } from "@/components/buildqueue/RawSourceControl";
import { RecipeAlternatives } from "@/components/buildqueue/RecipeAlternatives";
import { type QueueBlueprintData, isRecipeSteered } from "@/components/buildqueue/shared";
import { formatOptionLabel, getFacilityLabel } from "@/components/industry/RecipeDropdown";
import type { BomLineItem } from "@/lib/bomTypes";
import type { RecipeLockEntry } from "@/lib/buildQueueTypes";
import { type StepBuildItem, mergeLocks } from "@/lib/queueResolver";
import { type SourcePref, defaultSourcePref } from "@/lib/sourcePrefs";
import { setSourcePref } from "@/stores/buildQueueStore";
import { AlertTriangle, ChevronDown, ChevronRight, GitFork } from "lucide-react";
import { Fragment, useState } from "react";

// ── Shared cell helpers (consistent Need / Have / Still Need / Volume formatting) ──

function NeedCell({ value }: { value: number }) {
	return <td className="px-4 py-2 text-right font-mono text-zinc-400">{value.toLocaleString()}</td>;
}

function HaveCell({ value }: { value: number }) {
	return (
		<td className="px-4 py-2 text-right font-mono text-cyan-400">
			{value > 0 ? value.toLocaleString() : "--"}
		</td>
	);
}

function StillNeedCell({ value }: { value: number }) {
	return (
		<td
			className={`px-4 py-2 text-right font-mono ${
				value === 0 ? "text-green-400" : "text-violet-300"
			}`}
		>
			{value === 0 ? "0" : value.toLocaleString()}
		</td>
	);
}

function VolumeCell({ item }: { item: BomLineItem }) {
	return (
		<td className="px-4 py-2 text-right">
			{item.volumeMissing ? (
				<span
					className="inline-flex items-center gap-1 text-amber-400"
					title="Volume data missing for this item"
				>
					<AlertTriangle size={12} />
					<span className="text-xs">??</span>
				</span>
			) : (
				<span className="font-mono text-zinc-400">
					{item.volume.toLocaleString(undefined, { maximumFractionDigits: 1 })}
				</span>
			)}
		</td>
	);
}

// ── Build (producible) choices ─────────────────────────────────────────────────

interface BuildChoiceTableProps {
	items: StepBuildItem[];
	data: QueueBlueprintData;
	queueId: string;
	/** The step these intermediates belong to (for the per-step recipe-lock scope -- F2). */
	stepId?: string;
	/** Queue-global recipe locks (the default scope). */
	queueLocks: RecipeLockEntry[];
	/** Per-step recipe locks for this step, if any (override the queue locks per type -- mergeLocks). */
	stepLocks?: RecipeLockEntry[];
}

export function BuildChoiceTable({
	items,
	data,
	queueId,
	stepId,
	queueLocks,
	stepLocks,
}: BuildChoiceTableProps) {
	if (items.length === 0) {
		return <div className="px-4 py-3 text-xs text-zinc-600">None</div>;
	}
	// The EFFECTIVE locks the resolver used (step overrides queue per type) -- drives the "steered" chip.
	const mergedLocks = mergeLocks(queueLocks, stepLocks);
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<th className="px-4 py-2 text-left">Item</th>
					<th className="px-4 py-2 text-left">Recipe</th>
					<th className="px-4 py-2 text-right">Need</th>
					<th className="px-4 py-2 text-right">Have</th>
					<th className="px-4 py-2 text-right">Still Need</th>
					<th className="px-4 py-2 text-right">Volume (m³)</th>
				</tr>
			</thead>
			<tbody>
				{items.map((item) => (
					<BuildChoiceRow
						key={item.typeId}
						item={item}
						data={data}
						queueId={queueId}
						stepId={stepId}
						queueLocks={queueLocks}
						stepLocks={stepLocks}
						mergedLocks={mergedLocks}
					/>
				))}
			</tbody>
		</table>
	);
}

function BuildChoiceRow({
	item,
	data,
	queueId,
	stepId,
	queueLocks,
	stepLocks,
	mergedLocks,
}: {
	item: StepBuildItem;
	data: QueueBlueprintData;
	queueId: string;
	stepId?: string;
	queueLocks: RecipeLockEntry[];
	stepLocks?: RecipeLockEntry[];
	mergedLocks: RecipeLockEntry[];
}) {
	const [expanded, setExpanded] = useState(false);
	const producers = data.outputToBlueprints.get(item.typeId) ?? [];
	const hasAlternatives = item.alternativeBlueprintIds.length > 1;
	const chosenBp = producers.find((p) => p.blueprintID === item.blueprintId) ?? producers[0];
	const isSplit = (item.splits?.length ?? 0) > 1;
	const queueEntry = queueLocks.find((lock) => lock.typeId === item.typeId);
	const stepEntry = stepLocks?.find((lock) => lock.typeId === item.typeId);
	const steered = isRecipeSteered(item.typeId, mergedLocks);

	return (
		<Fragment>
			<tr className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
				<td className="px-4 py-2 text-zinc-200">
					<span className="flex items-center gap-2">
						<ItemIcon typeId={item.typeId} />
						{item.typeName}
					</span>
				</td>
				<td className="px-4 py-2">
					<div className="flex flex-wrap items-center gap-2">
						{isSplit ? (
							<span className="rounded border border-violet-500/40 bg-zinc-900 px-1.5 py-0.5 text-xs text-violet-300">
								Split · {item.splits?.length} facilities
							</span>
						) : chosenBp ? (
							<span
								className="truncate text-xs text-zinc-400"
								title={formatOptionLabel(chosenBp, item.typeId, data.blueprintFacilities)}
							>
								{getFacilityLabel(chosenBp, data.blueprintFacilities)}
							</span>
						) : (
							<span className="text-xs text-zinc-600">--</span>
						)}
						{hasAlternatives && (
							<button
								type="button"
								onClick={() => setExpanded((v) => !v)}
								className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
									steered
										? "border-cyan-600/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
										: "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
								}`}
								title={
									steered
										? "Recipe steered -- expand to review or change"
										: "More than one recipe can build this -- expand to choose"
								}
								aria-expanded={expanded}
							>
								{expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
								<GitFork size={10} />
								either/or · {item.alternativeBlueprintIds.length}
							</button>
						)}
					</div>
				</td>
				<NeedCell value={item.quantity} />
				<HaveCell value={item.stockQty} />
				<StillNeedCell value={item.stillNeed} />
				<VolumeCell item={item} />
			</tr>
			{hasAlternatives && expanded && (
				<tr className="border-t border-zinc-800/30">
					<td colSpan={6} className="px-4 py-2">
						<RecipeAlternatives
							queueId={queueId}
							stepId={stepId}
							typeId={item.typeId}
							producers={producers}
							chosenBpId={item.blueprintId}
							queueEntry={queueEntry}
							stepEntry={stepEntry}
							demandQuantity={item.quantity}
							currentSplits={item.splits}
							blueprintFacilities={data.blueprintFacilities}
							outputToBlueprints={data.outputToBlueprints}
							rawMaterialIds={data.rawMaterialIds}
							salvageMaterialIds={data.salvageMaterialIds}
						/>
					</td>
				</tr>
			)}
		</Fragment>
	);
}

// ── Raw / leaf inputs with inline source-pref control ────────────────────────────

interface RawSourceTableProps {
	items: BomLineItem[];
	typeGroups: Map<number, string>;
	sourcePrefs: Record<string, SourcePref>;
	queueId: string;
}

export function RawSourceTable({ items, typeGroups, sourcePrefs, queueId }: RawSourceTableProps) {
	if (items.length === 0) {
		return <div className="px-4 py-3 text-xs text-zinc-600">None</div>;
	}
	const totalVolume = items.reduce((sum, i) => (i.volumeMissing ? sum : sum + i.volume), 0);
	const hasMissing = items.some((i) => i.volumeMissing);

	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<th className="px-4 py-2 text-left">Item</th>
					<th className="px-4 py-2 text-left">Source</th>
					<th className="px-4 py-2 text-right">Need</th>
					<th className="px-4 py-2 text-right">Have</th>
					<th className="px-4 py-2 text-right">Still Need</th>
					<th className="px-4 py-2 text-right">Volume (m³)</th>
				</tr>
			</thead>
			<tbody>
				{items.map((item) => {
					const group = typeGroups.get(item.typeId) ?? "Other";
					const pref = sourcePrefs[group] ?? defaultSourcePref(group);
					return (
						<tr key={item.typeId} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
							<td className="px-4 py-2 text-zinc-200">
								<span className="flex items-center gap-2">
									<ItemIcon typeId={item.typeId} />
									{item.typeName}
								</span>
							</td>
							<td className="px-4 py-2">
								<div className="flex items-center gap-2">
									<span
										className="truncate text-xs text-zinc-500"
										title={`Source: ${group} -- this control steers the whole ${group} group across every step in the queue, not just this material`}
									>
										Source: {group}
									</span>
									<RawSourceControl
										pref={pref}
										onSetPref={(p) => setSourcePref(queueId, group, p)}
									/>
								</div>
							</td>
							<NeedCell value={item.quantity} />
							<HaveCell value={item.stockQty} />
							<StillNeedCell value={item.stillNeed} />
							<VolumeCell item={item} />
						</tr>
					);
				})}
			</tbody>
			<tfoot>
				<tr className="border-t border-zinc-700">
					<td className="px-4 py-2 text-xs font-medium text-zinc-400" colSpan={5}>
						Total
					</td>
					<td className="px-4 py-2 text-right font-mono text-sm text-zinc-200">
						{totalVolume.toLocaleString(undefined, { maximumFractionDigits: 1 })}
						{hasMissing && (
							<span className="ml-1 text-amber-400" title="Some items have missing volume">
								*
							</span>
						)}
					</td>
				</tr>
			</tfoot>
		</table>
	);
}
