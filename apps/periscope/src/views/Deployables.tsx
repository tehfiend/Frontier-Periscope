import { useState, useCallback, useMemo } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { discoverCharacterAndAssemblies } from "@/chain/queries";
import { syncTargetAssemblies } from "@/chain/sync";
import { buildRenameTx, isRenamableModule } from "@/chain/transactions";
import { useSponsoredTransaction } from "@/hooks/useSponsoredTransaction";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	Package,
	RefreshCw,
	Fuel,
	AlertTriangle,
	Loader2,
	User,
	Link2,
	ExternalLink,
	Trash2,
} from "lucide-react";
import { DataGrid, excelFilterFn, type ColumnDef } from "@/components/DataGrid";
import { EditableCell } from "@/components/EditableCell";
import type { DeployableIntel, AssemblyStatus } from "@/db/types";
import { FUEL_CRITICAL_HOURS, FUEL_WARNING_HOURS } from "@/lib/constants";
import { ASSEMBLY_TYPE_IDS } from "@/chain/config";

// ── Unified Row Type ────────────────────────────────────────────────────────

interface StructureRow {
	id: string;
	objectId: string;
	ownership: "mine" | "watched";
	assemblyType: string;
	status: AssemblyStatus;
	label: string;
	owner: string;
	ownerName?: string;
	systemId?: number;
	fuelLevel?: number;
	fuelExpiresAt?: string;
	notes?: string;
	tags: string[];
	source: "deployables" | "assemblies";
	ownerCapId?: string;
	assemblyModule?: string;
	characterObjectId?: string;
	updatedAt: string;
}

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
	if (hours < FUEL_CRITICAL_HOURS) return "text-red-400";
	if (hours < FUEL_WARNING_HOURS) return "text-orange-400";
	return "text-green-400";
}

function statusDotClass(status: string): string {
	switch (status) {
		case "online":
			return "bg-green-400";
		case "offline":
			return "bg-zinc-600";
		case "anchoring":
			return "bg-yellow-400";
		case "unanchoring":
			return "bg-orange-400";
		case "destroyed":
			return "bg-red-500";
		default:
			return "bg-zinc-700";
	}
}

/** Map OwnedAssembly.type to Move module name for rename PTB */
function assemblyKindToModule(
	kind: string,
): "turret" | "gate" | "storage_unit" | "network_node" | "assembly" {
	switch (kind) {
		case "turret":
			return "turret";
		case "gate":
			return "gate";
		case "storage_unit":
		case "smart_storage_unit":
		case "protocol_depot":
			return "storage_unit";
		case "network_node":
			return "network_node";
		default:
			return "assembly";
	}
}

// ── Fuel Data Fetch ─────────────────────────────────────────────────────────

