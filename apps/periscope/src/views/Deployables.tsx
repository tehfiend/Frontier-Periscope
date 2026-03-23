import { discoverCharacterAndAssemblies } from "@/chain/queries";
import { syncTargetAssemblies } from "@/chain/sync";
import { buildRenameTx, isRenamableModule } from "@/chain/transactions";
import { db, notDeleted } from "@/db";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { canRevokeExtension, useExtensionRevoke } from "@/hooks/useExtensionRevoke";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	ASSEMBLY_TYPE_IDS,
	TENANTS,
	type TenantId,
	classifyExtension,
	getTemplate,
} from "@/chain/config";
import { crossReferencePrivateMapLocations } from "@/chain/manifest";
import type { OwnedAssembly } from "@/chain/queries";
import { CopyAddress } from "@/components/CopyAddress";
import { type ColumnDef, DataGrid, excelFilterFn } from "@/components/DataGrid";
import { EditableCell } from "@/components/EditableCell";
import { StructureDetailCard } from "@/components/StructureDetailCard";
import { SystemSearch } from "@/components/SystemSearch";
import { DeployExtensionPanel } from "@/components/extensions/DeployExtensionPanel";
import type { AssemblyStatus, Celestial, DeployableIntel, SolarSystem } from "@/db/types";
import { PLANET_TYPE_NAMES, ensureCelestialsLoaded } from "@/lib/celestials";
import { FUEL_CRITICAL_HOURS, FUEL_WARNING_HOURS } from "@/lib/constants";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	AlertTriangle,
	AppWindow,
	ExternalLink,
	Fuel,
	Link2,
	Loader2,
	MapPin,
	Package,
	Puzzle,
	RefreshCw,
	Telescope,
	Trash2,
	User,
} from "lucide-react";

// ── Unified Row Type ────────────────────────────────────────────────────────

export interface StructureRow {
	id: string;
	objectId: string;
	ownership: "mine" | "watched";
	assemblyType: string;
	status: AssemblyStatus;
	label: string;
	owner: string;
	ownerName?: string;
	systemId?: number;
	lPoint?: string;
	fuelLevel?: number;
	fuelExpiresAt?: string;
	notes?: string;
	tags: string[];
	source: "deployables" | "assemblies";
	itemId?: string;
	dappUrl?: string;
	ownerCapId?: string;
	assemblyModule?: string;
	characterObjectId?: string;
	parentId?: string;
	extensionType?: string;
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
	const isValidTenant = tenant in TENANTS;
	const { activeCharacter, activeSuiAddresses } = useActiveCharacter();
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const executeSponsored = null;
	const sponsorAvailable = false;

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

	const assemblies = useLiveQuery(() => db.assemblies.filter(notDeleted).toArray(), []);

	const players = useLiveQuery(() => db.players.filter(notDeleted).toArray(), []);
	const targets = useLiveQuery(() => db.targets.filter(notDeleted).toArray(), []);
	const extensions = useLiveQuery(() => db.extensions.filter(notDeleted).toArray(), []);
	const lastSync = useLiveQuery(() => db.settings.get("lastChainSync"));

	// ── Solar System Lookup ──────────────────────────────────────────────────
	const systems = useLiveQuery(() => db.solarSystems.toArray()) ?? [];
	const systemNames = useMemo(() => {
		const map = new Map<number, string>();
		for (const s of systems) {
			if (s.name) map.set(s.id, s.name);
		}
		return map;
	}, [systems]);

	// ── Owner Name Lookup (players + manifest characters) ─────────────────
	const manifestChars = useLiveQuery(() => db.manifestCharacters.toArray()) ?? [];

	const ownerNames = useMemo(() => {
		const map = new Map<string, string>();
		// Manifest characters first (lower priority)
		for (const mc of manifestChars) {
			if (mc.name && mc.suiAddress) map.set(mc.suiAddress, mc.name);
		}
		// Players override (higher priority)
		for (const p of players ?? []) {
			map.set(p.address, p.name);
		}
		return map;
	}, [players, manifestChars]);

