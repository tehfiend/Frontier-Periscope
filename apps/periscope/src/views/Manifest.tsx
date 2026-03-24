import { ASSEMBLY_TYPE_IDS, TENANTS } from "@/chain/config";
import {
	discoverCharactersFromEvents,
	discoverLocationsFromEvents,
	discoverTribes,
	fetchCharacterByAddress,
} from "@/chain/manifest";
import { CopyAddress } from "@/components/CopyAddress";
import { type ColumnDef, DataGrid, excelFilterFn } from "@/components/DataGrid";
import { db } from "@/db";
import type { ManifestCharacter, ManifestLocation, ManifestTribe } from "@/db/types";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import { useTaskWorker } from "@/hooks/useTaskWorker";
import { enqueueTask } from "@/lib/taskWorker";
import { useLiveQuery } from "dexie-react-hooks";
import {
	Clock,
	Database,
	ExternalLink,
	Loader2,
	MapPin,
	Search,
	UserPlus,
	Users,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatAge(cachedAt: string): string {
	const ms = Date.now() - new Date(cachedAt).getTime();
	const mins = Math.floor(ms / 60000);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

// ── Character Columns ───────────────────────────────────────────────────────

function makeCharacterColumns(
	tribeMap: Record<number, string>,
): ColumnDef<ManifestCharacter, unknown>[] {
	return [
		{
			id: "name",
			accessorKey: "name",
			header: "Name",
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<span className="font-medium text-zinc-100">{row.original.name || "(unnamed)"}</span>
			),
		},
		{
			id: "characterItemId",
			accessorKey: "characterItemId",
			header: "Character ID",
			size: 130,
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<span className="font-mono text-xs text-zinc-400">{row.original.characterItemId}</span>
			),
		},
		{
			id: "tribe",
			accessorFn: (c) => tribeMap[c.tribeId] ?? String(c.tribeId || ""),
			header: "Tribe",
			size: 160,
			filterFn: excelFilterFn,
			cell: ({ row }) => {
				const name = tribeMap[row.original.tribeId];
				return (
					<span className="text-xs text-zinc-400">
						{name ?? (row.original.tribeId ? `#${row.original.tribeId}` : "—")}
					</span>
				);
			},
		},
		{
			id: "suiAddress",
			accessorKey: "suiAddress",
			header: "Sui Address",
			size: 150,
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<CopyAddress
					address={row.original.suiAddress}
					explorerUrl={`https://suiscan.xyz/testnet/account/${row.original.suiAddress}`}
					className="text-xs text-zinc-500"
				/>
			),
		},
		{
			id: "objectId",
			accessorKey: "id",
			header: "Object ID",
			size: 140,
			enableColumnFilter: false,
			cell: ({ row }) => (
				<CopyAddress
					address={row.original.id}
					explorerUrl={`https://suiscan.xyz/testnet/object/${row.original.id}`}
					className="text-xs text-zinc-600"
				/>
			),
		},
		{
			id: "status",
			accessorFn: (c) => (c.deletedAt ? "Deleted" : "Active"),
			header: "Status",
			size: 90,
			filterFn: excelFilterFn,
			cell: ({ row }) =>
				row.original.deletedAt ? (
					<span className="text-xs text-red-400">Deleted</span>
				) : (
					<span className="text-xs text-green-400">Active</span>
				),
		},
		{
			id: "createdOnChain",
			accessorKey: "createdOnChain",
			header: "Created",
			size: 110,
			enableColumnFilter: false,
			cell: ({ row }) => (
				<span className="text-xs text-zinc-500">
					{row.original.createdOnChain
						? new Date(row.original.createdOnChain).toLocaleString()
						: "—"}
				</span>
			),
		},
		{
			id: "cachedAt",
			accessorKey: "cachedAt",
			header: "Cached",
			size: 100,
			enableColumnFilter: false,
			cell: ({ row }) => (
				<div className="flex items-center gap-1 text-xs text-zinc-600">
					<Clock size={10} />
					{formatAge(row.original.cachedAt)}
				</div>
			),
		},
	];
}

// ── Tribe Columns ───────────────────────────────────────────────────────────

