import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { getTenant, getWorldPackageId, getWorldPublishedAt } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { Transaction } from "@mysten/sui/transactions";
import { useState } from "react";

interface ExtensionInfoProps {
	extensionType: string | null;
	isOwner: boolean;
	characterObjectId?: string;
	ownerCap?: OwnerCapInfo;
	ssuObjectId?: string;
}

/**
 * Display extension type and provide revoke control for owners.
 * Uses storage_unit::remove_extension via the borrow-cap PTB pattern.
 */
export function ExtensionInfo({
	extensionType,
	isOwner,
	characterObjectId,
	ownerCap,
	ssuObjectId,
}: ExtensionInfoProps) {
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const canRevoke = extensionType && isOwner && characterObjectId && ownerCap && ssuObjectId;

	async function handleRevoke() {
		if (!confirming) {
			setConfirming(true);
			return;
		}

		if (!characterObjectId || !ownerCap || !ssuObjectId) return;

		setError(null);
		setSuccess(null);

		try {
			const tenant = getTenant();
			const worldPkg = getWorldPublishedAt(tenant);
			const worldType = getWorldPackageId(tenant);
			const tx = new Transaction();

			// 1. Borrow OwnerCap<StorageUnit>
			const [borrowedCap, receipt] = tx.moveCall({
				target: `${worldPkg}::character::borrow_owner_cap`,
				typeArguments: [`${worldType}::storage_unit::StorageUnit`],
				arguments: [
					tx.object(characterObjectId),
					tx.receivingRef({
						objectId: ownerCap.objectId,
						version: String(ownerCap.version),
						digest: ownerCap.digest,
					}),
				],
			});

			// 2. Remove extension (no type argument)
			tx.moveCall({
				target: `${worldPkg}::storage_unit::remove_extension`,
				arguments: [tx.object(ssuObjectId), borrowedCap],
			});

			// 3. Return OwnerCap
			tx.moveCall({
				target: `${worldPkg}::character::return_owner_cap`,
				typeArguments: [`${worldType}::storage_unit::StorageUnit`],
				arguments: [tx.object(characterObjectId), borrowedCap, receipt],
			});

			await signAndExecute(tx);
			setSuccess("Extension removed successfully");
			setConfirming(false);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
			setConfirming(false);
		}
	}

	if (!extensionType && !isOwner) return null;

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h3 className="mb-3 text-sm font-medium text-zinc-300">Extension</h3>

			{extensionType ? (
				<div className="space-y-3">
					<div>
						<p className="text-xs text-zinc-500">Registered Extension</p>
						<p className="mt-0.5 break-all font-mono text-xs text-zinc-300">{extensionType}</p>
					</div>

					{canRevoke && !success && (
						<div className="space-y-1">
							<button
								type="button"
								onClick={handleRevoke}
								disabled={isPending}
								className={
									confirming
										? "rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
										: "rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
								}
							>
								{isPending ? "Removing..." : confirming ? "Confirm Remove" : "Remove Extension"}
							</button>
							{confirming && !isPending && (
								<button
									type="button"
									onClick={() => setConfirming(false)}
									className="ml-2 text-xs text-zinc-500 hover:text-zinc-300"
								>
									Cancel
								</button>
							)}
						</div>
					)}

					{error && <p className="text-xs text-red-400">{error}</p>}
					{success && <p className="text-xs text-emerald-400">{success}</p>}
				</div>
			) : (
				<p className="text-xs text-zinc-600">No extension configured</p>
			)}
		</div>
	);
}
