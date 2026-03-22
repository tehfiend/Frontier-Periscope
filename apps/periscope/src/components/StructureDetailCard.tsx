import { TENANTS } from "@/chain/config";
import { type TenantId, classifyExtension } from "@/chain/config";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import type { StructureRow } from "@/views/Deployables";
import { AppWindow, ExternalLink, Fuel, MapPin } from "lucide-react";
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

// ── Component ───────────────────────────────────────────────────────────────

interface StructureDetailCardProps {
	row: StructureRow | null;
	systemNames: Map<number, string>;
	onSaveNotes?: (row: StructureRow, notes: string) => void;
}

export function StructureDetailCard({ row, systemNames, onSaveNotes }: StructureDetailCardProps) {
	const tenant = useActiveTenant();

	if (!row) return null;

	const hours = fuelHoursRemaining(row);
	const systemName = row.systemId ? (systemNames.get(row.systemId) ?? `#${row.systemId}`) : null;
	const locationStr =
		systemName && row.lPoint
			? `${systemName} -- ${row.lPoint}`
			: (systemName ?? row.lPoint ?? "\u2014");

	const extensionInfo = classifyExtension(row.extensionType, tenant as TenantId);

	const dappHref = row.dappUrl
		? row.dappUrl.startsWith("http")
			? row.dappUrl
			: `https://${row.dappUrl}`
		: row.itemId
			? `${TENANTS[tenant]?.dappUrl ?? `https://dapps.evefrontier.com/?tenant=${tenant}`}&itemId=${row.itemId}`
			: null;

	return (
		<div className="mt-4 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="text-sm font-medium text-zinc-200">{row.label}</h3>
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
					<p className="mt-0.5 text-zinc-300">
						{extensionInfo.status === "default"
							? "Default"
							: extensionInfo.status === "periscope"
								? (extensionInfo.template?.name ?? "Periscope")
								: extensionInfo.status === "periscope-outdated"
									? `${extensionInfo.template?.name ?? "Periscope"} (outdated)`
									: extensionInfo.status === "unknown"
										? "Custom"
										: "\u2014"}
					</p>
				</div>

				{/* Location */}
				<div>
					<span className="text-zinc-500">Location</span>
					<div className="mt-0.5 flex items-center gap-1 text-zinc-300">
						{systemName && <MapPin size={12} className="shrink-0 text-cyan-500" />}
						<span>{locationStr}</span>
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
