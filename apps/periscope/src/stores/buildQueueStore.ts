// Build Queue persistence store -- plan 36 (industry-build-queue); Queue / Batch / Job (plan 39).
//
// CRUD + mutation helpers over the db.buildQueues Dexie table, plus reactive read hooks.
// Every write bumps queue.updatedAt and persists via an immutable update: we read the queue,
// produce a brand-new batches/jobs structure, then db.buildQueues.put(...) -- never mutate in place.
// The active queue id is persisted in the settings table (key "activeBuildQueueId") so the
// selection survives reloads, matching the appStore pattern for activeCharacterId / defaultMapId.

import { db } from "@/db";
import {
	type Batch,
	type BuildQueue,
	type ContainerRef,
	type ContainerSourceConfig,
	type Job,
	type JobOverrides,
	type QueueLocation,
	type RecipeLockEntry,
	type ReoptMode,
	type ScratchItem,
	type SourceLockEntry,
	createBuildQueue,
} from "@/lib/buildQueueTypes";
import { useLiveQuery } from "dexie-react-hooks";

// ── Settings key for the persisted active-queue selection ────────────────────
const ACTIVE_QUEUE_KEY = "activeBuildQueueId";

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Load a queue, apply an immutable producer that returns a new BuildQueue, then persist it
 * with a refreshed updatedAt. No-op if the queue does not exist. The producer must NOT mutate
 * its argument -- it returns a new object with replaced arrays.
 */
async function updateQueue(
	queueId: string,
	produce: (queue: BuildQueue) => BuildQueue,
): Promise<void> {
	const queue = await db.buildQueues.get(queueId);
	if (!queue) return;
	const next = produce(queue);
	await db.buildQueues.put({ ...next, updatedAt: Date.now() });
}

/**
 * Concatenate two job lists, summing runs for matching blueprintIds so a batch never holds two
 * entries for the same blueprint (the one-entry-per-blueprint invariant addJob also upholds).
 * Returns a fresh array of fresh job objects. Folded jobs keep the SURVIVING job's id; moved jobs
 * keep their own id (so a Target job's stable identity follows it across batches -- plan 39 Phase 3).
 */
function combineJobs(base: Job[], extra: Job[]): Job[] {
	const result = base.map((job) => ({ ...job }));
	for (const job of extra) {
		const existing = result.find((j) => j.blueprintId === job.blueprintId);
		if (existing) {
			existing.runs += job.runs;
		} else {
			result.push({ ...job });
		}
	}
	return result;
}

// ── Queue-level mutations ──────────────────────────────────────────────────────

/** Create a new empty queue and persist it. Returns the created queue (caller gets its id). */
export async function createQueue(name: string): Promise<BuildQueue> {
	const queue = createBuildQueue(name);
	await db.buildQueues.put(queue);
	return queue;
}

/** Rename a queue. */
export async function renameQueue(id: string, name: string): Promise<void> {
	await updateQueue(id, (q) => ({ ...q, name }));
}

/** Set (or clear) a queue's free-text description. */
export async function setQueueDescription(id: string, desc: string): Promise<void> {
	await updateQueue(id, (q) => ({ ...q, description: desc }));
}

/**
 * Deep-copy a queue under a new id with a " (copy)" suffix. Returns the copy, or undefined if
 * the source does not exist. Nested batches/jobs/locks are cloned so the copy is independent. Job
 * ids are carried over (the copy lives in a new queue, so reusing ids is harmless and keeps any
 * future per-job overrides aligned with the copied jobs).
 */
