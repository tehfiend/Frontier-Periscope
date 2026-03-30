import { discoverCharacterAndAssemblies } from "@/chain/queries";
import { buildRenameTx, isRenamableModule } from "@/chain/transactions";
import { db } from "@/db";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useContacts } from "@/hooks/useContacts";
import { useExtensionRevoke } from "@/hooks/useExtensionRevoke";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useStructureExtensions } from "@/hooks/useStructureExtensions";
import { useStructureRows } from "@/hooks/useStructureRows";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ASSEMBLY_TYPE_IDS, TENANTS, type TenantId, classifyExtension, getWorldTarget } from "@/chain/config";
import { ASSEMBLY_MODULE_MAP } from "@tehfrontier/chain-shared";
import { Transaction } from "@mysten/sui/transactions";
import {
	crossReferenceManifestLocations,
	crossReferencePrivateMapLocations,
} from "@/chain/manifest";
import type { OwnedAssembly } from "@/chain/queries";
import { AddToMapDialog } from "@/components/AddToMapDialog";
import { CopyAddress } from "@/components/CopyAddress";
import { type ColumnDef, DataGrid, excelFilterFn } from "@/components/DataGrid";
import { EditableCell } from "@/components/EditableCell";
import { StructureDetailCard } from "@/components/StructureDetailCard";
import { SystemSearch } from "@/components/SystemSearch";
import { DeployExtensionPanel } from "@/components/extensions/DeployExtensionPanel";
import type { AssemblyStatus, Celestial, DeployableIntel, SolarSystem } from "@/db/types";
import { PLANET_TYPE_NAMES, ensureCelestialsLoaded } from "@/lib/celestials";
import { FUEL_CRITICAL_HOURS, FUEL_WARNING_HOURS } from "@/lib/constants";
import { type CsvColumn, exportToCsv } from "@/lib/csv";
import { formatLocation } from "@/lib/format";
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

