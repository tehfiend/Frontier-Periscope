import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	Archive,
	ArchiveRestore,
	Loader2,
	Lock,
	MapPin,
	Plus,
	RefreshCw,
	Shield,
	Trash2,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	addMapV2ById,
	decryptMapKeys,
	syncMapLocations,
	syncMapLocationsV2,
	syncPrivateMapsForUser,
	syncPrivateMapsV2ForUser,
} from "@/chain/manifest";
import { CopyAddress } from "@/components/CopyAddress";
import { db } from "@/db";
import type { ManifestMapLocation, ManifestPrivateMap, ManifestPrivateMapV2 } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useStoredEncryptionKey } from "@/hooks/useStoredEncryptionKey";
import { useSuiClient } from "@/hooks/useSuiClient";
import {
	type TenantId,
	buildAddLocation,
	buildAddLocationEncrypted,
	buildAddLocationStandings,
	buildCreateEncryptedMap,
	buildCreateMap,
	buildCreateStandingsMap,
	buildInviteMember,
	buildRemoveLocation,
	buildRemoveLocationV2,
	bytesToHex,
	encodeLocationData,
	generateEphemeralX25519Keypair,
	getContractAddresses,
	getPublicKeyForAddress,
	hexToBytes,
	sealForRecipient,
} from "@tehfrontier/chain-shared";

// ── Main Component ──────────────────────────────────────────────────────────