async function fetchFuelData(
	client: SuiGraphQLClient,
	assemblyId: string,
): Promise<{ fuelLevel?: number; fuelExpiresAt?: string }> {
	try {
		const { object } = await client.getObject({
			objectId: assemblyId,
			include: { json: true },
		});
		if (!object?.json) return {};

		const fields = object.json as Record<string, unknown>;

		const fuelObj = fields.fuel as Record<string, unknown> | undefined;
		if (fuelObj) {
			const f = fuelObj;
			const quantity = Number(f.quantity ?? 0);
			const isBurning = f.is_burning as boolean;
			const burnRateMs = Number(f.burn_rate_in_ms ?? 0);
			const burnStartTime = Number(f.burn_start_time ?? 0);
			const prevElapsed = Number(f.previous_cycle_elapsed_time ?? 0);

			if (quantity > 0 && isBurning && burnRateMs > 0) {
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

		const energySourceId = fields.energy_source_id as string | undefined;
		if (energySourceId) {
			return fetchFuelData(client, energySourceId);
		}

		return {};
	} catch {
		return {};
	}
}

// ── Component ───────────────────────────────────────────────────────────────

export function Deployables() {
	const client = useSuiClient();
	const tenant = useActiveTenant();
	const { activeCharacter, activeSuiAddresses } = useActiveCharacter();
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const { executeSponsored, available: sponsorAvailable } = useSponsoredTransaction();

	const chainAddress = activeCharacter?.suiAddress ?? activeSuiAddresses[0] ?? null;
	const hasAddress = !!chainAddress;

	// ── DB Queries ───────────────────────────────────────────────────────────
	const deployables = useLiveQuery(
		() =>
			chainAddress
				? db.deployables.where("owner").equals(chainAddress).filter(notDeleted).toArray()
				: db.deployables.filter(notDeleted).toArray(),
		[chainAddress],
	);

	const assemblies = useLiveQuery(
		() => db.assemblies.filter(notDeleted).toArray(),
		[],
	);

	const players = useLiveQuery(() => db.players.filter(notDeleted).toArray(), []);
	const targets = useLiveQuery(() => db.targets.filter(notDeleted).toArray(), []);
	const lastSync = useLiveQuery(() => db.settings.get("lastChainSync"));

	// ── Owner Name Lookup ────────────────────────────────────────────────────
	const ownerNames = useMemo(() => {
		const map = new Map<string, string>();
		for (const p of players ?? []) {
			map.set(p.address, p.name);
		}
		return map;
	}, [players]);

	// ── Merge Rows ───────────────────────────────────────────────────────────
	const data: StructureRow[] = useMemo(() => {
		const seenObjectIds = new Set<string>();
		const rows: StructureRow[] = [];

		// Owned deployables first (they have richer data)
		for (const d of deployables ?? []) {
			seenObjectIds.add(d.objectId);
			rows.push({
				id: d.id,
				objectId: d.objectId,
				ownership: "mine",
				assemblyType: d.assemblyType,
				status: d.status,
				label: d.label || d.assemblyType,
				owner: d.owner ?? chainAddress ?? "",
				ownerName: d.owner ? ownerNames.get(d.owner) : undefined,
				systemId: d.systemId,
				fuelLevel: d.fuelLevel,
				fuelExpiresAt: d.fuelExpiresAt,
				notes: d.notes,
				tags: d.tags,
				source: "deployables",
				ownerCapId: d.ownerCapId,
				assemblyModule: d.assemblyModule,
				characterObjectId: d.characterObjectId,
				updatedAt: d.updatedAt,
			});
		}

		// Watched assemblies (skip duplicates already in deployables)
		for (const a of assemblies ?? []) {
			if (seenObjectIds.has(a.objectId)) continue;
			seenObjectIds.add(a.objectId);

			// Determine ownership: if the owner matches our addresses, mark as "mine"
			const isMine =
				chainAddress && a.owner === chainAddress
					? true
					: activeSuiAddresses.includes(a.owner);

			rows.push({
				id: a.id,
				objectId: a.objectId,
				ownership: isMine ? "mine" : "watched",
				assemblyType: a.assemblyType,
				status: a.status,
				label: a.label || a.assemblyType,
				owner: a.owner,
				ownerName: ownerNames.get(a.owner),
				systemId: a.systemId,
				notes: a.notes,
				tags: a.tags,
				source: "assemblies",
				updatedAt: a.updatedAt,
			});
		}

		return rows;
	}, [deployables, assemblies, chainAddress, activeSuiAddresses, ownerNames]);

	// ── Sync State ───────────────────────────────────────────────────────────
	const [syncing, setSyncing] = useState(false);
	const [syncStatus, setSyncStatus] = useState<string | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);

	// ── Sync Own Structures ──────────────────────────────────────────────────
	const handleSyncOwn = useCallback(async () => {
		if (!chainAddress || syncing) return;
		setSyncing(true);
		setSyncStatus("Syncing own structures...");
		try {
			const discovery = await discoverCharacterAndAssemblies(client, chainAddress, tenant);
			const now = new Date().toISOString();
			let totalCount = 0;

			for (const assembly of discovery.assemblies) {
				const typeIdNum = assembly.typeId;
				const typeName =
					ASSEMBLY_TYPE_IDS[typeIdNum] ?? assembly.type.replace("_", " ");
				const existing = await db.deployables
					.where("objectId")
					.equals(assembly.objectId)
					.first();

				let fuelData: { fuelLevel?: number; fuelExpiresAt?: string } = {};
				try {
					fuelData = await fetchFuelData(client, assembly.objectId);
				} catch {
					/* non-fatal */
				}

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
					// Phase 3: persist rename-related fields
					ownerCapId: assembly.ownerCapId ?? existing?.ownerCapId,
					assemblyModule:
						assemblyKindToModule(assembly.type) ?? existing?.assemblyModule,
					characterObjectId:
						discovery.character?.characterObjectId ??
						existing?.characterObjectId,
				});
				totalCount++;
			}

			setSyncStatus(`Synced ${totalCount} owned`);
			await db.settings.put({
				key: "lastChainSync",
				value: new Date().toISOString(),
			});
		} catch (e) {
			setSyncStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setSyncing(false);
		}
	}, [chainAddress, syncing, client, tenant]);

	// ── Sync Targets ─────────────────────────────────────────────────────────
	const handleSyncTargets = useCallback(async () => {
		if (syncing) return;
		const activeTargets =
			targets?.filter((t) => t.watchStatus === "active") ?? [];
		if (activeTargets.length === 0) {
			setSyncStatus("No active targets to sync");
			return;
		}
		setSyncing(true);
		setSyncStatus(`Syncing ${activeTargets.length} targets...`);
		try {
			let total = 0;
			for (const target of activeTargets) {
				const count = await syncTargetAssemblies(target.address);
				total += count;
			}
			setSyncStatus(`Found ${total} from ${activeTargets.length} targets`);
		} catch (e) {
			setSyncStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setSyncing(false);
		}
	}, [targets, syncing]);

	// ── Save Notes ───────────────────────────────────────────────────────────
	const handleSaveNotes = useCallback(async (row: StructureRow, newNotes: string) => {
		const now = new Date().toISOString();
		if (row.source === "deployables") {
			await db.deployables.update(row.id, {
				notes: newNotes || undefined,
				updatedAt: now,
			});
		} else {
			await db.assemblies.update(row.id, {
				notes: newNotes || undefined,
				updatedAt: now,
			});
		}
	}, []);

	// ── On-Chain Rename ──────────────────────────────────────────────────────
	const handleRename = useCallback(
		async (row: StructureRow, newName: string) => {
			if (!account || !newName || newName === row.label) return;
			if (!row.ownerCapId || !row.assemblyModule || !row.characterObjectId) {
				setSyncStatus("Missing rename data -- try re-syncing first");
				return;
			}

			setRenamingId(row.objectId);
			try {
				const tx = buildRenameTx({
					tenant,
					assemblyModule: row.assemblyModule,
					assemblyId: row.objectId,
					characterId: row.characterObjectId,
					ownerCapId: row.ownerCapId,
					newName,
					senderAddress: account.address,
				});

				if (sponsorAvailable) {
					await executeSponsored(tx);
				} else {
					await signAndExecute({ transaction: tx });
				}

				// Update local DB on success
				await db.deployables.update(row.id, {
					label: newName,
					updatedAt: new Date().toISOString(),
				});
				setSyncStatus(`Renamed to "${newName}"`);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				// Handle EMetadataNotSet (error code 7)
				if (msg.includes("7") && msg.includes("abort")) {
					setSyncStatus(
						"This structure has no metadata set on-chain. Contact support or deploy a new one.",
					);
				} else {
					setSyncStatus(`Rename failed: ${msg}`);
				}
			} finally {
				setRenamingId(null);
			}
		},
		[account, tenant, sponsorAvailable, executeSponsored, signAndExecute],
	);

	// ── Remove from tracking ─────────────────────────────────────────────────
	const handleRemove = useCallback(async (row: StructureRow) => {
		if (row.source === "assemblies") {
			await db.assemblies.update(row.id, {
				_deleted: true,
				updatedAt: new Date().toISOString(),
			});
		}
	}, []);

	// ── Stats ────────────────────────────────────────────────────────────────
	const stats = useMemo(() => {
		const mine = data.filter((d) => d.ownership === "mine").length;
		const watched = data.filter((d) => d.ownership === "watched").length;
		const online = data.filter((d) => d.status === "online").length;
		const offline = data.filter((d) => d.status === "offline").length;
		const warnings = data.filter((d) => {
			const h = fuelHoursRemaining(d);
			return h !== null && h > 0 && h < FUEL_WARNING_HOURS;
		}).length;
		return { total: data.length, mine, watched, online, offline, warnings };
	}, [data]);

	// ── Columns ──────────────────────────────────────────────────────────────
	const columns: ColumnDef<StructureRow, unknown>[] = useMemo(
		() => [
			{
				id: "status",
				accessorKey: "status",
				header: "Status",
				size: 100,
				filterFn: excelFilterFn,
				cell: ({ row }) => (
					<div className="flex items-center gap-2">
						<span
							className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(row.original.status)}`}
						/>
						<span className="capitalize">{row.original.status}</span>
					</div>
				),
			},
			{
				id: "label",
				accessorKey: "label",
				header: "Name",
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const r = row.original;
					const canRename =
						r.ownership === "mine" &&
						r.assemblyModule &&
						isRenamableModule(r.assemblyModule) &&
						r.ownerCapId &&
						r.characterObjectId;
					const isRenaming = renamingId === r.objectId;

					if (isRenaming) {
						return (
							<div className="flex items-center gap-2">
								<Loader2 size={12} className="animate-spin text-cyan-500" />
								<span className="text-xs text-zinc-400">Renaming...</span>
							</div>
						);
					}

					const disabledTooltip =
						r.ownership !== "mine"
							? "Only owned structures can be renamed"
							: r.assemblyModule &&
								  !isRenamableModule(r.assemblyModule)
								? "On-chain rename not supported for this structure type"
								: !account
									? "Connect wallet to rename"
									: !r.ownerCapId
										? "Sync chain data first"
										: undefined;

					return (
						<EditableCell
							value={r.label}
							onSave={(v) => handleRename(r, v)}
							editable={!!canRename && !!account}
							disabledTooltip={disabledTooltip}
						>
							<span className="font-medium text-zinc-100">
								{r.label || "\u2014"}
							</span>
							<span
								className="ml-2 font-mono text-xs text-zinc-600"
								title={r.objectId}
							>
								{r.objectId.slice(0, 8)}...
							</span>
						</EditableCell>
					);
				},
			},
			{
				id: "type",
				accessorFn: (d) => d.assemblyType,
				header: "Type",
				size: 150,
				filterFn: excelFilterFn,
			},
			{
				id: "ownership",
				accessorKey: "ownership",
				header: "Ownership",
				size: 100,
				filterFn: excelFilterFn,
				cell: ({ row }) => (
					<span
						className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
							row.original.ownership === "mine"
								? "bg-cyan-500/15 text-cyan-400"
								: "bg-zinc-700/50 text-zinc-400"
						}`}
					>
						{row.original.ownership === "mine" ? "Mine" : "Watched"}
					</span>
				),
			},
			{
				id: "owner",
				accessorFn: (d) => d.ownerName ?? d.owner,
				header: "Owner",
				size: 140,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const r = row.original;
					return (
						<div className="min-w-0">
							<span className="text-xs text-zinc-300">
								{r.ownerName ?? "Unknown"}
							</span>
							<div
								className="truncate font-mono text-xs text-zinc-600"
								title={r.owner}
							>
								{r.owner.slice(0, 6)}...{r.owner.slice(-4)}
							</div>
						</div>
					);
				},
			},
			{
				id: "fuelLevel",
				accessorFn: (d) => d.fuelLevel ?? null,
				header: "Fuel",
				size: 100,
				enableColumnFilter: false,
				cell: ({ row }) => (
					<span className="font-mono text-xs">
						{row.original.fuelLevel != null
							? row.original.fuelLevel.toLocaleString()
							: "\u2014"}
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
						<div
							className={`flex items-center gap-1 text-xs ${fuelColorClass(hours)}`}
						>
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
				cell: ({ row }) => {
					const r = row.original;
					return (
						<EditableCell
							value={r.notes ?? ""}
							onSave={(v) => handleSaveNotes(r, v)}
							className="text-xs text-zinc-500"
							placeholder="\u2014"
						/>
					);
				},
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
			{
				id: "actions",
				header: "Actions",
				size: 80,
				enableColumnFilter: false,
				enableSorting: false,
				cell: ({ row }) => {
					const r = row.original;
					return (
						<div className="flex items-center gap-1">
							<a
								href={`https://testnet.suivision.xyz/object/${r.objectId}`}
								target="_blank"
								rel="noopener noreferrer"
								className="text-zinc-600 hover:text-zinc-400"
								title="View on explorer"
							>
								<ExternalLink size={14} />
							</a>
							{r.source === "assemblies" && (
								<button
									type="button"
									onClick={() => handleRemove(r)}
									className="text-zinc-600 hover:text-red-400"
									title="Remove from tracking"
								>
									<Trash2 size={14} />
								</button>
							)}
						</div>
					);
				},
			},
		],
		[account, renamingId, handleRename, handleSaveNotes, handleRemove],
	);

	// ── No Address State ─────────────────────────────────────────────────────
	if (!hasAddress) {
		return (
			<div className="p-6">
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<Package size={24} className="text-emerald-500" />
					Structures
				</h1>
				<div className="mt-8 flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-12">
					{activeCharacter ? (
						<>
							<Link2 size={36} className="text-zinc-700" />
							<p className="text-sm text-zinc-500">
								No Sui address linked to{" "}
								<span className="text-zinc-300">
									{activeCharacter.characterName}
								</span>
							</p>
							<p className="text-xs text-zinc-600">
								Link an address in Settings or re-add the character to
								resolve from chain
							</p>
						</>
					) : (
						<>
							<User size={36} className="text-zinc-700" />
							<p className="text-sm text-zinc-500">
								Select a character to view their structures
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
						Structures
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{stats.total} structures &middot; {stats.mine} mine &middot;{" "}
						{stats.watched} watched &middot; {stats.online} online
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
			<div className="mb-6 grid grid-cols-5 gap-4">
				<StatCard label="Mine" value={stats.mine} color="text-cyan-400" />
				<StatCard label="Watched" value={stats.watched} color="text-zinc-300" />
				<StatCard label="Online" value={stats.online} color="text-green-400" />
				<StatCard label="Offline" value={stats.offline} color="text-zinc-500" />
				<StatCard
					label="Fuel Warnings"
					value={stats.warnings}
					color="text-orange-400"
				/>
			</div>

			{/* Data Grid */}
			<DataGrid
				columns={columns}
				data={data}
				keyFn={(d) => d.id}
				searchPlaceholder="Search structures, owners, notes..."
				emptyMessage='No structures found. Click "Sync Chain" to discover your on-chain deployables, or add targets in the Watchlist.'
				actions={
					<>
						{syncStatus && (
							<span className="text-xs text-zinc-500">{syncStatus}</span>
						)}
						<button
							type="button"
							onClick={handleSyncOwn}
							disabled={syncing}
							className="flex shrink-0 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
						>
							{syncing ? (
								<Loader2 size={14} className="animate-spin" />
							) : (
								<RefreshCw size={14} />
							)}
							Sync Chain
						</button>
						<button
							type="button"
							onClick={handleSyncTargets}
							disabled={syncing}
							className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
						>
							{syncing ? (
								<Loader2 size={14} className="animate-spin" />
							) : (
								<RefreshCw size={14} />
							)}
							Sync Targets
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

function StatCard({
	label,
	value,
	color,
}: { label: string; value: number; color: string }) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<p className="text-xs text-zinc-500">{label}</p>
			<p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
		</div>
	);
}
