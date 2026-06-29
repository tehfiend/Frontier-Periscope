// Per-step materials summary -- plan 36 (industry-build-queue), Phase 7.
// Compact gather (raws) / build (intermediates) / from-upstream / surplus lists for one step.
// Phase 7 makes the build + gather sections interactive: the build list is the either/or recipe
// drill-down (BuildChoiceTable -> RecipeAlternatives, lock/prefer/eliminate) and each gather row
// carries an inline source-pref control (RawSourceTable -> RawSourceControl). From-upstream and
// surplus stay read-only (reused SurplusTable). The build subsection's hint counts the inputs that
// still have an OPEN either/or choice (more than one recipe, not yet steered).

import { ItemIcon } from "@/components/ItemIcon";
import { BuildChoiceTable, RawSourceTable } from "@/components/buildqueue/InputDrillDown";
import {
	type QueueBlueprintData,
	formatVolume,
	stepOpenChoiceCount,
} from "@/components/buildqueue/shared";
import { SurplusTable } from "@/components/industry/SurplusTable";
import type { RecipeLockEntry } from "@/lib/buildQueueTypes";
import { type StepResult, mergeLocks } from "@/lib/queueResolver";
import type { SourcePref } from "@/lib/sourcePrefs";

interface StepMaterialsProps {
	step: StepResult;
	queueId: string;
	data: QueueBlueprintData;
	/** Queue-global recipe locks (the default lock scope). */
	recipeLocks: RecipeLockEntry[];
	/** This step's per-step lock overrides, if any (F2 -- override queue locks per type). */
	stepLocks: RecipeLockEntry[] | undefined;
	sourcePrefs: Record<string, SourcePref>;
	/** True when the queue is in global re-optimization mode (per-step material lists are empty). */
	globalMode: boolean;
}

function Subsection({
	title,
	count,
	hint,
	children,
}: {
	title: string;
	count: number;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="overflow-hidden rounded border border-zinc-800 bg-zinc-900/40">
			<div className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-400">
				{title}
				<span className="text-zinc-600">({count})</span>
				{hint && <span className="ml-auto text-[11px] font-normal text-amber-400/80">{hint}</span>}
			</div>
			{children}
		</div>
	);
}

export function StepMaterials({
	step,
	queueId,
	data,
	recipeLocks,
	stepLocks,
	sourcePrefs,
	globalMode,
}: StepMaterialsProps) {
	// EFFECTIVE locks (step overrides queue per type) so the open-choice hint reflects step-level steers.
	const mergedLocks = mergeLocks(recipeLocks, stepLocks);
	const openChoiceCount = stepOpenChoiceCount(step, mergedLocks);
	const buildHint =
		openChoiceCount > 0
			? `${openChoiceCount} choice${openChoiceCount === 1 ? "" : "s"} to make`
			: undefined;

	const hasAnything =
		step.gather.length > 0 ||
		step.build.length > 0 ||
		step.fromUpstream.length > 0 ||
		step.surplus.length > 0;

	if (!hasAnything) {
		// In global mode the per-step lists are intentionally empty (the plan is queue-level), so the
		// "fully covered" wording would be misleading -- point the user to the queue-level plan instead.
		return (
			<div className="px-4 py-3 text-xs text-zinc-600">
				{globalMode
					? "Materials are shown in the queue-level plan above (global mode)."
					: "No additional materials -- this step's inputs are fully covered."}
			</div>
		);
	}

	return (
		<div className="space-y-3 px-4 pb-4">
			{step.gather.length > 0 && (
				<Subsection title="Gather (raw materials)" count={step.gather.length}>
					<RawSourceTable
						items={step.gather}
						typeGroups={data.typeGroups}
						sourcePrefs={sourcePrefs}
						queueId={queueId}
					/>
				</Subsection>
			)}

			{step.build.length > 0 && (
				<Subsection title="Build (intermediates)" count={step.build.length} hint={buildHint}>
					<BuildChoiceTable
						items={step.build}
						data={data}
						queueId={queueId}
						stepId={step.stepId}
						queueLocks={recipeLocks}
						stepLocks={stepLocks}
					/>
				</Subsection>
			)}

			{step.fromUpstream.length > 0 && (
				<Subsection title="From upstream (earlier steps)" count={step.fromUpstream.length}>
					<table className="w-full text-sm">
						<thead>
							<tr className="border-t border-zinc-800 text-xs text-zinc-500">
								<th className="px-4 py-2 text-left">Item</th>
								<th className="px-4 py-2 text-right">Quantity</th>
								<th className="px-4 py-2 text-right">Volume (m³)</th>
							</tr>
						</thead>
						<tbody>
							{step.fromUpstream.map((item) => (
								<tr key={item.typeId} className="border-t border-zinc-800/50 hover:bg-zinc-800/30">
									<td className="px-4 py-2 text-zinc-200">
										<span className="flex items-center gap-2">
											<ItemIcon typeId={item.typeId} />
											{item.typeName}
										</span>
									</td>
									<td className="px-4 py-2 text-right font-mono text-cyan-400">
										{item.quantity.toLocaleString()}
									</td>
									<td className="px-4 py-2 text-right font-mono text-zinc-400">
										{item.volume < 0 ? "??" : formatVolume(item.volume)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</Subsection>
			)}

			{step.surplus.length > 0 && (
				<Subsection
					title="Surplus (rolls into next step)"
					count={step.surplus.length}
					hint="available to later steps"
				>
					<SurplusTable items={step.surplus} />
				</Subsection>
			)}
		</div>
	);
}
