// Queue header -- plan 36 (industry-build-queue).
// Editable queue name + description for the active queue, the prefer-stock toggle, plus the
// QueueSwitcher dropdown (select, new, duplicate, delete). Rename and description editing live here
// (inline EditableText); the list/select/new/duplicate/delete actions live in QueueSwitcher.

import { SystemPicker } from "@/components/SystemPicker";
import { EditableText } from "@/components/buildqueue/EditableText";
import { QueueSwitcher } from "@/components/buildqueue/QueueSwitcher";
import type { SolarSystem } from "@/db/types";
import type { RecentSystem } from "@/hooks/useCharacterRecentSystems";
import type { BuildQueue, QueueLocation } from "@/lib/buildQueueTypes";
import {
	renameQueue,
	setPreferStock,
	setQueueDescription,
	setQueueLocation,
} from "@/stores/buildQueueStore";
import { GitFork } from "lucide-react";

interface QueueHeaderProps {
	queue: BuildQueue;
	queues: BuildQueue[];
	/** Distinct producible inputs across the queue showing a changeable deterministic default. */
	openChoiceCount?: number;
	/** Solar systems for the location picker (plan 39 Phase 5). */
	systems: SolarSystem[];
	/** Recently visited systems for the active character -- the location picker's quick-select list. */
	recentSystems: RecentSystem[];
}

/**
 * Queue location (plan 39 Phase 5, decisions 10/11). One structured location per queue: the system is
 * the distance anchor (containers are gate-jump sorted against it), with optional free-text warpable +
 * note. Setting a system creates the location; clearing it removes the whole location. The SystemPicker
 * dropdown lists recently visited systems for one-click selection.
 */
function QueueLocationRow({
	queue,
	systems,
	recentSystems,
}: {
	queue: BuildQueue;
	systems: SolarSystem[];
	recentSystems: RecentSystem[];
}) {
	const loc = queue.location;
	const setLoc = (next: QueueLocation | undefined) => setQueueLocation(queue.id, next);
	return (
		<div className="mt-3 border-t border-zinc-800 pt-3">
			<div className="flex items-center gap-2">
				<span className="shrink-0 text-xs font-medium text-zinc-500">Location</span>
				<div className="min-w-0 max-w-xs flex-1">
					<SystemPicker
						value={loc?.systemId ?? null}
						onChange={(id) =>
							setLoc(
								id == null ? undefined : { systemId: id, warpable: loc?.warpable, note: loc?.note },
							)
						}
						systems={systems}
						recent={recentSystems}
						placeholder="Set location for container distance..."
						compact
					/>
				</div>
				{loc?.systemId != null && (
					<span className="text-[11px] text-zinc-600">
						containers are sorted by distance from here
					</span>
				)}
			</div>
			{loc?.systemId != null && (
				<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
					<span className="flex items-center gap-1">
						<span className="text-zinc-600">warp:</span>
						<EditableText
							value={loc.warpable ?? ""}
							onCommit={(w) => setLoc({ ...loc, warpable: w || undefined })}
							placeholder="Closest warpable"
							emptyLabel="add warpable..."
							className="text-left text-zinc-400 hover:text-zinc-200"
							inputClassName="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
						/>
					</span>
					<span className="flex items-center gap-1">
						<span className="text-zinc-600">note:</span>
						<EditableText
							value={loc.note ?? ""}
							onCommit={(n) => setLoc({ ...loc, note: n || undefined })}
							placeholder="Free-text note"
							emptyLabel="add note..."
							className="text-left text-zinc-400 hover:text-zinc-200"
							inputClassName="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
						/>
					</span>
				</div>
			)}
		</div>
	);
}

function PreferStockToggle({ queueId, value }: { queueId: string; value: boolean }) {
	return (
		<button
			type="button"
			onClick={() => setPreferStock(queueId, !value)}
			aria-pressed={value}
			title="Use held raw stock through stock-derived recipe splits when it can cover part of a material"
			className={`inline-flex shrink-0 items-center gap-2 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${
				value
					? "border-cyan-600/50 bg-cyan-500/10 text-cyan-200"
					: "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
			}`}
		>
			<span
				className={`h-2 w-2 rounded-full ${value ? "bg-cyan-300" : "bg-zinc-600"}`}
				aria-hidden="true"
			/>
			Always prefer stock
		</button>
	);
}

export function QueueHeader({
	queue,
	queues,
	openChoiceCount = 0,
	systems,
	recentSystems,
}: QueueHeaderProps) {
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
								title="Producible inputs with more than one recipe are showing the deterministic default -- click a build-path row to change"
							>
								<GitFork size={11} />
								{openChoiceCount} default{openChoiceCount === 1 ? "" : "s"}
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
					<PreferStockToggle queueId={queue.id} value={queue.preferStock ?? true} />
					<QueueSwitcher queue={queue} queues={queues} />
				</div>
			</div>
			<QueueLocationRow queue={queue} systems={systems} recentSystems={recentSystems} />
		</div>
	);
}
