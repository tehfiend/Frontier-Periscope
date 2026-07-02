import { Check, RotateCcw, Wrench, X } from "lucide-react";
import { useMemo, useState } from "react";

export function facilityNamesFromBlueprintFacilities(
	blueprintFacilities: Map<number, string[]>,
): string[] {
	const names = new Set<string>();
	for (const facilities of blueprintFacilities.values()) {
		for (const facility of facilities) names.add(facility);
	}
	return [...names].sort((a, b) => a.localeCompare(b));
}

function sortedKnownExclusions(excluded: string[] | undefined, facilityNames: string[]): string[] {
	if (!excluded) return [];
	const known = new Set(facilityNames);
	return excluded.filter((name) => known.has(name)).sort((a, b) => a.localeCompare(b));
}

function facilitySummary(excluded: string[] | undefined, facilityNames: string[]): string {
	const knownExcluded = sortedKnownExclusions(excluded, facilityNames);
	if (facilityNames.length === 0) return "no facilities";
	if (knownExcluded.length === 0) return "all available";
	const available = facilityNames.length - knownExcluded.length;
	if (available === 0) return "none available";
	if (knownExcluded.length <= 2) return `excluding ${knownExcluded.join(", ")}`;
	return `${available}/${facilityNames.length} available`;
}

interface FacilityPreferencePanelProps {
	facilityNames: string[];
	/** This scope's own exclusion list. Undefined inherits the wider scope. */
	value: string[] | undefined;
	/** The cascade-resolved exclusion list shown while this scope inherits. */
	effectiveExcluded?: string[];
	/** Persist this scope's own complete exclusion list. Undefined resets to inherit. */
	onChange: (excluded: string[] | undefined) => void;
	scopeLabel: string;
	/** Label for the wider scope this control inherits from. Omit for the queue default. */
	inheritedFromLabel?: string;
	align?: "left" | "right";
}

export function FacilityPreferencePanel({
	facilityNames,
	value,
	effectiveExcluded,
	onChange,
	scopeLabel,
	inheritedFromLabel,
	align = "right",
}: FacilityPreferencePanelProps) {
	const [open, setOpen] = useState(false);
	const canInherit = inheritedFromLabel != null;
	const configured = value !== undefined;
	const inherited = !configured && canInherit;
	const activeExcluded = useMemo(
		() => sortedKnownExclusions(value ?? effectiveExcluded, facilityNames),
		[value, effectiveExcluded, facilityNames],
	);
	const activeExcludedSet = useMemo(() => new Set(activeExcluded), [activeExcluded]);
	const effectiveSummary = facilitySummary(effectiveExcluded, facilityNames);
	const ownSummary = facilitySummary(value, facilityNames);
	const summary = configured ? ownSummary : effectiveSummary;

	if (facilityNames.length === 0) return null;

	function commit(nextExcluded: Set<string>) {
		onChange([...nextExcluded].sort((a, b) => a.localeCompare(b)));
	}

	function toggleFacility(name: string, available: boolean) {
		const next = new Set(activeExcluded);
		if (available) next.delete(name);
		else next.add(name);
		commit(next);
	}

	return (
		<div className="relative inline-block">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
					configured
						? "border-cyan-600/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
						: "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
				}`}
				title={`Set which build facilities are available for ${scopeLabel}`}
				aria-expanded={open}
			>
				<Wrench size={10} />
				Facilities: <span className={inherited ? "text-zinc-500" : ""}>{summary}</span>
				{inherited && <span className="text-zinc-600">(inherited)</span>}
			</button>

			{open && (
				<div
					className={`absolute z-20 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-xs shadow-xl ${
						align === "right" ? "right-0" : "left-0"
					}`}
				>
					<div className="mb-1 flex items-center justify-between">
						<span className="font-medium text-zinc-300">Build facilities</span>
						<div className="flex items-center gap-1">
							{configured && (
								<button
									type="button"
									onClick={() => onChange(undefined)}
									className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-zinc-500 hover:text-amber-300"
									title={canInherit ? `Reset to inherit from ${inheritedFromLabel}` : "Reset"}
								>
									<RotateCcw size={10} />
									{canInherit ? "Reset to inherit" : "Reset"}
								</button>
							)}
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
								aria-label="Close"
							>
								<X size={12} />
							</button>
						</div>
					</div>

					{inherited && (
						<div className="mb-1.5 rounded bg-zinc-800/40 px-1.5 py-1 text-[10px] text-zinc-500">
							Inherited from {inheritedFromLabel}: {effectiveSummary}
						</div>
					)}

					<button
						type="button"
						onClick={() => onChange([])}
						className={`mb-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-zinc-800/40 ${
							configured && activeExcluded.length === 0 ? "text-cyan-300" : "text-zinc-400"
						}`}
					>
						<Check size={10} />
						All available
					</button>

					<div className="border-t border-zinc-800 pt-1">
						{facilityNames.map((name) => {
							const available = !activeExcludedSet.has(name);
							return (
								<label
									key={name}
									className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-zinc-800/40"
								>
									<input
										type="checkbox"
										checked={available}
										onChange={(e) => toggleFacility(name, e.currentTarget.checked)}
										className="h-3 w-3 rounded border-zinc-700 bg-zinc-900 accent-cyan-500"
									/>
									<span
										className={`min-w-0 flex-1 truncate ${
											available ? "text-zinc-200" : "text-zinc-600 line-through"
										}`}
									>
										{name}
									</span>
								</label>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

interface FacilityAvailabilityBadgeProps {
	facilityNames: string[];
	excludedFacilities?: string[];
}

export function FacilityAvailabilityBadge({
	facilityNames,
	excludedFacilities,
}: FacilityAvailabilityBadgeProps) {
	if (facilityNames.length === 0) return null;

	const excluded = new Set(excludedFacilities ?? []);
	const excludedNames = facilityNames.filter((name) => excluded.has(name));
	const availableNames = facilityNames.filter((name) => !excluded.has(name));
	const fullyExcluded = availableNames.length === 0;
	const title = fullyExcluded
		? `No available facility -- needs ${facilityNames.join(", ")}.`
		: [
				`This build can run at: ${availableNames.join(", ")}.`,
				excludedNames.length > 0 ? `Excluded: ${excludedNames.join(", ")}.` : undefined,
			]
				.filter(Boolean)
				.join(" ");

	return (
		<span
			className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
				fullyExcluded
					? "border-red-500/40 bg-red-500/10 text-red-300"
					: "border-amber-500/30 bg-amber-500/10 text-amber-300"
			}`}
			title={title}
		>
			<Wrench size={10} />
			{fullyExcluded ? "no available facility -- needs " : "needs "}
			{facilityNames.map((name, index) => (
				<span key={name} className="inline-flex items-center gap-1">
					{index > 0 && <span>or</span>}
					<span className={excluded.has(name) ? "line-through opacity-60" : ""}>{name}</span>
				</span>
			))}
			{fullyExcluded && <span className="text-red-300/80">(excluded)</span>}
		</span>
	);
}
