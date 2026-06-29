// Source-preference model. Cycle 6 offers many ways to source the same input, so each
// raw-material source GROUP (Comet Ores, Salvage, Rogue Drone Components, ...) can be
// excluded or weighted to steer which raws the optimizer draws on.
//
// Extracted from IndustryCalculator.tsx so the Build Queue view, the queue resolver, and the
// shared source-prefs panel can all reference one canonical model. See plan 36.

export type SourcePref = "exclude" | "avoid" | "normal" | "prefer";

export const SOURCE_PREFS: SourcePref[] = ["exclude", "avoid", "normal", "prefer"];

// "avoid" must outweigh the efficiency edge that multi-output salvage recipes have over the
// dedicated single-output route. At weight 5 the optimizer still chose salvage reprocessing for
// e.g. Reinforced Alloys (10 salvage -> 6 RA + co-products beats the ore route on raw count);
// 50 reliably flips it to ore while still using salvage when a recipe has no alternative.
export const SOURCE_PREF_WEIGHT: Record<"avoid" | "normal" | "prefer", number> = {
	prefer: 0.25,
	normal: 1,
	avoid: 50,
};

export const SOURCE_PREF_LABEL: Record<SourcePref, string> = {
	exclude: "Exclude",
	avoid: "Avoid",
	normal: "Normal",
	prefer: "Prefer",
};

export const LS_SOURCE_PREFS_KEY = "bom-source-prefs";

// Salvage is looted, not mined -- excluded by default (still usable if you hold stock).
export const SALVAGE_SOURCE_GROUP = "Salvage";

export function defaultSourcePref(group: string): SourcePref {
	return group === SALVAGE_SOURCE_GROUP ? "exclude" : "normal";
}
