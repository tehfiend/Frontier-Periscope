import { useSyncExternalStore } from "react";
import {
	subscribe,
	getSnapshot,
	enqueueTask,
	cancelTask,
	clearFinishedTasks,
	removeTask,
	type TaskContext,
} from "@/lib/taskWorker";

/**
 * React hook to observe and manage background tasks.
 */
export function useTaskWorker() {
	const tasks = useSyncExternalStore(subscribe, getSnapshot);

	return {
		tasks,
		enqueue: enqueueTask,
		cancel: cancelTask,
		clearFinished: clearFinishedTasks,
		remove: removeTask,
		/** Number of active (queued + running) tasks */
		activeCount: tasks.filter((t) => t.status === "queued" || t.status === "running").length,
	};
}

export type { TaskContext };