export async function duplicateQueue(id: string): Promise<BuildQueue | undefined> {
	const source = await db.buildQueues.get(id);
	if (!source) return undefined;
	const now = Date.now();
	const copy: BuildQueue = {
		...source,
		id: crypto.randomUUID(),
		name: `${source.name} (copy)`,
		batches: source.batches.map((batch) => ({
			...batch,
			facilityExclude: batch.facilityExclude ? [...batch.facilityExclude] : undefined,
			jobs: batch.jobs.map((job) => ({
				...job,
				overrides: job.overrides
					? {
							...job.overrides,
							facilityExclude: job.overrides.facilityExclude
								? [...job.overrides.facilityExclude]
								: undefined,
						}
					: undefined,
			})),
			recipeLocks: batch.recipeLocks?.map((lock) => ({ ...lock })),
		})),
		recipeLocks: source.recipeLocks.map((lock) => ({ ...lock })),
		facilityExclude: source.facilityExclude ? [...source.facilityExclude] : undefined,
		scratch: source.scratch ? source.scratch.map((s) => ({ ...s })) : undefined,
		createdAt: now,
		updatedAt: now,
	};
	await db.buildQueues.put(copy);
	return copy;
}

/** Delete a queue. Clears the active-queue selection if it pointed at this queue. */
export async function deleteQueue(id: string): Promise<void> {
	await db.buildQueues.delete(id);
	const activeId = await getActiveQueueId();
	if (activeId === id) {
		await setActiveQueue(null);
	}
}

// ── Active-queue selection (persisted in settings) ───────────────────────────

/** Persist the active queue id, or clear the selection when passed null/undefined. */
export async function setActiveQueue(id: string | null): Promise<void> {
	if (id) {
		await db.settings.put({ key: ACTIVE_QUEUE_KEY, value: id });
	} else {
		await db.settings.delete(ACTIVE_QUEUE_KEY);
	}
}

/** Read the persisted active queue id (non-reactive). Undefined if none is selected. */
export async function getActiveQueueId(): Promise<string | undefined> {
	const setting = await db.settings.get(ACTIVE_QUEUE_KEY);
	return (setting?.value as string | undefined) ?? undefined;
}

// ── Batch mutations ──────────────────────────────────────────────────────────

/** Append a new empty batch. Returns the new batch id. */
export async function addBatch(queueId: string, label?: string): Promise<string> {
	const batchId = crypto.randomUUID();
	const batch: Batch = { id: batchId, jobs: [] };
	if (label !== undefined) batch.label = label;
	await updateQueue(queueId, (q) => ({ ...q, batches: [...q.batches, batch] }));
	return batchId;
}

/** Remove a batch (and its jobs) from the queue. */
export async function removeBatch(queueId: string, batchId: string): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.filter((b) => b.id !== batchId),
	}));
}

/** Move a batch from fromIndex to toIndex, clamping toIndex into range. */
export async function reorderBatches(
	queueId: string,
	fromIndex: number,
	toIndex: number,
): Promise<void> {
	await updateQueue(queueId, (q) => {
		if (fromIndex < 0 || fromIndex >= q.batches.length) return q;
		const batches = [...q.batches];
		const [moved] = batches.splice(fromIndex, 1);
		const target = Math.max(0, Math.min(toIndex, batches.length));
		batches.splice(target, 0, moved);
		return { ...q, batches };
	});
}

/**
 * Merge batch B's jobs into batch A (A keeps its position), then drop batch B. Duplicate
 * blueprintIds across the two batches have their runs summed. No-op if either batch is missing
 * or the two ids are identical.
 */
export async function mergeBatches(
	queueId: string,
	batchIdA: string,
	batchIdB: string,
): Promise<void> {
	if (batchIdA === batchIdB) return;
	await updateQueue(queueId, (q) => {
		const a = q.batches.find((b) => b.id === batchIdA);
		const b = q.batches.find((b) => b.id === batchIdB);
		if (!a || !b) return q;
		const mergedJobs = combineJobs(a.jobs, b.jobs);
		const batches = q.batches
			.filter((b) => b.id !== batchIdB)
			.map((b) => (b.id === batchIdA ? { ...b, jobs: mergedJobs } : b));
		return { ...q, batches };
	});
}

