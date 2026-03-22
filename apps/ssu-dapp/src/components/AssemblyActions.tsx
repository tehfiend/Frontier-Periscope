import type { AssemblyData } from "@/hooks/useAssembly";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import { useState } from "react";
import { CopyAddress } from "./CopyAddress";

interface AssemblyActionsProps {
	assembly: AssemblyData;
	characterObjectId: string;
	ownerCap: OwnerCapInfo;
}

/**
 * Online/offline toggle for the SSU.
 * Uses storage_unit::online() / storage_unit::offline() via OwnerCap PTB.
 *
 * NOTE: online() and offline() require additional shared objects
 * (NetworkNode, EnergyConfig, OfflineAssemblies) that may not be easily
 * available from the client. This component shows the current status and
 * provides the toggle as a best-effort operation.
 */
export function AssemblyActions({ assembly, characterObjectId, ownerCap }: AssemblyActionsProps) {
	const { isPending } = useSignAndExecute();
	const [error, setError] = useState<string | null>(null);

	// Online/offline requires NetworkNode + EnergyConfig shared objects
	// which are game-server-managed. We show status but note the limitation.
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
					<span className="text-sm text-zinc-300">{assembly.isOnline ? "Online" : "Offline"}</span>
				</div>

				<p className="text-xs text-zinc-600">Status managed by game server</p>
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
