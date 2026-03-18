/**
 * DEPRECATED: ListingForm is no longer used. Sell order creation
 * is handled through the escrow-based flow in OwnerView.
 * This file is kept to avoid breaking any remaining references.
 */

import type { MarketInfo } from "@tehfrontier/chain-shared";

interface ListingFormProps {
	config: MarketInfo;
	onClose: () => void;
}

export function ListingForm({ onClose }: ListingFormProps) {
	return (
		<div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
			<p className="text-xs text-zinc-500">
				Listing form has been replaced by the sell order flow.
			</p>
			<button
				type="button"
				onClick={onClose}
				className="mt-2 text-xs text-zinc-400 hover:text-zinc-300"
			>
				Close
			</button>
		</div>
	);
}
