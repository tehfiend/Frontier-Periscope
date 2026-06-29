// Multi-facility split authoring -- plan 36 (industry-build-queue), F5.
// Lets the user distribute a producible intermediate's required quantity across its producer
// facilities, then writes a split RecipePin. Adapted from the old IntermediateTable split editor:
// per-producer number input + slider with batch-size snapping (each facility's output-per-run) and
// redistribute-on-overflow (raising one facility pulls the excess from the others). The caller
// (RecipeAlternatives) owns the store write + pin precedence -- this component is purely the draft
// editor and hands the final per-blueprint quantities back via onApply / onOnly / onClear.

import { getFacilityLabel } from "@/components/industry/RecipeDropdown";
import type { Blueprint } from "@/lib/bomTypes";
import { useState } from "react";

interface SplitEditorProps {
	/** The intermediate type being split. */
	typeId: number;
	/** Every buildable producer of this type. */
	producers: Blueprint[];
	/** Total required quantity of this intermediate (the row's Need). The slider/inputs cap at this. */
	demandQuantity: number;
	blueprintFacilities: Map<number, string[]>;
	/** Seed allocation (blueprintId -> quantity) computed by the caller from the current pin / LP splits. */
	initialDraft: Map<number, number>;
	/** Apply the current draft (caller maps it to a clear / exclusive / split pin per its precedence). */
	onApply: (entries: Array<{ blueprintId: number; quantity: number }>) => void;
	/** "Use only this recipe" shortcut -> the caller writes an exclusive pin on this blueprint. */
	onOnly: (blueprintId: number) => void;
	/** Clear any pin for this type (back to the optimizer's auto pick). */
	onClear: () => void;
	onCancel: () => void;
}

/** This blueprint's output-per-run for the given type (its batch size). Defaults to 1. */
function outQtyFor(bp: Blueprint, typeId: number): number {
	return bp.outputs.find((o) => o.typeID === typeId)?.quantity ?? 1;
}

/** Round UP to the nearest multiple of batchSize (a facility can only build whole runs). */
function snapToBatch(val: number, batchSize: number): number {
	return Math.ceil(val / batchSize) * batchSize;
}

/** Total inputs needed to build `quantity` of `typeId` on this blueprint (ceil runs * per-run inputs). */
function getTotalInputs(bp: Blueprint, typeId: number, quantity: number) {
	const outputQty = outQtyFor(bp, typeId);
	const runs = Math.ceil(quantity / outputQty);
	return bp.inputs.map((input) => ({
		typeName: input.typeName,
		total: input.quantity * runs,
	}));
}

