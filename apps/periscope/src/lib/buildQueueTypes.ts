// Build Queue data model -- plan 36 (industry-build-queue).
// Defines the persisted shape of a named, ordered build queue with per-step jobs,
// recipe locks, and source preferences.

import type { RecipePin } from "@/lib/bomTypes";
import type { SourcePref } from "@/lib/sourcePrefs";

/** One job in a build step: N runs of a blueprint. Outputs = its primary output + co-products.
 *  The UI divides a target output quantity by the blueprint's PRIMARY output (ceil) to get runs. */
export interface BuildJob {
	blueprintId: number;
	runs: number;
}

/** Either/or recipe steering for a producible input. */
export interface RecipeLockEntry {
	typeId: number;
	prefer?: number[]; // blueprintIds to prefer (lower optimizer weight)
	exclude?: number[]; // blueprintIds to eliminate
	pin?: RecipePin; // hard exclusive/split (reuses existing type)
}

/** One step in the queue: a batch of jobs built together, solved as a group. */
export interface BuildStep {
	id: string;
	label?: string;
	jobs: BuildJob[];
	collapsed?: boolean;
	recipeLocks?: RecipeLockEntry[]; // optional per-step lock override; queue-global is the default
}

/**
 * How the queue is solved:
 * - "perStep" (default / undefined) -- each step solved on its own with the outputs of earlier steps
 *   flowing forward as stock; legible, executable per-step plans that respect the build order.
 * - "global" -- the whole queue's job-input demand is collapsed into ONE solve, trading per-step
 *   legibility for cross-step optimality (a recipe choice in one step that shares a co-product needed
 *   by another). The gather/build plan is then a single queue-level summary, not attributed per step.
 */
export type ReoptMode = "perStep" | "global";

/** A saved, ordered build queue. */
export interface BuildQueue {
	id: string;
	name: string;
	description?: string;
	steps: BuildStep[];
	sourcePrefs: Record<string, SourcePref>;
	recipeLocks: RecipeLockEntry[];
	/** Re-optimization mode (undefined = "perStep"; see ReoptMode). Optional -- no Dexie bump needed. */
	reoptMode?: ReoptMode;
	/**
	 * Ids of other saved queues whose outputs (their resolved totals.finalPool) count as available
	 * stock for this queue. The view resolves those source queues and merges their finalPool into
	 * baseStock before calling resolveQueue. Optional -- no Dexie bump needed.
	 */
	stockFromQueueIds?: string[];
	createdAt: number;
	updatedAt: number;
}

/** Factory -- returns a minimal empty BuildQueue with a new random id and the given name. */
export function createBuildQueue(name: string): BuildQueue {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		name,
		steps: [],
		sourcePrefs: {},
		recipeLocks: [],
		createdAt: now,
		updatedAt: now,
	};
}
