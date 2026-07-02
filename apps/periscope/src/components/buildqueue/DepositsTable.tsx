// Deposits table -- plan 41 (Option B output routing), stage B1.
// A DISPLAY of where an order's produced items physically landed: the resolver now deposits each job's
// TRUE leftover output (gross minus intra-order sibling consumption) plus surplus co-products into the
// effective `outputDest` container, recording them on OrderResult.deposits (and global.deposits). This
// table simply renders those REAL recorded deposits -- the symmetric counterpart to SourcingPlanTable
// ("pull from storage" / "deposit to storage").
//
// B0 projected GROSS outputs from the resolved OrderResult; B1 re-points this at the resolver's recorded,
// intra-order-netted deposits so the numbers match the carry-forward pool. When no scope set an
// `outputDest`, the deposit's `dest` is the reserved { kind: "unassigned" } ref (decision Q1a) and renders
// as "Unassigned" (Option A stays bit-identical -- everything lands in the one anonymous bucket).

import { ItemIcon } from "@/components/ItemIcon";
import type { BuildQueue, ContainerRef, Order } from "@/lib/buildQueueTypes";
import { type DepositRecord, type OrderResult, containerRefKey } from "@/lib/queueResolver";
import { formatContainerRef } from "@/lib/sourcingPlan";

/** Grouping key for the reserved "Unassigned" pseudo-container (decision Q1a -- terminal default). */
export const UNASSIGNED_DEST_KEY = "unassigned";

/** One deposit row: a produced item, its effective destination, and the quantity. */
export interface DepositRow {
	typeId: number;
	typeName: string;
	/** Effective deposit container; undefined renders as the reserved "Unassigned" bucket (Q1a). */
	dest?: ContainerRef;
	/** Stable grouping key: containerRefKey(dest), i.e. UNASSIGNED_DEST_KEY when un-routed. */
	destKey: string;
	qty: number;
}

/**
 * Shape the resolver's recorded deposits into display rows. Records are already merged per (typeId,
 * dest) by the resolver; this only maps the reserved Unassigned ref back to `dest: undefined` (so the
 * table renders it as the muted "Unassigned" pill, not a container chip) and sorts for stable display.
 */
export function depositRowsFromRecords(records: DepositRecord[]): DepositRow[] {
	const rows: DepositRow[] = records.map((rec) => {
		const destKey = containerRefKey(rec.dest);
		return {
			typeId: rec.typeId,
			typeName: rec.typeName,
			dest: rec.dest.kind === "unassigned" ? undefined : rec.dest,
			destKey,
			qty: rec.qty,
		};
	});
	return rows.sort(
		(a, b) => a.typeName.localeCompare(b.typeName) || a.destKey.localeCompare(b.destKey),
	);
}

/**
 * Render one order's recorded deposits (plan 41 B1). The `queue` / `order` arguments are retained for
 * the established call signature but are no longer needed -- the deposits already ride on the resolved
 * OrderResult, netted and routed by the resolver (decision 5: single source of truth).
 */
export function projectOrderDeposits(
	result: OrderResult,
	_queue: BuildQueue,
	_order: Order,
): DepositRow[] {
	return depositRowsFromRecords(result.deposits);
}

interface DepositsTableProps {
	rows: DepositRow[];
	/** containerRefKey -> display label ("#42 Junk", an SSU name, ...). */
	containerLabels: Map<string, string>;
}

export function DepositsTable({ rows, containerLabels }: DepositsTableProps) {
	if (rows.length === 0) {
		return (
			<div className="px-4 py-3 text-xs text-zinc-600">
				This order deposits nothing into storage.
			</div>
		);
	}
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="border-t border-zinc-800 text-xs text-zinc-500">
					<th className="px-4 py-2 text-left">Item</th>
					<th className="px-4 py-2 text-left">Deposit to</th>
					<th className="px-4 py-2 text-right">Qty</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr
						key={`${row.typeId}|${row.destKey}`}
						className="border-t border-zinc-800/50 align-top hover:bg-zinc-800/30"
					>
						<td className="px-4 py-2 text-zinc-200">
							<span className="flex items-center gap-2">
								<ItemIcon typeId={row.typeId} />
								{row.typeName}
							</span>
						</td>
						<td className="px-4 py-2">
							{row.dest ? (
								<span className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-200">
									{formatContainerRef(row.dest, containerLabels)}
								</span>
							) : (
								<span
									className="text-[11px] italic text-zinc-500"
									title="No output destination set anywhere in the cascade -- lands in the reserved Unassigned pool"
								>
									Unassigned
								</span>
							)}
						</td>
						<td className="px-4 py-2 text-right font-mono text-cyan-400">
							{row.qty.toLocaleString()}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
