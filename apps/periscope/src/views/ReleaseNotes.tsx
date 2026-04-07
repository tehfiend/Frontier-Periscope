import { CHANGELOG, type ChangelogEntry } from "@/version";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

const CATEGORY_STYLES: Record<ChangelogEntry["changes"][number]["category"], string> = {
	added: "bg-green-900/30 text-green-400",
	changed: "bg-blue-900/30 text-blue-400",
	fixed: "bg-amber-900/30 text-amber-400",
	removed: "bg-red-900/30 text-red-400",
};

export function ReleaseNotes() {
	const [expandedVersions, setExpandedVersions] = useState<Set<string>>(
		() => new Set(CHANGELOG.length > 0 ? [CHANGELOG[0].version] : []),
	);

	function toggleVersion(version: string) {
		setExpandedVersions((prev) => {
			const next = new Set(prev);
			if (next.has(version)) {
				next.delete(version);
			} else {
				next.add(version);
			}
			return next;
		});
	}

	return (
		<div className="mx-auto max-w-2xl p-6">
			<div className="mb-6 flex items-center gap-3">
				<h1 className="text-2xl font-bold text-zinc-100">Release Notes</h1>
				<span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
					v{__APP_VERSION__}
				</span>
			</div>

			<div className="space-y-3">
				{CHANGELOG.map((entry) => {
					const expanded = expandedVersions.has(entry.version);

					return (
						<div
							key={entry.version}
							className="rounded-lg border border-zinc-800 bg-zinc-900/50"
						>
							{/* Clickable header */}
							<button
								type="button"
								onClick={() => toggleVersion(entry.version)}
								className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/50"
							>
								{expanded ? (
									<ChevronDown size={16} className="shrink-0 text-zinc-500" />
								) : (
									<ChevronRight size={16} className="shrink-0 text-zinc-500" />
								)}
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<span className="text-sm font-semibold text-zinc-200">
											v{entry.version}
										</span>
										<span className="text-xs text-zinc-600">{entry.date}</span>
									</div>
									{entry.highlights && (
										<p className="mt-0.5 text-xs text-zinc-500">
											{entry.highlights}
										</p>
									)}
								</div>
							</button>

							{/* Expanded changes list */}
							{expanded && (
								<div className="border-t border-zinc-800 px-4 py-3">
									<ul className="space-y-1.5">
										{entry.changes.map((change, i) => (
											<li key={i} className="flex items-start gap-2 text-sm">
												<span
													className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${CATEGORY_STYLES[change.category]}`}
												>
													{change.category}
												</span>
												<span className="text-zinc-300">
													{change.description}
												</span>
											</li>
										))}
									</ul>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
