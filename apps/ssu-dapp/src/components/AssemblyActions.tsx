import type { AssemblyData } from "@/hooks/useAssembly";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useSuiClient } from "@/hooks/useSuiClient";
import { getTenant, getWorldPackageId, getWorldPublishedAt } from "@/lib/constants";
import { decodeErrorMessage } from "@/lib/errors";
import { Transaction } from "@mysten/sui/transactions";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CopyAddress } from "./CopyAddress";

interface AssemblyActionsProps {
	assembly: AssemblyData;
	characterObjectId: string;
	ownerCap: OwnerCapInfo;
	ssuObjectId: string;
}

const ENERGY_CONFIG_QUERY = `
	query($type: String!) {
		objects(filter: { type: $type }, first: 1) {
			nodes { address }
		}
	}
`;

/**
 * Online/offline toggle for the SSU.
 * Uses storage_unit::online() / storage_unit::offline() via OwnerCap PTB.
 */
export function AssemblyActions({
	assembly,
	characterObjectId,
	ownerCap,
	ssuObjectId,
}: AssemblyActionsProps) {
	const client = useSuiClient();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [error, setError] = useState<string | null>(null);

	// Discover the EnergyConfig singleton on-chain
	const worldPkg = getWorldPackageId(getTenant());
	const { data: energyConfigId } = useQuery({
		queryKey: ["energyConfig", worldPkg],
		queryFn: async (): Promise<string | null> => {
			const r: {
				data?: { objects?: { nodes: Array<{ address: string }> } } | null;
			} = await client.query({
				query: ENERGY_CONFIG_QUERY,
				variables: { type: `${worldPkg}::energy::EnergyConfig` },
			});
			return r.data?.objects?.nodes?.[0]?.address ?? null;
		},
		staleTime: 300_000,
	});

	const canToggle = !!assembly.energySourceId && !!energyConfigId;

	async function handleToggle() {
		if (!canToggle) return;
		setError(null);

		try {
			const tenant = getTenant();
			const worldTarget = getWorldPublishedAt(tenant);
			const worldType = getWorldPackageId(tenant);
			const tx = new Transaction();

			// Borrow OwnerCap
			const [borrowedCap, receipt] = tx.moveCall({
				target: `${worldTarget}::character::borrow_owner_cap`,
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

			// Online or offline
			const target = assembly.isOnline
				? `${worldTarget}::storage_unit::offline`
				: `${worldTarget}::storage_unit::online`;

			tx.moveCall({
				target,
				arguments: [
					tx.object(ssuObjectId),
					tx.object(assembly.energySourceId!),
					tx.object(energyConfigId!),
					borrowedCap,
				],
			});

			// Return OwnerCap
			tx.moveCall({
				target: `${worldTarget}::character::return_owner_cap`,
				typeArguments: [`${worldType}::storage_unit::StorageUnit`],
				arguments: [tx.object(characterObjectId), borrowedCap, receipt],
			});

			await signAndExecute(tx);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h3 className="mb-3 text-sm font-medium text-zinc-300">Assembly Status</h3>

			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span
						className={`h-3 w-3 rounded-full ${
							assembly.isOnline ? "bg-emerald-500" : "bg-zinc-600"
						}`}
					/>
					<span className="text-sm text-zinc-300">
						{assembly.isOnline ? "Online" : "Offline"}
					</span>
				</div>

				{canToggle ? (
					<button
						type="button"
						onClick={handleToggle}
						disabled={isPending}
						className={`rounded px-3 py-1 text-xs font-medium disabled:opacity-50 ${
							assembly.isOnline
								? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
								: "bg-emerald-700 text-white hover:bg-emerald-600"
						}`}
					>
						{isPending
							? "..."
							: assembly.isOnline
								? "Bring Offline"
								: "Bring Online"}
					</button>
				) : (
					<p className="text-xs text-zinc-600">
						{!assembly.energySourceId ? "No energy source" : "Loading..."}
					</p>
				)}
			</div>

			{assembly.energySourceId && (
				<p className="mt-2 text-xs text-zinc-500">
					Energy source:{" "}
					<CopyAddress
						address={assembly.energySourceId}
						sliceStart={10}
						sliceEnd={4}
						className="text-zinc-400"
					/>
				</p>
			)}

			{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
		</div>
	);
}
