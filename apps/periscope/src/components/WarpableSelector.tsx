import { db } from "@/db";
import type { Celestial } from "@/db/types";
import { PLANET_TYPE_NAMES, SUN_TYPE_NAME, ensureCelestialsLoaded } from "@/lib/celestials";
import { type SystemWarpables, loadSystemWarpables } from "@/lib/systemWarpables";
import { ChevronDown, Navigation, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface WarpableSelectorProps {
	value: string;
	onChange: (warpable: string) => void;
	/**
	 * Fired when the value should be persisted -- on blur and on picking a suggestion. Consumers that
	 * write to a store on every keystroke would be wasteful; they can hold `value` in local state via
	 * `onChange` and persist here instead. Omit when `onChange` already persists.
	 */
	onCommit?: (warpable: string) => void;
	/**
	 * When set, the dropdown offers this system's warpables (star + planets from the star-map data)
	 * as quick picks. When null, the field is free-text only.
	 */
	systemId: number | null;
	placeholder?: string;
	/** Compact mode reduces padding for inline/order rows. */
	compact?: boolean;
}

/** Label a celestial as an in-system warpable, e.g. "Planet 2 (Gas)". */
function celestialLabel(c: Celestial): string {
	const type = PLANET_TYPE_NAMES[c.typeId];
	return `Planet ${c.index}${type ? ` (${type})` : ""}`;
}

/**
 * Universal "closest warpable" selector: an editable combobox. The text is always free-form (so any
 * gate, structure, or custom landmark can be entered), but once a system is chosen the dropdown lists
 * that system's warpables (its star and planets) from the star-map data for one-click selection.
 * Used by every closest-warpable field -- field storage, build-queue locations, and structures.
 */
export function WarpableSelector({
	value,
	onChange,
	onCommit,
	systemId,
	placeholder = "Closest warpable...",
	compact,
}: WarpableSelectorProps) {
	const [open, setOpen] = useState(false);
	const [celestials, setCelestials] = useState<Celestial[]>([]);
	const [warpExtras, setWarpExtras] = useState<SystemWarpables | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	// Load the selected system's celestials (planets) plus its moon/stargate extras.
	useEffect(() => {
		if (systemId == null) {
			setCelestials([]);
			setWarpExtras(null);
			return;
		}
		let active = true;
		ensureCelestialsLoaded().then(async () => {
			const rows = await db.celestials.where("systemId").equals(systemId).sortBy("index");
			if (active) setCelestials(rows);
		});
		loadSystemWarpables().then((data) => {
			if (active) setWarpExtras(data[String(systemId)] ?? {});
		});
		return () => {
			active = false;
		};
	}, [systemId]);

	useEffect(() => {
		if (!open) return;
		function onDoc(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", onDoc);
		return () => document.removeEventListener("mousedown", onDoc);
	}, [open]);

	// Warpable quick-picks: the star, then each planet followed by its moons and five Lagrange
	// points, then the system's stargates. Filtered by whatever is already typed.
	const options = useMemo(() => {
		if (systemId == null) return [];
		const all: string[] = [SUN_TYPE_NAME];
		const moons = warpExtras?.m ?? {};
		for (const c of celestials) {
			all.push(celestialLabel(c));
			const moonCount = moons[String(c.index)] ?? 0;
			for (let m = 1; m <= moonCount; m++) all.push(`Planet ${c.index} - Moon ${m}`);
			for (let l = 1; l <= 5; l++) all.push(`Planet ${c.index} - L${l}`);
		}
		for (const g of warpExtras?.g ?? []) all.push(`Stargate (${g})`);
		const q = value.trim().toLowerCase();
		return q ? all.filter((o) => o.toLowerCase().includes(q)) : all;
	}, [systemId, celestials, warpExtras, value]);

	function pick(label: string) {
		onChange(label);
		onCommit?.(label);
		setOpen(false);
	}

	const py = compact ? "py-1.5" : "py-2";
	const textSize = compact ? "text-xs" : "text-sm";

	return (
		<div ref={ref} className="relative">
			<div
				className={`flex w-full items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 pl-3 pr-1.5 ${py} ${textSize} focus-within:border-cyan-500`}
			>
				<Navigation size={13} className="shrink-0 text-cyan-500" />
				<input
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onBlur={() => onCommit?.(value)}
					onFocus={() => systemId != null && setOpen(true)}
					placeholder={placeholder}
					className="min-w-0 flex-1 bg-transparent text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
				/>
				{value && (
					<button
						type="button"
						onClick={() => {
							onChange("");
							onCommit?.("");
						}}
						aria-label="Clear warpable"
						className="shrink-0 text-zinc-500 hover:text-zinc-200"
					>
						<X size={13} />
					</button>
				)}
				{systemId != null && (
					<button
						type="button"
						onClick={() => setOpen((o) => !o)}
						aria-label="Show warpables"
						className="shrink-0 text-zinc-600 hover:text-zinc-300"
					>
						<ChevronDown size={13} />
					</button>
				)}
			</div>

			{open && systemId != null && (
				<div className="absolute left-0 top-full z-30 mt-1 max-h-60 w-full min-w-[14rem] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
					{options.length > 0 ? (
						options.map((o) => (
							<button
								key={o}
								type="button"
								onMouseDown={(e) => {
									// Keep focus so the input's blur-commit doesn't fire with a stale value.
									e.preventDefault();
									pick(o);
								}}
								className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
									o === value ? "text-cyan-300" : "text-zinc-300"
								}`}
							>
								<Navigation size={11} className="shrink-0 text-cyan-500/70" />
								<span className="truncate">{o}</span>
							</button>
						))
					) : (
						<p className="px-3 py-2 text-xs text-zinc-600">
							{celestials.length === 0
								? "No warpables in the star-map data for this system."
								: "No match -- keep typing to enter a custom warpable."}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
