// Build Queue persistence store -- plan 36 (industry-build-queue).
//
// CRUD + mutation helpers over the db.buildQueues Dexie table, plus reactive read hooks.
// Every write bumps queue.updatedAt and persists via an immutable update: we read the queue,
// produce a brand-new steps/jobs structure, then db.buildQueues.put(...) -- never mutate in place.
// The active queue id is persisted in the settings table (key "activeBuildQueueId") so the
// selection survives reloads, matching the appStore pattern for activeCharacterId / defaultMapId.

import { db } from "@/db";
import {
	type BuildJob,
	type BuildQueue,
	type BuildStep,
	type RecipeLockEntry,
	type ReoptMode,
	createBuildQueue,
} from "@/lib/buildQueueTypes";
import type { SourcePref } from "@/lib/sourcePrefs";
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
 * Concatenate two job lists, summing runs for matching blueprintIds so a step never holds two
 * entries for the same blueprint (the one-entry-per-blueprint invariant addJob also upholds).
 * Returns a fresh array of fresh job objects.
 */
function combineJobs(base: BuildJob[], extra: BuildJob[]): BuildJob[] {
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
 * the source does not exist. Nested steps/jobs/locks are cloned so the copy is independent.
 */
export async function duplicateQueue(id: string): Promise<BuildQueue | undefined> {
	const source = await db.buildQueues.get(id);
	if (!source) return undefined;
	const now = Date.now();
	const copy: BuildQueue = {
		...source,
		id: crypto.randomUUID(),
		name: `${source.name} (copy)`,
		steps: source.steps.map((step) => ({
			...step,
			jobs: step.jobs.map((job) => ({ ...job })),
			recipeLocks: step.recipeLocks?.map((lock) => ({ ...lock })),
		})),
		sourcePrefs: { ...source.sourcePrefs },
		recipeLocks: source.recipeLocks.map((lock) => ({ ...lock })),
		stockFromQueueIds: source.stockFromQueueIds ? [...source.stockFromQueueIds] : undefined,
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

// ── Step mutations ─────────────────────────────────────────────────────────────

/** Append a new empty step. Returns the new step id. */
export async function addStep(queueId: string, label?: string): Promise<string> {
	const stepId = crypto.randomUUID();
	const step: BuildStep = { id: stepId, jobs: [] };
	if (label !== undefined) step.label = label;
	await updateQueue(queueId, (q) => ({ ...q, steps: [...q.steps, step] }));
	return stepId;
}

/** Remove a step (and its jobs) from the queue. */
export async function removeStep(queueId: string, stepId: string): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		steps: q.steps.filter((s) => s.id !== stepId),
	}));
}

/** Move a step from fromIndex to toIndex, clamping toIndex into range. */
export async function reorderSteps(
	queueId: string,
	fromIndex: number,
	toIndex: number,
): Promise<void> {
	await updateQueue(queueId, (q) => {
		if (fromIndex < 0 || fromIndex >= q.steps.length) return q;
		const steps = [...q.steps];
		const [moved] = steps.splice(fromIndex, 1);
		const target = Math.max(0, Math.min(toIndex, steps.length));
		steps.splice(target, 0, moved);
		return { ...q, steps };
	});
}

/**
 * Merge step B's jobs into step A (A keeps its position), then drop step B. Duplicate
 * blueprintIds across the two steps have their runs summed. No-op if either step is missing
 * or the two ids are identical.
 */
export async function mergeSteps(
	queueId: string,
	stepIdA: string,
	stepIdB: string,
): Promise<void> {
	if (stepIdA === stepIdB) return;
	await updateQueue(queueId, (q) => {
		const a = q.steps.find((s) => s.id === stepIdA);
		const b = q.steps.find((s) => s.id === stepIdB);
		if (!a || !b) return q;
		const mergedJobs = combineJobs(a.jobs, b.jobs);
		const steps = q.steps
			.filter((s) => s.id !== stepIdB)
			.map((s) => (s.id === stepIdA ? { ...s, jobs: mergedJobs } : s));
		return { ...q, steps };
	});
}

/**
 * Split a step at jobIndex: jobs[0..jobIndex] (inclusive) stay in the original step, the rest
 * move into a new step inserted immediately after. Returns the new step id. No-op (returns a
 * generated id that is not persisted) if the step is missing or there is nothing to split off.
 */
export async function splitStep(
	queueId: string,
	stepId: string,
	jobIndex: number,
): Promise<string> {
	const newStepId = crypto.randomUUID();
	await updateQueue(queueId, (q) => {
		const idx = q.steps.findIndex((s) => s.id === stepId);
		if (idx === -1) return q;
		const step = q.steps[idx];
		const keep = step.jobs.slice(0, jobIndex + 1).map((job) => ({ ...job }));
		const moved = step.jobs.slice(jobIndex + 1).map((job) => ({ ...job }));
		if (moved.length === 0) return q;
		const newStep: BuildStep = { id: newStepId, jobs: moved };
		const steps = [...q.steps];
		steps[idx] = { ...step, jobs: keep };
		steps.splice(idx + 1, 0, newStep);
		return { ...q, steps };
	});
	return newStepId;
}

