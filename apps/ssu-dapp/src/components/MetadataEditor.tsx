import type { AssemblyMetadata } from "@/hooks/useAssembly";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { getTenant, getWorldPackageId } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { Transaction } from "@mysten/sui/transactions";
import { useState } from "react";

interface MetadataEditorProps {
	ssuObjectId: string;
	characterObjectId: string;
	ownerCap: OwnerCapInfo;
	metadata: AssemblyMetadata | null;
}

/**
 * Edit SSU metadata: name, description, dApp URL.
 * Uses storage_unit::update_metadata_name/description/url via OwnerCap PTB.
 */
export function MetadataEditor({
	ssuObjectId,
	characterObjectId,
	ownerCap,
	metadata,
}: MetadataEditorProps) {
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [name, setName] = useState(metadata?.name ?? "");
	const [description, setDescription] = useState(metadata?.description ?? "");
	const [url, setUrl] = useState(metadata?.url ?? "");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	async function handleSave() {
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

			// Update name if changed
			if (name !== (metadata?.name ?? "")) {
				tx.moveCall({
					target: `${worldPkg}::storage_unit::update_metadata_name`,
					arguments: [tx.object(ssuObjectId), borrowedCap, tx.pure.string(name)],
				});
			}

			// Update description if changed
			if (description !== (metadata?.description ?? "")) {
				tx.moveCall({
					target: `${worldPkg}::storage_unit::update_metadata_description`,
					arguments: [tx.object(ssuObjectId), borrowedCap, tx.pure.string(description)],
				});
			}

			// Update URL if changed
			if (url !== (metadata?.url ?? "")) {
				tx.moveCall({
					target: `${worldPkg}::storage_unit::update_metadata_url`,
					arguments: [tx.object(ssuObjectId), borrowedCap, tx.pure.string(url)],
				});
			}

			// Return OwnerCap
			tx.moveCall({
				target: `${worldPkg}::character::return_owner_cap`,
				typeArguments: [`${worldPkg}::storage_unit::StorageUnit`],
				arguments: [tx.object(characterObjectId), borrowedCap, receipt],
			});

			await signAndExecute(tx);
			setSuccess("Metadata updated successfully");
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	const hasChanges =
		name !== (metadata?.name ?? "") ||
		description !== (metadata?.description ?? "") ||
		url !== (metadata?.url ?? "");

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h3 className="mb-3 text-sm font-medium text-zinc-300">Edit Metadata</h3>

			<div className="space-y-3">
				<div>
					<label className="mb-1 block text-xs text-zinc-500">Name</label>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Storage unit name"
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</div>

				<div>
					<label className="mb-1 block text-xs text-zinc-500">Description</label>
					<textarea
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Description"
						rows={2}
						className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</div>

				<div>
					<label className="mb-1 block text-xs text-zinc-500">dApp URL</label>
					<input
						type="text"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						placeholder="https://..."
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</div>

				<button
					type="button"
					onClick={handleSave}
					disabled={!hasChanges || isPending}
					className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending ? "Saving..." : "Save Metadata"}
				</button>

				{error && <p className="text-xs text-red-400">{error}</p>}
				{success && <p className="text-xs text-emerald-400">{success}</p>}
			</div>
		</div>
	);
}
