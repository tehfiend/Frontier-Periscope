// Compact per-row source-preference control -- plan 36 (industry-build-queue), Phase 7 / D9.
// A small Exclude/Avoid/Normal/Prefer toggle for a single raw-material source group, styled to match
// the group-level SourcePrefsPanel. The group-level panel (queue Sources section) remains the
// canonical multi-group control; this is the inline shortcut on a gather row. Both write to the same
// queue.sourcePrefs via setSourcePref, so a change here steers the WHOLE group across every step.
// D9: the button row itself now lives in the shared SourcePrefToggle so this and SourcePrefsPanel no
// longer duplicate it -- this stays a thin "sm"-sized wrapper to preserve the existing call site/API.

import { SourcePrefToggle } from "@/components/SourcePrefToggle";
import type { SourcePref } from "@/lib/sourcePrefs";

interface RawSourceControlProps {
	/** The current preference for the group (already resolved via defaultSourcePref by the caller). */
	pref: SourcePref;
	onSetPref: (pref: SourcePref) => void;
}

export function RawSourceControl({ pref, onSetPref }: RawSourceControlProps) {
	return <SourcePrefToggle pref={pref} onSetPref={onSetPref} size="sm" />;
}
