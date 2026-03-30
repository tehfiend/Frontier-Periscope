import { TENANTS } from "@/chain/config";
import { type TenantId, classifyExtension } from "@/chain/config";
import { canRevokeExtension } from "@/hooks/useExtensionRevoke";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useStructureExtensionConfig } from "@/hooks/useStructureExtensions";
import { formatLocation } from "@/lib/format";
import type { StructureRow } from "@/views/Deployables";
import { REGISTRY_STANDING_LABELS } from "@tehfrontier/chain-shared";
import { AppWindow, ExternalLink, Fuel, Loader2, MapPin, Settings2 } from "lucide-react";
import { useState } from "react";
import { CopyAddress } from "./CopyAddress";
import { EditableCell } from "./EditableCell";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fuelHoursRemaining(d: { fuelExpiresAt?: string }): number | null {
	if (!d.fuelExpiresAt) return null;
	return (new Date(d.fuelExpiresAt).getTime() - Date.now()) / 3600000;
}

function formatRuntime(hours: number | null): string {
	if (hours === null) return "\u2014";
	if (hours <= 0) return "Depleted";
	if (hours > 48) return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
	return `${Math.floor(hours)}h ${Math.floor((hours % 1) * 60)}m`;
}

function fuelColorClass(hours: number | null): string {
	if (hours === null) return "text-zinc-600";
	if (hours <= 0) return "text-red-500";
	if (hours < 6) return "text-red-400";
	if (hours < 24) return "text-orange-400";
	return "text-green-400";
}

function standingLabel(raw: number): string {
	return REGISTRY_STANDING_LABELS.get(raw) ?? `${raw}`;
}

// ── Component ───────────────────────────────────────────────────────────────

interface StructureDetailCardProps {
	row: StructureRow | null;
	systemNames: Map<number, string>;
	onSaveNotes?: (row: StructureRow, notes: string) => void;
	onDeploy?: (row: StructureRow) => void;
	onConfigure?: (row: StructureRow) => void;
	onAddToMap?: (row: StructureRow) => void;
	onReset?: (row: StructureRow) => void;
	isResetting?: boolean;
	onPowerToggle?: (row: StructureRow) => void;
	isPowerToggling?: boolean;
}