export function PrivateMaps() {
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const tenant = useActiveTenant();
	const client = useSuiClient();
	const dAppKit = useDAppKit();
	const { keyPair, isLoading: isLoadingKey } = useStoredEncryptionKey();

	// Use stored suiAddress for reads (no wallet needed), wallet address for writes
	const suiAddress = activeCharacter?.suiAddress;
	const walletAddress = account?.address;

	const [isSyncing, setIsSyncing] = useState(false);
	const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
	const [selectedMapVersion, setSelectedMapVersion] = useState<"v1" | "v2">("v1");
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [showInviteDialog, setShowInviteDialog] = useState(false);
	const [showAddLocationDialog, setShowAddLocationDialog] = useState(false);
	const [showAddMapByIdDialog, setShowAddMapByIdDialog] = useState(false);
	const [showArchived, setShowArchived] = useState(false);

	// Read cached V1 maps from IndexedDB
	const allMapsV1 =
		useLiveQuery(() => db.manifestPrivateMaps.where("tenant").equals(tenant).toArray(), [tenant]) ??
		[];

	// Read cached V2 maps from IndexedDB
	const allMapsV2 =
		useLiveQuery(
			() => db.manifestPrivateMapsV2.where("tenant").equals(tenant).toArray(),
			[tenant],
		) ?? [];

	// Filter maps by archive status
	const mapsV1 = useMemo(
		() => allMapsV1.filter((m) => !m._archived || showArchived),
		[allMapsV1, showArchived],
	);
	const mapsV2 = useMemo(
		() => allMapsV2.filter((m) => !m._archived || showArchived),
		[allMapsV2, showArchived],
	);

	// Read cached locations for selected map
	const locations =
		useLiveQuery(
			() =>
				selectedMapId
					? db.manifestMapLocations.where("mapId").equals(selectedMapId).toArray()
					: ([] as ManifestMapLocation[]),
			[selectedMapId],
		) ?? [];

	const selectedMapV1 = mapsV1.find((m) => m.id === selectedMapId) ?? null;
	const selectedMapV2 = mapsV2.find((m) => m.id === selectedMapId) ?? null;
	const selectedMap = selectedMapVersion === "v1" ? selectedMapV1 : null;
	const totalMaps = mapsV1.length + mapsV2.length;

	// Archive/unarchive handlers
	const handleArchiveV1 = async (id: string, archived: boolean) => {
		await db.manifestPrivateMaps.update(id, { _archived: archived });
		if (archived && selectedMapId === id) setSelectedMapId(null);
	};
	const handleArchiveV2 = async (id: string, archived: boolean) => {
		await db.manifestPrivateMapsV2.update(id, { _archived: archived });
		if (archived && selectedMapId === id) setSelectedMapId(null);
	};

	// Discover maps from chain -- uses stored suiAddress, no wallet needed
	const handleSync = useCallback(async () => {
		if (!suiAddress) return;
		setIsSyncing(true);
		try {
			// Sync V1 maps
			await syncPrivateMapsForUser(client, tenant as TenantId, suiAddress);

			// Decrypt any pending V1 map keys (needs wallet keypair)
			if (keyPair) {
				await decryptMapKeys(keyPair, tenant as TenantId);
			}

			// Sync V1 locations for all maps that have a decryptedMapKey
			const cachedMaps = await db.manifestPrivateMaps.where("tenant").equals(tenant).toArray();
			for (const m of cachedMaps) {
				if (m.decryptedMapKey) {
					await syncMapLocations(client, m.id, m.decryptedMapKey, tenant as TenantId);
				}
			}

			// Sync V2 maps
			await syncPrivateMapsV2ForUser(client, tenant as TenantId, suiAddress);

			// Sync V2 locations
			const cachedV2Maps = await db.manifestPrivateMapsV2.where("tenant").equals(tenant).toArray();
			for (const m of cachedV2Maps) {
				if (m.mode === 1) {
					// Cleartext standings -- no key needed
					await syncMapLocationsV2(client, m.id, 1, undefined, undefined, tenant as TenantId);
				} else if (m.decryptedMapKey && m.publicKey) {
					// Encrypted -- needs map key
					await syncMapLocationsV2(
						client,
						m.id,
						0,
						m.decryptedMapKey,
						m.publicKey,
						tenant as TenantId,
					);
				}
			}
		} catch {
			// Sync error -- silently continue
		} finally {
			setIsSyncing(false);
		}
	}, [suiAddress, keyPair, client, tenant]);

	// Auto-sync when suiAddress is available (no wallet needed)
	const syncedRef = useRef<string | null>(null);
	useEffect(() => {
		if (suiAddress && syncedRef.current !== suiAddress) {
			syncedRef.current = suiAddress;
			handleSync();
		}
	}, [suiAddress, handleSync]);

	// When key becomes available, decrypt any pending V1 map keys + sync locations
	useEffect(() => {
		const pending = allMapsV1.filter((m) => !m.decryptedMapKey && m.encryptedMapKey);
		if (keyPair && pending.length > 0) {
			decryptMapKeys(keyPair, tenant as TenantId).then(() => {
				db.manifestPrivateMaps
					.where("tenant")
					.equals(tenant)
					.toArray()
					.then((cachedMaps) => {
						for (const m of cachedMaps) {
							if (m.decryptedMapKey) {
								syncMapLocations(client, m.id, m.decryptedMapKey, tenant as TenantId);
							}
						}
					});
			});
		}
	}, [keyPair, allMapsV1, client, tenant]);

	// Sync V1 locations when a V1 map is selected
	useEffect(() => {
		if (!selectedMapV1?.decryptedMapKey) return;
		syncMapLocations(client, selectedMapV1.id, selectedMapV1.decryptedMapKey, tenant as TenantId);
	}, [selectedMapV1?.id, selectedMapV1?.decryptedMapKey, client, tenant]);

	// Sync V2 locations when a V2 map is selected
	useEffect(() => {
		if (!selectedMapV2) return;
		if (selectedMapV2.mode === 1) {
			syncMapLocationsV2(client, selectedMapV2.id, 1, undefined, undefined, tenant as TenantId);
		} else if (selectedMapV2.decryptedMapKey && selectedMapV2.publicKey) {
			syncMapLocationsV2(
				client,
				selectedMapV2.id,
				0,
				selectedMapV2.decryptedMapKey,
				selectedMapV2.publicKey,
				tenant as TenantId,
			);
		}
	}, [selectedMapV2?.id, selectedMapV2?.mode, selectedMapV2?.decryptedMapKey, client, tenant]);

	// Also sync locations for all decrypted V1 maps on first load
	useEffect(() => {
		if (allMapsV1.length === 0) return;
		for (const m of allMapsV1) {
			if (m.decryptedMapKey) {
				syncMapLocations(client, m.id, m.decryptedMapKey, tenant as TenantId);
			}
		}
	}, [allMapsV1.length]); // eslint-disable-line react-hooks/exhaustive-deps

	const addresses = getContractAddresses(tenant as TenantId);
	const packageId = addresses.privateMap?.packageId;
	const packageIdV2 = addresses.privateMapStandings?.packageId;

	// Helper to select a map
	const handleSelectMap = (id: string, version: "v1" | "v2") => {
		if (selectedMapId === id && selectedMapVersion === version) {
			setSelectedMapId(null);
		} else {
			setSelectedMapId(id);
			setSelectedMapVersion(version);
		}
	};

	// Determine the currently selected map's creator for permission checks
	const selectedCreator = selectedMapV1?.creator ?? selectedMapV2?.creator;

	return (
		<div className="mx-auto max-w-3xl p-6">
			<Header
				onSync={suiAddress ? handleSync : undefined}
				isSyncing={isSyncing || isLoadingKey}
				onCreate={walletAddress && keyPair ? () => setShowCreateDialog(true) : undefined}
				onAddById={walletAddress ? () => setShowAddMapByIdDialog(true) : undefined}
				hasPackageId={!!packageId || !!packageIdV2}
				showArchived={showArchived}
				onToggleArchived={() => setShowArchived(!showArchived)}
			/>

			{/* Map List */}
			{totalMaps === 0 ? (
				<EmptyState
					icon={<Shield size={48} className="text-zinc-700" />}
					title="No private maps"
					description={
						isSyncing || isLoadingKey
							? "Syncing..."
							: !suiAddress
								? "Select a character to discover your map invites."
								: "No map invites found. Create a map or ask a map creator to invite you."
					}
				/>
			) : (
				<div className="space-y-3">
					{/* V1 Maps */}
					{mapsV1.map((m) => (
						<MapCard
							key={`v1:${m.id}`}
							map={m}
							isSelected={m.id === selectedMapId && selectedMapVersion === "v1"}
							onSelect={() => handleSelectMap(m.id, "v1")}
							onArchive={(archived) => handleArchiveV1(m.id, archived)}
						/>
					))}
					{/* V2 Maps */}
					{mapsV2.map((m) => (
						<MapCardV2
							key={`v2:${m.id}`}
							map={m}
							isSelected={m.id === selectedMapId && selectedMapVersion === "v2"}
							onSelect={() => handleSelectMap(m.id, "v2")}
							onArchive={(archived) => handleArchiveV2(m.id, archived)}
						/>
					))}
				</div>
			)}

			{/* Selected V1 Map Details */}
			{selectedMapV1 && selectedMapVersion === "v1" && (
				<div className="mt-6 space-y-4">
					{walletAddress && keyPair && (
						<div className="flex items-center gap-2">
							{selectedMapV1.creator === walletAddress && (
								<button
									type="button"
									onClick={() => setShowInviteDialog(true)}
									className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
								>
									<UserPlus size={14} />
									Invite Member
								</button>
							)}
							<button
								type="button"
								onClick={() => setShowAddLocationDialog(true)}
								className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
							>
								<Plus size={14} />
								Add Location
							</button>
						</div>
					)}
					<LocationsTable
						locations={locations}
						isCreator={!!walletAddress && selectedMapV1.creator === walletAddress}
						walletAddress={walletAddress}
						onRemove={
							walletAddress && packageId
								? async (locationId) => {
										const tx = buildRemoveLocation({
											packageId,
											mapId: selectedMapV1.id,
											locationId,
											senderAddress: walletAddress,
										});
										try {
											await dAppKit.signAndExecuteTransaction({ transaction: tx });
											await db.manifestMapLocations.delete(`${selectedMapV1.id}:${locationId}`);
										} catch {
											// TX failed
										}
									}
								: undefined
						}
					/>
				</div>
			)}

			{/* Selected V2 Map Details */}
			{selectedMapV2 && selectedMapVersion === "v2" && (
				<div className="mt-6 space-y-4">
					{/* Standings info for mode=1 maps */}
					{selectedMapV2.mode === 1 && (
						<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
							<div className="flex items-center gap-2 text-xs text-zinc-400">
								<Shield size={14} className="text-amber-500" />
								<span>Standings-Gated Map</span>
							</div>
							<div className="mt-2 grid grid-cols-2 gap-3 text-xs">
								<div>
									<span className="text-zinc-600">Min Read:</span>{" "}
									<span className="text-zinc-300">{selectedMapV2.minReadStanding ?? 0}</span>
								</div>
								<div>
									<span className="text-zinc-600">Min Write:</span>{" "}
									<span className="text-zinc-300">{selectedMapV2.minWriteStanding ?? 0}</span>
								</div>
								{selectedMapV2.registryId && (
									<div className="col-span-2">
										<span className="text-zinc-600">Registry:</span>{" "}
										<CopyAddress
											address={selectedMapV2.registryId}
											sliceStart={14}
											sliceEnd={6}
											className="text-zinc-400"
										/>
									</div>
								)}
							</div>
						</div>
					)}

					{walletAddress && (
						<div className="flex items-center gap-2">
							{selectedMapV2.creator === walletAddress && selectedMapV2.mode === 0 && (
								<button
									type="button"
									onClick={() => setShowInviteDialog(true)}
									className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
								>
									<UserPlus size={14} />
									Invite Member
								</button>
							)}
							<button
								type="button"
								onClick={() => setShowAddLocationDialog(true)}
								className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
							>
								<Plus size={14} />
								Add Location
							</button>
						</div>
					)}

					<LocationsTable
						locations={locations}
						isCreator={!!walletAddress && selectedMapV2.creator === walletAddress}
						walletAddress={walletAddress}
						onRemove={
							walletAddress && packageIdV2
								? async (locationId) => {
										const tx = buildRemoveLocationV2({
											packageId: packageIdV2,
											mapId: selectedMapV2.id,
											locationId,
											senderAddress: walletAddress,
										});
										try {
											await dAppKit.signAndExecuteTransaction({ transaction: tx });
											await db.manifestMapLocations.delete(`v2:${selectedMapV2.id}:${locationId}`);
										} catch {
											// TX failed
										}
									}
								: undefined
						}
					/>
				</div>
			)}

			{/* Dialogs (all require wallet + key) */}
			{showCreateDialog && walletAddress && keyPair && (
				<CreateMapDialog
					packageId={packageId ?? ""}
					packageIdV2={packageIdV2 ?? ""}
					walletKeyPair={keyPair}
					senderAddress={walletAddress}
					tenant={tenant}
					onClose={() => setShowCreateDialog(false)}
					onCreated={handleSync}
				/>
			)}

			{showInviteDialog && selectedMap && packageId && walletAddress && (
				<InviteMemberDialog
					packageId={packageId}
					map={selectedMap}
					senderAddress={walletAddress}
					onClose={() => setShowInviteDialog(false)}
				/>
			)}

			{showAddLocationDialog && selectedMap && packageId && walletAddress && (
				<AddLocationDialog
					packageId={packageId}
					map={selectedMap}
					senderAddress={walletAddress}
					onClose={() => setShowAddLocationDialog(false)}
					onAdded={() => {
						if (selectedMap.decryptedMapKey) {
							syncMapLocations(
								client,
								selectedMap.id,
								selectedMap.decryptedMapKey,
								tenant as TenantId,
							);
						}
					}}
				/>
			)}

			{showAddMapByIdDialog && walletAddress && (
				<AddMapByIdDialog
					tenant={tenant}
					onClose={() => setShowAddMapByIdDialog(false)}
					onAdded={handleSync}
				/>
			)}
		</div>
	);
}

