// Build Queue data model -- plan 36 (industry-build-queue); terminology Queue / Order / Job (plan 39).
// Defines the persisted shape of a named, ordered build queue with per-order jobs and recipe locks.

import type { RecipePin } from "@/lib/bomTypes";

// ── Container sourcing model (plan 39 Phase 4a) ──────────────────────────────
// A tagged reference to any stock source (chain SSU, field storage unit, or the queue-local
// scratch pad). Used in the ordered include/exclude lists and -- later -- the sourcing plan.

/** Tagged reference to a stock source. `scratch` is the queue-local pad (no id); `unassigned` is the
 *  reserved terminal deposit bucket (plan 41 Q1a) -- not user-selectable, never a sourcing container. */
export type ContainerRef =
	| { kind: "chain"; id: string } // SSU objectId
	| { kind: "field"; id: string } // fieldStorageUnits.id (uuid)
	| { kind: "scratch" } // the queue-local scratch pad
	| { kind: "unassigned" }; // reserved default deposit bucket -- the anonymous Option-A pool (plan 41)

/** Ranked container include list (position = priority) plus scoped exclusions. */
export interface ContainerSourceConfig {
	/** Ranked include list -- earlier entries are higher sourcing priority. */
	order?: ContainerRef[];
	/** Scoped removals (a narrower scope re-including via `order` beats a wider scope's exclude). */
	exclude?: ContainerRef[];
}

/** Sourcing + output overrides applied at a single cascade scope. */
export interface JobOverrides {
	/** Container sourcing (ranked include + scoped exclude). */
	sources?: ContainerSourceConfig;
	/** Deposit destination (plan 41 B1). The job's leftover outputs physically land here in the
	 *  carry-forward pool so later orders source them from this named storage; un-routed -> Unassigned. */
	outputDest?: ContainerRef;
	/** Facility availability exclusions. Undefined inherits; a defined array fully replaces wider
	 *  scope exclusions for this job. Names match `blueprintFacilities` facility names. */
	facilityExclude?: string[];
	/** Per-item facility override -- the single facility name this item should run at. Undefined
	 *  inherits (uses the first available facility of the chosen recipe). Overrides availability. */
	facilityPick?: string;
}

/** A per-typeId override rule -- keys the Derived-job ("item-rule") cascade layers (2 and 4). */
export interface SourceLockEntry extends JobOverrides {
	typeId: number;
}

/** Queue location (plan 39 Phase 5, decisions 10/11). One per queue: containers are distance-sorted
 *  against `systemId` (gate-jump count) and a job's output container is the only per-job "where".
 *  Structured `systemId` is the distance anchor; `warpable`/`note` are free-text aids (mirrors the
 *  FieldStorageUnit location shape). */
export interface QueueLocation {
	systemId: number;
	warpable?: string;
	note?: string;
}

/** One speculative stock line in a queue's local scratch pad (plan 39 Phase 6, decision 18). The
 *  scratch pad folds into THIS queue's baseStock as the `{ kind: "scratch" }` container
 *  (queueResolver.scratchInventory) and ranks like any container, but is queue-local: never surfaced
 *  in Assets, never selectable by other queues. */
export interface ScratchItem {
	typeId: number;
	qty: number;
}

/** One job in a build order: N runs of a blueprint. Outputs = its primary output + co-products.
 *  The UI divides a target output quantity by the blueprint's PRIMARY output (ceil) to get runs.
 *
 *  `id` is a stable per-job identity (crypto.randomUUID(), minted in addJob -- plan 39 Phase 3). It is
 *  additive: the index-based store mutators (removeJob/moveJob/...) still key on the array index; the
 *  id is the override key for "Target" (authored) jobs in the Phase 4 sourcing cascade. */
export interface Job {
	id: string;
	blueprintId: number;
	runs: number;
	/** Per-job sourcing/output overrides -- Target jobs only (layer 5 of the Phase 4a cascade). */
	overrides?: JobOverrides;
}

/** Either/or recipe steering for a producible input. */
export interface RecipeLockEntry {
	typeId: number;
	prefer?: number[]; // blueprintIds to prefer (lower optimizer weight)
	exclude?: number[]; // blueprintIds to eliminate
	pin?: RecipePin; // hard exclusive/split (reuses existing type)
}

