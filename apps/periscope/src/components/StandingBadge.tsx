import { REGISTRY_STANDING_LABELS, displayToStanding } from "@tehfrontier/chain-shared";

/** Standing display value (-3 to +3) to Tailwind color classes. */
const STANDING_STYLES: Record<number, { text: string; bg: string }> = {
	3: { text: "text-blue-400", bg: "bg-blue-400/20" },
	2: { text: "text-blue-300", bg: "bg-blue-300/20" },
	1: { text: "text-blue-200", bg: "bg-blue-200/20" },
	0: { text: "text-zinc-100", bg: "bg-zinc-100/20" },
	"-1": { text: "text-red-200", bg: "bg-red-200/20" },
	"-2": { text: "text-red-300", bg: "bg-red-300/20" },
	"-3": { text: "text-red-400", bg: "bg-red-400/20" },
};

interface StandingBadgeProps {
	/** Display standing value (-3 to +3) */
	standing: number;
	/** Optional source label (e.g. ticker "BURQE" or "contacts") */
	source?: string;
}

/**
 * Reusable standing badge component.
 * Renders a colored pill with the standing value, label, and optional source.
 */
export function StandingBadge({ standing, source }: StandingBadgeProps) {
	const style = STANDING_STYLES[standing] ?? STANDING_STYLES[0];
	const raw = displayToStanding(standing);
	const label = REGISTRY_STANDING_LABELS.get(raw) ?? "Unknown";
	const valueStr = standing > 0 ? `+${standing}` : `${standing}`;

	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.text} ${style.bg}`}
		>
			{valueStr} {label}
			{source && <span className="opacity-60">({source})</span>}
		</span>
	);
}