// ── Sub Components ──────────────────────────────────────────────────────────

function Header({
	onSync,
	isSyncing,
	onCreate,
	onAddById,
	hasPackageId,
	showArchived,
	onToggleArchived,
}: {
	onSync?: () => void;
	isSyncing?: boolean;
	onCreate?: () => void;
	onAddById?: () => void;
	hasPackageId?: boolean;
	showArchived?: boolean;
	onToggleArchived?: () => void;
} = {}) {
	return (
		<div className="mb-6 flex items-center justify-between">
			<div>
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<Lock size={24} />
					Private Maps
				</h1>
				<p className="mt-1 text-sm text-zinc-500">Encrypted and standings-gated location sharing</p>
			</div>
			<div className="flex items-center gap-2">
				{onToggleArchived && (
					<button
						type="button"
						onClick={onToggleArchived}
						title={showArchived ? "Hide archived" : "Show archived"}
						className={`rounded-lg p-2 text-xs transition-colors ${
							showArchived
								? "bg-amber-900/30 text-amber-400"
								: "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
						}`}
					>
						<Archive size={14} />
					</button>
				)}
				{onSync && (
					<button
						type="button"
						onClick={onSync}
						disabled={isSyncing}
						className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-50"
					>
						<RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
						Sync
					</button>
				)}
				{onAddById && (
					<button
						type="button"
						onClick={onAddById}
						className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
					>
						<MapPin size={14} />
						Add by ID
					</button>
				)}
				{onCreate && hasPackageId && (
					<button
						type="button"
						onClick={onCreate}
						className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
					>
						<Plus size={14} />
						Create Map
					</button>
				)}
			</div>
		</div>
	);
}

