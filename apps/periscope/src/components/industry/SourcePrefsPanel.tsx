import { SourcePrefToggle } from "@/components/SourcePrefToggle";
import { type SourcePref, defaultSourcePref } from "@/lib/sourcePrefs";

// ── Sources panel (per-group Exclude/Avoid/Normal/Prefer controls) ───────────
// Renders the inner controls of the Sources section. Wrap in a CollapsibleSection at the
// call site. Shared so the Build Queue view can reuse the same source-prefs controls. D9: the
// per-group button row is the shared SourcePrefToggle ("md" size) so this no longer duplicates the
// row that RawSourceControl renders.

export interface SourcePrefsPanelProps {
	sourceGroups: Array<{ group: string; ids: number[] }>;
	sourcePrefs: Record<string, SourcePref>;
	onSetSourcePref: (group: string, pref: SourcePref) => void;
	onReset: () => void;
	/** typeID -> display name, used for the per-group sample tooltip. */
	fullNameMap: Map<number, string>;
}

export function SourcePrefsPanel({
	sourceGroups,
	sourcePrefs,
	onSetSourcePref,
	onReset,
	fullNameMap,
}: SourcePrefsPanelProps) {
	return (
		<div className="space-y-0.5 px-4 pb-3">
			<div className="flex items-start justify-between gap-3 py-1">
				<p className="text-xs text-zinc-500">
					Steer how inputs are sourced. Salvage is excluded by default (it's looted, not
					mined) but is still added automatically when a recipe has no other route. Avoid
					keeps a source out unless it's the only option; Prefer biases toward it. Setting
					everything to Normal lets the optimizer reprocess salvage, which can produce
					surplus co-products.
				</p>
				{Object.keys(sourcePrefs).length > 0 && (
					<button
						type="button"
						onClick={onReset}
						className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
					>
						Reset
					</button>
				)}
			</div>
			{sourceGroups.map(({ group, ids }) => {
				const pref = sourcePrefs[group] ?? defaultSourcePref(group);
				const sample = ids
					.slice(0, 8)
					.map((id) => fullNameMap.get(id) ?? `#${id}`)
					.join(", ");
				return (
					<div key={group} className="flex items-center justify-between gap-3 py-0.5">
						<span
							className="truncate text-xs text-zinc-300"
							title={`${ids.length} material${ids.length === 1 ? "" : "s"}: ${sample}`}
						>
							{group} <span className="text-zinc-600">({ids.length})</span>
						</span>
						<SourcePrefToggle
							pref={pref}
							onSetPref={(p) => onSetSourcePref(group, p)}
							size="md"
						/>
					</div>
				);
			})}
		</div>
	);
}