	// ── Extension Lookup (from local deploy records) ────────────────────────
	const extensionByAssembly = useMemo(() => {
		const map = new Map<string, string>();
		for (const ext of extensions ?? []) {
			const tmpl = getTemplate(ext.templateId);
			if (!tmpl) continue;
			const pkgId = tmpl.packageIds[tenant as TenantId];
			if (pkgId) {
				map.set(ext.assemblyId, `${pkgId}::${tmpl.witnessType}`);
			}
		}
		return map;
	}, [extensions, tenant]);

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
				lPoint: d.lPoint,
				fuelLevel: d.fuelLevel,
				fuelExpiresAt: d.fuelExpiresAt,
				notes: d.notes,
				tags: d.tags,
				source: "deployables",
				itemId: d.itemId,
				dappUrl: d.dappUrl,
				ownerCapId: d.ownerCapId,
				assemblyModule: d.assemblyModule,
				characterObjectId: d.characterObjectId,
				parentId: d.parentId,
				extensionType: extensionByAssembly.get(d.objectId) ?? d.extensionType,
				updatedAt: d.updatedAt,
			});
		}

		// Watched assemblies (skip duplicates already in deployables)
		for (const a of assemblies ?? []) {
			if (seenObjectIds.has(a.objectId)) continue;
			seenObjectIds.add(a.objectId);

			// Determine ownership: if the owner matches our addresses, mark as "mine"
			const isMine =
				chainAddress && a.owner === chainAddress ? true : activeSuiAddresses.includes(a.owner);

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
				lPoint: a.lPoint,
				notes: a.notes,
				tags: a.tags,
				source: "assemblies",
				parentId: a.parentId,
				extensionType: extensionByAssembly.get(a.objectId) ?? a.extensionType,
				updatedAt: a.updatedAt,
			});
		}

		return rows;
	}, [deployables, assemblies, chainAddress, activeSuiAddresses, ownerNames, extensionByAssembly]);

	// ── Sync State ───────────────────────────────────────────────────────────
	const [syncing, setSyncing] = useState(false);
	const [syncStatus, setSyncStatus] = useState<string | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [deployTarget, setDeployTarget] = useState<StructureRow | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [revokingId, setRevokingId] = useState<string | null>(null);
	const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
	const { revoke: executeRevoke } = useExtensionRevoke();

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
				const typeName = ASSEMBLY_TYPE_IDS[typeIdNum] ?? assembly.type.replace("_", " ");
				const existing = await db.deployables.where("objectId").equals(assembly.objectId).first();

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
					lPoint: existing?.lPoint,
					fuelLevel: fuelData.fuelLevel ?? existing?.fuelLevel,
					fuelExpiresAt: fuelData.fuelExpiresAt ?? existing?.fuelExpiresAt,
					notes: existing?.notes,
					parentId: assembly.energySourceId ?? existing?.parentId,
					extensionType: assembly.extensionType ?? existing?.extensionType,
					tags: existing?.tags ?? [],
					source: "chain",
					createdAt: existing?.createdAt ?? now,
					updatedAt: now,
					itemId: assembly.itemId ?? existing?.itemId,
					dappUrl: assembly.dappUrl ?? existing?.dappUrl,
					ownerCapId: assembly.ownerCapId ?? existing?.ownerCapId,
					assemblyModule: assemblyKindToModule(assembly.type) ?? existing?.assemblyModule,
					characterObjectId: discovery.character?.characterObjectId ?? existing?.characterObjectId,
				});
				totalCount++;
			}

			setSyncStatus(`Synced ${totalCount} owned`);
			// Cross-reference private map locations with structures
			await crossReferencePrivateMapLocations();
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
		const activeTargets = targets?.filter((t) => t.watchStatus === "active") ?? [];
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

	// ── Parent Label Lookup ──────────────────────────────────────────────────
	const parentLabels = useMemo(() => {
		const map = new Map<string, string>();
		for (const row of data) {
			map.set(row.id, row.label);
		}
		return map;
	}, [data]);

	// ── Save Parent ──────────────────────────────────────────────────────────
	const handleSaveParent = useCallback(async (row: StructureRow, parentId: string | undefined) => {
		const now = new Date().toISOString();
		if (row.source === "deployables") {
			await db.deployables.update(row.id, { parentId, updatedAt: now });
		} else {
			await db.assemblies.update(row.id, { parentId, updatedAt: now });
		}
	}, []);

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

	// ── Save Location ───────────────────────────────────────────────────────
	const handleSaveLocation = useCallback(
		async (row: StructureRow, systemId: number | undefined, lPoint: string | undefined) => {
			const now = new Date().toISOString();
			if (row.source === "deployables") {
				await db.deployables.update(row.id, {
					systemId,
					lPoint,
					updatedAt: now,
				});
			} else {
				await db.assemblies.update(row.id, {
					systemId,
					lPoint,
					updatedAt: now,
				});
			}
		},
		[],
	);

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

				await signAndExecute({ transaction: tx });

				// Update local DB on success
				const now = new Date().toISOString();
				if (row.source === "assemblies") {
					await db.assemblies.update(row.id, { label: newName, updatedAt: now });
				} else {
					await db.deployables.update(row.id, { label: newName, updatedAt: now });
				}
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

	// ── Revoke Extension ─────────────────────────────────────────
	const handleRevoke = useCallback(
		async (row: StructureRow) => {
			if (!account || !row.ownerCapId || !row.characterObjectId) {
				setSyncStatus("Missing data for revoke -- try re-syncing first");
				return;
			}
			if (!isValidTenant) {
				setSyncStatus(`Unknown tenant "${tenant}" -- cannot revoke`);
				return;
			}

			if (!row.assemblyModule) {
				console.warn(
					`[Deployables] assemblyModule missing for ${row.objectId} -- cannot revoke without it`,
				);
				setSyncStatus("Cannot revoke: assembly module unknown -- try re-syncing first");
				return;
			}

			setRevokingId(row.objectId);
			try {
				await executeRevoke({
					assemblyId: row.objectId,
					assemblyType: row.assemblyModule,
					characterId: row.characterObjectId,
					ownerCapId: row.ownerCapId,
					tenant: tenant as TenantId,
				});
				setSyncStatus("Extension revoked successfully");

				// Update local extensionType
				const now = new Date().toISOString();
				if (row.source === "deployables") {
					await db.deployables.update(row.id, { extensionType: undefined, updatedAt: now });
				} else {
					await db.assemblies.update(row.id, { extensionType: undefined, updatedAt: now });
				}
			} catch (e) {
				setSyncStatus(`Revoke failed: ${e instanceof Error ? e.message : String(e)}`);
			} finally {
				setRevokingId(null);
				setRevokeConfirmId(null);
			}
		},
		[account, tenant, isValidTenant, executeRevoke],
	);

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
							: r.assemblyModule && !isRenamableModule(r.assemblyModule)
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
							<span className="font-medium text-zinc-100">{r.label || "\u2014"}</span>
							<CopyAddress
								address={r.objectId}
								sliceStart={8}
								sliceEnd={0}
								className="ml-2 text-xs text-zinc-600"
							/>
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
				id: "extension",
				accessorFn: (d) => classifyExtension(d.extensionType, tenant as TenantId).status,
				header: "Extension",
				size: 150,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const r = row.original;
					const info = classifyExtension(r.extensionType, tenant as TenantId);

					const actionLabel =
						info.status === "periscope-outdated"
							? "Update"
							: info.status === "periscope"
								? "Change"
								: "Deploy";

					return (
						<div className="flex items-center gap-1.5">
							{info.status === "default" && <span className="text-xs text-zinc-600">Default</span>}
							{info.status === "periscope" && (
								<>
									<Telescope size={14} className="text-cyan-500" />
									<span className="text-xs text-cyan-400">
										{info.template?.name ?? "Periscope"}
									</span>
								</>
							)}
							{info.status === "periscope-outdated" && (
								<>
									<Telescope size={14} className="text-amber-500" />
									<AlertTriangle size={10} className="text-amber-400" />
									<span className="text-xs text-amber-400">Outdated</span>
								</>
							)}
							{info.status === "unknown" && (
								<>
									<Puzzle size={14} className="text-amber-500" />
									<span className="text-xs text-amber-400">Custom</span>
								</>
							)}
							{r.ownership === "mine" && (
								<div className="ml-auto flex items-center gap-1">
									{info.status !== "default" &&
										r.characterObjectId &&
										r.ownerCapId &&
										canRevokeExtension(r.assemblyModule ?? "") &&
										(revokingId === r.objectId ? (
											<span className="text-[10px] text-zinc-400">
												<Loader2 size={10} className="inline animate-spin" /> Revoking...
											</span>
										) : revokeConfirmId === r.objectId ? (
											<>
												<button
													type="button"
													onClick={() => {
														setRevokeConfirmId(null);
														handleRevoke(r);
													}}
													className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-900/30"
												>
													Confirm
												</button>
												<button
													type="button"
													onClick={() => setRevokeConfirmId(null)}
													className="text-[10px] text-zinc-500 hover:text-zinc-300"
												>
													Cancel
												</button>
											</>
										) : (
											<button
												type="button"
												onClick={() => setRevokeConfirmId(r.objectId)}
												className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-900/30"
												title="Remove extension (reset to default)"
											>
												Reset
											</button>
										))}
									<button
										type="button"
										onClick={() => setDeployTarget(r)}
										className="rounded px-1.5 py-0.5 text-[10px] font-medium text-cyan-400 hover:bg-cyan-900/30"
									>
										{actionLabel}
									</button>
								</div>
							)}
						</div>
					);
				},
			},
			{
				id: "location",
				accessorFn: (d) => {
					const sysName = d.systemId ? (systemNames.get(d.systemId) ?? "") : "";
					if (sysName && d.lPoint) return `${sysName} -- ${d.lPoint}`;
					if (sysName) return sysName;
					if (d.lPoint) return d.lPoint;
					return "";
				},
				header: "Location",
				size: 200,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const r = row.original;
					return (
						<LocationEditor
							row={r}
							systems={systems}
							systemNames={systemNames}
							onSave={handleSaveLocation}
						/>
					);
				},
			},
			{
				id: "parent",
				accessorFn: (d) => (d.parentId ? (parentLabels.get(d.parentId) ?? "") : ""),
				header: "Parent",
				size: 160,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const r = row.original;
					return (
						<ParentSelect
							value={r.parentId}
							options={data.filter((d) => d.id !== r.id)}
							onSave={(id) => handleSaveParent(r, id)}
						/>
					);
				},
			},
			{
				id: "owner",
				accessorFn: (d) => d.ownerName ?? d.owner,
				header: "Owner",
				size: 180,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const r = row.original;
					return (
						<div className="flex min-w-0 items-center gap-1.5">
							<span
								className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
									r.ownership === "mine"
										? "bg-cyan-500/15 text-cyan-400"
										: "bg-zinc-700/50 text-zinc-400"
								}`}
							>
								{r.ownership === "mine" ? "Mine" : "Watched"}
							</span>
							<div className="min-w-0">
								<span className="text-xs text-zinc-300">{r.ownerName ?? "Unknown"}</span>
								<CopyAddress
									address={r.owner}
									sliceStart={6}
									sliceEnd={4}
									className="block text-xs text-zinc-600"
								/>
							</div>
						</div>
					);
				},
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
					const dappHref = r.dappUrl
						? r.dappUrl.startsWith("http")
							? r.dappUrl
							: `https://${r.dappUrl}`
						: r.itemId
							? `${TENANTS[tenant]?.dappUrl ?? `https://dapps.evefrontier.com/?tenant=${tenant}`}&itemId=${r.itemId}`
							: undefined;
					return (
						<div className="flex items-center gap-1">
							{dappHref && (
								<a
									href={dappHref}
									target="_blank"
									rel="noopener noreferrer"
									className="text-zinc-600 hover:text-cyan-400"
									title="Open dApp"
								>
									<AppWindow size={14} />
								</a>
							)}
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
		[
			account,
			tenant,
			renamingId,
			handleRename,
			handleSaveNotes,
			handleSaveLocation,
			handleSaveParent,
			handleRemove,
			handleRevoke,
			revokingId,
			revokeConfirmId,
			setDeployTarget,
			data,
			parentLabels,
			systems,
			systemNames,
		],
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
								<span className="text-zinc-300">{activeCharacter.characterName}</span>
							</p>
							<p className="text-xs text-zinc-600">
								Link an address in Settings or re-add the character to resolve from chain
							</p>
						</>
					) : (
						<>
							<User size={36} className="text-zinc-700" />
							<p className="text-sm text-zinc-500">Select a character to view their structures</p>
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
						{stats.total} structures &middot; {stats.mine} mine &middot; {stats.watched} watched
						&middot; {stats.online} online
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
				<StatCard label="Fuel Warnings" value={stats.warnings} color="text-orange-400" />
			</div>

			{/* Data Grid */}
			<DataGrid
				columns={columns}
				data={data}
				keyFn={(d) => d.id}
				searchPlaceholder="Search structures, owners, notes..."
				emptyMessage='No structures found. Click "Sync Chain" to discover your on-chain deployables, or add targets in the Watchlist.'
				selectedRowId={selectedId ?? undefined}
				onRowClick={(id) => setSelectedId(id === selectedId ? null : id)}
				actions={
					<>
						{syncStatus && <span className="text-xs text-zinc-500">{syncStatus}</span>}
						<button
							type="button"
							onClick={handleSyncOwn}
							disabled={syncing}
							className="flex shrink-0 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
						>
							{syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
							Sync Chain
						</button>
						<button
							type="button"
							onClick={handleSyncTargets}
							disabled={syncing}
							className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
						>
							{syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
							Sync Targets
						</button>
					</>
				}
			/>

			{/* Structure Detail Card */}
			<StructureDetailCard
				row={data.find((d) => d.id === selectedId) ?? null}
				systemNames={systemNames}
				onSaveNotes={handleSaveNotes}
			/>

			{typeof lastSync?.value === "string" && (
				<p className="mt-4 text-xs text-zinc-600">
					Last sync: {new Date(lastSync.value).toLocaleString()}
				</p>
			)}

			{deployTarget && isValidTenant && (
				<DeployExtensionPanel
					assembly={structureRowToAssembly(deployTarget)}
					characterId={deployTarget.characterObjectId ?? ""}
					tenant={tenant as TenantId}
					onClose={() => setDeployTarget(null)}
				/>
			)}
		</div>
	);
}

/** Convert a StructureRow back to an OwnedAssembly for the deploy panel. */
function structureRowToAssembly(row: StructureRow): OwnedAssembly {
	// Map assemblyModule back to OwnedAssembly.type
	const moduleToKind: Record<string, OwnedAssembly["type"]> = {
		turret: "turret",
		gate: "gate",
		storage_unit: "storage_unit",
		network_node: "network_node",
	};
	const kind = row.assemblyModule
		? (moduleToKind[row.assemblyModule] ?? "storage_unit")
		: "storage_unit";

	return {
		objectId: row.objectId,
		type: kind,
		typeId: 0,
		status: row.status,
		extensionType: row.extensionType,
		ownerCapId: row.ownerCapId,
	};
}

function LocationEditor({
	row,
	systems,
	systemNames,
	onSave,
}: {
	row: StructureRow;
	systems: SolarSystem[];
	systemNames: Map<number, string>;
	onSave: (row: StructureRow, systemId: number | undefined, lPoint: string | undefined) => void;
}) {
	const [open, setOpen] = useState(false);
	const [selectedSystem, setSelectedSystem] = useState<number | null>(row.systemId ?? null);
	const [selectedLPoint, setSelectedLPoint] = useState<string | null>(row.lPoint ?? null);
	const [planets, setPlanets] = useState<Celestial[]>([]);
	const [selectedPlanet, setSelectedPlanet] = useState<number | null>(() => {
		// Parse planet index from existing lPoint (e.g. "P2-L3" -> 2)
		const match = row.lPoint?.match(/^P(\d+)-L[1-5]$/);
		return match ? Number(match[1]) : null;
	});
	const [selectedL, setSelectedL] = useState<number | null>(() => {
		// Parse L-point number from existing lPoint (e.g. "P2-L3" -> 3, or "L3" -> 3)
		const matchFull = row.lPoint?.match(/^P\d+-L([1-5])$/);
		if (matchFull) return Number(matchFull[1]);
		const matchSimple = row.lPoint?.match(/^L([1-5])$/);
		return matchSimple ? Number(matchSimple[1]) : null;
	});

	// Load planets when system changes
	useEffect(() => {
		if (!selectedSystem) {
			setPlanets([]);
			return;
		}
		let cancelled = false;
		ensureCelestialsLoaded().then(() => {
			if (cancelled) return;
			db.celestials
				.where("systemId")
				.equals(selectedSystem)
				.sortBy("index")
				.then((result) => {
					if (!cancelled) setPlanets(result);
				});
		});
		return () => {
			cancelled = true;
		};
	}, [selectedSystem]);

	// Build display text
	const sysName = row.systemId ? (systemNames.get(row.systemId) ?? "") : "";
	const displayText =
		sysName && row.lPoint ? `${sysName} -- ${row.lPoint}` : sysName || row.lPoint || "";

	function handleSystemChange(id: number | null) {
		setSelectedSystem(id);
		// Reset planet and L-point when system changes
		setSelectedPlanet(null);
		setSelectedL(null);
		setSelectedLPoint(null);
	}

	function handlePlanetSelect(planetIndex: number) {
		setSelectedPlanet(planetIndex);
		// If L-point already selected, build the combined string
		if (selectedL) {
			setSelectedLPoint(`P${planetIndex}-L${selectedL}`);
		}
	}

	function handleLPointSelect(l: number) {
		setSelectedL(l);
		if (selectedPlanet) {
			setSelectedLPoint(`P${selectedPlanet}-L${l}`);
		} else {
			setSelectedLPoint(`L${l}`);
		}
	}

	function handleSave() {
		onSave(row, selectedSystem ?? undefined, selectedLPoint ?? undefined);
		setOpen(false);
	}

	function handleClear() {
		onSave(row, undefined, undefined);
		setOpen(false);
		setSelectedSystem(null);
		setSelectedPlanet(null);
		setSelectedL(null);
		setSelectedLPoint(null);
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex w-full items-center gap-1.5 text-left text-xs text-zinc-400 hover:text-zinc-200"
			>
				{displayText ? (
					<>
						<MapPin size={12} className="shrink-0 text-cyan-500" />
						<span className="truncate">{displayText}</span>
					</>
				) : (
					<span className="text-zinc-600">{"\u2014"}</span>
				)}
			</button>
		);
	}

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(false)}
				className="flex w-full items-center gap-1.5 text-left text-xs text-cyan-400"
			>
				<MapPin size={12} className="shrink-0" />
				<span className="truncate">{displayText || "Set location..."}</span>
			</button>

			{/* Popover */}
			<div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
				{/* System search */}
				<SystemSearch
					value={selectedSystem}
					onChange={handleSystemChange}
					systems={systems}
					placeholder="Search system..."
					compact
				/>

				{/* Planet selector */}
				{selectedSystem && planets.length > 0 && (
					<div className="mt-2">
						<label className="mb-1 block text-[10px] font-medium uppercase text-zinc-500">
							Planet
						</label>
						<div className="flex flex-wrap gap-1">
							{planets.map((p) => {
								const typeName = PLANET_TYPE_NAMES[p.typeId] ?? "Unknown";
								return (
									<button
										key={p.id}
										type="button"
										onClick={() => handlePlanetSelect(p.index)}
										title={`${typeName} (P${p.index})`}
										className={`rounded px-2 py-1 text-xs transition-colors ${
											selectedPlanet === p.index
												? "bg-cyan-900/50 text-cyan-400"
												: "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
										}`}
									>
										P{p.index}
									</button>
								);
							})}
						</div>
					</div>
				)}

				{/* L-point selector */}
				<div className="mt-2">
					<label className="mb-1 block text-[10px] font-medium uppercase text-zinc-500">
						L-Point
					</label>
					<div className="flex gap-1">
						{[1, 2, 3, 4, 5].map((l) => (
							<button
								key={l}
								type="button"
								onClick={() => handleLPointSelect(l)}
								className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
									selectedL === l
										? "bg-cyan-900/50 text-cyan-400"
										: "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
								}`}
							>
								L{l}
							</button>
						))}
					</div>
				</div>

				{/* Preview */}
				{(selectedSystem || selectedLPoint) && (
					<div className="mt-2 rounded bg-zinc-800/50 px-2 py-1 text-xs text-zinc-300">
						{selectedSystem ? (systemNames.get(selectedSystem) ?? `#${selectedSystem}`) : ""}
						{selectedSystem && selectedLPoint ? " -- " : ""}
						{selectedLPoint ?? ""}
					</div>
				)}

				{/* Actions */}
				<div className="mt-2 flex justify-end gap-2">
					{(row.systemId || row.lPoint) && (
						<button
							type="button"
							onClick={handleClear}
							className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/20 hover:text-red-300"
						>
							Clear
						</button>
					)}
					<button
						type="button"
						onClick={() => setOpen(false)}
						className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSave}
						className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-500"
					>
						Save
					</button>
				</div>
			</div>
		</div>
	);
}