export function SplitEditor({
	typeId,
	producers,
	demandQuantity,
	blueprintFacilities,
	initialDraft,
	onApply,
	onOnly,
	onClear,
	onCancel,
}: SplitEditorProps) {
	const [splitDraft, setSplitDraft] = useState<Map<number, number>>(() => new Map(initialDraft));

	// Raising one facility's quantity past total demand pulls the overflow back out of the OTHERS,
	// proportional to what they currently hold and snapped to each one's batch size. Mirrors the
	// reference editor so an over-allocation never silently produces surplus while you drag.
	function setQtyAndRedistribute(bp: Blueprint, newVal: number) {
		const outQty = outQtyFor(bp, typeId);
		const snapped = snapToBatch(Math.max(0, Math.min(newVal, demandQuantity)), outQty);
		const next = new Map(splitDraft);
		next.set(bp.blueprintID, snapped);

		let totalAfter = 0;
		for (const v of next.values()) totalAfter += v;
		const overflow = totalAfter - demandQuantity;

		if (overflow > 0) {
			const otherBps = producers.filter((p) => p.blueprintID !== bp.blueprintID);
			let remaining = overflow;
			let othersSum = 0;
			for (const p of otherBps) othersSum += next.get(p.blueprintID) ?? 0;
			if (othersSum > 0) {
				for (const p of otherBps) {
					if (remaining <= 0) break;
					const cur = next.get(p.blueprintID) ?? 0;
					const otherBatch = outQtyFor(p, typeId);
					const raw = cur - (cur / othersSum) * overflow;
					const reduced = snapToBatch(Math.max(0, raw), otherBatch);
					const took = cur - reduced;
					next.set(p.blueprintID, reduced);
					remaining -= took;
				}
			}
		}

		for (const [id, q] of next) {
			if (q <= 0) next.delete(id);
		}
		setSplitDraft(next);
	}

	function applyDraft() {
		const entries: Array<{ blueprintId: number; quantity: number }> = [];
		for (const [bpId, qty] of splitDraft) {
			if (qty > 0) entries.push({ blueprintId: bpId, quantity: qty });
		}
		onApply(entries);
	}

	let totalPinned = 0;
	for (const qty of splitDraft.values()) totalPinned += qty;
	const diff = totalPinned - demandQuantity;

	return (
		<div className="space-y-2 rounded border border-violet-500/30 bg-violet-500/5 p-3">
			<div className="text-sm font-medium text-zinc-200">Split production across facilities</div>
			{producers.map((bp) => {
				const facLabel = getFacilityLabel(bp, blueprintFacilities);
				const outQty = outQtyFor(bp, typeId);
				const draftQty = splitDraft.get(bp.blueprintID) ?? 0;
				const inputTotals = getTotalInputs(bp, typeId, draftQty);
				const pct = demandQuantity > 0 ? Math.round((draftQty / demandQuantity) * 100) : 0;
				return (
					<div
						key={bp.blueprintID}
						className="grid grid-cols-[5rem_12rem_1fr] gap-x-2 gap-y-0"
					>
						<input
							type="number"
							value={draftQty || ""}
							onChange={(e) => {
								const val = Math.max(0, Number.parseInt(e.target.value) || 0);
								const next = new Map(splitDraft);
								if (val > 0) next.set(bp.blueprintID, val);
								else next.delete(bp.blueprintID);
								setSplitDraft(next);
							}}
							onBlur={() => setQtyAndRedistribute(bp, draftQty)}
							placeholder="0"
							min={0}
							className="row-span-2 w-20 self-center rounded border border-zinc-700 bg-zinc-800 px-2 py-2.5 text-center font-mono text-sm text-zinc-100 focus:border-violet-600 focus:outline-none"
						/>
						<div className="flex items-center gap-1.5">
							<span className="text-sm text-zinc-200">{facLabel}</span>
							<button
								type="button"
								onClick={() => onOnly(bp.blueprintID)}
								className="text-xs text-violet-400/60 hover:text-violet-300"
								title="Use only this recipe"
							>
								only
							</button>
						</div>
						<div className="flex items-center gap-2">
							<span className="w-16 shrink-0 text-right font-mono text-xs text-zinc-500">
								{pct}% · {draftQty > 0 ? Math.ceil(draftQty / outQty) : 0}r
							</span>
							<input
								type="range"
								value={draftQty}
								onChange={(e) => setQtyAndRedistribute(bp, Number.parseInt(e.target.value) || 0)}
								min={0}
								max={demandQuantity}
								step={outQty}
								className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-violet-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400"
							/>
						</div>
						<div className="col-span-2 col-start-2 whitespace-nowrap text-xs text-zinc-500">
							{inputTotals.map((i) => `${i.total.toLocaleString()} ${i.typeName}`).join(", ")}
						</div>
					</div>
				);
			})}

			<div className="flex items-center gap-3 border-t border-zinc-800 pt-2 text-xs">
				<span className="text-zinc-400">
					Allocated: {totalPinned.toLocaleString()} / {demandQuantity.toLocaleString()}
				</span>
				{diff < 0 && (
					<span className="text-amber-400">
						Shortfall of {Math.abs(diff).toLocaleString()} -- optimizer will allocate the rest
					</span>
				)}
				{diff > 0 && (
					<span className="text-amber-400">
						Exceeds demand by {diff.toLocaleString()} -- surplus will be produced
					</span>
				)}
			</div>

			<div className="flex items-center gap-2 border-t border-zinc-800 pt-2">
				<button
					type="button"
					onClick={applyDraft}
					className="rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500"
				>
					Apply
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="rounded px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={onClear}
					className="ml-auto text-xs text-zinc-600 hover:text-zinc-400"
				>
					Clear override
				</button>
			</div>
		</div>
	);
}