/**
 * Split a batch at jobIndex: jobs[0..jobIndex] (inclusive) stay in the original batch, the rest
 * move into a new batch inserted immediately after. Returns the new batch id. No-op (returns a
 * generated id that is not persisted) if the batch is missing or there is nothing to split off.
 */
export async function splitBatch(
	queueId: string,
	batchId: string,
	jobIndex: number,
): Promise<string> {
	const newBatchId = crypto.randomUUID();
	await updateQueue(queueId, (q) => {
		const idx = q.batches.findIndex((b) => b.id === batchId);
		if (idx === -1) return q;
		const batch = q.batches[idx];
		const keep = batch.jobs.slice(0, jobIndex + 1).map((job) => ({ ...job }));
		const moved = batch.jobs.slice(jobIndex + 1).map((job) => ({ ...job }));
		if (moved.length === 0) return q;
		const newBatch: Batch = { id: newBatchId, jobs: moved };
		const batches = [...q.batches];
		batches[idx] = { ...batch, jobs: keep };
		batches.splice(idx + 1, 0, newBatch);
		return { ...q, batches };
	});
	return newBatchId;
}

/** Set a batch's display label. */
export async function setBatchLabel(
	queueId: string,
	batchId: string,
	label: string,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) => (b.id === batchId ? { ...b, label } : b)),
	}));
}

/** Set a batch's collapsed (UI) flag. */
export async function setBatchCollapsed(
	queueId: string,
	batchId: string,
	collapsed: boolean,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) => (b.id === batchId ? { ...b, collapsed } : b)),
	}));
}

/**
 * Set (or clear, when undefined) a batch's location (plan 41 B4). Overrides the queue location as the
 * distance anchor for THIS batch's haul readout; clearing it falls back to the queue location. No-op if
 * the batch is missing.
 */
export async function setBatchLocation(
	queueId: string,
	batchId: string,
	location: QueueLocation | undefined,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) => (b.id === batchId ? { ...b, location } : b)),
	}));
}

// ── Job mutations ──────────────────────────────────────────────────────────────
// Jobs are identified by ARRAY INDEX in every mutator below (removeJob / moveJob / setJobBlueprint /
// setJobRuns). The stable `Job.id` (minted in addJob) is additive -- it is the override key for
// "Target" jobs in the Phase 4 sourcing cascade, not the mutation key.

/**
 * Add a job to a batch. The new job gets a fresh stable `id` (crypto.randomUUID()). If the batch
 * already holds a job for the same blueprintId, its runs are incremented by job.runs instead of
 * inserting a duplicate (the existing entry keeps its id).
 */
export async function addJob(
	queueId: string,
	batchId: string,
	job: Omit<Job, "id">,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) => {
			if (b.id !== batchId) return b;
			const existing = b.jobs.find((j) => j.blueprintId === job.blueprintId);
			if (existing) {
				return {
					...b,
					jobs: b.jobs.map((j) =>
						j.blueprintId === job.blueprintId ? { ...j, runs: j.runs + job.runs } : j,
					),
				};
			}
			return { ...b, jobs: [...b.jobs, { ...job, id: crypto.randomUUID() }] };
		}),
	}));
}

/** Remove the job at jobIndex from a batch. */
export async function removeJob(queueId: string, batchId: string, jobIndex: number): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) =>
			b.id === batchId ? { ...b, jobs: b.jobs.filter((_, i) => i !== jobIndex) } : b,
		),
	}));
}

/**
 * Move a job between (or within) batches -- the grouping primitive. Within the same batch this
 * reorders to toIndex. Across batches the job is removed from fromBatch and inserted into toBatch
 * at toIndex (appended when toIndex is omitted), carrying its id so a Target job's identity follows
 * it; if toBatch already holds that blueprintId its runs are incremented instead of inserting a
 * duplicate. No-op if any referenced item is missing.
 */
