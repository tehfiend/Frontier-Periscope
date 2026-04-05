import { useCoinMetadata } from "@/hooks/useCoinMetadata";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { formatBaseUnits } from "@/lib/coin-format";
import { getTenant } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import {
	type TenantId,
	buildCancelAsk,
	buildCancelBid,
	getContractAddresses,
} from "@tehfrontier/chain-shared";
import { useEffect, useRef, useState } from "react";

interface CancelOrderDialogProps {
	bookObjectId: string;
	coinTypeA: string;
	coinTypeB: string;
	orderId: number;
	isBid: boolean;
	price: string;
	amount: string;
	onClose: () => void;
}

export function CancelOrderDialog({
	bookObjectId,
	coinTypeA,
	coinTypeB,
	orderId,
	isBid,
	price,
	amount,
	onClose,
}: CancelOrderDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const { data: metaA } = useCoinMetadata(coinTypeA);
	const { data: metaB } = useCoinMetadata(coinTypeB);

	const symbolA = metaA?.symbol ?? formatCoinTypeName(coinTypeA);
	const symbolB = metaB?.symbol ?? formatCoinTypeName(coinTypeB);
	const decimalsA = metaA?.decimals ?? 9;
	const decimalsB = metaB?.decimals ?? 9;

	useEffect(() => {
		dialogRef.current?.showModal();
	}, []);

	async function handleCancel() {
		if (!account?.address) return;
		setError(null);
		setSuccess(null);

		const tenant = getTenant() as TenantId;
		const exchangePkg = getContractAddresses(tenant).exchange?.packageId;
		if (!exchangePkg) {
			setError("Exchange package not configured for this tenant");
			return;
		}

		try {
			const params = {
				packageId: exchangePkg,
				coinTypeA,
				coinTypeB,
				bookObjectId,
				orderId,
				senderAddress: account.address,
			};

			const tx = isBid ? buildCancelBid(params) : buildCancelAsk(params);
			await signAndExecute(tx);
			setSuccess(`${isBid ? "Bid" : "Ask"} order cancelled -- escrowed funds returned`);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	return (
		<dialog
			ref={dialogRef}
			className="m-auto w-full max-w-sm rounded-lg border border-zinc-700 bg-zinc-900 p-0 text-zinc-100 backdrop:bg-black/60"
			onClose={onClose}
		>
			<div className="p-4">
				<div className="mb-4 flex items-center justify-between">
					<h3 className="text-sm font-medium text-zinc-200">
						Cancel {isBid ? "Bid" : "Ask"} Order
					</h3>
					<button
						type="button"
						onClick={() => {
							dialogRef.current?.close();
							onClose();
						}}
						className="text-zinc-500 hover:text-zinc-300"
					>
						&times;
					</button>
				</div>

				{success ? (
					<div className="space-y-3">
						<p className="text-xs text-emerald-400">{success}</p>
						<button
							type="button"
							onClick={() => {
								dialogRef.current?.close();
								onClose();
							}}
							className="w-full rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600"
						>
							Close
						</button>
					</div>
				) : (
					<div className="space-y-3">
						<p className="text-[10px] text-zinc-600">
							Are you sure you want to cancel this {isBid ? "bid" : "ask"} order?
							Escrowed funds will be returned to your wallet.
						</p>

						<div className="rounded border border-zinc-800 bg-zinc-800/50 px-3 py-2">
							<p className="text-xs text-zinc-300">
								{isBid ? "Bid" : "Ask"} #{orderId}
							</p>
							<p className="text-[10px] text-zinc-500">
								Price: {formatBaseUnits(BigInt(price), decimalsB)} {symbolB}
							</p>
							<p className="text-[10px] text-zinc-500">
								Amount: {formatBaseUnits(BigInt(amount), decimalsA)} {symbolA}
							</p>
						</div>

						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => {
									dialogRef.current?.close();
									onClose();
								}}
								className="flex-1 rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600"
							>
								Keep Order
							</button>
							<button
								type="button"
								onClick={handleCancel}
								disabled={isPending}
								className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
							>
								{isPending ? "Cancelling..." : "Cancel Order"}
							</button>
						</div>

						{error && <p className="text-xs text-red-400">{error}</p>}
					</div>
				)}
			</div>
		</dialog>
	);
}

function formatCoinTypeName(coinType: string): string {
	const parts = coinType.split("::");
	return parts.length >= 3 ? parts[parts.length - 1] : coinType.slice(0, 12);
}