/** Set a step's display label. */
export async function setStepLabel(
	queueId: string,
	stepId: string,
	label: string,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		steps: q.steps.map((s) => (s.id === stepId ? { ...s, label } : s)),
	}));
}

/** Set a step's collapsed (UI) flag. */
export async function setStepCollapsed(
	queueId: string,
	stepId: string,
	collapsed: boolean,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		steps: q.steps.map((s) => (s.id === stepId ? { ...s, collapsed } : s)),
	}));
}

// ── Job mutations ──────────────────────────────────────────────────────────────

/**
 * Add a job to a step. If the step already holds a job for the same blueprintId, its runs are
 * incremented by job.runs instead of inserting a duplicate.
 */
export async function addJob(queueId: string, stepId: string, job: BuildJob): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		steps: q.steps.map((s) => {
			if (s.id !== stepId) return s;
			const existing = s.jobs.find((j) => j.blueprintId === job.blueprintId);
			if (existing) {
				return {
					...s,
					jobs: s.jobs.map((j) =>
						j.blueprintId === job.blueprintId ? { ...j, runs: j.runs + job.runs } : j,
					),
				};
			}
			return { ...s, jobs: [...s.jobs, { ...job }] };
		}),
	}));
}

/** Remove the job at jobIndex from a step. */
export async function removeJob(
	queueId: string,
	stepId: string,
	jobIndex: number,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		steps: q.steps.map((s) =>
			s.id === stepId ? { ...s, jobs: s.jobs.filter((_, i) => i !== jobIndex) } : s,
		),
	}));
}

/**
 * Move a job between (or within) steps -- the grouping primitive. Within the same step this
 * reorders to toIndex. Across steps the job is removed from fromStep and inserted into toStep
 * at toIndex (appended when toIndex is omitted); if toStep already holds that blueprintId its
 * runs are incremented instead of inserting a duplicate. No-op if any referenced item is missing.
 */
export async function moveJob(
	queueId: string,
	fromStepId: string,
	jobIndex: number,
	toStepId: string,
	toIndex?: number,
): Promise<void> {
	await updateQueue(queueId, (q) => {
		const fromStep = q.steps.find((s) => s.id === fromStepId);
		if (!fromStep) return q;
		const job = fromStep.jobs[jobIndex];
		if (!job) return q;

		// Same step: reorder within the step.
		if (fromStepId === toStepId) {
			const jobs = [...fromStep.jobs];
			const [moved] = jobs.splice(jobIndex, 1);
			const target = toIndex == null ? jobs.length : Math.max(0, Math.min(toIndex, jobs.length));
			jobs.splice(target, 0, moved);
			return {
				...q,
				steps: q.steps.map((s) => (s.id === fromStepId ? { ...s, jobs } : s)),
			};
		}

		// Cross-step move: bail if the destination is gone so the job is never lost.
		if (!q.steps.some((s) => s.id === toStepId)) return q;
		return {
			...q,
			steps: q.steps.map((s) => {
				if (s.id === fromStepId) {
					return { ...s, jobs: s.jobs.filter((_, i) => i !== jobIndex) };
				}
				if (s.id === toStepId) {
					const existing = s.jobs.find((j) => j.blueprintId === job.blueprintId);
					if (existing) {
						return {
							...s,
							jobs: s.jobs.map((j) =>
								j.blueprintId === job.blueprintId ? { ...j, runs: j.runs + job.runs } : j,
							),
						};
					}
					const jobs = [...s.jobs];
					const target =
						toIndex == null ? jobs.length : Math.max(0, Math.min(toIndex, jobs.length));
					jobs.splice(target, 0, { ...job });
					return { ...s, jobs };
				}
				return s;
			}),
		};
	});
}

/**
 * Change a job's top-level blueprint while keeping its position and run count. If another job in
 * the same step already uses the target blueprintId, this job's runs are folded into that entry
 * and this one is removed (upholding the one-entry-per-blueprint invariant addJob also enforces).
 * No-op when the blueprint is unchanged or the job/step is missing.
 */