/** One order in the queue: a group of jobs built together, solved as a unit. */
export interface Order {
	id: string;
	label?: string;
	jobs: Job[];
	collapsed?: boolean;
	recipeLocks?: RecipeLockEntry[]; // optional per-order lock override; queue-global is the default
	/** Order-scope container sourcing default (Phase 4a cascade layer 3). */
	sourcesDefault?: ContainerSourceConfig;
	/** Order-scope output deposit annotation default (layer 3). */
	outputDefault?: ContainerRef;
	/** Order-scope facility availability exclusions. Undefined inherits; a defined array fully
	 *  replaces the queue default for jobs under this order. */
	facilityExclude?: string[];
	/** Order-scope per-typeId sourcing/output rules (layer 4 -- the finest grain for Derived jobs). */
	sourceLocks?: SourceLockEntry[];
	/** Per-Order build location (plan 41 B4). The distance anchor for THIS order's costed haul readout
	 *  (container -> consuming-order gate jumps); inherits the queue location when unset. Additive -- no
	 *  Dexie bump (lives in the JSON queue record), and inert in the frozen LP. */
	location?: QueueLocation;
}

/**
 * How the queue is solved:
 * - "perStep" (default / undefined) -- each order solved on its own with the outputs of earlier orders
 *   flowing forward as stock; legible, executable per-order plans that respect the build order.
 * - "global" -- the whole queue's job-input demand is collapsed into ONE solve, trading per-order
 *   legibility for cross-order optimality (a recipe choice in one order that shares a co-product needed
 *   by another). The gather/build plan is then a single queue-level summary, not attributed per order.
 *
 * NOTE: the mode values stay "perStep" / "global" (persisted strings) even though the UI now says
 * "Per-Order" / "Global" -- no migration of existing dev queues.
 */
export type ReoptMode = "perStep" | "global";

/** A saved, ordered build queue. The type NAME stays `BuildQueue` (the Dexie `buildQueues` index keys
 *  on id/name/updatedAt). Its ordered units are `batches` (Queue / Order / Job -- plan 39). */
export interface BuildQueue {
	id: string;
	name: string;
	description?: string;
	batches: Order[];
	recipeLocks: RecipeLockEntry[];
	/** Queue-scope container sourcing default (Phase 4a cascade layer 1). Optional -- no Dexie bump. */
	sourcesDefault?: ContainerSourceConfig;
	/** Queue-scope output deposit annotation default (layer 1). */
	outputDefault?: ContainerRef;
	/** Queue-scope facility availability exclusions. Undefined means no queue default; a defined array is
	 *  the complete default exclude list inherited by orders/jobs until they replace it. */
	facilityExclude?: string[];
	/** Queue-scope per-typeId sourcing/output rules (layer 2). */
	sourceLocks?: SourceLockEntry[];
	/** Queue location (plan 39 Phase 5). Containers are distance-sorted against it; the output
	 *  destination is the only per-job "where". Optional -- no Dexie bump (lives in the record). */
	location?: QueueLocation;
	/** Queue-local scratch pad (plan 39 Phase 6, decision 18) -- speculative stock folded into this
	 *  queue's baseStock as the `{ kind: "scratch" }` container. Never surfaced in Assets, never
	 *  selectable by other queues. Optional -- no Dexie bump (lives in the record). */
	scratch?: ScratchItem[];
	/** Re-optimization mode (undefined = "perStep"; see ReoptMode). Optional -- no Dexie bump needed. */
	reoptMode?: ReoptMode;
	/**
	 * Default ON. OFF means held raws are used only when the default recipe already needs them.
	 * Optional -- no Dexie bump needed.
	 */
	preferStock?: boolean;
	createdAt: number;
	updatedAt: number;
}

/** Factory -- returns a minimal empty BuildQueue with a new random id and the given name. */
export function createBuildQueue(name: string): BuildQueue {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		name,
		batches: [],
		recipeLocks: [],
		createdAt: now,
		updatedAt: now,
	};
}
