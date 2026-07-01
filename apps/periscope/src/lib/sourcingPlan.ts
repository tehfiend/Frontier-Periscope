// Post-solve container sourcing plan -- plan 39 Phase 4b, reworked in plan 41 B1.
//
// As of plan 41 B1 the RESOLVER (queueResolver.resolveBatch) is the single source of truth for post-solve
// container attribution: it draws each batch's stockConsumed from the named source containers (priority
// cascade + spillover) against the same container-keyed carry-forward pool it solves over, and RECORDS
// those draws on BatchResult.draws (global.draws in re-opt mode). This module no longer re-walks its own
// inventory -- it RE-SHAPES those recorded draws into the per-material plans the UI renders ("pull 400
// from #42, 365 from #43"), so the displayed plan and the carry-forward pool cannot drift.
//
// The container-priority cascade (queue/batch sourcesDefault + per-typeId sourceLocks) steers WHICH
// container each drawn type is attributed to; it never changes the LP solve or the quantities. Shortfall
// is the LP's authoritative `stillNeed`, so it is never inflated by stock the solve used that is not in
// the per-container breakdown (the reserved Unassigned bucket: chain-pool / cross-queue stock).

import type { BomLineItem } from "@/lib/bomTypes";
import type { ContainerRef, ContainerSourceConfig } from "@/lib/buildQueueTypes";
import { type ContainerDraw, type QueueResolveResult, containerRefKey } from "@/lib/queueResolver";

// ── Plan shapes ───────────────────────────────────────────────────────────────

/** One container's share of a single material's demand. */
export interface MaterialAllocation {
	ref: ContainerRef;
	qty: number;
}

/** The sourcing plan for one raw material: where to pull it from + what is left to gather. */
export interface MaterialSourcingPlan {
	typeId: number;
	typeName: string;
	/** Total quantity the build needs of this material (the gather row's quantity). */
	demand: number;
	/** Sum of the allocations below -- the part of stockQty attributed to broken-down containers. */
	fromStock: number;
	/** Ordered allocations across the effective containers (priority order, with spillover). */
	allocations: MaterialAllocation[];
	/**
	 * The part to gather/mine externally: the LP's authoritative `stillNeed` (gross demand minus EVERY
	 * stock source the solve consumed). Can be less than `demand - fromStock` when stock outside the
	 * per-container breakdown (chain SSUs, cross-queue pools) covered part of the demand.
	 */
	shortfall: number;
}

/** The whole-queue sourcing plan: per-batch material plans (perStep) or a single global list. */
export interface QueueSourcingPlan {
	/** Per-batch material sourcing plans, keyed by batchId (empty in global re-opt mode). */
	byBatch: Map<string, MaterialSourcingPlan[]>;
	/** The single queue-level material sourcing plan, present only in global re-opt mode. */
	global?: MaterialSourcingPlan[];
}

/** A selectable container with a display label (for the row/queue source-priority editors). */
export interface ContainerOption {
	ref: ContainerRef;
	label: string;
}

// ── Allocation (plan 41 B1: consume the resolver's recorded draws) ────────────
// The resolver is now the single source of truth for post-solve container attribution (decision 5): it
// records, per batch, which named containers each drawn type was pulled from (BatchResult.draws), drawn
// against the SAME carry-forward pool it solves over. This module no longer re-walks its own inventory
// -- it shapes those recorded draws into the per-material plans the UI renders, so the two cannot drift.

/** Shape one gather list + its recorded draws into per-material sourcing plans. */
function plansFromDraws(
	gather: BomLineItem[],
	draws: Map<number, ContainerDraw[]>,
): MaterialSourcingPlan[] {
	const plans: MaterialSourcingPlan[] = [];
	for (const row of gather) {
		// The resolver attributes only the stock the LP actually drew across NAMED containers; the rest is
		// gathered/mined externally (stillNeed) or came from the Unassigned bucket (cross-queue stock).
		const allocations = draws.get(row.typeId) ?? [];
		const fromStock = allocations.reduce((sum, a) => sum + a.qty, 0);
		// Skip materials no named container supplied -- the gather table already lists those in full.
		if (fromStock <= 0) continue;
		plans.push({
			typeId: row.typeId,
			typeName: row.typeName,
			demand: row.quantity,
			fromStock,
			allocations,
			// shortfall = the LP's authoritative stillNeed (gross minus EVERY stock source the solve used,
			// including chain SSUs / cross-queue pools absent from the breakdown), so it is never inflated.
			shortfall: Math.max(0, row.stillNeed),
		});
	}
	return plans;
}