export async function setJobBlueprint(
	queueId: string,
	stepId: string,
	jobIndex: number,
	blueprintId: number,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		steps: q.steps.map((s) => {
			if (s.id !== stepId) return s;
			const current = s.jobs[jobIndex];
			if (!current || current.blueprintId === blueprintId) return s;
			const dupIndex = s.jobs.findIndex((j, i) => i !== jobIndex && j.blueprintId === blueprintId);
			if (dupIndex !== -1) {
				// Target blueprint already present -- fold runs in and drop this entry (keep position
				// of the surviving entry).
				const jobs = s.jobs
					.map((j, i) => (i === dupIndex ? { ...j, runs: j.runs + current.runs } : { ...j }))
					.filter((_, i) => i !== jobIndex);
				return { ...s, jobs };
			}
			// Swap the blueprint in place -- position and runs are preserved.
			return {
				...s,
				jobs: s.jobs.map((j, i) => (i === jobIndex ? { ...j, blueprintId } : j)),
			};
		}),
	}));
}

/** Set a job's run count, clamped to a positive integer (minimum 1). */
export async function setJobRuns(
	queueId: string,
	stepId: string,
	jobIndex: number,
	runs: number,
): Promise<void> {
	const safeRuns = Math.max(1, Math.floor(runs));
	await updateQueue(queueId, (q) => ({
		...q,
		steps: q.steps.map((s) =>
			s.id === stepId
				? { ...s, jobs: s.jobs.map((j, i) => (i === jobIndex ? { ...j, runs: safeRuns } : j)) }
				: s,
		),
	}));
}

// ── Steering: source preferences + recipe locks ─────────────────────────────

/** Set the source preference for a raw-material source group on this queue. */
export async function setSourcePref(
	queueId: string,
	group: string,
	pref: SourcePref,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		sourcePrefs: { ...q.sourcePrefs, [group]: pref },
	}));
}

/** Clear every source preference on this queue (back to the per-group defaults). */
export async function resetSourcePrefs(queueId: string): Promise<void> {
	await updateQueue(queueId, (q) => ({ ...q, sourcePrefs: {} }));
}

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

// ── Per-step recipe locks (F2) ───────────────────────────────────────────────
// The resolver's mergeLocks merges a step's recipeLocks OVER the queue-global recipeLocks per typeId
// (a step entry fully replaces the queue entry for that type). These mirror the queue-global
// setRecipeLock / clearRecipeLock above, scoped to one step.

/**
 * Upsert a per-step recipe lock by typeId (replaces any existing entry for the same typeId on that
 * step). No-op if the step is missing.
 */
export async function setStepRecipeLock(
	queueId: string,
	stepId: string,
	entry: RecipeLockEntry,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		steps: q.steps.map((s) => {
			if (s.id !== stepId) return s;
			const locks = s.recipeLocks ?? [];
			const exists = locks.some((lock) => lock.typeId === entry.typeId);
			const recipeLocks = exists
				? locks.map((lock) => (lock.typeId === entry.typeId ? { ...entry } : lock))
				: [...locks, { ...entry }];
			return { ...s, recipeLocks };
		}),
	}));
}

/** Remove the per-step recipe lock for a given typeId on a step, if present. No-op if step missing. */
export async function clearStepRecipeLock(
	queueId: string,
	stepId: string,
	typeId: number,
): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		steps: q.steps.map((s) =>
			s.id === stepId
				? { ...s, recipeLocks: (s.recipeLocks ?? []).filter((lock) => lock.typeId !== typeId) }
				: s,
		),
	}));
}

// ── Re-optimization mode (F3) ────────────────────────────────────────────────

/**
 * Set the queue's re-optimization mode. "global" collapses the whole queue into ONE solve
 * (cross-step optimality, a single queue-level gather/build plan); "perStep" (the default) keeps the
 * per-step pipeline. See ReoptMode / resolveQueue.
 */
export async function setReoptMode(queueId: string, mode: ReoptMode): Promise<void> {
	await updateQueue(queueId, (q) => ({ ...q, reoptMode: mode }));
}

// ── Cross-queue stock sources (F4) ───────────────────────────────────────────
// Ids of other saved queues whose resolved outputs (totals.finalPool) count as available stock for
// this queue. The view resolves those source queues and merges their finalPool into baseStock (via
// queueResolver.mergeStockMaps) before calling resolveQueue -- the store only persists the id list.

/** Replace the full set of cross-queue stock source ids (deduped). */
export async function setStockSources(queueId: string, ids: string[]): Promise<void> {
	await updateQueue(queueId, (q) => ({ ...q, stockFromQueueIds: [...new Set(ids)] }));
}

/** Add one cross-queue stock source id (deduped; no-op if already present). */
export async function addStockSource(queueId: string, sourceQueueId: string): Promise<void> {
	await updateQueue(queueId, (q) => {
		const ids = new Set(q.stockFromQueueIds ?? []);
		ids.add(sourceQueueId);
		return { ...q, stockFromQueueIds: [...ids] };
	});
}

/** Remove one cross-queue stock source id, if present. */
export async function removeStockSource(queueId: string, sourceQueueId: string): Promise<void> {
	await updateQueue(queueId, (q) => ({
		...q,
		stockFromQueueIds: (q.stockFromQueueIds ?? []).filter((id) => id !== sourceQueueId),
	}));
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
