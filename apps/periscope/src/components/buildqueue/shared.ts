// Shared helpers + types for the Build Queue view -- plan 36 (industry-build-queue), Phase 5.
// Small, dependency-free utilities used across the queue/step/job components.

import type { Blueprint } from "@/lib/bomTypes";
import type { RecipeLockEntry } from "@/lib/buildQueueTypes";
import { type StepResult, mergeLocks } from "@/lib/queueResolver";

/**
 * The slice of loaded blueprint/game data the Build Queue components consume. The view assembles
 * this once (buildable-filtered, mirroring IndustryCalculator) and threads it down so the step and
 * job components never touch useBlueprintData themselves.
 */
export interface QueueBlueprintData {
	/** Buildable-filtered blueprint record (keyed by blueprintID string). */
	blueprints: Record<string, Blueprint>;
	/** Buildable-filtered output typeID -> producers (used for the per-job recipe dropdown). */
	outputToBlueprints: Map<number, Blueprint[]>;
	/** Buildable-filtered typeID -> default blueprintID (used to resolve a picked product -> a job). */
	defaultRecipes: Map<number, number>;
	/** Leaf raw typeIDs (full set) -- recipe-path classification in the recipe dropdown. */
	rawMaterialIds: Set<number>;
	/** Salvage leaf typeIDs (full set) -- recipe-path classification + material source labels. */
	salvageMaterialIds: Set<number>;
	/** blueprintID -> live facility names (for the facility label in the recipe dropdown). */
	blueprintFacilities: Map<number, string[]>;
	/** typeID -> source group name (for the gather material-table source column). */
	typeGroups: Map<number, string>;
	/** Buildable producible products, sorted by name (for the add-job search). */
	producibleItems: Array<{ typeId: number; typeName: string }>;
}

/** A lightweight reference to a step, for the move-to-step dropdown. */
export interface StepRef {
	id: string;
	label: string;
}

/** Format a duration in seconds as "1h 2m 3s" (matches IndustryCalculator). */
export function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const parts: string[] = [];
	if (h > 0) parts.push(`${h}h`);
	if (m > 0) parts.push(`${m}m`);
	if (s > 0) parts.push(`${s}s`);
	return parts.join(" ") || "0s";
}

/** Format an m3 volume with at most one decimal place. */
export function formatVolume(m3: number): string {
	return m3.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/** Format a millisecond-epoch timestamp as a short relative string ("just now", "5m ago"). */
export function formatRelativeMs(ms: number): string {
	const diff = Date.now() - ms;
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** A job's primary output quantity per run (defaults to 1 when the recipe is unknown). */
export function outputPerRun(bp: Blueprint | undefined): number {
	if (!bp) return 1;
	return bp.outputs.find((o) => o.typeID === bp.primaryTypeID)?.quantity ?? 1;
}

/**
 * Resolve a picked product typeID to the blueprintID a new job should use: the buildable default
 * recipe, falling back to the first buildable producer. Undefined when nothing can build it.
 */
export function resolveBlueprintForProduct(
	typeId: number,
	data: QueueBlueprintData,
): number | undefined {
	return data.defaultRecipes.get(typeId) ?? data.outputToBlueprints.get(typeId)?.[0]?.blueprintID;
}

// ── Either/or "open choice" accounting ────────────────────────────────────────
// A producible input is an "open choice" when more than one recipe can build it AND the user has
// NOT steered it yet -- so it is still on the optimizer's auto pick. These power the "N choices"
// indicators that tell early-game users a decision is available without hunting for it.

/**
 * True when a recipe lock actively steers a type -- it pins a recipe, prefers one, or eliminates
 * one. An empty/absent entry is NOT steering (still auto). clearRecipeLock removes the entry, and
 * the Phase 7 controls never persist an all-empty entry, so this stays in sync with the store.
 */
export function isRecipeSteered(typeId: number, recipeLocks: RecipeLockEntry[]): boolean {
	const entry = recipeLocks.find((lock) => lock.typeId === typeId);
	if (!entry) return false;
	return entry.pin != null || (entry.prefer?.length ?? 0) > 0 || (entry.exclude?.length ?? 0) > 0;
}

/** Producible inputs in a step with >1 recipe that are still on the optimizer's auto pick. */
export function stepOpenChoiceCount(step: StepResult, recipeLocks: RecipeLockEntry[]): number {
	return step.build.filter(
		(b) => b.alternativeBlueprintIds.length > 1 && !isRecipeSteered(b.typeId, recipeLocks),
	).length;
}

/** Distinct producible typeIDs across all steps that are still open either/or choices. */
export function queueOpenChoiceCount(
	steps: StepResult[],
	recipeLocks: RecipeLockEntry[],
): number {
	const open = new Set<number>();
	for (const step of steps) {
		// Apply the step's own per-step locks on top of the queue-global locks so a purely
		// step-scoped steer is counted as steered (otherwise the badge over-counts). Merging with an
		// absent step.recipeLocks is a no-op, so per-step (default) results are unchanged.
		const effective = mergeLocks(recipeLocks, step.recipeLocks);
		for (const b of step.build) {
			if (b.alternativeBlueprintIds.length > 1 && !isRecipeSteered(b.typeId, effective)) {
				open.add(b.typeId);
			}
		}
	}
	return open.size;
}
