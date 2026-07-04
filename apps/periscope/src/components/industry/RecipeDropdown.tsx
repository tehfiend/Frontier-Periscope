import { ItemIcon } from "@/components/ItemIcon";
import type { Blueprint } from "@/lib/bomTypes";
import { ChevronDown, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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

/** The facility an item will actually run at: the explicit pick (if valid for this recipe), else the
 *  first non-excluded facility, else the first facility (shown unavailable). */
export function resolveEffectiveFacility(
	facilities: string[],
	excluded: Set<string>,
	pick: string | undefined,
): string | undefined {
	if (facilities.length === 0) return undefined;
	if (pick && facilities.includes(pick)) return pick;
	return facilities.find((f) => !excluded.has(f)) ?? facilities[0];
}

/** Closed-control label: "<facility> · <inputs>" -- shows both the recipe (its inputs) and facility. */
export function facilityRecipeLabel(bp: Blueprint, facility: string | undefined): string {
	const inputs = bp.inputs.map((i) => i.typeName).join(", ");
	const fac = facility ?? `BP #${bp.blueprintID}`;
	return inputs ? `${fac} · ${inputs}` : fac;
}

/**
 * Compact recipe label: the facility name followed by the recipe's input ICONS (no names) -- the
 * shortened form of `facilityRecipeLabel` for the build-tree Source cell. The caller keeps the full
 * "<facility> · <input names>" text as the element's hover title.
 */
export function RecipeIconLabel({
	bp,
	facility,
	size = 14,
}: {
	bp: Blueprint;
	facility: string | undefined;
	size?: number;
}) {
	const fac = facility ?? `BP #${bp.blueprintID}`;
	return (
		<span className="inline-flex min-w-0 items-center gap-1">
			<span className="shrink-0">{bp.inputs.length > 0 ? `${fac} ·` : fac}</span>
			{bp.inputs.length > 0 && (
				<span className="inline-flex shrink-0 items-center gap-0.5">
					{bp.inputs.map((input) => (
						<ItemIcon key={input.typeID} typeId={input.typeID} size={size} />
					))}
				</span>
			)}
		</span>
	);
}

// ── Recipe dropdown (shows recipe + facility closed, full combos in dropdown) ────

export interface RecipeDropdownProps {
	typeId: number;
	producers: Blueprint[];
	currentBpId: number | undefined;
	isOverridden: boolean;
	onSelect: (blueprintId: number, facility: string | undefined) => void;
	formatOptionLabel: (bp: Blueprint, typeId: number) => string;
	getFacilityLabel: (bp: Blueprint) => string;
	blueprintFacilities: Map<number, string[]>;
	excludedFacilities?: string[];
	pick?: string;
	onResetFacility?: () => void;
	/** When provided, shows a "Split..." option in the dropdown. */
	onSplitRequest?: () => void;
	/** Raw-leaf mode: the "gather directly" default label (e.g. "Source: Char Ores"). When set, the
	 *  dropdown gains a top "Gather directly" option and the closed control shows this while gathering. */
	gatherLabel?: string;
	/** True when currently gathering (no reprocess pin) -- closed control shows gatherLabel. */
	gathering?: boolean;
	/** Reset to gathering (clear the reprocess pin). Required for the gather option to appear. */
	onGather?: () => void;
}

function recipeRank(bp: Blueprint, typeId: number) {
	const outputQty = bp.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
	const totalInputQty = bp.inputs.reduce((sum, i) => sum + i.quantity, 0);
	const efficiency = totalInputQty / outputQty;
	const soleOutput = bp.outputs.length === 1 && bp.outputs[0].typeID === typeId;
	const maxOutputQty = Math.max(...bp.outputs.map((o) => o.quantity));
	const maxOutputCount = bp.outputs.filter((o) => o.quantity === maxOutputQty).length;
	const uniqueLargestOutput = outputQty === maxOutputQty && maxOutputCount === 1;
	return { efficiency, soleOutput, uniqueLargestOutput };
}

function facilityOptionLabel(bp: Blueprint, typeId: number, facility: string | undefined): string {
	const outputQty = bp.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
	const totalInputQty = bp.inputs.reduce((s, i) => s + i.quantity, 0);
	const rawEff = totalInputQty / outputQty;
	const eff = rawEff < 1 ? rawEff.toPrecision(2) : rawEff.toFixed(1);
	return `${facilityRecipeLabel(bp, facility)} · eff ${eff}`;
}

interface RecipeOption {
	bp: Blueprint;
	facility: string | undefined;
	excluded: boolean;
	rank: ReturnType<typeof recipeRank>;
}

export function RecipeDropdown({
	typeId,
	producers,
	currentBpId,
	isOverridden,
	onSelect,
	formatOptionLabel,
	blueprintFacilities,
	excludedFacilities,
	pick,
	onResetFacility,
	onSplitRequest,
	gatherLabel,
	gathering,
	onGather,
}: RecipeDropdownProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const excludedSet = useMemo(() => new Set(excludedFacilities ?? []), [excludedFacilities]);
	const options = useMemo(() => {
		const next: RecipeOption[] = [];
		for (const bp of producers) {
			const facilities = blueprintFacilities.get(bp.blueprintID) ?? [];
			const rank = recipeRank(bp, typeId);
			if (facilities.length === 0) {
				next.push({ bp, facility: undefined, excluded: false, rank });
				continue;
			}
			for (const facility of facilities) {
				next.push({
					bp,
					facility,
					excluded: excludedSet.has(facility),
					rank,
				});
			}
		}
		return next.sort((a, b) => {
			if (a.rank.soleOutput !== b.rank.soleOutput) return a.rank.soleOutput ? -1 : 1;
			if (a.rank.uniqueLargestOutput !== b.rank.uniqueLargestOutput) {
				return a.rank.uniqueLargestOutput ? -1 : 1;
			}
			if (a.rank.efficiency !== b.rank.efficiency) {
				return a.rank.efficiency - b.rank.efficiency;
			}
			if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
			const facilityCompare = (a.facility ?? "").localeCompare(b.facility ?? "");
			if (facilityCompare !== 0) return facilityCompare;
			return a.bp.blueprintID - b.bp.blueprintID;
		});
	}, [producers, typeId, blueprintFacilities, excludedSet]);
	const currentBp =
		options.find((option) => option.bp.blueprintID === currentBpId)?.bp ?? options[0]?.bp;
	const currentBpFacilities = currentBp
		? (blueprintFacilities.get(currentBp.blueprintID) ?? [])
		: [];
	const effectiveFacility = resolveEffectiveFacility(currentBpFacilities, excludedSet, pick);
	const selectedBpId = currentBpId ?? currentBp?.blueprintID;
	const configured = pick !== undefined || isOverridden;

	useEffect(() => {
		if (!open) return;
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	if (!currentBp) return null;

	const isGathering = gathering === true && gatherLabel !== undefined;
	const closedLabel = isGathering
		? (gatherLabel as string)
		: facilityRecipeLabel(currentBp, effectiveFacility);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				title={closedLabel}
				className={`flex items-center gap-1 truncate rounded border px-1.5 py-0.5 text-xs focus:border-violet-600 focus:outline-none ${
					configured
						? "border-cyan-600/50 bg-zinc-900 text-cyan-300"
						: "border-zinc-700 bg-zinc-900 text-zinc-400"
				}`}
			>
				{isGathering ? (
					<span className="truncate">{closedLabel}</span>
				) : (
					<RecipeIconLabel bp={currentBp} facility={effectiveFacility} />
				)}
				<ChevronDown size={10} className="shrink-0 text-zinc-600" />
			</button>
			{open && (
				<div className="absolute left-0 top-full z-20 mt-1 min-w-[320px] rounded border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
					{onGather && gatherLabel !== undefined && (
						<>
							<button
								type="button"
								onClick={() => {
									onGather();
									setOpen(false);
								}}
								className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
									isGathering ? "text-cyan-300" : "text-zinc-400"
								}`}
							>
								<span className="w-3 shrink-0 text-cyan-400">{isGathering ? "●" : ""}</span>
								<span className="min-w-0 flex-1 truncate">{gatherLabel} (gather directly)</span>
							</button>
							<div className="mx-2 my-1 border-t border-zinc-800" />
						</>
					)}
					{pick !== undefined && onResetFacility && (
						<>
							<button
								type="button"
								onClick={() => {
									onResetFacility();
									setOpen(false);
								}}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-800 hover:text-amber-300"
							>
								<RotateCcw size={10} />
								<span>Reset to order default</span>
							</button>
							<div className="mx-2 my-1 border-t border-zinc-800" />
						</>
					)}
					{options.map((option) => {
						const isSelected =
							!isGathering &&
							option.bp.blueprintID === selectedBpId &&
							option.facility === effectiveFacility;
						const label =
							option.facility === undefined
								? formatOptionLabel(option.bp, typeId)
								: facilityOptionLabel(option.bp, typeId, option.facility);
						return (
							<button
								key={`${option.bp.blueprintID}:${option.facility ?? "no-facility"}`}
								type="button"
								onClick={() => {
									onSelect(option.bp.blueprintID, option.facility);
									setOpen(false);
								}}
								className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
									isSelected
										? "text-cyan-300"
										: option.excluded
											? "text-red-300/70"
											: "text-zinc-400"
								}`}
							>
								<span className="w-3 shrink-0 text-cyan-400">{isSelected ? "●" : ""}</span>
								<span className="flex shrink-0 items-center gap-0.5">
									{option.bp.inputs.map((input) => (
										<ItemIcon key={input.typeID} typeId={input.typeID} size={16} />
									))}
								</span>
								<span
									className={`min-w-0 flex-1 truncate ${
										option.excluded ? "line-through decoration-red-400/70" : ""
									}`}
									title={label}
								>
									{label}
								</span>
								{option.excluded && (
									<span className="ml-auto shrink-0 text-[10px] text-red-300/80">excluded</span>
								)}
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
