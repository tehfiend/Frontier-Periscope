import { Crosshair, DoorOpen, Box, Wifi, WifiOff, Loader2, ExternalLink } from "lucide-react";
import { SyncBadge } from "./SyncBadge";
import { GroupSelector } from "./GroupSelector";
import type { AssemblyPolicy, PermissionGroup, PolicyMode } from "@/db/types";
import type { OwnedAssembly } from "@/chain/queries";

const assemblyIcons = {
	turret: Crosshair,
	gate: DoorOpen,
	storage_unit: Box,
	network_node: Wifi,
} as const;

const assemblyLabels = {
	turret: "Turret",
	gate: "Gate",
	storage_unit: "Storage Unit",
	network_node: "Network Node",
} as const;

interface PolicyCardProps {
	policy: AssemblyPolicy;
	assembly?: OwnedAssembly;
	groups: PermissionGroup[];
	hasExtension: boolean;
	isSyncing: boolean;
	onUpdatePolicy: (data: Partial<Pick<AssemblyPolicy, "mode" | "groupIds" | "permitDurationMs">>) => void;
	onSync: () => void;
	onGoToExtensions: () => void;
}

export function PolicyCard({
	policy,
	assembly,
	groups,
	hasExtension,
	isSyncing,
	onUpdatePolicy,
	onSync,
	onGoToExtensions,
}: PolicyCardProps) {
	const Icon = assemblyIcons[policy.assemblyType];
	const label = assemblyLabels[policy.assemblyType];
	const isOnline = assembly?.status === "online" || assembly?.status === "ONLINE";

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			{/* Header */}
			<div className="mb-3 flex items-start justify-between">
				<div className="flex items-center gap-3">
					<div className="rounded-lg bg-zinc-800 p-2">
						<Icon size={18} className="text-cyan-500" />
					</div>
					<div>
						<p className="text-sm font-medium text-zinc-200">{label}</p>
						<p className="font-mono text-xs text-zinc-600">
							{policy.assemblyId.slice(0, 10)}...{policy.assemblyId.slice(-6)}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{assembly && (
						<span className="flex items-center gap-1">
							{isOnline ? (
								<>
									<Wifi size={12} className="text-green-500" />
									<span className="text-xs text-green-500">Online</span>
								</>
							) : (
								<>
									<WifiOff size={12} className="text-zinc-600" />
									<span className="text-xs text-zinc-600">{assembly.status}</span>
								</>
							)}
						</span>
					)}
				</div>
			</div>

			{/* Mode toggle */}
			<div className="mb-3">
				<label className="mb-1 block text-xs text-zinc-500">Mode</label>
				<div className="flex gap-2">
					{(["allowlist", "denylist"] as PolicyMode[]).map((mode) => (
						<button
							key={mode}
							type="button"
							onClick={() => onUpdatePolicy({ mode })}
							className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
								policy.mode === mode
									? "bg-cyan-500/20 text-cyan-400"
									: "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
							}`}
						>
							{mode === "allowlist" ? "Allowlist" : "Denylist"}
						</button>
					))}
				</div>
			</div>

			{/* Groups */}
			<div className="mb-3">
				<label className="mb-1 block text-xs text-zinc-500">Groups</label>
				<GroupSelector
					groups={groups}
					selectedIds={policy.groupIds}
					onChange={(groupIds) => onUpdatePolicy({ groupIds })}
				/>
			</div>

			{/* Gate-specific: permit duration */}
			{policy.assemblyType === "gate" && (
				<div className="mb-3">
					<label className="mb-1 block text-xs text-zinc-500">Permit duration (min)</label>
					<input
						type="number"
						value={Math.round((policy.permitDurationMs ?? 600_000) / 60_000)}
						onChange={(e) =>
							onUpdatePolicy({ permitDurationMs: Number(e.target.value) * 60_000 })
						}
						min={1}
						className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
					/>
				</div>
			)}

			{/* Extension + Sync status */}
			<div className="flex items-center justify-between border-t border-zinc-800/50 pt-3">
				<div className="flex items-center gap-2">
					{hasExtension ? (
						<>
							<span className="text-xs text-zinc-500">Extension:</span>
							<span className="text-xs text-cyan-400">
								{policy.extensionTemplateId ?? "Gate ACL"}
							</span>
						</>
					) : (
						<div className="flex items-center gap-2">
							<span className="text-xs text-amber-400">No ACL extension</span>
							<button
								type="button"
								onClick={onGoToExtensions}
								className="text-xs text-cyan-400 hover:text-cyan-300"
							>
								Go to Extensions →
							</button>
						</div>
					)}
				</div>

				<div className="flex items-center gap-2">
					<SyncBadge status={policy.syncStatus} lastSyncedAt={policy.lastSyncedAt} />
					{hasExtension && (policy.syncStatus === "dirty" || policy.syncStatus === "draft" || policy.syncStatus === "error") && (
						<button
							type="button"
							onClick={onSync}
							disabled={isSyncing}
							className="rounded bg-cyan-600/20 px-3 py-1 text-xs font-medium text-cyan-400 transition-colors hover:bg-cyan-600/30 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isSyncing ? (
								<span className="flex items-center gap-1">
									<Loader2 size={12} className="animate-spin" />
									Syncing
								</span>
							) : (
								"Sync Now"
							)}
						</button>
					)}
					{policy.syncStatus === "synced" && (
						<button
							type="button"
							onClick={onSync}
							disabled={isSyncing}
							className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
						>
							Re-sync
						</button>
					)}
				</div>
			</div>

			{/* Sync error */}
			{policy.syncError && (
				<p className="mt-2 text-xs text-red-400">{policy.syncError}</p>
			)}

			{/* Tx link */}
			{policy.syncTxDigest && (
				<a
					href={`https://suiscan.xyz/testnet/tx/${policy.syncTxDigest}`}
					target="_blank"
					rel="noopener noreferrer"
					className="mt-1 flex items-center gap-1 text-xs text-zinc-600 hover:text-cyan-400"
				>
					{policy.syncTxDigest.slice(0, 12)}... <ExternalLink size={10} />
				</a>
			)}
		</div>
	);
}
