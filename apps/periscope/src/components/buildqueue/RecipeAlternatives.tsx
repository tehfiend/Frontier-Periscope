// Either/or recipe alternatives -- plan 36 (industry-build-queue), Phase 7 + F2 + F5.
// For one producible input, lists EVERY buildable producer and lets the user steer the optimizer
// with four actions:
//   - Lock      -> an exclusive RecipePin (hard pick); clicking the locked recipe clears it.
//   - Prefer    -> add the blueprintId to prefer[] (soft steer; drops any pin -- incl. a split).
//   - Eliminate -> add the blueprintId to exclude[] (hard remove; drops any pin -- incl. a split).
//   - Split...  -> open SplitEditor (F5) to distribute the demand across producers as a split pin.
// "Reset" clears the SELECTED scope's lock for this type.
//
// F2 -- SCOPE. A scope toggle chooses whether an action applies to "This step" (setStepRecipeLock /
// clearStepRecipeLock) or the "Whole queue" (setRecipeLock / clearRecipeLock). Per the resolver's
// mergeLocks a step entry FULLY overrides the queue entry for that type, so the per-row status badge
// reflects the EFFECTIVE entry (and tags it "(step)"/"(queue)"), while the action buttons highlight
// what is set at the scope you are currently editing. Queue is the default scope; a type that
// already has a step override opens on "This step" so you edit the override that is actually in use.
//
// PRECEDENCE (F5): writing a split replaces any exclusive pin for the type (the entry becomes pin-only,
// dropping prefer/exclude); a single-facility split collapses to an exclusive pin; an empty split
// clears the lock. Conversely Lock writes a fresh exclusive pin and Prefer/Eliminate write a pin-less
// entry -- both therefore clear an existing split. So a type carries at most one of {split, exclusive
// pin, prefer/exclude} per scope and the four actions are mutually consistent.

import { SplitEditor } from "@/components/buildqueue/SplitEditor";
import { formatOptionLabel, getFacilityLabel } from "@/components/industry/RecipeDropdown";
import { classifyRecipePath } from "@/hooks/useBlueprintData";
import type { Blueprint, ProductionSplit } from "@/lib/bomTypes";
import type { RecipeLockEntry } from "@/lib/buildQueueTypes";
import {
	clearRecipeLock,
	clearStepRecipeLock,
	setRecipeLock,
	setStepRecipeLock,
} from "@/stores/buildQueueStore";
import { Ban, GitFork, Lock, RotateCcw, Star } from "lucide-react";
import { useState } from "react";

type Scope = "queue" | "step";

interface RecipeAlternativesProps {
	queueId: string;
	/** The step this drill-down belongs to (for the "This step" scope writes). Omit for a queue-only
	 *  context (e.g. the global-mode plan) -- then only the whole-queue scope is offered. */
	stepId?: string;
	typeId: number;
	/** All buildable producers of this type (chosen one included). */
	producers: Blueprint[];
	/** The recipe the resolver actually chose this solve (item.blueprintId). */
	chosenBpId: number | undefined;
	/** The queue-global lock entry for this type, if any. */
	queueEntry: RecipeLockEntry | undefined;
	/** The per-step lock entry for this type, if any (overrides the queue entry -- see mergeLocks). */
	stepEntry: RecipeLockEntry | undefined;
	/** This row's required quantity (Need) -- the total the SplitEditor distributes. */
	demandQuantity: number;
	/** The LP-decided splits for this type this solve (seeds the SplitEditor when no pin is set). */
	currentSplits: ProductionSplit[] | undefined;
	blueprintFacilities: Map<number, string[]>;
	outputToBlueprints: Map<number, Blueprint[]>;
	rawMaterialIds: Set<number>;
	salvageMaterialIds: Set<number>;
}

/** True when an entry actively steers (pins, prefers, or eliminates) -- an empty entry does not. */
function isSteered(entry: RecipeLockEntry | undefined): boolean {
	if (!entry) return false;
	return entry.pin != null || (entry.prefer?.length ?? 0) > 0 || (entry.exclude?.length ?? 0) > 0;
}

