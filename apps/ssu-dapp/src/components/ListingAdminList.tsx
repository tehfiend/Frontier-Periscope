import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { resolveItemName } from "@/lib/items";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import {
	type MarketSellListing,
	buildCancelListing,
	buildUpdateSellListing,
} from "@tehfrontier/chain-shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface ListingAdminListProps {
	listings: MarketSellListing[];
	ssuConfig: SsuConfigResult;
	characterObjectId?: string;
	ssuObjectId: string;
	coinType: string;
}

export function ListingAdminList({
	listings,
	ssuConfig,
	characterObjectId,
	ssuObjectId,
	coinType,
}: ListingAdminListProps) {
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();

	const [editingId, setEditingId] = useState<number | null>(null);
	const [editPrice, setEditPrice] = useState("");
	const [editQty, setEditQty] = useState("");
	const [cancellingId, setCancellingId] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function handleUpdate(listingId: number) {
		if (!account?.address || !editPrice || !editQty || !ssuConfig.marketId) return;
		setError(null);
		try {
			const tx = buildUpdateSellListing({
				packageId: ssuConfig.packageId,
				marketId: ssuConfig.marketId,
				coinType,
				listingId,
				pricePerUnit: Number(editPrice),
				quantity: Number(editQty),
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setEditingId(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleCancel(listingId: number) {
		if (!account?.address || !ssuConfig.marketId || !characterObjectId) return;
		setError(null);
		try {
			const tx = buildCancelListing({
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
			setCancellingId(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	if (listings.length === 0) {
		return (
			<p className="py-4 text-center text-xs text-zinc-600">
				No sell listings. Use the Sell button in the Inventory tab to create one.
			</p>
		);
	}

	return (
		<div className="space-y-2">
			{listings.map((listing) => (
				<ListingAdminRow
					key={listing.listingId}
					listing={listing}
					isEditing={editingId === listing.listingId}
					isCancelling={cancellingId === listing.listingId}
					editPrice={editPrice}
					editQty={editQty}
					isPending={isPending}
					onEditStart={() => {
						setEditingId(listing.listingId);
						setEditPrice(String(listing.pricePerUnit));
						setEditQty(String(listing.quantity));
					}}
					onEditCancel={() => setEditingId(null)}
					onEditPriceChange={setEditPrice}
					onEditQtyChange={setEditQty}
					onUpdate={() => handleUpdate(listing.listingId)}
					onCancelStart={() => setCancellingId(listing.listingId)}
					onCancelDismiss={() => setCancellingId(null)}
					onCancelConfirm={() => handleCancel(listing.listingId)}
				/>
			))}
			{error && <p className="text-xs text-red-400">{error}</p>}
		</div>
	);
}

function ListingAdminRow({
	listing,
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
					<p className="text-sm text-zinc-200">
						{itemName ?? `Item #${listing.typeId}`}
					</p>
					<p className="text-xs text-zinc-500">
						{listing.pricePerUnit.toLocaleString()} per unit --{" "}
						{listing.quantity.toLocaleString()} available
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
