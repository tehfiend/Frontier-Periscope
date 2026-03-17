import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { getWorldPackageId, getTenant } from "@/lib/constants";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";

interface ExtensionInfoProps {
	ssuObjectId: string;
	characterObjectId: string;
	ownerCap: OwnerCapInfo;
	extensionType: string | null;
	isOwner: boolean;
}

/**
 * Display extension type and provide authorize/remove controls for owners.
 */
export function ExtensionInfo({
	ssuObjectId,
	characterObjectId,
	ownerCap,
	extensionType,
	isOwner,
}: ExtensionInfoProps) {
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	async function handleRemoveExtension() {
		setError(null);
		setSuccess(null);

		try {
			const tenant = getTenant();
			const worldPkg = getWorldPackageId(tenant);
			const tx = new Transaction();

			// Borrow OwnerCap
			const [borrowedCap, receipt] = tx.moveCall({
				target: `${worldPkg}::character::borrow_owner_cap`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [
					tx.object(characterObjectId),
					tx.receivingRef({
						objectId: ownerCap.objectId,
						version: String(ownerCap.version),
						digest: ownerCap.digest,
					}),
				],
			});

			// Remove extension
			tx.moveCall({
				target: `${worldPkg}::storage_unit::remove_extension`,
				arguments: [tx.object(ssuObjectId), borrowedCap],
			});

			// Return OwnerCap
			tx.moveCall({
				target: `${worldPkg}::character::return_owner_cap`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [tx.object(characterObjectId), borrowedCap, receipt],
			});

			await signAndExecute(tx);
			setSuccess("Extension removed");
		} catch (err) {
			setError(String(err));
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
						<p className="mt-0.5 font-mono text-xs text-zinc-300 break-all">
							{extensionType}
						</p>
					</div>

					{isOwner && (
						<button
							type="button"
							onClick={handleRemoveExtension}
							disabled={isPending}
							className="rounded-lg bg-red-600/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
						>
							{isPending ? "Removing..." : "Remove Extension"}
						</button>
					)}
				</div>
			) : (
				<p className="text-xs text-zinc-600">No extension configured</p>
			)}

			{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
			{success && <p className="mt-2 text-xs text-emerald-400">{success}</p>}
		</div>
	);
}