export async function moveJob(
	queueId: string,
	fromBatchId: string,
	jobIndex: number,
	toBatchId: string,
	toIndex?: number,
): Promise<void> {
	await updateQueue(queueId, (q) => {
		const fromBatch = q.batches.find((b) => b.id === fromBatchId);
		if (!fromBatch) return q;
		const job = fromBatch.jobs[jobIndex];
		if (!job) return q;

		// Same batch: reorder within the batch.
		if (fromBatchId === toBatchId) {
			const jobs = [...fromBatch.jobs];
			const [moved] = jobs.splice(jobIndex, 1);
			const target = toIndex == null ? jobs.length : Math.max(0, Math.min(toIndex, jobs.length));
			jobs.splice(target, 0, moved);
			return {
				...q,
				batches: q.batches.map((b) => (b.id === fromBatchId ? { ...b, jobs } : b)),
			};
		}

		// Cross-batch move: bail if the destination is gone so the job is never lost.
		if (!q.batches.some((b) => b.id === toBatchId)) return q;
		return {
			...q,
			batches: q.batches.map((b) => {
				if (b.id === fromBatchId) {
					return { ...b, jobs: b.jobs.filter((_, i) => i !== jobIndex) };
				}
				if (b.id === toBatchId) {
					const existing = b.jobs.find((j) => j.blueprintId === job.blueprintId);
					if (existing) {
						return {
							...b,
							jobs: b.jobs.map((j) =>
								j.blueprintId === job.blueprintId ? { ...j, runs: j.runs + job.runs } : j,
							),
						};
					}
					const jobs = [...b.jobs];
					const target =
						toIndex == null ? jobs.length : Math.max(0, Math.min(toIndex, jobs.length));
					jobs.splice(target, 0, { ...job });
					return { ...b, jobs };
				}
				return b;
			}),
		};
	});
}

/**
 * Change a job's top-level blueprint while keeping its position and run count. If another job in
 * the same batch already uses the target blueprintId, this job's runs are folded into that entry
 * and this one is removed (upholding the one-entry-per-blueprint invariant addJob also enforces).
 * No-op when the blueprint is unchanged or the job/batch is missing.
 */
export async function setJobBlueprint(
	queueId: string,
	batchId: string,
	jobIndex: number,
	blueprintId: number,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) => {
			if (b.id !== batchId) return b;
			const current = b.jobs[jobIndex];
			if (!current || current.blueprintId === blueprintId) return b;
			const dupIndex = b.jobs.findIndex((j, i) => i !== jobIndex && j.blueprintId === blueprintId);
			if (dupIndex !== -1) {
				// Target blueprint already present -- fold runs in and drop this entry (keep position
				// of the surviving entry).
				const jobs = b.jobs
					.map((j, i) => (i === dupIndex ? { ...j, runs: j.runs + current.runs } : { ...j }))
					.filter((_, i) => i !== jobIndex);
				return { ...b, jobs };
			}
			// Swap the blueprint in place -- position and runs are preserved.
			return {
				...b,
				jobs: b.jobs.map((j, i) => (i === jobIndex ? { ...j, blueprintId } : j)),
			};
		}),
	}));
}

/** Set a job's run count, clamped to a positive integer (minimum 1). */
export async function setJobRuns(
	queueId: string,
	batchId: string,
	jobIndex: number,
	runs: number,
): Promise<void> {
	const safeRuns = Math.max(1, Math.floor(runs));
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) =>
			b.id === batchId
				? { ...b, jobs: b.jobs.map((j, i) => (i === jobIndex ? { ...j, runs: safeRuns } : j)) }
				: b,
		),
	}));
}

// ── Steering: recipe locks ───────────────────────────────────────────────────

/** Upsert a recipe lock by typeId (replaces any existing entry for the same typeId). */
export async function setRecipeLock(queueId: string, entry: RecipeLockEntry): Promise<void> {
	await updateQueue(queueId, (q) => {
		const exists = q.recipeLocks.some((lock) => lock.typeId === entry.typeId);
		const recipeLocks = exists
			? q.recipeLocks.map((lock) => (lock.typeId === entry.typeId ? { ...entry } : lock))
			: [...q.recipeLocks, { ...entry }];
		return { ...q, recipeLocks };
	});
}