function ParentSelect({
	value,
	options,
	onSave,
}: {
	value?: string;
	options: StructureRow[];
	onSave: (id: string | undefined) => void;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const filtered = useMemo(() => {
		if (!search) return options;
		const q = search.toLowerCase();
		return options.filter(
			(o) => o.label.toLowerCase().includes(q) || o.assemblyType.toLowerCase().includes(q),
		);
	}, [options, search]);

	const selectedLabel = value ? (options.find((o) => o.id === value)?.label ?? "Unknown") : null;

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="w-full text-left text-xs text-zinc-400 hover:text-zinc-200"
			>
				{selectedLabel ?? "\u2014"}
			</button>
		);
	}

	return (
		<div className="relative">
			<input
				type="text"
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") setOpen(false);
				}}
				placeholder="Search..."
				className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
			/>
			<div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-56 overflow-auto rounded border border-zinc-700 bg-zinc-900 shadow-lg">
				{value && (
					<button
						type="button"
						onClick={() => {
							onSave(undefined);
							setOpen(false);
							setSearch("");
						}}
						className="w-full px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
					>
						Clear parent
					</button>
				)}
				{filtered.slice(0, 20).map((o) => (
					<button
						type="button"
						key={o.id}
						onClick={() => {
							onSave(o.id);
							setOpen(false);
							setSearch("");
						}}
						className={`w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
							o.id === value ? "text-cyan-400" : "text-zinc-300"
						}`}
					>
						<span className="font-medium">{o.label}</span>
						<span className="ml-2 text-zinc-600">{o.assemblyType}</span>
					</button>
				))}
				{filtered.length === 0 && <div className="px-3 py-2 text-xs text-zinc-600">No matches</div>}
			</div>
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