const tribeColumns: ColumnDef<ManifestTribe, unknown>[] = [
	{
		id: "name",
		accessorKey: "name",
		header: "Name",
		filterFn: excelFilterFn,
		cell: ({ row }) => <span className="font-medium text-zinc-100">{row.original.name}</span>,
	},
	{
		id: "nameShort",
		accessorKey: "nameShort",
		header: "Tag",
		size: 80,
		filterFn: excelFilterFn,
		cell: ({ row }) => (
			<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-cyan-400">
				{row.original.nameShort}
			</span>
		),
	},
	{
		id: "id",
		accessorFn: (t) => String(t.id),
		header: "Tribe ID",
		size: 110,
		filterFn: excelFilterFn,
		cell: ({ row }) => <span className="font-mono text-xs text-zinc-400">{row.original.id}</span>,
	},
	{
		id: "description",
		accessorKey: "description",
		header: "Description",
		filterFn: excelFilterFn,
		cell: ({ row }) => (
			<span className="text-xs text-zinc-500 truncate max-w-[300px] block">
				{row.original.description || "—"}
			</span>
		),
	},
	{
		id: "taxRate",
		accessorKey: "taxRate",
		header: "Tax %",
		size: 70,
		enableColumnFilter: false,
		cell: ({ row }) => (
			<span className="font-mono text-xs text-zinc-400">{row.original.taxRate}%</span>
		),
	},
	{
		id: "tribeUrl",
		accessorKey: "tribeUrl",
		header: "URL",
		size: 80,
		enableColumnFilter: false,
		cell: ({ row }) =>
			row.original.tribeUrl ? (
				<a
					href={row.original.tribeUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1 text-xs text-cyan-500 hover:text-cyan-400"
					onClick={(e) => e.stopPropagation()}
				>
					<ExternalLink size={10} /> Link
				</a>
			) : (
				<span className="text-xs text-zinc-700">—</span>
			),
	},
	{
		id: "createdOnChain",
		accessorKey: "createdOnChain",
		header: "Created",
		size: 110,
		enableColumnFilter: false,
		cell: ({ row }) => (
			<span className="text-xs text-zinc-500">
				{row.original.createdOnChain
					? new Date(row.original.createdOnChain).toLocaleDateString()
					: "—"}
			</span>
		),
	},
	{
		id: "cachedAt",
		accessorKey: "cachedAt",
		header: "Cached",
		size: 100,
		enableColumnFilter: false,
		cell: ({ row }) => (
			<div className="flex items-center gap-1 text-xs text-zinc-600">
				<Clock size={10} />
				{formatAge(row.original.cachedAt)}
			</div>
		),
	},
];

// ── Location Columns ────────────────────────────────────────────────────────

function makeLocationColumns(
	systemNames: Map<number, string>,
): ColumnDef<ManifestLocation, unknown>[] {
	return [
		{
			id: "assemblyType",
			accessorFn: (loc) => ASSEMBLY_TYPE_IDS[loc.typeId] ?? String(loc.typeId),
			header: "Type",
			size: 160,
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<span className="text-xs font-medium text-zinc-300">
					{ASSEMBLY_TYPE_IDS[row.original.typeId] ?? `#${row.original.typeId}`}
				</span>
			),
		},
		{
			id: "solarsystem",
			accessorFn: (loc) => systemNames.get(loc.solarsystem) ?? String(loc.solarsystem),
			header: "Solar System",
			size: 180,
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<span className="text-xs text-zinc-400">
					{systemNames.get(row.original.solarsystem) ?? `#${row.original.solarsystem}`}
				</span>
			),
		},
		{
			id: "lPoint",
			accessorFn: (loc) => loc.lPoint ?? "",
			header: "L-Point",
			size: 90,
			filterFn: excelFilterFn,
			cell: ({ row }) => (
				<span className="font-mono text-xs text-cyan-400">{row.original.lPoint ?? "--"}</span>
			),
		},
		{
			id: "id",
			accessorKey: "id",
			header: "Assembly ID",
			size: 150,
			enableColumnFilter: false,
			cell: ({ row }) => (
				<CopyAddress
					address={row.original.id}
					explorerUrl={`https://suiscan.xyz/testnet/object/${row.original.id}`}
					className="text-xs text-zinc-500"
				/>
			),
		},
		{
			id: "revealedAt",
			accessorKey: "revealedAt",
			header: "Revealed",
			size: 110,
			enableColumnFilter: false,
			cell: ({ row }) => (
				<span className="text-xs text-zinc-500">
					{row.original.revealedAt ? new Date(row.original.revealedAt).toLocaleString() : "--"}
				</span>
			),
		},
		{
			id: "cachedAt",
			accessorKey: "cachedAt",
			header: "Cached",
			size: 100,
			enableColumnFilter: false,
			cell: ({ row }) => (
				<div className="flex items-center gap-1 text-xs text-zinc-600">
					<Clock size={10} />
					{formatAge(row.original.cachedAt)}
				</div>
			),
		},
	];
}

