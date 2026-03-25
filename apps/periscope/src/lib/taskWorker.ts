/**
 * Background Task Worker — module-level task queue that survives React unmounts.
 *
 * Tasks run as async functions with progress callbacks. The queue persists
 * in memory (not IndexedDB) since tasks are ephemeral operations, not data.
 * React components observe state via the subscribe/getSnapshot pattern.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface BackgroundTask {
	id: string;
	name: string;
	status: TaskStatus;
	progress?: string;
	itemsProcessed: number;
	itemsTotal?: number;
	startedAt?: string;
	completedAt?: string;
	error?: string;
	/** Duration in ms (computed) */
	durationMs: number;
}

export interface TaskContext {
	/** Update progress message */
	setProgress: (msg: string) => void;
	/** Update item counts */
	setItems: (processed: number, total?: number) => void;
	/** Check if cancelled — task should poll this and exit gracefully */
	isCancelled: () => boolean;
}

type TaskFn = (ctx: TaskContext) => Promise<void>;
type Listener = () => void;

// ── Internal State ──────────────────────────────────────────────────────────

interface InternalTask extends BackgroundTask {
	fn: TaskFn;
	abortController: AbortController;
}

let tasks: InternalTask[] = [];
let listeners: Set<Listener> = new Set();
let running = false;

// ── Notify ──────────────────────────────────────────────────────────────────

let snapshotVersion = 0;

function notify() {
	snapshotVersion++;
	for (const listener of listeners) {
		listener();
	}
}

// ── Queue Management ────────────────────────────────────────────────────────

function processQueue() {
	if (running) return;

	const next = tasks.find((t) => t.status === "queued");
	if (!next) return;

	running = true;
	next.status = "running";
	next.startedAt = new Date().toISOString();
	notify();

	const ctx: TaskContext = {
		setProgress: (msg) => {
			next.progress = msg;
			next.durationMs = Date.now() - new Date(next.startedAt!).getTime();
			notify();
		},
		setItems: (processed, total) => {
			next.itemsProcessed = processed;
			if (total !== undefined) next.itemsTotal = total;
			next.durationMs = Date.now() - new Date(next.startedAt!).getTime();
			notify();
		},
		isCancelled: () => next.abortController.signal.aborted,
	};

	next.fn(ctx)
		.then(() => {
			if (next.abortController.signal.aborted) {
				next.status = "cancelled";
			} else {
				next.status = "completed";
			}
		})
		.catch((err) => {
			if (next.abortController.signal.aborted) {
				next.status = "cancelled";
			} else {
				next.status = "failed";
				next.error = err instanceof Error ? err.message : String(err);
			}
		})
		.finally(() => {
			next.completedAt = new Date().toISOString();
			next.durationMs = Date.now() - new Date(next.startedAt!).getTime();
			running = false;
			notify();
			// Process next in queue
			processQueue();
		});
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Enqueue a background task. Returns the task ID.
 */
export function enqueueTask(name: string, fn: TaskFn): string {
	const id = crypto.randomUUID();
	const task: InternalTask = {
		id,
		name,
		status: "queued",
		itemsProcessed: 0,
		durationMs: 0,
		fn,
		abortController: new AbortController(),
	};
	tasks.push(task);
	notify();
	processQueue();
	return id;
}

/**
 * Cancel a task. If running, sets the abort signal — task must check isCancelled().
 */
export function cancelTask(id: string) {
	const task = tasks.find((t) => t.id === id);
	if (!task) return;

	if (task.status === "queued") {
		task.status = "cancelled";
		task.completedAt = new Date().toISOString();
		notify();
	} else if (task.status === "running") {
		task.abortController.abort();
		// Status will be set to "cancelled" when the promise resolves
	}
}

/**
 * Remove completed/failed/cancelled tasks from the list.
 */
export function clearFinishedTasks() {
	tasks = tasks.filter((t) => t.status === "queued" || t.status === "running");
	notify();
}

/**
 * Remove a specific task (only if not running).
 */
export function removeTask(id: string) {
	const task = tasks.find((t) => t.id === id);
	if (task && task.status !== "running") {
		tasks = tasks.filter((t) => t.id !== id);
		notify();
	}
}

// ── React Integration (useSyncExternalStore) ────────────────────────────────

/**
 * Subscribe to task list changes. Returns unsubscribe function.
 * Compatible with React's useSyncExternalStore.
 */
export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * Get current snapshot of all tasks.
 * Returns a new array reference when state changes (required by useSyncExternalStore).
 */
let snapshotCache: BackgroundTask[] = [];
let lastVersion = -1;

export function getSnapshot(): BackgroundTask[] {
	if (snapshotVersion !== lastVersion) {
		snapshotCache = tasks.map((t) => ({
			id: t.id,
			name: t.name,
			status: t.status,
			progress: t.progress,
			itemsProcessed: t.itemsProcessed,
			itemsTotal: t.itemsTotal,
			startedAt: t.startedAt,
			completedAt: t.completedAt,
			error: t.error,
			durationMs: t.status === "running" && t.startedAt
				? Date.now() - new Date(t.startedAt).getTime()
				: t.durationMs,
		}));
		lastVersion = snapshotVersion;
	}
	return snapshotCache;
}