export function RecipeAlternatives({
	queueId,
	stepId,
	typeId,
	producers,
	chosenBpId,
	queueEntry,
	stepEntry,
	demandQuantity,
	currentSplits,
	blueprintFacilities,
	outputToBlueprints,
	rawMaterialIds,
	salvageMaterialIds,
}: RecipeAlternativesProps) {
	const queueSteered = isSteered(queueEntry);
	const stepSteered = isSteered(stepEntry);

	// Open on the scope whose override is actually in effect: a step override wins, so editing it is
	// the obvious intent. Otherwise default to the whole-queue scope (preserves the pre-F2 behaviour).
	const [scope, setScope] = useState<Scope>(stepSteered ? "step" : "queue");
	const [splitOpen, setSplitOpen] = useState(false);

	const canSplit = producers.length > 1;
	// When there is no owning step (queue-only context, e.g. global mode), only the whole-queue scope
	// is offered -- hide the step toggle and route all writes to the queue-global lock.
	const canScopeStep = stepId != null;

	// EFFECTIVE entry -- what the resolver uses (step fully overrides queue per mergeLocks). Drives the
	// per-row status badge so it always tells the truth about the plan, regardless of editing scope.
	const effectiveFromStep = stepSteered;
	const effectiveEntry = stepSteered ? stepEntry : queueEntry;
	const effPin = effectiveEntry?.pin;
	const effLockedBpId = effPin?.kind === "exclusive" ? effPin.blueprintId : undefined;
	const effSplitBpIds = new Set(
		effPin?.kind === "split" ? effPin.splits.map((s) => s.blueprintId) : [],
	);
	const effPreferred = new Set(effectiveEntry?.prefer ?? []);
	const effExcluded = new Set(effectiveEntry?.exclude ?? []);
	const effectiveSteered = queueSteered || stepSteered;
	const scopeTag = effectiveFromStep ? "step" : "queue";

	// ACTIVE entry -- the one being edited (selected scope). Drives the action buttons' highlight + logic.
	const activeEntry = scope === "step" ? stepEntry : queueEntry;
	const activePin = activeEntry?.pin;
	const lockedBpId = activePin?.kind === "exclusive" ? activePin.blueprintId : undefined;
	const preferred = new Set(activeEntry?.prefer ?? []);
	const excluded = new Set(activeEntry?.exclude ?? []);
	const activeSteered = isSteered(activeEntry);
	const nonExcludedCount = producers.filter((p) => !excluded.has(p.blueprintID)).length;

	// ── Scope-aware store writes ────────────────────────────────────────────────
	function writeEntry(entry: RecipeLockEntry) {
		if (scope === "step" && stepId != null) setStepRecipeLock(queueId, stepId, entry);
		else setRecipeLock(queueId, entry);
	}
	function clearEntry() {
		if (scope === "step" && stepId != null) clearStepRecipeLock(queueId, stepId, typeId);
		else clearRecipeLock(queueId, typeId);
	}

	// commit() collapses an empty steer back to "auto" by removing the lock. prefer/exclude always
	// drop any pin (incl. a split) -- a soft steer with a hard pin masking it would be incoherent.
	function commit(nextPrefer: Set<number>, nextExclude: Set<number>) {
		if (nextPrefer.size === 0 && nextExclude.size === 0) {
			clearEntry();
			return;
		}
		const next: RecipeLockEntry = { typeId };
		if (nextPrefer.size > 0) next.prefer = [...nextPrefer];
		if (nextExclude.size > 0) next.exclude = [...nextExclude];
		writeEntry(next);
	}

	function handleLock(bpId: number) {
		if (lockedBpId === bpId) {
			clearEntry(); // toggle the lock off -> back to auto
		} else {
			// Hard pick: a clean exclusive pin (drops any prefer/exclude/split -- the lock supersedes them).
			writeEntry({ typeId, pin: { typeId, kind: "exclusive", blueprintId: bpId } });
		}
	}

	function handlePrefer(bpId: number) {
		const nextPrefer = new Set(preferred);
		const nextExclude = new Set(excluded);
		if (nextPrefer.has(bpId)) {
			nextPrefer.delete(bpId);
		} else {
			nextPrefer.add(bpId);
			nextExclude.delete(bpId); // can't prefer and eliminate the same recipe
		}
		commit(nextPrefer, nextExclude);
	}

	function handleEliminate(bpId: number) {
		const nextPrefer = new Set(preferred);
		const nextExclude = new Set(excluded);
		if (nextExclude.has(bpId)) {
			nextExclude.delete(bpId);
		} else {
			// Never eliminate the last remaining producer -- that would make the type unbuildable.
			if (nonExcludedCount <= 1) return;
			nextExclude.add(bpId);
			nextPrefer.delete(bpId);
		}
		commit(nextPrefer, nextExclude);
	}

	// ── Split authoring (F5) ────────────────────────────────────────────────────
	// Seed the editor from the active pin (a split, or full demand on an exclusive), else the LP splits,
	// else full demand on the chosen recipe. Snapping to batch sizes matches the editor's own slider.
	function buildInitialDraft(): Map<number, number> {
		const draft = new Map<number, number>();
		if (effPin?.kind === "split") {
			for (const s of effPin.splits) draft.set(s.blueprintId, s.quantity);
			return draft;
		}
		if (currentSplits && currentSplits.length > 1) {
			for (const s of currentSplits) {
				const bp = producers.find((p) => p.blueprintID === s.blueprintId);
				const batch = bp?.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
				draft.set(s.blueprintId, Math.round(s.quantity / batch) * batch);
			}
			return draft;
		}
		const seedBp = effLockedBpId ?? chosenBpId ?? producers[0]?.blueprintID;
		if (seedBp != null) draft.set(seedBp, demandQuantity);
		return draft;
	}

	function handleApplySplit(entries: Array<{ blueprintId: number; quantity: number }>) {
		const positive = entries.filter((e) => e.quantity > 0);
		if (positive.length === 0) {
			clearEntry();
		} else if (positive.length === 1) {
			writeEntry({ typeId, pin: { typeId, kind: "exclusive", blueprintId: positive[0].blueprintId } });
		} else {
			writeEntry({ typeId, pin: { typeId, kind: "split", splits: positive } });
		}
		setSplitOpen(false);
	}

	function handleOnly(bpId: number) {
		writeEntry({ typeId, pin: { typeId, kind: "exclusive", blueprintId: bpId } });
		setSplitOpen(false);
	}

	function handleClearSplit() {
		clearEntry();
		setSplitOpen(false);
	}

	// Cross-scope banner so a step override is unmistakable even while editing the other scope.
	const banner =
		scope === "queue" && stepSteered
			? {
					cls: "text-amber-400",
					text: "A step override is set for this item and takes priority. Switch to This step to change what's used here.",
				}
			: scope === "step" && stepSteered
				? {
						cls: "text-cyan-300",
						text: "Editing this step's override -- it overrides the whole-queue setting for this step.",
					}
				: scope === "step" && queueSteered
					? {
							cls: "text-zinc-400",
							text: "No step override yet -- the whole-queue setting applies. Set one here to override it for this step only.",
						}
					: null;

	return (
		<div className="ml-8 space-y-1.5 rounded border border-zinc-700/60 bg-zinc-900/60 p-3">
			<div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
				<span>{producers.length} ways to build this</span>

				{/* F2 scope toggle -- only when this drill-down belongs to a step */}
				{canScopeStep && (
				<div className="ml-1 flex shrink-0 overflow-hidden rounded border border-zinc-700">
					<button
						type="button"
						onClick={() => setScope("step")}
						className={`px-1.5 py-0.5 text-[10px] transition-colors ${
							scope === "step"
								? "bg-cyan-500/20 text-cyan-300"
								: "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
						}`}
						title="Apply changes to THIS step only (overrides the whole-queue setting)"
					>
						This step
					</button>
					<button
						type="button"
						onClick={() => setScope("queue")}
						className={`px-1.5 py-0.5 text-[10px] transition-colors ${
							scope === "queue"
								? "bg-zinc-700 text-zinc-100"
								: "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
						}`}
						title="Apply changes to the WHOLE queue (every step)"
					>
						Whole queue
					</button>
				</div>
				)}

				{canSplit && (
					<button
						type="button"
						onClick={() => setSplitOpen((v) => !v)}
						className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
							splitOpen || effPin?.kind === "split"
								? "bg-violet-500/20 text-violet-300"
								: "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
						}`}
						title="Split this item's production across multiple facilities"
					>
						<GitFork size={10} />
						Split...
					</button>
				)}

				{activeSteered && (
					<button
						type="button"
						onClick={clearEntry}
						className="ml-auto inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300"
						title={
							scope === "step"
								? "Clear this step's override for this item"
								: "Reset this input to the optimizer's automatic pick"
						}
					>
						<RotateCcw size={11} />
						{scope === "step" ? "Reset step" : "Reset to auto"}
					</button>
				)}
			</div>

			{banner && <div className={`text-[11px] ${banner.cls}`}>{banner.text}</div>}

			{splitOpen && canSplit && (
				<SplitEditor
					typeId={typeId}
					producers={producers}
					demandQuantity={demandQuantity}
					blueprintFacilities={blueprintFacilities}
					initialDraft={buildInitialDraft()}
					onApply={handleApplySplit}
					onOnly={handleOnly}
					onClear={handleClearSplit}
					onCancel={() => setSplitOpen(false)}
				/>
			)}

			{producers.map((bp) => {
				const bpId = bp.blueprintID;
				const path = classifyRecipePath(bp, outputToBlueprints, rawMaterialIds, salvageMaterialIds);

				// Status badge reflects the EFFECTIVE entry (+ scope tag) so it matches the resolved plan.
				const effLocked = effLockedBpId === bpId;
				const effInSplit = effSplitBpIds.has(bpId);
				const effIsPreferred = effPreferred.has(bpId);
				const effIsEliminated = effExcluded.has(bpId);
				const isAutoPick = !effectiveSteered && chosenBpId === bpId;

				const status = effLocked
					? { label: `Locked (${scopeTag})`, cls: "text-cyan-300" }
					: effInSplit
						? { label: `In split (${scopeTag})`, cls: "text-violet-300" }
						: effIsPreferred
							? { label: `Preferred (${scopeTag})`, cls: "text-emerald-300" }
							: effIsEliminated
								? { label: `Eliminated (${scopeTag})`, cls: "text-red-300" }
								: isAutoPick
									? { label: "Auto pick", cls: "text-zinc-400" }
									: null;

				// Action buttons highlight what is set at the SELECTED scope.
				const locked = lockedBpId === bpId;
				const isPreferred = preferred.has(bpId);
				const isEliminated = excluded.has(bpId);

				return (
					<div
						key={bpId}
						className={`flex items-start justify-between gap-3 rounded border px-2.5 py-1.5 ${
							effIsEliminated
								? "border-red-500/30 bg-red-500/5 opacity-60"
								: effLocked
									? "border-cyan-500/40 bg-cyan-500/5"
									: effInSplit
										? "border-violet-500/30 bg-violet-500/5"
										: effIsPreferred
											? "border-emerald-500/30 bg-emerald-500/5"
											: "border-zinc-800 bg-zinc-900/40"
						}`}
					>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<span className="truncate text-xs font-medium text-zinc-200">
									{path === "salvage" ? "♻ " : ""}
									{getFacilityLabel(bp, blueprintFacilities)}
								</span>
								{status && (
									<span className={`shrink-0 text-[10px] font-medium ${status.cls}`}>
										{status.label}
									</span>
								)}
							</div>
							<div
								className="truncate text-[11px] text-zinc-500"
								title={formatOptionLabel(bp, typeId, blueprintFacilities)}
							>
								{bp.inputs.map((i) => `${i.quantity.toLocaleString()} ${i.typeName}`).join(", ")}
							</div>
						</div>

						<div className="flex shrink-0 items-center gap-1">
							<button
								type="button"
								onClick={() => handleLock(bpId)}
								className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
									locked
										? "bg-cyan-500/20 text-cyan-300"
										: "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
								}`}
								title={locked ? "Unlock (back to auto)" : "Lock: always use this recipe"}
							>
								<Lock size={10} />
								Lock
							</button>
							<button
								type="button"
								onClick={() => handlePrefer(bpId)}
								className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
									isPreferred
										? "bg-emerald-500/20 text-emerald-300"
										: "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
								}`}
								title="Prefer: bias the optimizer toward this recipe"
							>
								<Star size={10} />
								Prefer
							</button>
							<button
								type="button"
								onClick={() => handleEliminate(bpId)}
								disabled={!isEliminated && nonExcludedCount <= 1}
								className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
									isEliminated
										? "bg-red-500/20 text-red-300"
										: "text-zinc-500 enabled:hover:bg-zinc-800 enabled:hover:text-zinc-200 disabled:opacity-30"
								}`}
								title={
									!isEliminated && nonExcludedCount <= 1
										? "Can't eliminate the last remaining recipe"
										: "Eliminate: never use this recipe"
								}
							>
								<Ban size={10} />
								Eliminate
							</button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