// ── Component ───────────────────────────────────────────────────────────────

type Tab = "characters" | "tribes" | "locations";

export function Manifest() {
	const client = useSuiClient();
	const tenant = useActiveTenant();
	const worldPkg = TENANTS[tenant].worldPackageId;

	const [tab, setTab] = useState<Tab>("characters");
	const { activeCount } = useTaskWorker();
	const [syncStatus, setSyncStatus] = useState<string | null>(null);

	// Filter to current tenant
	const allCharacters = useLiveQuery(() => db.manifestCharacters.toArray()) ?? [];
	const characters = useMemo(
		() => allCharacters.filter((c) => c.tenant === tenant),
		[allCharacters, tenant],
	);

	const allTribes = useLiveQuery(() => db.manifestTribes.toArray()) ?? [];
	const tribes = useMemo(() => allTribes.filter((t) => t.tenant === tenant), [allTribes, tenant]);

	// Tribe name lookup for character grid
	const tribeMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const t of allTribes) map[t.id] = t.name;
		return map;
	}, [allTribes]);

	const characterColumns = useMemo(() => makeCharacterColumns(tribeMap), [tribeMap]);

	// Locations
	const allLocations = useLiveQuery(() => db.manifestLocations.toArray()) ?? [];
	const locations = useMemo(
		() => allLocations.filter((l) => l.tenant === tenant),
		[allLocations, tenant],
	);

	// System name lookup for location grid
	const allSystems = useLiveQuery(() => db.solarSystems.toArray()) ?? [];
	const systemNames = useMemo(() => {
		const map = new Map<number, string>();
		for (const s of allSystems) {
			if (s.name) map.set(s.id, s.name);
		}
		return map;
	}, [allSystems]);

	const locationColumns = useMemo(() => makeLocationColumns(systemNames), [systemNames]);

	// Lookup by address
	const [lookupAddress, setLookupAddress] = useState("");
	const [lookupLoading, setLookupLoading] = useState(false);

	const handleFullResync = useCallback(() => {
		if (tab === "characters") {
			enqueueTask(`Full Character Resync (${tenant})`, async (ctx) => {
				// Clear cursor to force full re-sync from scratch
				const cursorKey = `manifestCharCursor:${worldPkg}`;
				await db.settings.delete(cursorKey);
				// Clear soft-delete flags so they get re-evaluated
				const deleted = await db.manifestCharacters
					.filter((c) => !!c.deletedAt)
					.toArray();
				for (const c of deleted) {
					await db.manifestCharacters.update(c.id, { deletedAt: undefined, name: "" });
				}
				await discoverCharactersFromEvents(client, tenant, worldPkg, 50000, ctx);
			});
			setSyncStatus("Full resync queued — check Workers page");
		} else if (tab === "locations") {
			enqueueTask(`Full Location Resync (${tenant})`, async (ctx) => {
				const cursorKey = `manifestLocCursor:${worldPkg}`;
				await db.settings.delete(cursorKey);
				await discoverLocationsFromEvents(client, tenant, worldPkg, 50000, ctx);
			});
			setSyncStatus("Full resync queued — check Workers page");
		}
	}, [tab, client, tenant, worldPkg]);

	const handleDiscover = useCallback(() => {
		if (tab === "characters") {
			enqueueTask(`Discover Characters (${tenant})`, async (ctx) => {
				await discoverCharactersFromEvents(client, tenant, worldPkg, 5000, ctx);
			});
			setSyncStatus("Character discovery queued — check Workers page");
		} else if (tab === "tribes") {
			enqueueTask(`Fetch Tribes (${tenant})`, async (ctx) => {
				await discoverTribes(tenant, ctx);
			});
			setSyncStatus("Tribe fetch queued — check Workers page");
		} else if (tab === "locations") {
			enqueueTask(`Discover Locations (${tenant})`, async (ctx) => {
				await discoverLocationsFromEvents(client, tenant, worldPkg, 5000, ctx);
			});
			setSyncStatus("Location discovery queued — check Workers page");
		}
	}, [tab, client, tenant, worldPkg]);

	const handleLookup = useCallback(async () => {
		if (!lookupAddress.trim() || lookupLoading) return;
		setLookupLoading(true);
		try {
			const result = await fetchCharacterByAddress(client, lookupAddress.trim(), tenant);
			if (result) {
				const tribeName = tribeMap[result.tribeId] ?? `#${result.tribeId}`;
				setSyncStatus(`Found: ${result.name} (${tribeName})`);
			} else {
				setSyncStatus("No character found for that address");
			}
		} catch (e) {
			setSyncStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
		}
		setLookupLoading(false);
		setLookupAddress("");
	}, [lookupAddress, lookupLoading, client, tenant, tribeMap]);

	const tribeCounts = useMemo(
		() => new Set(characters.map((c) => c.tribeId).filter((t) => t > 0)).size,
		[characters],
	);

	return (
		<div className="p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div className="flex items-center gap-4">
					<div>
						<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
							<Database size={24} className="text-violet-500" />
							Manifest
						</h1>
						<p className="mt-1 text-sm text-zinc-500">
							{characters.length} characters &middot; {tribes.length} tribes &middot;{" "}
							{locations.length} locations &middot; {tribeCounts} unique tribes in characters
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{syncStatus && (
						<span className="max-w-xs truncate text-xs text-zinc-500">{syncStatus}</span>
					)}
					{(tab === "characters" || tab === "locations") && (
						<button
							type="button"
							onClick={handleFullResync}
							disabled={activeCount > 0}
							className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
						>
							<Database size={14} />
							Full Resync
						</button>
					)}
					<button
						type="button"
						onClick={handleDiscover}
						disabled={activeCount > 0}
						className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
					>
						{activeCount > 0 ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<Search size={14} />
						)}
						{tab === "characters"
							? "Discover"
							: tab === "tribes"
								? "Fetch Tribes"
								: "Discover Locations"}
					</button>
				</div>
			</div>

			{/* Tabs */}
			<div className="mb-4 flex gap-1 rounded-lg bg-zinc-900/50 p-1">
				<button
					type="button"
					onClick={() => setTab("characters")}
					className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
						tab === "characters" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
					}`}
				>
					<UserPlus size={14} />
					Characters ({characters.length})
				</button>
				<button
					type="button"
					onClick={() => setTab("tribes")}
					className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
						tab === "tribes" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
					}`}
				>
					<Users size={14} />
					Tribes ({tribes.length})
				</button>
				<button
					type="button"
					onClick={() => setTab("locations")}
					className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
						tab === "locations" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
					}`}
				>
					<MapPin size={14} />
					Locations ({locations.length})
				</button>
			</div>

			{/* Character lookup */}
			{tab === "characters" && (
				<div className="mb-4 flex items-center gap-2">
					<div className="relative max-w-md flex-1">
						<UserPlus
							size={14}
							className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
						/>
						<input
							type="text"
							value={lookupAddress}
							onChange={(e) => setLookupAddress(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleLookup()}
							placeholder="Look up character by Sui address (0x...)..."
							className="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
						/>
					</div>
					<button
						type="button"
						onClick={handleLookup}
						disabled={lookupLoading || !lookupAddress.trim()}
						className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50"
					>
						{lookupLoading ? <Loader2 size={14} className="animate-spin" /> : "Lookup"}
					</button>
				</div>
			)}

			{/* Data Grid */}
			{tab === "characters" ? (
				<DataGrid
					columns={characterColumns}
					data={characters}
					keyFn={(c) => c.id}
					searchPlaceholder="Search names, IDs, addresses, tribes..."
					emptyMessage='No characters cached yet. Click "Discover" to scan recent chain activity.'
				/>
			) : tab === "tribes" ? (
				<DataGrid
					columns={tribeColumns}
					data={tribes}
					keyFn={(t) => String(t.id)}
					searchPlaceholder="Search tribe names, tags, descriptions..."
					emptyMessage='No tribes cached yet. Click "Fetch Tribes" to load from the World API.'
				/>
			) : (
				<DataGrid
					columns={locationColumns}
					data={locations}
					keyFn={(l) => l.id}
					searchPlaceholder="Search assembly types, systems, L-points..."
					emptyMessage='No locations cached yet. Click "Discover Locations" to scan revealed locations.'
				/>
			)}
		</div>
	);
}