/** Remove the recipe lock for a given typeId, if present. */
export async function clearRecipeLock(queueId: string, typeId: number): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		recipeLocks: q.recipeLocks.filter((lock) => lock.typeId !== typeId),
	}));
}

// ── Per-batch recipe locks (F2) ──────────────────────────────────────────────
// The resolver's mergeLocks merges a batch's recipeLocks OVER the queue-global recipeLocks per typeId
// (a batch entry fully replaces the queue entry for that type). These mirror the queue-global
// setRecipeLock / clearRecipeLock above, scoped to one batch.

/**
 * Upsert a per-batch recipe lock by typeId (replaces any existing entry for the same typeId on that
 * batch). No-op if the batch is missing.
 */
export async function setBatchRecipeLock(
	queueId: string,
	batchId: string,
	entry: RecipeLockEntry,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) => {
			if (b.id !== batchId) return b;
			const locks = b.recipeLocks ?? [];
			const exists = locks.some((lock) => lock.typeId === entry.typeId);
			const recipeLocks = exists
				? locks.map((lock) => (lock.typeId === entry.typeId ? { ...entry } : lock))
				: [...locks, { ...entry }];
			return { ...b, recipeLocks };
		}),
	}));
}

/** Remove the per-batch recipe lock for a given typeId on a batch, if present. No-op if batch missing. */
export async function clearBatchRecipeLock(
	queueId: string,
	batchId: string,
	typeId: number,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) =>
			b.id === batchId
				? { ...b, recipeLocks: (b.recipeLocks ?? []).filter((lock) => lock.typeId !== typeId) }
				: b,
		),
	}));
}

// ── Re-optimization mode (F3) ────────────────────────────────────────────────

/**
 * Set the queue's re-optimization mode. "global" collapses the whole queue into ONE solve
 * (cross-batch optimality, a single queue-level gather/build plan); "perStep" (the default) keeps the
 * per-batch pipeline. See ReoptMode / resolveQueue.
 */
export async function setReoptMode(queueId: string, mode: ReoptMode): Promise<void> {
	await updateQueue(queueId, (q) => ({ ...q, reoptMode: mode }));
}

/** Set whether held raw stock should drive stock-derived split pins. */
export async function setPreferStock(queueId: string, value: boolean): Promise<void> {
	await updateQueue(queueId, (q) => ({ ...q, preferStock: value }));
}

// ── Queue location (plan 39 Phase 5) ─────────────────────────────────────────
// One structured location per queue (decision 10). Containers are distance-sorted against
// location.systemId (gate-jump count via lib/distance); the output destination is the only per-job
// "where". Passing `undefined` clears the location.

/** Set (or clear, when undefined) the queue's location. */
export async function setQueueLocation(
	queueId: string,
	location: QueueLocation | undefined,
): Promise<void> {
	await updateQueue(queueId, (q) => ({ ...q, location }));
}

// ── Container sourcing overrides (plan 39 Phase 4a) ──────────────────────────
// A NEW cascade, independent of recipeLocks: queue/batch `sourcesDefault` + `outputDefault` +
// per-typeId `sourceLocks`, plus per-job `overrides` (Target jobs). queueResolver.resolveEffectiveOverrides
// composes the five scopes last-wins / scope-dominant. The sourceLock upsert/clear mirror the recipe-lock
// helpers (one entry per typeId). Passing `undefined` to a default setter clears that default.

/** Set (or clear, when undefined) the queue-wide container sourcing default (cascade layer 1). */
export async function setQueueSourcesDefault(
	queueId: string,
	config: ContainerSourceConfig | undefined,
): Promise<void> {
	await updateQueue(queueId, (q) => ({ ...q, sourcesDefault: config }));
}

