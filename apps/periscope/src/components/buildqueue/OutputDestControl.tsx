// Output destination control -- plan 39 Phase 5; routing made REAL in plan 41 B1.
// A compact single-select picker for one scope's deposit destination (a ContainerRef). The chosen
// destination is now LIVE: the resolver deposits the scope's leftover outputs into this container in the
// carry-forward pool, so later orders (and later queues) source them from this named storage. Reused on
// Target job rows (writes job.overrides.outputDest), Derived intermediate rows (writes an order
// sourceLock), and the queue-level default (writes outputDefault). It edits ONLY the value it is handed;
// the Phase 4a cascade composes the scopes (queueResolver.resolveEffectiveOverrides). When this scope is
// unset, the cascade-resolved (`effective`) destination is shown greyed as an inherited hint; un-routed
// outputs fall to the reserved Unassigned bucket (Q1a). When `projected` is supplied, each container
// shows a "+N projected" badge so plan-projected deposits never read as measured snapshot stock.

import type { ContainerRef } from "@/lib/buildQueueTypes";
import { containerRefKey } from "@/lib/queueResolver";
import { type ContainerOption, formatContainerRef } from "@/lib/sourcingPlan";
import { PackageOpen, RotateCcw, X } from "lucide-react";
import { useState } from "react";

interface OutputDestControlProps {
	/** Every selectable deposit container. */
	containers: ContainerOption[];
	/** This scope's own deposit destination (undefined = inherit / none). */
	value: ContainerRef | undefined;
	/** Persist a new destination for this scope (undefined clears it back to inherited / none). */
	onChange: (ref: ContainerRef | undefined) => void;
	/** The cascade-resolved destination (for the inherited hint shown when `value` is unset). */
	effective?: ContainerRef | undefined;
	/** Short scope label for the button title (e.g. "this job", "the queue"). */
	scopeLabel: string;
	/**
	 * Projected deposit quantity per container (containerRefKey -> qty) from the live plan (plan 41 B1).
	 * Renders a "+N projected" badge on each container that the current plan deposits into, so projected
	 * (not-yet-built) output is visually distinct from measured pasted-snapshot stock. Omit to show none.
	 */
	projected?: Map<string, number>;
}

export function OutputDestControl({
	containers,
	value,
	onChange,
	effective,
	scopeLabel,
	projected,
}: OutputDestControlProps) {
	const [open, setOpen] = useState(false);

	if (containers.length === 0) return null;

	const projectedFor = (ref: ContainerRef) => projected?.get(containerRefKey(ref)) ?? 0;

	const labelMap = new Map(containers.map((c) => [containerRefKey(c.ref), c.label]));
	const ownLabel = value ? formatContainerRef(value, labelMap) : null;
	const effectiveLabel = effective ? formatContainerRef(effective, labelMap) : null;
	// Inherited when this scope set nothing but a wider scope did.
	const inherited = !value && effectiveLabel != null;

	const summary = ownLabel ?? (inherited ? `${effectiveLabel} (inherited)` : "none");
	const configured = value != null;

	return (
		<div className="relative inline-block">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
					configured
						? "border-emerald-600/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
						: "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
				}`}
				title={`Where ${scopeLabel} deposits its output -- later orders source it from this container`}
				aria-expanded={open}
			>
				<PackageOpen size={10} />
				Output: {summary}
			</button>

			{open && (
				<div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-xs shadow-xl">
					<div className="mb-1 flex items-center justify-between">
						<span className="font-medium text-zinc-300">Deposit output to</span>
						<button
							type="button"
							onClick={() => setOpen(false)}
							className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
							aria-label="Close"
						>
							<X size={12} />
						</button>
					</div>

					<button
						type="button"
						onClick={() => {
							onChange(undefined);
							setOpen(false);
						}}
						className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-zinc-800/40 ${
							value == null ? "text-cyan-300" : "text-zinc-400"
						}`}
					>
						<RotateCcw size={10} />
						{inherited ? `Inherit (${effectiveLabel})` : "None"}
					</button>

					<div className="mt-1 border-t border-zinc-800 pt-1">
						{containers.map((opt) => {
							const selected = value != null && containerRefKey(value) === containerRefKey(opt.ref);
							const proj = projectedFor(opt.ref);
							return (
								<button
									key={containerRefKey(opt.ref)}
									type="button"
									onClick={() => {
										onChange(opt.ref);
										setOpen(false);
									}}
									className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-zinc-800/40 ${
										selected ? "text-emerald-300" : "text-zinc-200"
									}`}
								>
									<PackageOpen size={10} className="shrink-0 text-zinc-600" />
									<span className="min-w-0 flex-1 truncate">{opt.label}</span>
									{proj > 0 && (
										<span
											className="shrink-0 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-400/90"
											title="Projected output the current plan deposits here -- not measured snapshot stock"
										>
											+{proj.toLocaleString()} projected
										</span>
									)}
									{selected && <span className="shrink-0 text-[9px] text-emerald-400/80">set</span>}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
