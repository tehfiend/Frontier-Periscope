import { useState, useCallback, useMemo } from "react";
import { useSuiClient } from "@mysten/dapp-kit";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { discoverCharacterAndAssemblies } from "@/chain/queries";
import type { SuiClient as SuiClientType } from "@mysten/sui/client";
import { Package, RefreshCw, Fuel, AlertTriangle, Loader2, User, Link2 } from "lucide-react";
import { DataGrid, excelFilterFn, type ColumnDef } from "@/components/DataGrid";
import type { DeployableIntel } from "@/db/types";
import { FUEL_CRITICAL_HOURS, FUEL_WARNING_HOURS } from "@/lib/constants";
import { ASSEMBLY_TYPE_IDS } from "@/chain/config";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fuelHoursRemaining(d: DeployableIntel): number | null {
	if (!d.fuelExpiresAt) return null;
	return (new Date(d.fuelExpiresAt).getTime() - Date.now()) / 3600000;
}

function formatRuntime(hours: number | null): string {
	if (hours === null) return "—";
	if (hours <= 0) return "Depleted";
	if (hours > 48) return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
	return `${Math.floor(hours)}h ${Math.floor((hours % 1) * 60)}m`;
}

function fuelColorClass(hours: number | null): string {
	if (hours === null) return "text-zinc-600";
	if (hours <= 0) return "text-red-500";
	if (hours < FUEL_CRITICAL_HOURS) return "text-red-400";
	if (hours < FUEL_WARNING_HOURS) return "text-orange-400";
	return "text-green-400";
}

function statusDotClass(status: string): string {
	switch (status) {
		case "online": return "bg-green-400";
		case "offline": return "bg-zinc-600";
		case "anchoring": return "bg-yellow-400";
		case "unanchoring": return "bg-orange-400";
		case "destroyed": return "bg-red-500";
		default: return "bg-zinc-700";
	}
}

function assemblyTypeName(typeStr: string, typeId?: number): string {
	if (typeId && ASSEMBLY_TYPE_IDS[typeId]) return ASSEMBLY_TYPE_IDS[typeId];
	return typeStr.replace("_", " ");
}

// ── Fuel Data Fetch ─────────────────────────────────────────────────────────

async function fetchFuelData(
	client: SuiClientType,
	assemblyId: string,
): Promise<{ fuelLevel?: number; fuelExpiresAt?: string }> {
	try {
		const obj = await client.getObject({ id: assemblyId, options: { showContent: true } });
		const content = obj.data?.content;
		if (!content || !("fields" in content)) return {};

		const fields = content.fields as Record<string, unknown>;

		// Network nodes have fuel directly
		const fuelObj = fields.fuel as { fields?: Record<string, unknown> } | undefined;
		if (fuelObj?.fields) {
			const f = fuelObj.fields;
			const quantity = Number(f.quantity ?? 0);
			const isBurning = f.is_burning as boolean;
			const burnRateMs = Number(f.burn_rate_in_ms ?? 0);
			const burnStartTime = Number(f.burn_start_time ?? 0);
			const lastUpdated = Number(f.last_updated ?? 0);
			const prevElapsed = Number(f.previous_cycle_elapsed_time ?? 0);

			if (quantity > 0 && isBurning && burnRateMs > 0) {
				// Calculate remaining fuel time
				const nowMs = Date.now();
				const elapsedSinceBurnStart = nowMs - burnStartTime;
				const totalElapsed = prevElapsed + elapsedSinceBurnStart;
				const fuelUsed = totalElapsed / burnRateMs;
				const remaining = Math.max(0, quantity - fuelUsed);
				const msRemaining = remaining * burnRateMs;
				const expiresAt = new Date(nowMs + msRemaining).toISOString();
				return { fuelLevel: Math.round(remaining), fuelExpiresAt: expiresAt };
			}

			return { fuelLevel: quantity };
		}

		// Storage units / gates reference an energy_source_id (network node)
		const energySourceId = fields.energy_source_id as string | undefined;
		if (energySourceId) {
			return fetchFuelData(client, energySourceId);
		}

		return {};
	} catch {
		return {};
	}
}