export function StructureDetailCard({
	row,
	systemNames,
	onSaveNotes,
	onDeploy,
	onConfigure,
	onAddToMap,
	onReset,
	isResetting,
	onPowerToggle,
	isPowerToggling,
}: StructureDetailCardProps) {
	const tenant = useActiveTenant();
	const extConfig = useStructureExtensionConfig(row?.objectId ?? null);
	const [resetConfirm, setResetConfirm] = useState(false);

	if (!row) return null;

	const hours = fuelHoursRemaining(row);
	const systemName = row.systemId ? (systemNames.get(row.systemId) ?? `#${row.systemId}`) : null;
	const locationStr = formatLocation(systemName ?? undefined, row.lPoint) || "\u2014";

	const extensionInfo = classifyExtension(
		row.extensionType,
		tenant as TenantId,
		extConfig?.publishedPackageId,
	);

	const tenantDapp =
		TENANTS[tenant]?.dappUrl ?? `https://dapp.frontierperiscope.com/?tenant=${tenant}`;
	const dappHref = (() => {
		if (row.dappUrl) {
			try {
				const parsed = new URL(row.dappUrl.startsWith("http") ? row.dappUrl : `https://${row.dappUrl}`);
				if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
			} catch { /* invalid URL, fall through */ }
		}
		if (row.itemId) {
			const url = new URL(tenantDapp);
			url.searchParams.set("itemId", row.itemId);
			return url.toString();
		}
		return row.ownership === "mine" ? tenantDapp : null;
	})();

	return (
		<div className="mt-4 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-medium text-zinc-200">{row.label}</h3>
				<div className="flex items-center gap-2">
					{onPowerToggle && row.ownership === "mine" && row.parentId && (
						<button
							type="button"
							onClick={() => onPowerToggle(row)}
							disabled={isPowerToggling}
							className={`rounded px-2 py-0.5 text-[10px] font-medium disabled:opacity-50 ${
								row.status === "online"
									? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
									: "bg-emerald-700 text-white hover:bg-emerald-600"
							}`}
						>
							{isPowerToggling
								? "..."
								: row.status === "online"
									? "Power Off"
									: "Power On"}
						</button>
					)}
					<span
						className={`rounded-full px-2 py-0.5 text-xs font-medium ${
							row.status === "online"
								? "bg-green-500/15 text-green-400"
								: row.status === "offline"
									? "bg-zinc-700/50 text-zinc-400"
									: "bg-yellow-500/15 text-yellow-400"
						}`}
					>
						{row.status}
					</span>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
				{/* Object ID */}
				<div>
					<span className="text-zinc-500">Object ID</span>
					<div className="mt-0.5">
						<CopyAddress
							address={row.objectId}
							sliceStart={16}
							sliceEnd={8}
							explorerUrl={`https://testnet.suivision.xyz/object/${row.objectId}`}
							className="text-zinc-300"
						/>
					</div>
				</div>

				{/* Item ID */}
				<div>
					<span className="text-zinc-500">Item ID</span>
					<p className="mt-0.5 font-mono text-zinc-400">{row.itemId ?? "\u2014"}</p>
				</div>

				{/* Type */}
				<div>
					<span className="text-zinc-500">Type</span>
					<p className="mt-0.5 text-zinc-300">{row.assemblyType}</p>
				</div>

				{/* Owner */}
				<div>
					<span className="text-zinc-500">Owner</span>
					<div className="mt-0.5">
						<span className="text-zinc-300">{row.ownerName ?? "Unknown"}</span>
						<CopyAddress
							address={row.owner}
							sliceStart={10}
							sliceEnd={6}
							explorerUrl={`https://suiscan.xyz/testnet/account/${row.owner}`}
							className="block text-zinc-500"
						/>
					</div>
				</div>

				{/* Fuel Level + Runtime + Expiry */}
				<div>
					<span className="text-zinc-500">Fuel</span>
					<div className={`mt-0.5 flex items-center gap-1 ${fuelColorClass(hours)}`}>
						{hours !== null && <Fuel size={12} />}
						<span>
							{row.fuelLevel != null ? `${row.fuelLevel.toLocaleString()} units` : "\u2014"}
						</span>
					</div>
					{hours !== null && (
						<p className={`${fuelColorClass(hours)} text-[10px]`}>
							{formatRuntime(hours)} remaining
							{row.fuelExpiresAt && (
								<span className="ml-1 text-zinc-600">
									(expires {new Date(row.fuelExpiresAt).toLocaleString()})
								</span>
							)}
						</p>
					)}
				</div>

				{/* Extension Type */}
				<div>
					<span className="text-zinc-500">Extension</span>
					<div className="mt-0.5 flex items-center gap-2">
						<span className="text-zinc-300">
							{extensionInfo.status === "default"
								? "Default"
								: extensionInfo.status === "periscope"
									? (extensionInfo.template?.name ?? "Periscope")
									: extensionInfo.status === "periscope-outdated"
										? `${extensionInfo.template?.name ?? "Periscope"} (outdated)`
										: extensionInfo.status === "unknown"
											? "Custom"
											: "\u2014"}
						</span>
						{onReset &&
							extensionInfo.status !== "default" &&
							row.ownership === "mine" &&
							row.characterObjectId &&
							row.ownerCapId &&
							canRevokeExtension(row.assemblyModule ?? "") &&
							(isResetting ? (
								<span className="flex items-center gap-1 text-[10px] text-zinc-400">
									<Loader2 size={10} className="animate-spin" /> Resetting...
								</span>
							) : resetConfirm ? (
								<span className="flex items-center gap-1">
									<button
										type="button"
										onClick={() => {
											setResetConfirm(false);
											onReset(row);
										}}
										className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-900/30"
									>
										Confirm
									</button>
									<button
										type="button"
										onClick={() => setResetConfirm(false)}
										className="text-[10px] text-zinc-500 hover:text-zinc-300"
									>
										Cancel
									</button>
								</span>
							) : (
								<button
									type="button"
									onClick={() => setResetConfirm(true)}
									className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-900/30"
									title="Remove extension (reset to default)"
								>
									Reset
								</button>
							))}
					</div>
				</div>

				{/* Extension Action Buttons */}
				{row.ownership === "mine" && (
					<div className="col-span-2 flex items-center gap-2">
						{extensionInfo.status === "default" && onDeploy && (
							<button
								type="button"
								onClick={() => onDeploy(row)}
								className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
							>
								Deploy Extension
							</button>
						)}
						{extensionInfo.status === "periscope" && onConfigure && (
							<button
								type="button"
								onClick={() => onConfigure(row)}
								className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
							>
								Configure
							</button>
						)}
						{extensionInfo.status === "periscope-outdated" && onDeploy && (
							<button
								type="button"
								onClick={() => onDeploy(row)}
								className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500"
							>
								Update Extension
							</button>
						)}
					</div>
				)}

				{/* Standings Extension Details */}
				{extConfig && (
					<div className="col-span-2 rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3">
						<div className="mb-2 flex items-center justify-between">
							<span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
								<Settings2 size={12} className="text-cyan-500" />
								Standings Config
							</span>
						</div>
						<div className="grid grid-cols-2 gap-2 text-xs">
							<div>
								<span className="text-zinc-600">Registry</span>
								<p className="text-zinc-300">{extConfig.registryName ?? "Unknown"}</p>
							</div>
							{extConfig.minAccess !== undefined && (
								<div>
									<span className="text-zinc-600">Min Access</span>
									<p className="text-zinc-300">{standingLabel(extConfig.minAccess)}</p>
								</div>
							)}
							{extConfig.freeAccess !== undefined && (
								<div>
									<span className="text-zinc-600">Free Access</span>
									<p className="text-zinc-300">{standingLabel(extConfig.freeAccess)}</p>
								</div>
							)}
							{extConfig.tollFee && extConfig.tollFee !== "0" && (
								<div>
									<span className="text-zinc-600">Toll</span>
									<p className="text-zinc-300">{extConfig.tollFee} SUI</p>
								</div>
							)}
							{extConfig.minDeposit !== undefined && (
								<div>
									<span className="text-zinc-600">Min Deposit</span>
									<p className="text-zinc-300">{standingLabel(extConfig.minDeposit)}</p>
								</div>
							)}
							{extConfig.minWithdraw !== undefined && (
								<div>
									<span className="text-zinc-600">Min Withdraw</span>
									<p className="text-zinc-300">{standingLabel(extConfig.minWithdraw)}</p>
								</div>
							)}
							{extConfig.marketId && (
								<div>
									<span className="text-zinc-600">Market</span>
									<CopyAddress
										address={extConfig.marketId}
										sliceStart={8}
										sliceEnd={4}
										className="text-zinc-300"
									/>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Location */}
				<div>
					<span className="text-zinc-500">Location</span>
					<div className="mt-0.5 flex items-center gap-1 text-zinc-300">
						{systemName && <MapPin size={12} className="shrink-0 text-cyan-500" />}
						<span>{locationStr}</span>
						{locationStr === "\u2014" && onAddToMap && (
							<button
								type="button"
								onClick={() => onAddToMap(row)}
								className="ml-1 text-[10px] text-cyan-500 hover:text-cyan-400"
							>
								Add to Map
							</button>
						)}
					</div>
				</div>

				{/* dApp URL */}
				<div>
					<span className="text-zinc-500">dApp URL</span>
					<p className="mt-0.5">
						{dappHref ? (
							<a
								href={dappHref}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
							>
								<AppWindow size={12} />
								Open dApp
								<ExternalLink size={10} />
							</a>
						) : (
							<span className="text-zinc-600">{"\u2014"}</span>
						)}
					</p>
				</div>

				{/* Notes */}
				<div className="col-span-2">
					<span className="text-zinc-500">Notes</span>
					<div className="mt-0.5">
						{onSaveNotes ? (
							<EditableCell
								value={row.notes ?? ""}
								onSave={(v) => onSaveNotes(row, v)}
								className="text-zinc-400"
								placeholder="Click to add notes..."
							/>
						) : (
							<span className="text-zinc-400">{row.notes || "\u2014"}</span>
						)}
					</div>
				</div>

				{/* Last Updated */}
				<div className="col-span-2">
					<span className="text-zinc-500">Last Updated</span>
					<p className="mt-0.5 text-zinc-400">{new Date(row.updatedAt).toLocaleString()}</p>
				</div>
			</div>
		</div>
	);
}
