import { CHANGELOG, type ChangelogEntry } from "@/version";
import { X } from "lucide-react";

const CATEGORY_STYLES: Record<ChangelogEntry["changes"][number]["category"], string> = {
	added: "bg-green-900/30 text-green-400",
	changed: "bg-blue-900/30 text-blue-400",
	fixed: "bg-amber-900/30 text-amber-400",
	removed: "bg-red-900/30 text-red-400",
};

interface Props {
	open: boolean;
	onClose: () => void;
	entries?: ChangelogEntry[];
}

export function ChangelogModal({ open, onClose, entries }: Props) {
	const displayEntries = entries ?? CHANGELOG;

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
			<div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl">
				{/* Header */}
				<div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-4">
					<div className="flex items-center gap-3">
						<h2 className="text-lg font-semibold text-zinc-100">Changelog</h2>
						<span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
							v{__APP_VERSION__}
						</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-zinc-500 transition-colors hover:text-zinc-300"
					>
						<X size={18} />
					</button>
				</div>

				{/* Body */}
				<div className="overflow-y-auto px-5 py-4">
					{displayEntries.length === 0 && (
						<p className="text-sm text-zinc-500">No changelog entries.</p>
					)}
					{displayEntries.map((entry) => (
						<div key={entry.version} className="mb-6 last:mb-0">
							{/* Entry header */}
							<div className="mb-2">
								<div className="flex items-center gap-2">
									<h3 className="text-sm font-semibold text-zinc-200">
										v{entry.version}
									</h3>
									<span className="text-xs text-zinc-600">{entry.date}</span>
								</div>
								{entry.highlights && (
									<p className="mt-0.5 text-xs text-zinc-500">{entry.highlights}</p>
								)}
							</div>

							{/* Changes list */}
							<ul className="space-y-1.5">
								{entry.changes.map((change, i) => (
									<li key={i} className="flex items-start gap-2 text-sm">
										<span
											className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${CATEGORY_STYLES[change.category]}`}
										>
											{change.category}
										</span>
										<span className="text-zinc-300">{change.description}</span>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