/**
 * Build the whole-queue sourcing plan from a resolved queue by consuming the resolver's recorded draws
 * (BatchResult.draws, or global.draws in re-opt mode). The carry-forward pool those draws were
 * attributed against already mirrors batch order, so this is a pure re-shape -- no second inventory walk
 * (decision 5). Returns an empty plan when the resolver recorded no draws (e.g. a flat-baseStock resolve).
 */
export function buildQueueSourcingPlan(resolved: QueueResolveResult): QueueSourcingPlan {
	const byBatch = new Map<string, MaterialSourcingPlan[]>();
	if (resolved.global) {
		return { byBatch, global: plansFromDraws(resolved.global.gather, resolved.global.draws) };
	}
	for (const result of resolved.batches) {
		byBatch.set(result.batchId, plansFromDraws(result.gather, result.draws));
	}
	return { byBatch };
}

// ── Orphaned overrides (decision 8) ──────────────────────────────────────────
// A sourcing override is "active" while the typeId / Job.id it keys still appears in the resolved
// plan; otherwise it is dormant (greyed "inactive"), kept and reactivated if the target reappears --
// never auto-deleted.

/** Every typeId present anywhere in the resolved plan (job outputs, gather, build, from-upstream). */
export function resolvedTypeIds(resolved: QueueResolveResult): Set<number> {
	const ids = new Set<number>();
	for (const b of resolved.batches) {
		for (const j of b.jobs) for (const o of j.outputs) ids.add(o.typeId);
		for (const g of b.gather) ids.add(g.typeId);
		for (const bi of b.build) ids.add(bi.typeId);
		for (const fu of b.fromUpstream) ids.add(fu.typeId);
	}
	if (resolved.global) {
		for (const g of resolved.global.gather) ids.add(g.typeId);
		for (const bi of resolved.global.build) ids.add(bi.typeId);
		for (const fu of resolved.global.fromUpstream) ids.add(fu.typeId);
	}
	return ids;
}

/** The typeIds present in a single batch's resolved result (for batch-scope lock orphan checks). */
export function batchResolvedTypeIds(resolved: QueueResolveResult, batchId: string): Set<number> {
	const ids = new Set<number>();
	const b = resolved.batches.find((x) => x.batchId === batchId);
	if (!b) return ids;
	for (const j of b.jobs) for (const o of j.outputs) ids.add(o.typeId);
	for (const g of b.gather) ids.add(g.typeId);
	for (const bi of b.build) ids.add(bi.typeId);
	for (const fu of b.fromUpstream) ids.add(fu.typeId);
	return ids;
}

/** Every resolved Job.id (Target jobs that actually resolved) -- for job-override orphan checks. */
export function resolvedJobIds(resolved: QueueResolveResult): Set<string> {
	const ids = new Set<string>();
	for (const b of resolved.batches) for (const j of b.jobs) ids.add(j.jobId);
	return ids;
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** True when a sourcing config carries neither an order nor an exclude (i.e. inherits/auto). */
export function isEmptySourceConfig(config: ContainerSourceConfig | undefined): boolean {
	return !config || ((config.order?.length ?? 0) === 0 && (config.exclude?.length ?? 0) === 0);
}

/** Display a container reference: the provided label, else "#seq"/SSU name fall back per kind. */
export function formatContainerRef(ref: ContainerRef, labels?: Map<string, string>): string {
	const fromMap = labels?.get(containerRefKey(ref));
	if (fromMap) return fromMap;
	switch (ref.kind) {
		case "scratch":
			return "Scratch";
		case "field":
			return "Field storage";
		case "chain":
			return "SSU";
		case "unassigned":
			return "Unassigned";
	}
}

/** A one-line summary of a sourcing config for collapsed controls ("auto", "2 ranked", "1 excluded"). */
export function sourceConfigSummary(config: ContainerSourceConfig | undefined): string {
	if (isEmptySourceConfig(config)) return "auto";
	const parts: string[] = [];
	const ordered = config?.order?.length ?? 0;
	const excluded = config?.exclude?.length ?? 0;
	if (ordered > 0) parts.push(`${ordered} ranked`);
	if (excluded > 0) parts.push(`${excluded} excluded`);
	return parts.join(", ");
}