/** Set (or clear, when undefined) the queue-wide output deposit annotation (layer 1). */
export async function setQueueOutputDefault(
	queueId: string,
	ref: ContainerRef | undefined,
): Promise<void> {
	await updateQueue(queueId, (q) => ({ ...q, outputDefault: ref }));
}

/** Set (or clear) the queue-wide facility exclusion default. */
export async function setQueueFacilityExclude(
	queueId: string,
	facilityExclude: string[] | undefined,
): Promise<void> {
	await updateQueue(queueId, (q) => ({ ...q, facilityExclude }));
}

/** Upsert a queue-wide per-typeId source lock by typeId (replaces any existing entry; layer 2). */
export async function setQueueSourceLock(queueId: string, entry: SourceLockEntry): Promise<void> {
	await updateQueue(queueId, (q) => {
		const locks = q.sourceLocks ?? [];
		const exists = locks.some((l) => l.typeId === entry.typeId);
		const sourceLocks = exists
			? locks.map((l) => (l.typeId === entry.typeId ? { ...entry } : l))
			: [...locks, { ...entry }];
		return { ...q, sourceLocks };
	});
}

/** Remove the queue-wide source lock for a given typeId, if present. */
export async function clearQueueSourceLock(queueId: string, typeId: number): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		sourceLocks: (q.sourceLocks ?? []).filter((l) => l.typeId !== typeId),
	}));
}

/** Set (or clear) a batch's container sourcing default (layer 3). No-op if the batch is missing. */
export async function setBatchSourcesDefault(
	queueId: string,
	batchId: string,
	config: ContainerSourceConfig | undefined,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) => (b.id === batchId ? { ...b, sourcesDefault: config } : b)),
	}));
}

/** Set (or clear) a batch's output deposit annotation (layer 3). No-op if the batch is missing. */
export async function setBatchOutputDefault(
	queueId: string,
	batchId: string,
	ref: ContainerRef | undefined,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) => (b.id === batchId ? { ...b, outputDefault: ref } : b)),
	}));
}

/** Set (or clear) a batch's facility exclusion default. No-op if the batch is missing. */
export async function setBatchFacilityExclude(
	queueId: string,
	batchId: string,
	facilityExclude: string[] | undefined,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) => (b.id === batchId ? { ...b, facilityExclude } : b)),
	}));
}

/** Upsert a per-batch source lock by typeId (layer 4). No-op if the batch is missing. */
export async function setBatchSourceLock(
	queueId: string,
	batchId: string,
	entry: SourceLockEntry,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) => {
			if (b.id !== batchId) return b;
			const locks = b.sourceLocks ?? [];
			const exists = locks.some((l) => l.typeId === entry.typeId);
			const sourceLocks = exists
				? locks.map((l) => (l.typeId === entry.typeId ? { ...entry } : l))
				: [...locks, { ...entry }];
			return { ...b, sourceLocks };
		}),
	}));
}

/** Remove a per-batch source lock for a typeId, if present. No-op if the batch is missing. */
export async function clearBatchSourceLock(
	queueId: string,
	batchId: string,
	typeId: number,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) =>
			b.id === batchId
				? { ...b, sourceLocks: (b.sourceLocks ?? []).filter((l) => l.typeId !== typeId) }
				: b,
		),
	}));
}

/**
 * Set (or clear, when undefined) a Target job's per-job overrides (cascade layer 5). Keyed by array
 * index like the other job mutators (removeJob / setJobRuns); no-op if the batch/job is missing.
 */
export async function setJobOverrides(
	queueId: string,
	batchId: string,
	jobIndex: number,
	overrides: JobOverrides | undefined,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		batches: q.batches.map((b) =>
			b.id === batchId
				? { ...b, jobs: b.jobs.map((j, i) => (i === jobIndex ? { ...j, overrides } : j)) }
				: b,
		),
	}));
}