// ── Columns ─────────────────────────────────────────────────────────────────

const columns: ColumnDef<DeployableIntel, unknown>[] = [
	{
		id: "status",
		accessorKey: "status",
		header: "Status",
		size: 100,
		filterFn: excelFilterFn,
		cell: ({ row }) => (
			<div className="flex items-center gap-2">
				<span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(row.original.status)}`} />
				<span className="capitalize">{row.original.status}</span>
			</div>
		),
	},
	{
		id: "label",
		accessorKey: "label",
		header: "Name",
		filterFn: excelFilterFn,
		cell: ({ row }) => (
			<div>
				<span className="font-medium text-zinc-100">{row.original.label || "—"}</span>
				<span className="ml-2 font-mono text-xs text-zinc-600" title={row.original.objectId}>
					{row.original.objectId.slice(0, 8)}...
				</span>
			</div>
		),
	},
	{
		id: "type",
		accessorFn: (d) => assemblyTypeName(d.assemblyType),
		header: "Type",
		size: 150,
		filterFn: excelFilterFn,
	},
	{
		id: "fuelLevel",
		accessorFn: (d) => d.fuelLevel ?? null,
		header: "Fuel",
		size: 100,
		enableColumnFilter: false,
		cell: ({ row }) => (
			<span className="font-mono text-xs">
				{row.original.fuelLevel != null ? row.original.fuelLevel.toLocaleString() : "—"}
			</span>
		),
	},
	{
		id: "runtime",
		accessorFn: (d) => {
			const h = fuelHoursRemaining(d);
			return h !== null ? Math.round(h * 10) / 10 : null;
		},
		header: "Runtime",
		size: 120,
		enableColumnFilter: false,
		cell: ({ row }) => {
			const hours = fuelHoursRemaining(row.original);
			return (
				<div className={`flex items-center gap-1 text-xs ${fuelColorClass(hours)}`}>
					{hours !== null && <Fuel size={12} />}
					{formatRuntime(hours)}
				</div>
			);
		},
	},
	{
		id: "notes",
		accessorKey: "notes",
		header: "Notes",
		filterFn: excelFilterFn,
		cell: ({ row }) => (
			<span className="text-xs text-zinc-500 truncate max-w-[200px] block">
				{row.original.notes || "—"}
			</span>
		),
	},
	{
		id: "updated",
		accessorKey: "updatedAt",
		header: "Updated",
		size: 130,
		enableColumnFilter: false,
		cell: ({ row }) => (
			<span className="text-xs text-zinc-600">
				{new Date(row.original.updatedAt).toLocaleDateString()}
			</span>
		),
	},
];

// ── Component ───────────────────────────────────────────────────────────────

export function Deployables() {
	const client = useSuiClient();
	const tenant = useActiveTenant();
	const { activeCharacter, activeSuiAddresses } = useActiveCharacter();

	// Use the active character's address, or the first available
	const chainAddress = activeCharacter?.suiAddress ?? activeSuiAddresses[0] ?? null;
	const hasAddress = !!chainAddress;

	const deployables = useLiveQuery(
		() =>
			chainAddress
				? db.deployables.where("owner").equals(chainAddress).filter(notDeleted).toArray()
				: db.deployables.filter(notDeleted).toArray(),
		[chainAddress],
	);
	const lastSync = useLiveQuery(() => db.settings.get("lastChainSync"));
	const [syncing, setSyncing] = useState(false);
	const [syncStatus, setSyncStatus] = useState<string | null>(null);

	const data = deployables ?? [];

	const handleSync = useCallback(async () => {
		if (!chainAddress || syncing) return;
		setSyncing(true);
		setSyncStatus("Syncing...");
		try {
			const discovery = await discoverCharacterAndAssemblies(client, chainAddress, tenant);
			const now = new Date().toISOString();
			let totalCount = 0;

			for (const assembly of discovery.assemblies) {
				const typeIdNum = assembly.typeId;
				const typeName = ASSEMBLY_TYPE_IDS[typeIdNum] ?? assembly.type.replace("_", " ");
				const existing = await db.deployables.where("objectId").equals(assembly.objectId).first();

				// Fetch full assembly object for fuel data
				let fuelData: { fuelLevel?: number; fuelExpiresAt?: string } = {};
				try {
					fuelData = await fetchFuelData(client, assembly.objectId);
				} catch { /* non-fatal */ }

				await db.deployables.put({
					id: existing?.id ?? crypto.randomUUID(),
					objectId: assembly.objectId,
					assemblyType: typeName,
					owner: chainAddress,
					status: assembly.status as DeployableIntel["status"],
					label: existing?.label ?? typeName,
					systemId: existing?.systemId,
					fuelLevel: fuelData.fuelLevel ?? existing?.fuelLevel,
					fuelExpiresAt: fuelData.fuelExpiresAt ?? existing?.fuelExpiresAt,
					notes: existing?.notes,
					tags: existing?.tags ?? [],
					source: "chain",
					createdAt: existing?.createdAt ?? now,
					updatedAt: now,
				});
				totalCount++;
			}

			setSyncStatus(`Synced ${totalCount}`);
			await db.settings.put({ key: "lastChainSync", value: new Date().toISOString() });
		} catch (e) {
			setSyncStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setSyncing(false);
		}
	}, [chainAddress, syncing, client, tenant]);

	const stats = useMemo(() => {
		const online = data.filter((d) => d.status === "online").length;
		const warnings = data.filter((d) => {
			const h = fuelHoursRemaining(d);
			return h !== null && h > 0 && h < FUEL_WARNING_HOURS;
		}).length;
		return { total: data.length, online, offline: data.length - online, warnings };
	}, [data]);

	if (!hasAddress) {
		return (
			<div className="p-6">
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<Package size={24} className="text-emerald-500" />
					Deployables
				</h1>
				<div className="mt-8 flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-12">
					{activeCharacter ? (
						<>
							<Link2 size={36} className="text-zinc-700" />
							<p className="text-sm text-zinc-500">
								No Sui address linked to <span className="text-zinc-300">{activeCharacter.characterName}</span>
							</p>
							<p className="text-xs text-zinc-600">
								Link an address in Settings or re-add the character to resolve from chain
							</p>
						</>
					) : (
						<>
							<User size={36} className="text-zinc-700" />
							<p className="text-sm text-zinc-500">
								Select a character to view their deployables
							</p>
						</>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<Package size={24} className="text-emerald-500" />
						Deployables
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{stats.total} assemblies &middot; {stats.online} online
						{stats.warnings > 0 && (
							<span className="ml-2 text-orange-400">
								<AlertTriangle size={12} className="mr-0.5 inline" />
								{stats.warnings} low fuel
							</span>
						)}
					</p>
				</div>
			</div>

			{/* Summary Cards */}
			<div className="mb-6 grid grid-cols-4 gap-4">
				<StatCard label="Total" value={stats.total} color="text-zinc-100" />
				<StatCard label="Online" value={stats.online} color="text-green-400" />
				<StatCard label="Offline" value={stats.offline} color="text-zinc-500" />
				<StatCard label="Fuel Warnings" value={stats.warnings} color="text-orange-400" />
			</div>

			{/* Data Grid */}
			<DataGrid
				columns={columns}
				data={data}
				keyFn={(d) => d.id}
				searchPlaceholder="Search deployables..."
				emptyMessage='No assemblies found. Click "Sync Chain" to discover your on-chain deployables.'
				actions={
					<>
						{syncStatus && <span className="text-xs text-zinc-500">{syncStatus}</span>}
						<button
							type="button"
							onClick={handleSync}
							disabled={syncing}
							className="flex shrink-0 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
						>
							{syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
							Sync Chain
						</button>
					</>
				}
			/>

			{typeof lastSync?.value === "string" && (
				<p className="mt-4 text-xs text-zinc-600">
					Last sync: {new Date(lastSync.value).toLocaleString()}
				</p>
			)}
		</div>
	);
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<p className="text-xs text-zinc-500">{label}</p>
			<p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
		</div>
	);
}
