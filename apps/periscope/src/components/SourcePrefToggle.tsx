// Shared source-preference segmented toggle -- plan 36 (industry-build-queue), D9.
// One Exclude/Avoid/Normal/Prefer button row, parameterized by size. Extracted so the inline
// per-row control (RawSourceControl) and the queue-level Sources panel (SourcePrefsPanel) render
// the SAME control instead of each duplicating the button row + active-colour logic. Both write a
// SourcePref for a source group via their own onSetPref; appearance/behaviour are unchanged.

import { SOURCE_PREF_LABEL, SOURCE_PREFS, type SourcePref } from "@/lib/sourcePrefs";

/** Per-size padding/text classes. "sm" = inline gather-row control; "md" = the Sources panel. */
const SIZE_CLASS: Record<"sm" | "md", string> = {
	sm: "px-1.5 py-0.5 text-[10px]",
	md: "px-2 py-0.5 text-[11px]",
};

/** Active-state tint per preference (red = exclude, amber = avoid, emerald = prefer, zinc = normal). */
function activeClassFor(pref: SourcePref): string {
	switch (pref) {
		case "exclude":
			return "bg-red-500/20 text-red-300";
		case "avoid":
			return "bg-amber-500/20 text-amber-300";
		case "prefer":
			return "bg-emerald-500/20 text-emerald-300";
		default:
			return "bg-zinc-700 text-zinc-100";
	}
}

interface SourcePrefToggleProps {
	/** The current preference for the group (already resolved via defaultSourcePref by the caller). */
	pref: SourcePref;
	onSetPref: (pref: SourcePref) => void;
	/** "sm" for the inline gather-row control, "md" for the queue-level Sources panel. */
	size?: "sm" | "md";
}

export function SourcePrefToggle({ pref, onSetPref, size = "sm" }: SourcePrefToggleProps) {
	return (
		<div className="flex shrink-0 overflow-hidden rounded border border-zinc-700">
			{SOURCE_PREFS.map((p) => {
				const active = pref === p;
				return (
					<button
						key={p}
						type="button"
						onClick={() => onSetPref(p)}
						className={`${SIZE_CLASS[size]} transition-colors ${
							active ? activeClassFor(p) : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
						}`}
					>
						{SOURCE_PREF_LABEL[p]}
					</button>
				);
			})}
		</div>
	);
}
