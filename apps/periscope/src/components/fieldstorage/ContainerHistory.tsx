import { History } from "lucide-react";

export type TimelineTone = "add" | "remove" | "change";

export interface TimelineChange {
	key: string;
	/** Resolved item label, e.g. "Tritanium #34". */
	label: string;
	/** Signed change in quantity. */
	delta: number;
	tone: TimelineTone;
}

export interface TimelineEntry {
	id: string;
	/** Epoch ms. */
	timestamp: number;
	title: string;
	subtitle?: string;
	changes: TimelineChange[];
}

const TONE_CLASS: Record<TimelineTone, string> = {
	add: "text-teal-400",
	remove: "text-red-400",
	change: "text-amber-400",
};

function formatDelta(delta: number): string {
	return `${delta > 0 ? "+" : ""}${delta.toLocaleString()}`;
}

/**
 * Presentational history timeline shared by field storage (snapshot diffs) and on-chain
 * SSUs (Sonar deposit/withdraw events). The caller derives `TimelineEntry[]`.
 */
export function ContainerHistory({
	entries,
	emptyMessage,
}: {
	entries: TimelineEntry[];
	emptyMessage: string;
}) {
	if (entries.length === 0) {
		return (
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-6 text-center text-xs text-zinc-600">
				{emptyMessage}
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{entries.map((entry) => (
				<div key={entry.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<div className="mb-1.5 flex items-center justify-between gap-2">
						<div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
							<History size={12} className="text-zinc-500" />
							{entry.title}
							{entry.subtitle && <span className="text-zinc-600">{entry.subtitle}</span>}
						</div>
						<span className="shrink-0 text-[10px] text-zinc-600">
							{new Date(entry.timestamp).toLocaleString()}
						</span>
					</div>
					{entry.changes.length === 0 ? (
						<p className="text-[11px] text-zinc-600">No changes</p>
					) : (
						<div className="flex flex-wrap gap-x-3 gap-y-0.5">
							{entry.changes.map((change) => (
								<span key={change.key} className="text-[11px] text-zinc-400">
									{change.label}{" "}
									<span className={`font-mono font-medium ${TONE_CLASS[change.tone]}`}>
										{formatDelta(change.delta)}
									</span>
								</span>
							))}
						</div>
					)}
				</div>
			))}
		</div>
	);
}
