// Queue header -- plan 36 (industry-build-queue).
// Editable queue name + description for the active queue, the F3 per-step / global re-optimization
// toggle, plus the QueueSwitcher dropdown (select, new, duplicate, delete). Rename and description
// editing live here (inline EditableText); the list/select/new/duplicate/delete actions live in
// QueueSwitcher.

import { EditableText } from "@/components/buildqueue/EditableText";
import { QueueSwitcher } from "@/components/buildqueue/QueueSwitcher";
import type { BuildQueue, ReoptMode } from "@/lib/buildQueueTypes";
import { renameQueue, setQueueDescription, setReoptMode } from "@/stores/buildQueueStore";
import { GitFork } from "lucide-react";

interface QueueHeaderProps {
	queue: BuildQueue;
	queues: BuildQueue[];
	/** Distinct producible inputs across the queue with an open either/or choice (still on auto). */
	openChoiceCount?: number;
}

/**
 * F3 -- the per-step / global re-optimization toggle. "Per-step" (default) solves each step on its
 * own with earlier outputs carried forward as stock; "Global" collapses the whole queue into one
 * solve for cross-step optimality at the cost of per-step legibility (per-step recipe locks are
 * ignored and the per-step material breakdown is replaced by a single queue-level plan).
 */
function ReoptModeToggle({ queueId, mode }: { queueId: string; mode: ReoptMode }) {
	const options: Array<{ value: ReoptMode; label: string; title: string }> = [
		{
			value: "perStep",
			label: "Per-step",
			title:
				"Solve each step on its own, carrying earlier outputs forward as stock -- legible per-step plans that respect the build order.",
		},
		{
			value: "global",
			label: "Global",
			title:
				"Collapse the whole queue into one solve for cross-step optimality. Per-step recipe locks are ignored and the per-step material breakdown is replaced by a single queue-level plan.",
		},
	];
	return (
		<fieldset
			className="m-0 inline-flex min-w-0 shrink-0 overflow-hidden rounded border border-zinc-700 p-0"
			aria-label="Re-optimization mode"
		>
			{options.map((opt) => {
				const active = mode === opt.value;
				return (
					<button
						key={opt.value}
						type="button"
						onClick={() => setReoptMode(queueId, opt.value)}
						title={opt.title}
						aria-pressed={active}
						className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
							active ? "bg-violet-600/30 text-violet-200" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
						}`}
					>
						{opt.label}
					</button>
				);
			})}
		</fieldset>
	);
}

export function QueueHeader({ queue, queues, openChoiceCount = 0 }: QueueHeaderProps) {
	return (
		<div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<EditableText
							value={queue.name}
							onCommit={(name) => {
								if (name) renameQueue(queue.id, name);
							}}
							placeholder="Queue name"
							className="block min-w-0 truncate text-left text-lg font-semibold text-zinc-100 hover:text-cyan-300"
							inputClassName="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-lg font-semibold text-zinc-100 focus:border-cyan-500 focus:outline-none"
						/>
						{openChoiceCount > 0 && (
							<span
								className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300"
								title="Producible inputs with more than one recipe still on the optimizer's auto pick -- expand a step to choose"
							>
								<GitFork size={11} />
								{openChoiceCount} choice{openChoiceCount === 1 ? "" : "s"}
							</span>
						)}
					</div>
					<EditableText
						value={queue.description ?? ""}
						onCommit={(desc) => setQueueDescription(queue.id, desc)}
						placeholder="Describe this build queue..."
						emptyLabel="Add a description..."
						multiline
						className="mt-1 block text-left text-xs text-zinc-400 hover:text-zinc-200"
						inputClassName="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
					/>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<ReoptModeToggle queueId={queue.id} mode={queue.reoptMode ?? "perStep"} />
					<QueueSwitcher queue={queue} queues={queues} />
				</div>
			</div>
		</div>
	);
}
