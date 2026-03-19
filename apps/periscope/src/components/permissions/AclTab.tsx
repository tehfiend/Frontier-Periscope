import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { DoorOpen, List, Settings, Shield } from "lucide-react";
import { getTemplate, type TenantId } from "@/chain/config";
import { getContractAddresses } from "@tehfrontier/chain-shared";
import { useOwnedAssemblies, useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { AclEditor } from "./AclEditor";
import { SharedAclBrowser } from "./SharedAclBrowser";

type SubMode = "gate-acl" | "shared-acls";

export function AclTab() {
	const account = useCurrentAccount();
	const tenant = useActiveTenant();
	const { data: assemblyData } = useOwnedAssemblies();
	const [subMode, setSubMode] = useState<SubMode>("gate-acl");
	const [selectedGateId, setSelectedGateId] = useState("");

	const assemblies = assemblyData?.assemblies ?? [];
	const gates = assemblies.filter((a) => a.type === "gate");

	// Resolve contract addresses for the active tenant
	const addresses = getContractAddresses(tenant);
	const gateAclTemplate = getTemplate("gate_acl");
	const gateAclPackageId = gateAclTemplate?.packageIds[tenant] ?? "";
	const gateAclConfigObjectId = gateAclTemplate?.configObjectIds[tenant] ?? "";
	const aclRegistryPackageId = addresses.aclRegistry?.packageId ?? "";

	return (
		<div className="space-y-4">
			{!account && (
				<div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-xs text-zinc-500">
					<Shield size={14} />
					<span>Connect wallet to manage ACLs on-chain</span>
				</div>
			)}

			{/* Sub-mode tabs */}
			<div className="flex gap-1.5">
				<button
					type="button"
					onClick={() => setSubMode("gate-acl")}
					className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
						subMode === "gate-acl"
							? "bg-cyan-500/20 text-cyan-400"
							: "bg-zinc-800 text-zinc-500 hover:text-zinc-400"
					}`}
				>
					<Settings size={12} />
					Gate ACL
				</button>
				<button
					type="button"
					onClick={() => setSubMode("shared-acls")}
					className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
						subMode === "shared-acls"
							? "bg-cyan-500/20 text-cyan-400"
							: "bg-zinc-800 text-zinc-500 hover:text-zinc-400"
					}`}
				>
					<List size={12} />
					Shared ACLs
				</button>
			</div>

			{/* Gate ACL sub-mode */}
			{subMode === "gate-acl" && (
				<>
					{/* Assembly dropdown for gates */}
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						<h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-400">
							<DoorOpen size={14} />
							Select Gate
						</h3>
						{gates.length > 0 ? (
							<select
								value={selectedGateId}
								onChange={(e) => setSelectedGateId(e.target.value)}
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
							>
								<option value="">-- Select a gate --</option>
								{gates.map((gate) => (
									<option key={gate.objectId} value={gate.objectId}>
										Gate ({gate.objectId.slice(0, 10)}
										...{gate.objectId.slice(-6)})
									</option>
								))}
							</select>
						) : (
							<p className="text-xs text-zinc-600">
								{account
									? "No gates found for your account. Deploy a gate assembly first."
									: "Connect wallet to see your gates."}
							</p>
						)}
						{selectedGateId && (
							<p className="mt-2 font-mono text-[10px] text-zinc-600">
								{selectedGateId}
							</p>
						)}
					</div>

					{/* Contract config status */}
					{!gateAclPackageId && (
						<div className="flex items-center gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-xs text-amber-400">
							Gate ACL extension not published for {tenant} tenant.
						</div>
					)}

					{/* ACL Editor */}
					{selectedGateId && gateAclPackageId && gateAclConfigObjectId && (
						<AclEditor
							assemblyId={selectedGateId}
							packageId={gateAclPackageId}
							configObjectId={gateAclConfigObjectId}
							aclRegistryPackageId={
								aclRegistryPackageId || undefined
							}
							tenant={tenant}
						/>
					)}
				</>
			)}

			{/* Shared ACLs sub-mode */}
			{subMode === "shared-acls" && (
				<>
					{aclRegistryPackageId ? (
						<SharedAclBrowser packageId={aclRegistryPackageId} />
					) : (
						<div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 py-12">
							<List size={32} className="text-zinc-700" />
							<p className="text-xs text-zinc-600">
								ACL Registry not configured for {tenant} tenant
							</p>
						</div>
					)}
				</>
			)}
		</div>
	);
}
