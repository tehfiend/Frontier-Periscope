import { useTaskWorker } from "@/hooks/useTaskWorker";
import {
	Cog,
	Loader2,
	CheckCircle2,
	XCircle,
	Ban,
	Clock,
	Trash2,
	X,
} from "lucide-react";
import type { BackgroundTask, TaskStatus } from "@/lib/taskWorker";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const secs = Math.floor(ms / 1000);
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	const remainSecs = secs % 60;
	if (mins < 60) return `${mins}m ${remainSecs}s`;
	const hours = Math.floor(mins / 60);
	return `${hours}h ${mins % 60}m`;
}

const STATUS_CONFIG: Record<TaskStatus, { icon: typeof Loader2; color: string; label: string }> = {
	queued: { icon: Clock, color: "text-zinc-500", label: "Queued" },
	running: { icon: Loader2, color: "text-cyan-400", label: "Running" },
	completed: { icon: CheckCircle2, color: "text-green-400", label: "Completed" },
	failed: { icon: XCircle, color: "text-red-400", label: "Failed" },
	cancelled: { icon: Ban, color: "text-amber-400", label: "Cancelled" },
};

// ── Component ───────────────────────────────────────────────────────────────

export function Workers() {
	const { tasks, cancel, clearFinished, remove, activeCount } = useTaskWorker();

	const hasFinished = tasks.some(
		(t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled",
	);

	return (
		<div className="mx-auto max-w-3xl p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<Cog size={24} className="text-zinc-400" />
						Workers
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{activeCount > 0
							? `${activeCount} task${activeCount !== 1 ? "s" : ""} running`
							: "No active tasks"}
						{tasks.length > activeCount && ` · ${tasks.length - activeCount} finished`}
					</p>
				</div>
				{hasFinished && (
					<button
						type="button"
						onClick={clearFinished}
						className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					>
						<Trash2 size={14} />
						Clear Finished
					</button>
				)}
			</div>

			{/* Task List */}
			{tasks.length === 0 ? (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
					<Cog size={48} className="mx-auto mb-4 text-zinc-800" />
					<p className="text-sm text-zinc-600">
						No background tasks. Operations like "Discover" will appear here.
					</p>
				</div>
			) : (
				<div className="space-y-2">
					{tasks.map((task) => (
						<TaskCard key={task.id} task={task} onCancel={cancel} onRemove={remove} />
					))}
				</div>
			)}
		</div>
	);
}

function TaskCard({
	task,
	onCancel,
	onRemove,
}: {
	task: BackgroundTask;
	onCancel: (id: string) => void;
	onRemove: (id: string) => void;
}) {
	const config = STATUS_CONFIG[task.status];
	const Icon = config.icon;
	const isActive = task.status === "queued" || task.status === "running";
	const isRunning = task.status === "running";

	const progressPct =
		task.itemsTotal && task.itemsTotal > 0
			? Math.round((task.itemsProcessed / task.itemsTotal) * 100)
			: null;

	return (
		<div
			className={`rounded-lg border p-4 ${
				isRunning
					? "border-cyan-900/50 bg-cyan-950/10"
					: task.status === "failed"
						? "border-red-900/50 bg-red-950/10"
						: "border-zinc-800 bg-zinc-900/50"
			}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex items-start gap-3">
					<Icon
						size={18}
						className={`mt-0.5 shrink-0 ${config.color} ${isRunning ? "animate-spin" : ""}`}
					/>
					<div>
						<p className="text-sm font-medium text-zinc-200">{task.name}</p>
						<div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
							<span className={config.color}>{config.label}</span>
							{task.durationMs > 0 && (
								<span className="text-zinc-600">
									{formatDuration(task.durationMs)}
								</span>
							)}
							{task.itemsProcessed > 0 && (
								<span className="text-zinc-500">
									{task.itemsProcessed.toLocaleString()}
									{task.itemsTotal ? ` / ${task.itemsTotal.toLocaleString()}` : ""} items
								</span>
							)}
						</div>
						{task.progress && (
							<p className="mt-1 text-xs text-zinc-500">{task.progress}</p>
						)}
						{task.error && (
							<p className="mt-1 text-xs text-red-400">{task.error}</p>
						)}
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-1">
					{isActive && (
						<button
							type="button"
							onClick={() => onCancel(task.id)}
							className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
							title="Cancel"
						>
							<X size={14} />
						</button>
					)}
					{!isActive && (
						<button
							type="button"
							onClick={() => onRemove(task.id)}
							className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400"
							title="Remove"
						>
							<Trash2 size={14} />
						</button>
					)}
				</div>
			</div>

			{/* Progress bar */}
			{isRunning && progressPct !== null && (
				<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
					<div
						className="h-full rounded-full bg-cyan-500 transition-all"
						style={{ width: `${progressPct}%` }}
					/>
				</div>
			)}
		</div>
	);
}