function EmptyState({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
			{icon}
			<p className="text-sm text-zinc-400">{title}</p>
			<p className="text-xs text-zinc-600">{description}</p>
		</div>
	);
}

function MapCard({
	map,
	isSelected,
	onSelect,
	onArchive,
}: {
	map: ManifestPrivateMap;
	isSelected: boolean;
	onSelect: () => void;
	onArchive?: (archived: boolean) => void;
}) {
	return (
		<div
			className={`rounded-lg border p-4 transition-colors ${
				map._archived
					? "border-zinc-800/50 bg-zinc-900/30 opacity-60"
					: isSelected
						? "border-cyan-500/50 bg-cyan-500/5"
						: "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
			}`}
		>
			<div className="flex items-center justify-between">
				<button
					type="button"
					onClick={onSelect}
					className="flex min-w-0 flex-1 items-center gap-3 text-left"
				>
					<div className="rounded-lg bg-zinc-800 p-2">
						<Lock size={18} className="text-cyan-500" />
					</div>
					<div>
						<div className="flex items-center gap-2">
							<p className="text-sm font-medium text-zinc-200">{map.name}</p>
							{map._archived && (
								<span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
									archived
								</span>
							)}
						</div>
						<CopyAddress
							address={map.id}
							sliceStart={14}
							sliceEnd={6}
							className="text-xs text-zinc-600"
						/>
					</div>
				</button>
				<div className="flex shrink-0 items-center gap-2">
					<span className="text-xs text-zinc-500">
						{new Date(map.cachedAt).toLocaleDateString()}
					</span>
					{onArchive && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onArchive(!map._archived);
							}}
							title={map._archived ? "Unarchive" : "Archive"}
							className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
						>
							{map._archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

function MapCardV2({
	map,
	isSelected,
	onSelect,
	onArchive,
}: {
	map: ManifestPrivateMapV2;
	isSelected: boolean;
	onSelect: () => void;
	onArchive?: (archived: boolean) => void;
}) {
	const isEncrypted = map.mode === 0;
	const ModeIcon = isEncrypted ? Lock : Shield;
	const modeColor = isEncrypted ? "text-cyan-500" : "text-amber-500";
	const modeLabel = isEncrypted ? "Encrypted" : "Standings";

	return (
		<div
			className={`rounded-lg border p-4 transition-colors ${
				map._archived
					? "border-zinc-800/50 bg-zinc-900/30 opacity-60"
					: isSelected
						? "border-cyan-500/50 bg-cyan-500/5"
						: "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
			}`}
		>
			<div className="flex items-center justify-between">
				<button
					type="button"
					onClick={onSelect}
					className="flex min-w-0 flex-1 items-center gap-3 text-left"
				>
					<div className="rounded-lg bg-zinc-800 p-2">
						<ModeIcon size={18} className={modeColor} />
					</div>
					<div>
						<div className="flex items-center gap-2">
							<p className="text-sm font-medium text-zinc-200">{map.name}</p>
							<span
								className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
									isEncrypted ? "bg-cyan-500/10 text-cyan-400" : "bg-amber-500/10 text-amber-400"
								}`}
							>
								{modeLabel}
							</span>
							<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
								V2
							</span>
							{map._archived && (
								<span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
									archived
								</span>
							)}
						</div>
						<CopyAddress
							address={map.id}
							sliceStart={14}
							sliceEnd={6}
							className="text-xs text-zinc-600"
						/>
					</div>
				</button>
				<div className="flex shrink-0 items-center gap-2">
					<span className="text-xs text-zinc-500">
						{new Date(map.cachedAt).toLocaleDateString()}
					</span>
					{onArchive && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onArchive(!map._archived);
							}}
							title={map._archived ? "Unarchive" : "Archive"}
							className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
						>
							{map._archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

function LocationsTable({
	locations,
	isCreator,
	walletAddress,
	onRemove,
}: {
	locations: ManifestMapLocation[];
	isCreator: boolean;
	walletAddress?: string;
	onRemove?: (locationId: number) => void;
}) {
	const sorted = [...locations].sort((a, b) => a.addedAtMs - b.addedAtMs);

	// Resolve system names from cached solar systems
	const systemIds = [...new Set(sorted.map((l) => l.solarSystemId))];
	const systemNames = useLiveQuery(
		() => db.solarSystems.where("id").anyOf(systemIds).toArray(),
		[systemIds.join(",")],
	);
	const systemNameMap = useMemo(() => {
		const map = new Map<number, string>();
		for (const s of systemNames ?? []) {
			if (s.name) map.set(s.id, s.name);
		}
		return map;
	}, [systemNames]);

	// Resolve structure names + types from cached deployables
	const structureIds = sorted.map((l) => l.structureId).filter(Boolean) as string[];
	const deployables = useLiveQuery(
		() =>
			structureIds.length > 0 ? db.deployables.where("objectId").anyOf(structureIds).toArray() : [],
		[structureIds.join(",")],
	);

	// Friendly type names from static game data (ASSEMBLY_TYPE_IDS uses generic names like
	// "Smart Storage Unit", but the actual in-game type names are more specific)
	const FRIENDLY_TYPE_NAMES: Record<string, string> = {
		"Smart Storage Unit": "Heavy Storage",
		"Protocol Depot": "Lens Seller",
		"Network Node": "Network Node",
		"Portable Refinery": "Field Refinery",
		"Portable Printer": "Field Printer",
		"Portable Storage": "Field Storage",
		Refuge: "Refuge",
		Gate: "Gate",
		Turret: "Turret",
		Gatekeeper: "Gatekeeper",
	};

	const deployableMap = useMemo(() => {
		const map = new Map<string, { label: string; typeName: string }>();
		for (const d of deployables ?? []) {
			const typeName = FRIENDLY_TYPE_NAMES[d.assemblyType] ?? d.assemblyType;
			map.set(d.objectId, { label: d.label, typeName });
		}
		return map;
	}, [deployables]);

	// Resolve character names from addresses (check both manifest + local characters)
	const addedByAddresses = [...new Set(sorted.map((l) => l.addedBy))];
	const manifestChars = useLiveQuery(
		() => db.manifestCharacters.where("suiAddress").anyOf(addedByAddresses).toArray(),
		[addedByAddresses.join(",")],
	);
	const localChars = useLiveQuery(
		() => db.characters.where("suiAddress").anyOf(addedByAddresses).toArray(),
		[addedByAddresses.join(",")],
	);
	const characterNameMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const c of localChars ?? []) {
			if (c.suiAddress && c.characterName) map.set(c.suiAddress, c.characterName);
		}
		// Manifest takes priority (has on-chain names)
		for (const c of manifestChars ?? []) {
			if (c.name) map.set(c.suiAddress, c.name);
		}
		return map;
	}, [manifestChars, localChars]);

	if (sorted.length === 0) {
		return (
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center text-sm text-zinc-600">
				No locations in this map yet
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
			<div className="border-b border-zinc-800 px-4 py-2">
				<h3 className="flex items-center gap-1.5 text-sm font-medium text-zinc-400">
					<MapPin size={14} />
					Locations ({sorted.length})
				</h3>
			</div>
			<div className="divide-y divide-zinc-800/50">
				{sorted.map((loc) => {
					const canRemove =
						onRemove && (isCreator || (walletAddress && loc.addedBy === walletAddress));
					const systemName = systemNameMap.get(loc.solarSystemId);
					const structure = loc.structureId ? deployableMap.get(loc.structureId) : undefined;
					const addedByName = characterNameMap.get(loc.addedBy);
					return (
						<div key={loc.id} className="flex items-center justify-between px-4 py-3">
							<div>
								<p className="text-sm text-zinc-300">
									{systemName ?? `System ${loc.solarSystemId}`}
									<span className="text-zinc-500">
										{" "}
										-- P{loc.planet}-L{loc.lPoint}
									</span>
								</p>
								{loc.description && <p className="text-xs text-zinc-500">{loc.description}</p>}
								{loc.structureId && (
									<p className="text-xs text-zinc-500">
										{structure ? (
											<>
												<span className="text-zinc-400">{structure.label}</span>
												{structure.typeName !== structure.label && (
													<span className="text-zinc-600"> ({structure.typeName})</span>
												)}
											</>
										) : (
											<CopyAddress
												address={loc.structureId}
												sliceStart={14}
												sliceEnd={0}
												className="text-zinc-600"
											/>
										)}
									</p>
								)}
								<p className="mt-0.5 text-xs text-zinc-600">
									Added by{" "}
									{addedByName ?? (
										<CopyAddress
											address={loc.addedBy}
											sliceStart={10}
											sliceEnd={0}
											className="text-zinc-600"
										/>
									)}{" "}
									-- {new Date(loc.addedAtMs).toLocaleDateString()}
								</p>
							</div>
							{canRemove && (
								<button
									type="button"
									onClick={() => onRemove(loc.locationId)}
									title="Remove location"
									className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
								>
									<Trash2 size={14} />
								</button>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function CreateMapDialog({
	packageId,
	packageIdV2,
	walletKeyPair,
	senderAddress,
	tenant,
	onClose,
	onCreated,
}: {
	packageId: string;
	packageIdV2: string;
	walletKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
	senderAddress: string;
	tenant: string;
	onClose: () => void;
	onCreated: () => void;
}) {
	const dAppKit = useDAppKit();
	const client = useSuiClient();
	const [name, setName] = useState("");
	const [mode, setMode] = useState<"encrypted" | "standings">("encrypted");
	const [registryId, setRegistryId] = useState("");
	const [minRead, setMinRead] = useState("3");
	const [minWrite, setMinWrite] = useState("4");
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Load subscribed registries for the registry dropdown
	const registries =
		useLiveQuery(
			() => db.subscribedRegistries.where("tenant").equals(tenant).toArray(),
			[tenant],
		) ?? [];

	const handleCreate = async () => {
		if (!name.trim()) return;
		setIsPending(true);
		setError(null);

		try {
			if (mode === "encrypted") {
				// Use V1 contract if available, otherwise V2 encrypted mode
				const targetPkg = packageId || packageIdV2;
				if (!targetPkg) {
					setError("No map contract deployed on this tenant.");
					return;
				}

				// Generate ephemeral map keypair
				const mapKeyPair = generateEphemeralX25519Keypair();
				const selfInviteEncrypted = sealForRecipient(mapKeyPair.secretKey, walletKeyPair.publicKey);

				let tx;
				if (packageIdV2) {
					tx = buildCreateEncryptedMap({
						packageId: packageIdV2,
						name: name.trim(),
						publicKey: mapKeyPair.publicKey,
						selfInviteEncryptedKey: selfInviteEncrypted,
						senderAddress,
					});
				} else {
					tx = buildCreateMap({
						packageId: targetPkg,
						name: name.trim(),
						publicKey: mapKeyPair.publicKey,
						selfInviteEncryptedKey: selfInviteEncrypted,
						senderAddress,
					});
				}

				const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
				const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";

				let mapObjectId: string | undefined;
				let inviteObjectId: string | undefined;
				try {
					const fullResult = await client.waitForTransaction({
						digest,
						include: { effects: true, objectTypes: true },
					});
					const fullTx = fullResult.Transaction ?? fullResult.FailedTransaction;
					const changedObjects = fullTx?.effects?.changedObjects ?? [];
					const objectTypesMap = fullTx?.objectTypes ?? {};

					for (const change of changedObjects) {
						const objType = objectTypesMap[change.objectId] ?? "";
						if (
							objType.includes("::private_map::PrivateMap") ||
							objType.includes("::private_map_standings::PrivateMapV2")
						) {
							mapObjectId = change.objectId;
						} else if (
							objType.includes("::private_map::MapInvite") ||
							objType.includes("::private_map_standings::MapInviteV2")
						) {
							inviteObjectId = change.objectId;
						}
					}
				} catch {
					// Fallback to indexer sync
				}

				if (mapObjectId) {
					if (packageIdV2) {
						const entry: ManifestPrivateMapV2 = {
							id: mapObjectId,
							name: name.trim(),
							creator: senderAddress,
							editors: [senderAddress],
							mode: 0,
							publicKey: bytesToHex(mapKeyPair.publicKey),
							decryptedMapKey: bytesToHex(mapKeyPair.secretKey),
							encryptedMapKey: bytesToHex(selfInviteEncrypted),
							inviteId: inviteObjectId,
							tenant,
							cachedAt: new Date().toISOString(),
						};
						await db.manifestPrivateMapsV2.put(entry);
					} else {
						const entry: ManifestPrivateMap = {
							id: mapObjectId,
							name: name.trim(),
							creator: senderAddress,
							publicKey: bytesToHex(mapKeyPair.publicKey),
							decryptedMapKey: bytesToHex(mapKeyPair.secretKey),
							inviteId: inviteObjectId ?? "",
							tenant,
							cachedAt: new Date().toISOString(),
						};
						await db.manifestPrivateMaps.put(entry);
					}
				} else {
					await new Promise((r) => setTimeout(r, 3000));
					onCreated();
				}
			} else {
				// Standings mode -- requires V2 package
				if (!packageIdV2) {
					setError("Standings map requires private_map_standings contract.");
					return;
				}
				if (!registryId.trim()) {
					setError("Please select a StandingsRegistry.");
					return;
				}

				const tx = buildCreateStandingsMap({
					packageId: packageIdV2,
					name: name.trim(),
					registryId: registryId.trim(),
					minReadStanding: Number(minRead),
					minWriteStanding: Number(minWrite),
					senderAddress,
				});

				const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
				const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";

				let mapObjectId: string | undefined;
				try {
					const fullResult = await client.waitForTransaction({
						digest,
						include: { effects: true, objectTypes: true },
					});
					const fullTx = fullResult.Transaction ?? fullResult.FailedTransaction;
					const changedObjects = fullTx?.effects?.changedObjects ?? [];
					const objectTypesMap = fullTx?.objectTypes ?? {};

					for (const change of changedObjects) {
						const objType = objectTypesMap[change.objectId] ?? "";
						if (objType.includes("::private_map_standings::PrivateMapV2")) {
							mapObjectId = change.objectId;
						}
					}
				} catch {
					// Fallback
				}

				if (mapObjectId) {
					const entry: ManifestPrivateMapV2 = {
						id: mapObjectId,
						name: name.trim(),
						creator: senderAddress,
						editors: [senderAddress],
						mode: 1,
						registryId: registryId.trim(),
						minReadStanding: Number(minRead),
						minWriteStanding: Number(minWrite),
						tenant,
						cachedAt: new Date().toISOString(),
					};
					await db.manifestPrivateMapsV2.put(entry);
				} else {
					await new Promise((r) => setTimeout(r, 3000));
					onCreated();
				}
			}

			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	};

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Create Private Map</h2>

			<label className="mb-3 block">
				<span className="mb-1 block text-xs text-zinc-400">Map Name</span>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g., Alliance Intel Map"
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			{/* Mode selector */}
			<div className="mb-4">
				<span className="mb-2 block text-xs text-zinc-400">Map Mode</span>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => setMode("encrypted")}
						className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors ${
							mode === "encrypted"
								? "border border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
								: "border border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
						}`}
					>
						<Lock size={14} />
						Encrypted (Invite-Only)
					</button>
					<button
						type="button"
						onClick={() => setMode("standings")}
						disabled={!packageIdV2}
						className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors disabled:opacity-40 ${
							mode === "standings"
								? "border border-amber-500/50 bg-amber-500/10 text-amber-300"
								: "border border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
						}`}
					>
						<Shield size={14} />
						Standings-Gated
					</button>
				</div>
			</div>

			{/* Standings-specific fields */}
			{mode === "standings" && (
				<>
					<label className="mb-3 block">
						<span className="mb-1 block text-xs text-zinc-400">StandingsRegistry</span>
						{registries.length > 0 ? (
							<select
								value={registryId}
								onChange={(e) => setRegistryId(e.target.value)}
								className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
							>
								<option value="">Select a registry...</option>
								{registries.map((r) => (
									<option key={r.id} value={r.id}>
										[{r.ticker}] {r.name}
									</option>
								))}
							</select>
						) : (
							<input
								type="text"
								value={registryId}
								onChange={(e) => setRegistryId(e.target.value)}
								placeholder="0x... (registry object ID)"
								className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
						)}
					</label>
					<div className="mb-4 grid grid-cols-2 gap-3">
						<label className="block">
							<span className="mb-1 block text-xs text-zinc-400">Min Read Standing (0-6)</span>
							<input
								type="number"
								min={0}
								max={6}
								value={minRead}
								onChange={(e) => setMinRead(e.target.value)}
								className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
							/>
						</label>
						<label className="block">
							<span className="mb-1 block text-xs text-zinc-400">Min Write Standing (0-6)</span>
							<input
								type="number"
								min={0}
								max={6}
								value={minWrite}
								onChange={(e) => setMinWrite(e.target.value)}
								className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
							/>
						</label>
					</div>
				</>
			)}

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleCreate}
					disabled={!name.trim() || isPending}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					Create
				</button>
			</div>
		</DialogOverlay>
	);
}

function InviteMemberDialog({
	packageId,
	map,
	senderAddress,
	onClose,
}: {
	packageId: string;
	map: ManifestPrivateMap;
	senderAddress: string;
	onClose: () => void;
}) {
	const dAppKit = useDAppKit();
	const client = useSuiClient();
	const [recipientAddress, setRecipientAddress] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleInvite = async () => {
		if (!recipientAddress.trim()) return;
		setIsPending(true);
		setError(null);

		try {
			// Get recipient's Ed25519 public key from their tx signatures,
			// then convert to X25519
			const recipientX25519PubKey = await getPublicKeyForAddress(client, recipientAddress.trim());

			// Decrypt our own map key, then re-encrypt for the recipient
			if (!map.decryptedMapKey) throw new Error("Map key not yet decrypted. Connect wallet first.");
			const mapSecretKey = hexToBytes(map.decryptedMapKey);
			const encryptedForRecipient = sealForRecipient(mapSecretKey, recipientX25519PubKey);

			const tx = buildInviteMember({
				packageId,
				mapId: map.id,
				recipient: recipientAddress.trim(),
				encryptedMapKey: encryptedForRecipient,
				senderAddress,
			});

			await dAppKit.signAndExecuteTransaction({ transaction: tx });
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	};

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Invite Member</h2>
			<p className="mb-3 text-xs text-zinc-500">
				Map: <span className="text-zinc-300">{map.name}</span>
			</p>

			<label className="mb-4 block">
				<span className="mb-1 block text-xs text-zinc-400">Recipient Sui Address</span>
				<input
					type="text"
					value={recipientAddress}
					onChange={(e) => setRecipientAddress(e.target.value)}
					placeholder="0x..."
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			<p className="mb-4 text-xs text-zinc-600">
				The recipient's Ed25519 public key will be extracted from their on-chain transactions. Only
				Ed25519 wallets are supported.
			</p>

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleInvite}
					disabled={!recipientAddress.trim() || isPending}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					<UserPlus size={14} />
					Invite
				</button>
			</div>
		</DialogOverlay>
	);
}

function AddLocationDialog({
	packageId,
	map,
	senderAddress,
	onClose,
	onAdded,
}: {
	packageId: string;
	map: ManifestPrivateMap;
	senderAddress: string;
	onClose: () => void;
	onAdded: () => void;
}) {
	const dAppKit = useDAppKit();
	const [solarSystemId, setSolarSystemId] = useState("");
	const [planet, setPlanet] = useState("");
	const [lPoint, setLPoint] = useState("");
	const [description, setDescription] = useState("");
	const [structureId, setStructureId] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleAdd = async () => {
		if (!solarSystemId || !planet || !lPoint) return;
		setIsPending(true);
		setError(null);

		try {
			// Encode and encrypt location data
			const plaintext = encodeLocationData({
				solarSystemId: Number(solarSystemId),
				planet: Number(planet),
				lPoint: Number(lPoint),
				description: description.trim() || undefined,
			});

			const mapPublicKey = hexToBytes(map.publicKey);
			const encryptedData = sealForRecipient(plaintext, mapPublicKey);

			const tx = buildAddLocation({
				packageId,
				mapId: map.id,
				inviteId: map.inviteId,
				structureId: structureId.trim() || undefined,
				encryptedData,
				senderAddress,
			});

			await dAppKit.signAndExecuteTransaction({ transaction: tx });
			// Wait for indexer
			await new Promise((r) => setTimeout(r, 2000));
			onAdded();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	};

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Add Location</h2>
			<p className="mb-3 text-xs text-zinc-500">
				Map: <span className="text-zinc-300">{map.name}</span>
			</p>

			<div className="mb-3 grid grid-cols-3 gap-3">
				<label className="block">
					<span className="mb-1 block text-xs text-zinc-400">Solar System ID</span>
					<input
						type="number"
						value={solarSystemId}
						onChange={(e) => setSolarSystemId(e.target.value)}
						placeholder="30001234"
						className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</label>
				<label className="block">
					<span className="mb-1 block text-xs text-zinc-400">Planet</span>
					<input
						type="number"
						value={planet}
						onChange={(e) => setPlanet(e.target.value)}
						placeholder="2"
						className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</label>
				<label className="block">
					<span className="mb-1 block text-xs text-zinc-400">L-Point</span>
					<input
						type="number"
						value={lPoint}
						onChange={(e) => setLPoint(e.target.value)}
						placeholder="3"
						className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</label>
			</div>

			<label className="mb-3 block">
				<span className="mb-1 block text-xs text-zinc-400">Description (optional)</span>
				<input
					type="text"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="e.g., Main trade hub SSU"
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			<label className="mb-4 block">
				<span className="mb-1 block text-xs text-zinc-400">Structure ID (optional)</span>
				<input
					type="text"
					value={structureId}
					onChange={(e) => setStructureId(e.target.value)}
					placeholder="0x..."
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleAdd}
					disabled={!solarSystemId || !planet || !lPoint || isPending}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					<MapPin size={14} />
					Add Location
				</button>
			</div>
		</DialogOverlay>
	);
}

function AddMapByIdDialog({
	tenant,
	onClose,
	onAdded,
}: {
	tenant: string;
	onClose: () => void;
	onAdded: () => void;
}) {
	const client = useSuiClient();
	const [mapId, setMapId] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleAdd = async () => {
		if (!mapId.trim()) return;
		setIsPending(true);
		setError(null);

		try {
			const result = await addMapV2ById(client, mapId.trim(), tenant as TenantId);
			if (!result) {
				setError("Map not found or could not be fetched.");
				return;
			}
			onAdded();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	};

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Add Map by ID</h2>
			<p className="mb-3 text-xs text-zinc-500">
				Paste a PrivateMapV2 object ID to add a known map to your list.
			</p>

			<label className="mb-4 block">
				<span className="mb-1 block text-xs text-zinc-400">Map Object ID</span>
				<input
					type="text"
					value={mapId}
					onChange={(e) => setMapId(e.target.value)}
					placeholder="0x..."
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleAdd}
					disabled={!mapId.trim() || isPending}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					Add
				</button>
			</div>
		</DialogOverlay>
	);
}

function DialogOverlay({
	children,
	onClose,
}: {
	children: React.ReactNode;
	onClose: () => void;
}) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div
				className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={() => {}}
			>
				{children}
			</div>
		</div>
	);
}