function resolveCategory(assemblyType: string, catMap: Map<string, string>): string {
	// Direct match from gameTypes DB (e.g. "Heavy Storage" -> "Ship / Drone / Structure Equipment")
	const direct = catMap.get(assemblyType);
	if (direct) return direct;
	// Fallback: keyword-based classification
	const lower = assemblyType.toLowerCase();
	if (lower.includes("turret")) return "Turret";
	if (lower.includes("gate") || lower.includes("jumpgate") || lower.includes("stargate"))
		return "Gate";
	if (lower.includes("storage") || lower.includes("depot") || lower.includes("gatekeeper"))
		return "Storage";
	if (lower.includes("node")) return "Node";
	if (lower.includes("refinery") || lower.includes("printer") || lower.includes("manufacturing"))
		return "Production";
	if (lower.includes("refuge")) return "Habitat";
	return "Other";
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

/** Friendly names for assembly kinds (from OwnedAssembly.type) */
const ASSEMBLY_KIND_NAMES: Record<string, string> = {
	storage_unit: "Storage Unit",
	smart_storage_unit: "Smart Storage Unit",
	protocol_depot: "Protocol Depot",
	gate: "Stargate",
	turret: "Turret",
	network_node: "Network Node",
};

/** Old generic type names that should be overwritten on re-sync */
const AUTO_TYPE_NAMES = new Set([
	"Smart Storage Unit",
	"Storage Unit",
	"Heavy Storage",
	"Gate",
	"Turret",
	"Assembly",
	"Network Node",
	"Manufacturing",
	"Refinery",
	"storage unit",
]);

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

	// ── Structure Extension Configs ──────────────────────────────────────────
	const { configMap: extensionConfigMap } = useStructureExtensions();

	// ── Show All Toggle ──────────────────────────────────────────────────────
	const [showAll, setShowAll] = useState(false);

	// ── Structure Rows (filtered or unfiltered) ──────────────────────────────
	const { data } = useStructureRows({
		activeAddresses: activeSuiAddresses,
		tenant,
		showAll,
	});

	const lastSync = useLiveQuery(() => db.settings.get("lastChainSync"));

	// ── Category Lookup (from gameTypes DB) ─────────────────────────────────
	const assemblyCategoryMap =
		useLiveQuery(async () => {
			const typeIds = Object.keys(ASSEMBLY_TYPE_IDS).map(Number);
			const types = await db.gameTypes.where("id").anyOf(typeIds).toArray();
			const map = new Map<string, string>();
			for (const t of types) {
				const assemblyName = ASSEMBLY_TYPE_IDS[t.id];
				if (assemblyName) {
					map.set(assemblyName, t.categoryName);
				}
			}
			return map;
		}) ?? new Map<string, string>();

	// ── Solar System Lookup ──────────────────────────────────────────────────
	const systems = useLiveQuery(() => db.solarSystems.toArray()) ?? [];
	const systemNames = useMemo(() => {
		const map = new Map<number, string>();
		for (const s of systems) {
			if (s.name) map.set(s.id, s.name);
		}
		return map;
	}, [systems]);

	// ── Market Currency Lookup ───────────────────────────────────────────────
	const manifestMarkets = useLiveQuery(() => db.manifestMarkets.toArray(), []) ?? [];
	const currencyByMarketId = useMemo(() => {
		const map = new Map<string, string>();
		for (const m of manifestMarkets) {
			// Extract ticker from coinType (e.g. "0xabc::token::TOKEN" -> "TOKEN")
			const parts = m.coinType.split("::");
			const ticker = parts.length >= 3 ? parts[parts.length - 1] : m.coinType;
			map.set(m.id, ticker);
		}
		return map;
	}, [manifestMarkets]);

	// ── Contacts / Standings ─────────────────────────────────────────────────
	const contacts = useContacts();

	const standingByName = useMemo(() => {
		const m = new Map<string, number>();
		for (const c of contacts) {
			if (c.characterName) m.set(c.characterName, c.standing);
		}
		return m;
	}, [contacts]);

	// ── Quick Filter ─────────────────────────────────────────────────────────
	const [quickFilter, setQuickFilter] = useState<"all" | "mine" | "friendly" | "hostile">("all");

	const filteredData = useMemo(() => {
		if (quickFilter === "all") return data;
		if (quickFilter === "mine") return data.filter((d) => d.ownership === "mine");
		if (quickFilter === "friendly")
			return data.filter((d) => {
				const standing = standingByName.get(d.ownerName ?? "");
				return standing != null && standing > 0;
			});
		if (quickFilter === "hostile")
			return data.filter((d) => {
				const standing = standingByName.get(d.ownerName ?? "");
				return standing != null && standing < 0;
			});
		return data;
	}, [data, quickFilter, standingByName]);

	// ── Sync State ───────────────────────────────────────────────────────────
	const [syncing, setSyncing] = useState(false);
	const [syncStatus, setSyncStatus] = useState<string | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [deployTarget, setDeployTarget] = useState<StructureRow | null>(null);
	const [addToMapTarget, setAddToMapTarget] = useState<StructureRow | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [revokingId, setRevokingId] = useState<string | null>(null);
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
				const typeName =
					ASSEMBLY_TYPE_IDS[typeIdNum] ??
					ASSEMBLY_KIND_NAMES[assembly.type] ??
					assembly.type.replace("_", " ");
				const existing = await db.deployables.where("objectId").equals(assembly.objectId).first();
				// Use on-chain metadata name if available; otherwise fall back to type name
				const chainName = assembly.name || undefined;
				const isAutoLabel =
					!existing?.label ||
					existing.label === existing.assemblyType ||
					Object.values(ASSEMBLY_TYPE_IDS).includes(existing.label) ||
					AUTO_TYPE_NAMES.has(existing.label);
				const label = chainName ?? (isAutoLabel ? typeName : existing.label);

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
					label,
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
			// Cross-reference locations with structures
			await crossReferencePrivateMapLocations();
			const allManifestLocIds = (await db.manifestLocations.toArray()).map((l) => l.id);
			if (allManifestLocIds.length > 0) {
				await crossReferenceManifestLocations(allManifestLocIds);
			}
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

	// ── Parent Label Lookup ──────────────────────────────────────────────────
	const parentLabels = useMemo(() => {
		const map = new Map<string, string>();
		for (const row of data) {
			map.set(row.id, row.label);
			map.set(row.objectId, row.label);
		}
		return map;
	}, [data]);

	// ── Save Parent ──────────────────────────────────────────────────────────
	const handleSaveParent = useCallback(async (row: StructureRow, parentId: string | undefined) => {
		// Prevent persisting self-referential parentId (nodes display themselves via UI logic)
		if (parentId && (parentId === row.objectId || parentId === row.id)) return;
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
			}
		},
		[account, tenant, isValidTenant, executeRevoke],
	);

	// ── Power Toggle ────────────────────────────────────────────────────────
	const [powerTogglingId, setPowerTogglingId] = useState<string | null>(null);

	const handlePowerToggle = useCallback(
		async (row: StructureRow) => {
			if (!account || !row.ownerCapId || !row.characterObjectId || !row.parentId) {
				setSyncStatus("Missing data for power toggle -- try re-syncing first");
				return;
			}
			if (!isValidTenant) return;

			if (!row.assemblyModule) {
				setSyncStatus("Cannot toggle power: assembly module unknown -- try re-syncing first");
				return;
			}
			const assemblyModule = row.assemblyModule;
			const moduleEntry = ASSEMBLY_MODULE_MAP[assemblyModule as keyof typeof ASSEMBLY_MODULE_MAP];
			if (!moduleEntry) {
				setSyncStatus(`Unsupported assembly type for power toggle: ${assemblyModule}`);
				return;
			}

			setPowerTogglingId(row.objectId);
			try {
				const worldPkg = TENANTS[tenant as TenantId].worldPackageId;
				const worldTarget = getWorldTarget(tenant as TenantId);
				const fullType = `${worldPkg}::${moduleEntry.module}::${moduleEntry.type}`;

				// Discover EnergyConfig singleton
				const ecResult: {
					data?: { objects?: { nodes: Array<{ address: string }> } } | null;
				} = await client.query({
					query: `query($type: String!) { objects(filter: { type: $type }, first: 1) { nodes { address } } }`,
					variables: { type: `${worldPkg}::energy::EnergyConfig` },
				});
				const energyConfigId = ecResult.data?.objects?.nodes?.[0]?.address;
				if (!energyConfigId) {
					setSyncStatus("Could not find EnergyConfig on chain");
					return;
				}

				const tx = new Transaction();
				tx.setSender(account.address);

				const [borrowedCap, receipt] = tx.moveCall({
					target: `${worldTarget}::character::borrow_owner_cap`,
					typeArguments: [fullType],
					arguments: [tx.object(row.characterObjectId), tx.object(row.ownerCapId)],
				});

				const target = row.status === "online"
					? `${worldTarget}::${moduleEntry.module}::offline`
					: `${worldTarget}::${moduleEntry.module}::online`;

				tx.moveCall({
					target,
					arguments: [
						tx.object(row.objectId),
						tx.object(row.parentId),
						tx.object(energyConfigId),
						borrowedCap,
					],
				});

				tx.moveCall({
					target: `${worldTarget}::character::return_owner_cap`,
					typeArguments: [fullType],
					arguments: [tx.object(row.characterObjectId), borrowedCap, receipt],
				});

				await signAndExecute({ transaction: tx });

				// Update local status
				const newStatus = row.status === "online" ? "offline" : "online";
				const now = new Date().toISOString();
				if (row.source === "deployables") {
					await db.deployables.update(row.id, { status: newStatus as AssemblyStatus, updatedAt: now });
				} else {
					await db.assemblies.update(row.id, { status: newStatus as AssemblyStatus, updatedAt: now });
				}
				setSyncStatus(`Structure ${newStatus === "online" ? "powered on" : "powered off"}`);
			} catch (e) {
				setSyncStatus(`Power toggle failed: ${e instanceof Error ? e.message : String(e)}`);
			} finally {
				setPowerTogglingId(null);
			}
		},
		[account, tenant, isValidTenant, client, signAndExecute],
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
				id: "actions",
				header: "Actions",
				size: 80,
				enableColumnFilter: false,
				enableSorting: false,
				cell: ({ row }) => {
					const r = row.original;
					const tenantDapp =
						TENANTS[tenant]?.dappUrl ?? `https://dapp.frontierperiscope.com/?tenant=${tenant}`;
					// Periscope dApp link: custom URL or default Periscope with itemId
					const periscopeHref = (() => {
						if (r.dappUrl) {
							try {
								const parsed = new URL(r.dappUrl.startsWith("http") ? r.dappUrl : `https://${r.dappUrl}`);
								if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
							} catch { /* invalid URL, fall through */ }
						}
						const url = new URL(tenantDapp);
						if (r.itemId) url.searchParams.set("itemId", r.itemId);
						else url.searchParams.set("objectId", r.objectId);
						return url.toString();
					})();
					// CCP default dApp link
					const ccpDapp = TENANTS[tenant]?.ccpDappUrl;
					const ccpHref = (() => {
						if (!ccpDapp || !r.itemId) return undefined;
						const url = new URL(ccpDapp);
						url.searchParams.set("tenant", tenant);
						url.searchParams.set("itemId", r.itemId);
						return url.toString();
					})();
					return (
						<div className="flex items-center gap-1">
							<a
								href={periscopeHref}
								target="_blank"
								rel="noopener noreferrer"
								className="text-zinc-600 hover:text-cyan-400"
								title="Open Periscope dApp"
							>
								<Telescope size={14} />
							</a>
							{ccpHref && (
								<a
									href={ccpHref}
									target="_blank"
									rel="noopener noreferrer"
									className="text-zinc-600 hover:text-zinc-400"
									title="Open CCP default dApp"
								>
									<ExternalLink size={14} />
								</a>
							)}
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
				id: "category",
				accessorFn: (d) => resolveCategory(d.assemblyType, assemblyCategoryMap),
				header: "Category",
				size: 110,
				filterFn: excelFilterFn,
			},
			{
				id: "extension",
				accessorFn: (d) => {
					const extConfig = extensionConfigMap.get(d.objectId);
					const info = classifyExtension(
						d.extensionType,
						tenant as TenantId,
						extConfig?.publishedPackageId,
					);
					if (extConfig?.registryName) return `${info.status} (${extConfig.registryName})`;
					return info.status;
				},
				header: "Extension",
				size: 200,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const r = row.original;
					const extConfig = extensionConfigMap.get(r.objectId);
					const info = classifyExtension(
						r.extensionType,
						tenant as TenantId,
						extConfig?.publishedPackageId,
					);

					const actionLabel =
						info.status === "periscope-outdated"
							? "Update"
							: info.status === "periscope"
								? "Configure"
								: "Deploy";

					return (
						<div className="flex items-center gap-1.5">
							{info.status === "default" &&
								(r.ownership === "mine" ? (
									<button
										type="button"
										onClick={() => setDeployTarget(r)}
										className="text-xs text-cyan-400 hover:text-cyan-300"
									>
										Deploy
									</button>
								) : (
									<span className="text-xs text-zinc-600">--</span>
								))}
							{info.status === "periscope" && (
								<>
									<Telescope size={14} className="text-cyan-500" />
									<span className="text-xs text-cyan-400">
										{info.template?.name ?? "Standings"}
									</span>
									{extConfig?.registryName && (
										<span className="rounded bg-cyan-500/10 px-1 py-0.5 text-[10px] font-medium text-cyan-400">
											{extConfig.registryName}
										</span>
									)}
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
							{r.ownership === "mine" && info.status !== "default" && (
								<div className="ml-auto flex items-center gap-1">
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
				id: "currency",
				accessorFn: (d) => {
					const extConfig = extensionConfigMap.get(d.objectId);
					return extConfig?.marketId ? (currencyByMarketId.get(extConfig.marketId) ?? "") : "";
				},
				header: "Currency",
				size: 100,
				filterFn: excelFilterFn,
			},
			{
				id: "location",
				accessorFn: (d) => {
					const sysName = d.systemId ? (systemNames.get(d.systemId) ?? "") : "";
					return formatLocation(sysName || undefined, d.lPoint);
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
							onAddToMap={setAddToMapTarget}
						/>
					);
				},
			},
			{
				id: "parent",
				accessorFn: (d) => {
					if (d.parentId) {
						return `${parentLabels.get(d.parentId) ?? ""} ${d.parentId}`;
					}
					// Network nodes with no parent show themselves (include both IDs for filtering)
					if (d.assemblyType.toLowerCase().includes("node")) {
						return `${d.label} ${d.id} ${d.objectId}`;
					}
					return "";
				},
				header: "Parent",
				size: 160,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const r = row.original;
					// Network nodes with no explicit parent show their own label as static text
					if (!r.parentId && r.assemblyType.toLowerCase().includes("node")) {
						return <span className="text-xs text-zinc-400">{r.label}</span>;
					}
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
				id: "standing",
				accessorFn: (d) => {
					if (d.ownership === "mine") return 99;
					return standingByName.get(d.ownerName ?? "") ?? 0;
				},
				header: "Standing",
				size: 100,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const r = row.original;
					if (r.ownership === "mine") {
						return (
							<span className="inline-flex items-center rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
								Mine
							</span>
						);
					}
					const standing = standingByName.get(r.ownerName ?? "");
					if (standing == null || standing === 0) {
						return <span className="text-[10px] text-zinc-600">--</span>;
					}
					const style =
						standing === 3
							? "text-blue-400 bg-blue-400/20"
							: standing === 2
								? "text-blue-300 bg-blue-300/20"
								: standing === 1
									? "text-blue-200 bg-blue-200/20"
									: standing === -1
										? "text-red-200 bg-red-200/20"
										: standing === -2
											? "text-red-300 bg-red-300/20"
											: standing === -3
												? "text-red-400 bg-red-400/20"
												: "text-zinc-100 bg-zinc-100/20";
					const label =
						standing === 3
							? "Excellent"
							: standing === 2
								? "Good"
								: standing === 1
									? "Friendly"
									: standing === -1
										? "Unfriendly"
										: standing === -2
											? "Bad"
											: standing === -3
												? "Terrible"
												: "Neutral";
					return (
						<span
							className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${style}`}
						>
							{standing > 0 ? `+${standing}` : standing} {label}
						</span>
					);
				},
			},
			{
				id: "owner",
				accessorFn: (d) => d.ownerName ?? d.owner,
				header: "Owner",
				size: 150,
				filterFn: excelFilterFn,
				cell: ({ row }) => {
					const r = row.original;
					return (
						<div className="min-w-0">
							<span className="text-xs text-zinc-300">{r.ownerName ?? "Unknown"}</span>
							<CopyAddress
								address={r.owner}
								sliceStart={6}
								sliceEnd={4}
								className="block text-xs text-zinc-600"
							/>
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
			extensionConfigMap,
			currencyByMarketId,
			data,
			parentLabels,
			systems,
			systemNames,
			standingByName,
			assemblyCategoryMap,
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
				data={filteredData}
				keyFn={(d) => d.id}
				searchPlaceholder="Search structures, owners, notes..."
				emptyMessage='No structures found. Click "Sync Chain" to discover your on-chain deployables, or add targets in the Watchlist.'
				selectedRowId={selectedId ?? undefined}
				onRowClick={(id) => setSelectedId(id === selectedId ? null : id)}
				onExport={(rows) => {
					const csvCols: CsvColumn<StructureRow>[] = [
						{ header: "Status", accessor: (r) => r.status },
						{ header: "Name", accessor: (r) => r.label },
						{ header: "Object ID", accessor: (r) => r.objectId },
						{ header: "Type", accessor: (r) => r.assemblyType },
						{
							header: "Category",
							accessor: (r) => resolveCategory(r.assemblyType, assemblyCategoryMap),
						},
						{
							header: "Extension",
							accessor: (r) => {
								const ext = extensionConfigMap.get(r.objectId);
								const info = classifyExtension(
									r.extensionType,
									tenant as TenantId,
									ext?.publishedPackageId,
								);
								return info.template?.name ?? info.status;
							},
						},
						{
							header: "Currency",
							accessor: (r) => {
								const ext = extensionConfigMap.get(r.objectId);
								return ext?.marketId ? (currencyByMarketId.get(ext.marketId) ?? "") : "";
							},
						},
						{
							header: "Location",
							accessor: (r) => {
								const sysName = r.systemId ? (systemNames.get(r.systemId) ?? "") : "";
								return formatLocation(sysName || undefined, r.lPoint);
							},
						},
						{
							header: "Parent",
							accessor: (r) => (r.parentId ? (parentLabels.get(r.parentId) ?? "") : ""),
						},
						{
							header: "Standing",
							accessor: (r) =>
								r.ownership === "mine"
									? "Mine"
									: String(standingByName.get(r.ownerName ?? "") ?? ""),
						},
						{
							header: "Owner",
							accessor: (r) => r.ownerName ?? r.owner,
						},
						{
							header: "Runtime (hours)",
							accessor: (r) => {
								const h = fuelHoursRemaining(r);
								return h !== null ? Math.round(h * 10) / 10 : "";
							},
						},
						{ header: "Notes", accessor: (r) => r.notes ?? "" },
						{ header: "Updated", accessor: (r) => r.updatedAt },
					];
					exportToCsv(rows, csvCols, "structures");
				}}
				actions={
					<>
						{/* Quick filters */}
						<div className="flex items-center gap-1">
							<FilterButton
								active={quickFilter === "mine"}
								onClick={() => setQuickFilter(quickFilter === "mine" ? "all" : "mine")}
								label="Mine"
							/>
							<FilterButton
								active={quickFilter === "friendly"}
								onClick={() => setQuickFilter(quickFilter === "friendly" ? "all" : "friendly")}
								label="Friendly"
							/>
							<FilterButton
								active={quickFilter === "hostile"}
								onClick={() => setQuickFilter(quickFilter === "hostile" ? "all" : "hostile")}
								label="Hostile"
							/>
						</div>
						{syncStatus && <span className="text-xs text-zinc-500">{syncStatus}</span>}
						<button
							type="button"
							onClick={() => setShowAll(!showAll)}
							className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
								showAll
									? "border-cyan-600 bg-cyan-600/10 text-cyan-400"
									: "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
							}`}
						>
							<Telescope size={14} />
							{showAll ? "Show All" : "Filtered"}
						</button>
						<button
							type="button"
							onClick={handleSyncOwn}
							disabled={syncing}
							className="flex shrink-0 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
						>
							{syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
							Sync Chain
						</button>
					</>
				}
			/>

			{/* Structure Detail Card */}
			<StructureDetailCard
				row={data.find((d) => d.id === selectedId) ?? null}
				systemNames={systemNames}
				onSaveNotes={handleSaveNotes}
				onDeploy={(row) => setDeployTarget(row)}
				onConfigure={(row) => setDeployTarget(row)}
				onAddToMap={(row) => setAddToMapTarget(row)}
				onReset={handleRevoke}
				isResetting={
					revokingId != null && revokingId === data.find((d) => d.id === selectedId)?.objectId
				}
				onPowerToggle={handlePowerToggle}
				isPowerToggling={
					powerTogglingId != null &&
					powerTogglingId === data.find((d) => d.id === selectedId)?.objectId
				}
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

			{addToMapTarget && (
				<AddToMapDialog structureRow={addToMapTarget} onClose={() => setAddToMapTarget(null)} />
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
		name: row.label,
		status: row.status,
		extensionType: row.extensionType,
		dappUrl: row.dappUrl,
		ownerCapId: row.ownerCapId,
		itemId: row.itemId,
	};
}

function LocationEditor({
	row,
	systems,
	systemNames,
	onSave,
	onAddToMap,
}: {
	row: StructureRow;
	systems: SolarSystem[];
	systemNames: Map<number, string>;
	onSave: (row: StructureRow, systemId: number | undefined, lPoint: string | undefined) => void;
	onAddToMap?: (row: StructureRow) => void;
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
	const displayText = formatLocation(sysName || undefined, row.lPoint);

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
		return displayText ? (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex w-full items-center gap-1.5 text-left text-xs text-zinc-400 hover:text-zinc-200"
			>
				<MapPin size={12} className="shrink-0 text-cyan-500" />
				<span className="truncate">{displayText}</span>
			</button>
		) : (
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="text-xs text-zinc-600 hover:text-zinc-400"
				>
					{"\u2014"}
				</button>
				{onAddToMap && (
					<button
						type="button"
						onClick={() => onAddToMap(row)}
						className="text-[10px] text-cyan-500 hover:text-cyan-400"
					>
						Add to map
					</button>
				)}
			</div>
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

	const selectedLabel = value
		? (options.find((o) => o.id === value || o.objectId === value)?.label ?? "Unknown")
		: null;

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

function FilterButton({
	active,
	onClick,
	label,
}: { active: boolean; onClick: () => void; label: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={
				active
					? "flex shrink-0 items-center gap-1 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-400"
					: "flex shrink-0 items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
			}
		>
			{label}
		</button>
	);
}