// ── Queue-local scratch pad (plan 39 Phase 6, decision 18) ───────────────────
// A per-queue speculative stock list folded into THIS queue's baseStock as the { kind: "scratch" }
// container (queueResolver.scratchInventory); it ranks like any container but is NEVER surfaced in
// Assets and NEVER selectable by other queues. One entry per typeId (qty summed on add / paste-merge).
// Every writer drops the field entirely when the list goes empty so an absent pad reads as undefined.

/** Replace the queue's entire scratch list (empty list clears the pad). */
export async function setScratchItems(queueId: string, items: ScratchItem[]): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		scratch: items.length > 0 ? items.map((i) => ({ ...i })) : undefined,
	}));
}

/** Add `qty` of `typeId` to the scratch pad, incrementing an existing line. No-op for qty <= 0. */
export async function addScratchItem(queueId: string, typeId: number, qty = 1): Promise<void> {
	if (qty <= 0) return;
	await updateQueue(queueId, (q) => {
		const items = q.scratch ?? [];
		const exists = items.some((i) => i.typeId === typeId);
		const scratch = exists
			? items.map((i) => (i.typeId === typeId ? { ...i, qty: i.qty + qty } : i))
			: [...items, { typeId, qty }];
		return { ...q, scratch };
	});
}

/** Set a scratch line's quantity, clamped to a non-negative integer (0 removes the line). */
export async function setScratchItemQty(
	queueId: string,
	typeId: number,
	qty: number,
): Promise<void> {
	const safe = Math.max(0, Math.floor(qty));
	await updateQueue(queueId, (q) => {
		const items = q.scratch ?? [];
		const scratch =
			safe <= 0
				? items.filter((i) => i.typeId !== typeId)
				: items.map((i) => (i.typeId === typeId ? { ...i, qty: safe } : i));
		return { ...q, scratch: scratch.length > 0 ? scratch : undefined };
	});
}

/** Remove a scratch line by typeId, if present. */
export async function removeScratchItem(queueId: string, typeId: number): Promise<void> {
	await updateQueue(queueId, (q) => {
		const scratch = (q.scratch ?? []).filter((i) => i.typeId !== typeId);
		return { ...q, scratch: scratch.length > 0 ? scratch : undefined };
	});
}

/** Merge parsed items into the scratch pad, summing quantities per typeId (paste-to-update). */
export async function mergeScratchItems(queueId: string, items: ScratchItem[]): Promise<void> {
	if (items.length === 0) return;
	await updateQueue(queueId, (q) => {
		const merged = (q.scratch ?? []).map((i) => ({ ...i }));
		for (const it of items) {
			if (it.qty <= 0) continue;
			const existing = merged.find((m) => m.typeId === it.typeId);
			if (existing) existing.qty += it.qty;
			else merged.push({ typeId: it.typeId, qty: it.qty });
		}
		return { ...q, scratch: merged.length > 0 ? merged : undefined };
	});
}

/** Clear the queue's scratch pad entirely. */
export async function clearScratch(queueId: string): Promise<void> {
	await updateQueue(queueId, (q) => ({ ...q, scratch: undefined }));
}

// ── Reactive read hooks ──────────────────────────────────────────────────────

/** All queues, sorted by updatedAt descending (most recently touched first). */
export function useBuildQueues(): BuildQueue[] {
	return useLiveQuery(() => db.buildQueues.orderBy("updatedAt").reverse().toArray()) ?? [];
}

/** The persisted active queue id (reactive), or undefined when none is selected. */
export function useActiveQueueId(): string | undefined {
	const setting = useLiveQuery(() => db.settings.get(ACTIVE_QUEUE_KEY));
	return setting?.value as string | undefined;
}

/** The active queue (reactive), or undefined if none is selected or it no longer exists. */
export function useActiveQueue(): BuildQueue | undefined {
	return useLiveQuery(async () => {
		const setting = await db.settings.get(ACTIVE_QUEUE_KEY);
		const id = setting?.value as string | undefined;
		if (!id) return undefined;
		return (await db.buildQueues.get(id)) ?? undefined;
	});
}
