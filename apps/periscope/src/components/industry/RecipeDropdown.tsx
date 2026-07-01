import type { Blueprint } from "@/lib/bomTypes";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ── Shared recipe label helpers ──────────────────────────────────────────────
// Pure helpers shared by the production and intermediate tables. Both bind these to their
// blueprintFacilities map and pass the result as the formatOptionLabel/getFacilityLabel props.

/** Short facility label for a blueprint -- its first published facility, or a BP-id fallback. */
export function getFacilityLabel(
	bp: Blueprint,
	blueprintFacilities: Map<number, string[]>,
): string {
	const facs = blueprintFacilities.get(bp.blueprintID) ?? [];
	return facs.length > 0 ? facs[0] : `BP #${bp.blueprintID}`;
}

/** Full recipe option label: "<facility> · <inputs> · eff <ratio>" shown in the dropdown. */
export function formatOptionLabel(
	bp: Blueprint,
	typeId: number,
	blueprintFacilities: Map<number, string[]>,
): string {
	const outputQty = bp.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
	const totalInputQty = bp.inputs.reduce((s, i) => s + i.quantity, 0);
	const rawEff = totalInputQty / outputQty;
	const eff = rawEff < 1 ? rawEff.toPrecision(2) : rawEff.toFixed(1);
	const facLabel = getFacilityLabel(bp, blueprintFacilities);
	const inputs = bp.inputs.map((i) => i.typeName).join(", ");
	return `${facLabel} · ${inputs} · eff ${eff}`;
}

// ── Recipe dropdown (shows facility name closed, full info in dropdown) ────

export interface RecipeDropdownProps {
	typeId: number;
	producers: Blueprint[];
	currentBpId: number | undefined;
	isOverridden: boolean;
	onSelect: (blueprintId: number) => void;
	formatOptionLabel: (bp: Blueprint, typeId: number) => string;
	getFacilityLabel: (bp: Blueprint) => string;
	/** When provided, shows a "Split..." option in the dropdown. */
	onSplitRequest?: () => void;
}

export function RecipeDropdown({
	typeId,
	producers,
	currentBpId,
	isOverridden,
	onSelect,
	formatOptionLabel,
	getFacilityLabel,
	onSplitRequest,
}: RecipeDropdownProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const currentBp = producers.find((p) => p.blueprintID === currentBpId) ?? producers[0];

	useEffect(() => {
		if (!open) return;
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className={`flex items-center gap-1 truncate rounded border px-1.5 py-0.5 text-xs focus:border-violet-600 focus:outline-none ${
					isOverridden
						? "border-cyan-600/50 bg-zinc-900 text-cyan-300"
						: "border-zinc-700 bg-zinc-900 text-zinc-400"
				}`}
			>
				{getFacilityLabel(currentBp)}
				<ChevronDown size={10} className="shrink-0 text-zinc-600" />
			</button>
			{open && (
				<div className="absolute left-0 top-full z-20 mt-1 min-w-[320px] rounded border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
					{producers.map((bp) => {
						const isSelected = bp.blueprintID === currentBpId;
						return (
							<button
								key={bp.blueprintID}
								type="button"
								onClick={() => {
									onSelect(bp.blueprintID);
									setOpen(false);
								}}
								className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
									isSelected ? "text-cyan-300" : "text-zinc-400"
								}`}
							>
								{isSelected && <span className="text-cyan-400">●</span>}
								<span className={isSelected ? "" : "ml-4"}>{formatOptionLabel(bp, typeId)}</span>
							</button>
						);
					})}
					{onSplitRequest && (
						<>
							<div className="mx-2 my-1 border-t border-zinc-800" />
							<button
								type="button"
								onClick={() => {
									onSplitRequest();
									setOpen(false);
								}}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-violet-400 hover:bg-zinc-800"
							>
								<span className="ml-4">Split...</span>
							</button>
						</>
					)}
				</div>
			)}
		</div>
	);
}
