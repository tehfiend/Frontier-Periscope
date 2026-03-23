import type { BuyOrderWithName } from "@/hooks/useBuyOrders";
import type { SellListingWithName } from "@/hooks/useMarketListings";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { formatBaseUnits } from "@tehfrontier/chain-shared";
import { useMemo, useState } from "react";
import { BuyFromListingDialog } from "./BuyFromListingDialog";
import { CancelBuyOrderDialog } from "./CancelBuyOrderDialog";
import { CancelListingDialog } from "./CancelListingDialog";
import { CopyAddress } from "./CopyAddress";
import { type ColumnDef, DataGrid, excelFilterFn } from "./DataGrid";
import { EditListingDialog } from "./EditListingDialog";
import { FillBuyOrderDialog } from "./FillBuyOrderDialog";

// ── Row type ────────────────────────────────────────────────────────────────

export interface MarketOrderRow {
	id: string;
	type: "Sell" | "Buy";
	itemName: string;
	typeId: number;
	quantity: number;
	pricePerUnit: bigint;
	by: string;
	byAddress: string;
	timestamp: Date;
	isMine: boolean;
	listing?: SellListingWithName;
	buyOrder?: BuyOrderWithName;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface MarketOrdersGridProps {
	rows: MarketOrderRow[];
	ssuConfig: SsuConfigResult;
	characterObjectId?: string;
	coinType: string;
	ssuObjectId: string;
	ownerCapReceivingId?: string;
	isConnected: boolean;
	coinDecimals: number;
	coinSymbol: string;
	marketPackageId?: string | null;
}

// ── Dialog state ────────────────────────────────────────────────────────────

type DialogState =
	| null
	| { type: "buyFromListing"; listing: SellListingWithName }
	| { type: "editListing"; listing: SellListingWithName }
	| { type: "cancelListing"; listing: SellListingWithName }
	| { type: "fillBuyOrder"; order: BuyOrderWithName }
	| { type: "cancelBuyOrder"; order: BuyOrderWithName };

// ── Component ───────────────────────────────────────────────────────────────

export function MarketOrdersGrid({
	rows,
	ssuConfig,
	characterObjectId,
	coinType,
	ssuObjectId,
	ownerCapReceivingId,
	isConnected,
	coinDecimals,
	coinSymbol,
	marketPackageId,
}: MarketOrdersGridProps) {
	const [dialog, setDialog] = useState<DialogState>(null);

	const columns = useMemo<ColumnDef<MarketOrderRow, unknown>[]>(
		() => [
			{
				accessorKey: "type",
				header: "Type",
				size: 56,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const t = row.original.type;
					return (
						<span
							className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
								t === "Sell"
									? "bg-emerald-900/40 text-emerald-400"
									: "bg-amber-900/40 text-amber-400"
							}`}
						>
							{t}
						</span>
					);
				},
			},
			{
				accessorKey: "itemName",
				header: "Item",
				size: 130,
				filterFn: excelFilterFn,
			},
			{
				accessorKey: "quantity",
				header: "Qty",
				size: 56,
				enableColumnFilter: false,
				cell: ({ row }) => row.original.quantity.toLocaleString(),
			},
			{
				id: "price",
				accessorFn: (row) => row.pricePerUnit,
				header: "Price",
				enableColumnFilter: false,
				sortingFn: (a, b) => {
					const av = a.original.pricePerUnit;
					const bv = b.original.pricePerUnit;
					return av < bv ? -1 : av > bv ? 1 : 0;
				},
				size: 100,
				cell: ({ row }) => (
					<span>
						{formatBaseUnits(row.original.pricePerUnit, coinDecimals)} {coinSymbol}
					</span>
				),
			},
			{
				accessorKey: "by",
				header: "By",
				size: 90,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const { by, byAddress } = row.original;
					if (by !== byAddress) {
						return (
							<span className="text-xs" title={byAddress}>
								{by}
							</span>
						);
					}
					return (
						<CopyAddress
							address={byAddress}
							sliceStart={6}
							sliceEnd={4}
							className="text-xs text-zinc-500"
						/>
					);
				},
			},
			{
				accessorKey: "timestamp",
				header: "Time",
				size: 70,
				enableColumnFilter: false,
				cell: ({ row }) => {
					const d = row.original.timestamp;
					return (
						<span className="text-xs text-zinc-500" title={d.toLocaleString()}>
							{d.toLocaleDateString([], { month: "numeric", day: "numeric" })}{" "}
							{d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
						</span>
					);
				},
			},
			{
				id: "actions",
				header: "",
				size: 80,
				enableSorting: false,
				enableColumnFilter: false,
				cell: ({ row }) => {
					const r = row.original;
					if (!isConnected) return null;

					const { listing, buyOrder } = r;

					if (r.type === "Sell" && !r.isMine && listing) {
						const l = listing;
						return (
							<button
								type="button"
								onClick={() => setDialog({ type: "buyFromListing", listing: l })}
								className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-amber-500"
							>
								Buy
							</button>
						);
					}

					if (r.type === "Sell" && r.isMine && listing) {
						const l = listing;
						return (
							<div className="flex gap-1">
								<button
									type="button"
									onClick={() => setDialog({ type: "editListing", listing: l })}
									className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-500"
								>
									Edit
								</button>
								<button
									type="button"
									onClick={() =>
										setDialog({
											type: "cancelListing",
											listing: l,
										})
									}
									className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-500"
								>
									Cancel
								</button>
							</div>
						);
					}

					if (r.type === "Buy" && !r.isMine && buyOrder) {
						const o = buyOrder;
						return (
							<button
								type="button"
								onClick={() => setDialog({ type: "fillBuyOrder", order: o })}
								className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-500"
							>
								Sell
							</button>
						);
					}

					if (r.type === "Buy" && r.isMine && buyOrder) {
						const o = buyOrder;
						return (
							<button
								type="button"
								onClick={() => setDialog({ type: "cancelBuyOrder", order: o })}
								className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-500"
							>
								Cancel
							</button>
						);
					}

					return null;
				},
			},
		],
		[isConnected, coinDecimals, coinSymbol],
	);

	return (
		<>
			<DataGrid
				columns={columns}
				data={rows}
				keyFn={(r) => r.id}
				searchPlaceholder="Search orders..."
				emptyMessage="No market orders yet."
			/>

			{/* Buy from listing dialog */}
			{dialog?.type === "buyFromListing" && characterObjectId && (
				<BuyFromListingDialog
					listing={dialog.listing}
					ssuConfig={ssuConfig}
					characterObjectId={characterObjectId}
					coinType={coinType}
					ssuObjectId={ssuObjectId}
					coinDecimals={coinDecimals}
					coinSymbol={coinSymbol}
					onClose={() => setDialog(null)}
				/>
			)}

			{/* Edit listing dialog */}
			{dialog?.type === "editListing" && (
				<EditListingDialog
					listing={dialog.listing}
					ssuConfig={ssuConfig}
					coinType={coinType}
					coinDecimals={coinDecimals}
					coinSymbol={coinSymbol}
					onClose={() => setDialog(null)}
				/>
			)}

			{/* Cancel listing dialog */}
			{dialog?.type === "cancelListing" && characterObjectId && (
				<CancelListingDialog
					listing={dialog.listing}
					ssuConfig={ssuConfig}
					characterObjectId={characterObjectId}
					ssuObjectId={ssuObjectId}
					coinType={coinType}
					coinDecimals={coinDecimals}
					coinSymbol={coinSymbol}
					onClose={() => setDialog(null)}
				/>
			)}

			{/* Fill buy order dialog */}
			{dialog?.type === "fillBuyOrder" && characterObjectId && ownerCapReceivingId && (
				<FillBuyOrderDialog
					order={dialog.order}
					ssuConfig={ssuConfig}
					coinType={coinType}
					ssuObjectId={ssuObjectId}
					characterObjectId={characterObjectId}
					ownerCapReceivingId={ownerCapReceivingId}
					onClose={() => setDialog(null)}
				/>
			)}

			{/* Cancel buy order dialog */}
			{dialog?.type === "cancelBuyOrder" && ssuConfig.marketId && marketPackageId && (
				<CancelBuyOrderDialog
					order={dialog.order}
					marketId={ssuConfig.marketId}
					marketPackageId={marketPackageId}
					coinType={coinType}
					coinDecimals={coinDecimals}
					coinSymbol={coinSymbol}
					onClose={() => setDialog(null)}
				/>
			)}
		</>
	);
}
