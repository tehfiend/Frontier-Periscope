// Per-scope container source control -- plan 39 Phase 4b.
// A compact expandable editor for one ContainerSourceConfig (a ranked include `order` + scoped
// `exclude`). Reused as the source-controls entry point on Target job rows (writes job.overrides),
// Derived intermediate rows (writes an order sourceLock), and the queue-level container priority
// (writes sourcesDefault). It edits ONLY the config it is handed -- the Phase 4a cascade composes the
// scopes (queueResolver.resolveEffectiveOverrides), and the resulting per-material plan is rendered by
// SourcingPlanTable. Editing is intentionally minimal-but-usable: rank, reorder, exclude, restore.

import type { ContainerRef, ContainerSourceConfig } from "@/lib/buildQueueTypes";
import { containerRefKey } from "@/lib/queueResolver";
import { type ContainerOption, formatContainerRef, sourceConfigSummary } from "@/lib/sourcingPlan";
import { ArrowDown, ArrowUp, Ban, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

interface RowSourceControlProps {
	/** Every selectable container (the editor ranks/excludes from this list). */
	containers: ContainerOption[];
	/** This scope's own sourcing config (job.overrides.sources, a sourceLock.sources, sourcesDefault). */
	config: ContainerSourceConfig | undefined;
	/** Persist a new config for this scope (undefined clears it back to inherited/auto). */
	onChange: (config: ContainerSourceConfig | undefined) => void;
	/** Short scope label for the button title (e.g. "this job", "this item", "the queue"). */
	scopeLabel: string;
	/**
	 * Gate-jump distance from the queue location to each container, keyed by containerRefKey (plan 39
	 * Phase 5). A finite number renders a "Nj" badge; undefined (no location / unreachable) renders none.
	 * Omitted entirely when no queue location is set.
	 */
	jumps?: Map<string, number | undefined>;
	/**
	 * Optional caption shown at the top of the popover. Used to flag that a per-row (job/item) source
	 * priority is recorded but does not steer the live raw plan (the queue/order container priority does).
	 */
	note?: string;
}

/** A small gate-distance badge ("3j" / "here"); null when the distance is unknown. */
function JumpBadge({ jumps }: { jumps: number | undefined }) {
	if (jumps == null) return null;
	return (
		<span
			className="shrink-0 rounded bg-zinc-800 px-1 py-0.5 text-[9px] font-medium text-zinc-400"
			title={`${jumps} gate jump${jumps === 1 ? "" : "s"} from the queue location`}
		>
			{jumps === 0 ? "here" : `${jumps}j`}
		</span>
	);
}

/** Normalize an order/exclude pair into a config (undefined when both are empty). */
function toConfig(
	order: ContainerRef[],
	exclude: ContainerRef[],
): ContainerSourceConfig | undefined {
	const config: ContainerSourceConfig = {};
	if (order.length > 0) config.order = order;
	if (exclude.length > 0) config.exclude = exclude;
	return config.order || config.exclude ? config : undefined;
}

export function RowSourceControl({
	containers,
	config,
	onChange,
	scopeLabel,
	jumps,
	note,
}: RowSourceControlProps) {
	const [open, setOpen] = useState(false);
	const jumpsFor = (ref: ContainerRef) => jumps?.get(containerRefKey(ref));

	const order = config?.order ?? [];
	const exclude = config?.exclude ?? [];
	const orderKeys = new Set(order.map(containerRefKey));
	const excludeKeys = new Set(exclude.map(containerRefKey));

	const labelMap = new Map(containers.map((c) => [containerRefKey(c.ref), c.label]));
	const labelFor = (ref: ContainerRef) => formatContainerRef(ref, labelMap);

	const available = containers.filter(
		(c) => !orderKeys.has(containerRefKey(c.ref)) && !excludeKeys.has(containerRefKey(c.ref)),
	);

	const addToOrder = (ref: ContainerRef) =>
		onChange(
			toConfig(
				[...order, ref],
				exclude.filter((r) => containerRefKey(r) !== containerRefKey(ref)),
			),
		);
	const removeFromOrder = (ref: ContainerRef) =>
		onChange(
			toConfig(
				order.filter((r) => containerRefKey(r) !== containerRefKey(ref)),
				exclude,
			),
		);
	const addToExclude = (ref: ContainerRef) =>
		onChange(
			toConfig(
				order.filter((r) => containerRefKey(r) !== containerRefKey(ref)),
				[...exclude, ref],
			),
		);
	const removeFromExclude = (ref: ContainerRef) =>
		onChange(
			toConfig(
				order,
				exclude.filter((r) => containerRefKey(r) !== containerRefKey(ref)),
			),
		);
	const move = (index: number, delta: number) => {
		const next = [...order];
		const target = index + delta;
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target], next[index]];
		onChange(toConfig(next, exclude));
	};

	const summary = sourceConfigSummary(config);
	const configured = summary !== "auto";

	if (containers.length === 0) return null;

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
				title={`Set which containers source ${scopeLabel}`}
				aria-expanded={open}
			>
				<SlidersHorizontal size={10} />
				Sources: {summary}
			</button>

			{open && (
				<div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-xs shadow-xl">
					{note && (
						<div className="mb-1.5 rounded bg-zinc-800/40 px-1.5 py-1 text-[10px] leading-snug text-zinc-500">
							{note}
						</div>
					)}
					<div className="mb-1 flex items-center justify-between">
						<span className="font-medium text-zinc-300">Container priority</span>
						<div className="flex items-center gap-1">
							{configured && (
								<button
									type="button"
									onClick={() => onChange(undefined)}
									className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-zinc-500 hover:text-amber-300"
									title="Clear -- back to inherited / auto"
								>
									<RotateCcw size={10} />
									Reset
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

					{order.length > 0 && (
						<div className="mb-1.5">
							<div className="px-1 py-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
								Ranked (priority order)
							</div>
							{order.map((ref, i) => (
								<div
									key={containerRefKey(ref)}
									className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-800/40"
								>
									<span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-zinc-800 text-[9px] text-zinc-400">
										{i + 1}
									</span>
									<span className="min-w-0 flex-1 truncate text-zinc-200">{labelFor(ref)}</span>
									<JumpBadge jumps={jumpsFor(ref)} />
									<button
										type="button"
										onClick={() => move(i, -1)}
										disabled={i === 0}
										className="rounded p-0.5 text-zinc-500 enabled:hover:text-zinc-200 disabled:opacity-30"
										aria-label="Move up"
									>
										<ArrowUp size={11} />
									</button>
									<button
										type="button"
										onClick={() => move(i, 1)}
										disabled={i === order.length - 1}
										className="rounded p-0.5 text-zinc-500 enabled:hover:text-zinc-200 disabled:opacity-30"
										aria-label="Move down"
									>
										<ArrowDown size={11} />
									</button>
									<button
										type="button"
										onClick={() => removeFromOrder(ref)}
										className="rounded p-0.5 text-zinc-500 hover:text-red-400"
										aria-label="Remove from priority"
									>
										<X size={11} />
									</button>
								</div>
							))}
						</div>
					)}

					{available.length > 0 && (
						<div className="mb-1.5">
							<div className="px-1 py-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
								Available
							</div>
							{available.map((opt) => (
								<div
									key={containerRefKey(opt.ref)}
									className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-800/40"
								>
									<span className="min-w-0 flex-1 truncate text-zinc-300">{opt.label}</span>
									<JumpBadge jumps={jumpsFor(opt.ref)} />
									<button
										type="button"
										onClick={() => addToOrder(opt.ref)}
										className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-zinc-500 hover:text-cyan-300"
										title="Add to priority order"
									>
										<Plus size={10} />
										Rank
									</button>
									<button
										type="button"
										onClick={() => addToExclude(opt.ref)}
										className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-zinc-500 hover:text-red-400"
										title="Exclude this container"
									>
										<Ban size={10} />
									</button>
								</div>
							))}
						</div>
					)}

					{exclude.length > 0 && (
						<div>
							<div className="px-1 py-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
								Excluded
							</div>
							{exclude.map((ref) => (
								<div
									key={containerRefKey(ref)}
									className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-zinc-800/40"
								>
									<span className="min-w-0 flex-1 truncate text-zinc-600 line-through">
										{labelFor(ref)}
									</span>
									<button
										type="button"
										onClick={() => removeFromExclude(ref)}
										className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-zinc-500 hover:text-cyan-300"
										title="Restore this container"
									>
										<RotateCcw size={10} />
										Restore
									</button>
								</div>
							))}
						</div>
					)}

					{containers.length === order.length + exclude.length && available.length === 0 && (
						<div className="px-1 py-0.5 text-[10px] text-zinc-600">
							Every container is ranked or excluded.
						</div>
					)}
				</div>
			)}
		</div>
	);
}
