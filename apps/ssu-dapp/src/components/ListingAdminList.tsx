import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { decodeErrorMessage } from "@/lib/errors";
import { resolveItemName } from "@/lib/items";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import {
	type MarketSellListing,
	buildCancelListingWithStandings,
	buildUpdateSellListing,
	formatBaseUnits,
	parseDisplayPrice,
} from "@tehfrontier/chain-shared";
import { useState } from "react";
import { CopyAddress } from "./CopyAddress";

interface ListingAdminListProps {
	listings: MarketSellListing[];
	ssuConfig: SsuConfigResult;
	characterObjectId?: string;
	ssuObjectId: string;
	coinType: string;
	nameMap?: Map<string, string>;
}

export function ListingAdminList({
	listings,
	ssuConfig,
	characterObjectId,
	ssuObjectId,
	coinType,
	nameMap,
}: ListingAdminListProps) {
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const { data: coinMeta } = useCoinMetadata(coinType);
	const decimals = coinMeta?.decimals ?? 9;

	const [dialogState, setDialogState] = useState<
		null | { type: "edit"; id: number; price: string; qty: string } | { type: "cancel"; id: number }
	>(null);
	const [error, setError] = useState<string | null>(null);

	async function handleUpdate(listingId: number) {
		if (!account?.address || !ssuConfig.marketId || dialogState?.type !== "edit") return;
		setError(null);
		try {
			const tx = buildUpdateSellListing({
				packageId: ssuConfig.packageId,
				marketId: ssuConfig.marketId,
				coinType,
				listingId,
				pricePerUnit: parseDisplayPrice(dialogState.price, decimals),
				quantity: Number(dialogState.qty),
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setDialogState(null);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	async function handleCancel(listingId: number) {
		if (!account?.address || !ssuConfig.marketId || !characterObjectId) return;
		setError(null);
		try {
			const tx = buildCancelListingWithStandings({
				packageId: ssuConfig.packageId,
				ssuConfigId: ssuConfig.ssuConfigId,
				marketId: ssuConfig.marketId,
				coinType,
				ssuObjectId,
				characterObjectId,
				listingId,
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setDialogState(null);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	if (listings.length === 0) {
		return (
			<p className="py-4 text-center text-xs text-zinc-600">
				No sell orders. Use the Sell button in the Inventory tab to create one.
			</p>
		);
	}

	return (
		<div className="space-y-2">
			{listings.map((listing) => (
				<ListingAdminRow
					key={listing.listingId}
					listing={listing}
					decimals={decimals}
					nameMap={nameMap}
					isEditing={dialogState?.type === "edit" && dialogState.id === listing.listingId}
					isCancelling={dialogState?.type === "cancel" && dialogState.id === listing.listingId}
					editPrice={
						dialogState?.type === "edit" && dialogState.id === listing.listingId
							? dialogState.price
							: ""
					}
					editQty={
						dialogState?.type === "edit" && dialogState.id === listing.listingId
							? dialogState.qty
							: ""
					}
					isPending={isPending}
					onEditStart={() => {
						setDialogState({
							type: "edit",
							id: listing.listingId,
							price: formatBaseUnits(listing.pricePerUnit, decimals),
							qty: String(listing.quantity),
						});
					}}
					onEditCancel={() => setDialogState(null)}
					onEditPriceChange={(v) =>
						setDialogState((prev) => (prev?.type === "edit" ? { ...prev, price: v } : prev))
					}
					onEditQtyChange={(v) =>
						setDialogState((prev) => (prev?.type === "edit" ? { ...prev, qty: v } : prev))
					}
					onUpdate={() => handleUpdate(listing.listingId)}
					onCancelStart={() => setDialogState({ type: "cancel", id: listing.listingId })}
					onCancelDismiss={() => setDialogState(null)}
					onCancelConfirm={() => handleCancel(listing.listingId)}
				/>
			))}
			{error && <p className="text-xs text-red-400">{error}</p>}
		</div>
	);
}

function ListingAdminRow({
	listing,
	decimals,
	nameMap,
	isEditing,
	isCancelling,
	editPrice,
	editQty,
	isPending,
	onEditStart,
	onEditCancel,
	onEditPriceChange,
	onEditQtyChange,
	onUpdate,
	onCancelStart,
	onCancelDismiss,
	onCancelConfirm,
}: {
	listing: MarketSellListing;
	decimals: number;
	nameMap?: Map<string, string>;
	isEditing: boolean;
	isCancelling: boolean;
	editPrice: string;
	editQty: string;
	isPending: boolean;
	onEditStart: () => void;
	onEditCancel: () => void;
	onEditPriceChange: (v: string) => void;
	onEditQtyChange: (v: string) => void;
	onUpdate: () => void;
	onCancelStart: () => void;
	onCancelDismiss: () => void;
	onCancelConfirm: () => void;
}) {
	const { data: itemName } = useQuery({
		queryKey: ["typeName", listing.typeId],
		queryFn: () => resolveItemName(listing.typeId),
		staleTime: 5 * 60_000,
	});

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
			<div className="flex items-center justify-between">
				<div>
					<p className="text-sm text-zinc-200">{itemName ?? `Item #${listing.typeId}`}</p>
					<p className="text-xs text-zinc-500">
						{formatBaseUnits(listing.pricePerUnit, decimals)} per unit --{" "}
						{listing.quantity.toLocaleString()} available
					</p>
					<p className="text-[10px] text-zinc-600">
						Seller:{" "}
						{nameMap?.get(listing.seller) ?? (
							<CopyAddress
								address={listing.seller}
								sliceStart={10}
								sliceEnd={4}
								className="text-zinc-600"
							/>
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onEditStart}
						disabled={isPending}
						className="rounded px-2 py-0.5 text-xs text-cyan-500 hover:bg-zinc-800"
					>
						Edit
					</button>
					<button
						type="button"
						onClick={onCancelStart}
						disabled={isPending}
						className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-zinc-800"
					>
						Cancel
					</button>
				</div>
			</div>

			{/* Inline edit */}
			{isEditing && (
				<div className="mt-2 flex items-center gap-2 border-t border-zinc-800 pt-2">
					<input
						type="number"
						value={editPrice}
						onChange={(e) => onEditPriceChange(e.target.value)}
						placeholder="Price"
						className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-600 focus:outline-none"
					/>
					<input
						type="number"
						value={editQty}
						onChange={(e) => onEditQtyChange(e.target.value)}
						placeholder="Qty"
						className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-cyan-600 focus:outline-none"
					/>
					<button
						type="button"
						onClick={onUpdate}
						disabled={isPending}
						className="rounded bg-cyan-600 px-2 py-1 text-xs text-white hover:bg-cyan-500 disabled:opacity-50"
					>
						Save
					</button>
					<button
						type="button"
						onClick={onEditCancel}
						className="text-xs text-zinc-500 hover:text-zinc-300"
					>
						Cancel
					</button>
				</div>
			)}

			{/* Cancel confirm */}
			{isCancelling && (
				<div className="mt-2 flex items-center gap-2 border-t border-zinc-800 pt-2">
					<p className="text-xs text-zinc-500">Cancel this listing?</p>
					<button
						type="button"
						onClick={onCancelConfirm}
						disabled={isPending}
						className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500 disabled:opacity-50"
					>
						Confirm
					</button>
					<button
						type="button"
						onClick={onCancelDismiss}
						className="text-xs text-zinc-500 hover:text-zinc-300"
					>
						Dismiss
					</button>
				</div>
			)}
		</div>
	);
}
