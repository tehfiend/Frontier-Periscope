import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
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

import { decryptMapKeys, syncMapLocations, syncPrivateMapsForUser } from "@/chain/manifest";
import { db } from "@/db";
import type { ManifestMapLocation, ManifestPrivateMap } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import {
	type TenantId,
	buildAddLocation,
	buildCreateMap,
	buildInviteMember,
	buildRemoveLocation,
	deriveMapKeyFromSignature,
	encodeLocationData,
	generateEphemeralX25519Keypair,
	getContractAddresses,
	getPublicKeyForAddress,
	bytesToHex,
	hexToBytes,
	sealForRecipient,
} from "@tehfrontier/chain-shared";

const MAP_KEY_MESSAGE = "TehFrontier Map Key v1";

// ── Stored Map Key Hook ─────────────────────────────────────────────────────

/**
 * Load the map keypair for the connected wallet address.
 * Stored permanently in settings keyed by wallet address.
 * If wallet is connected and key not yet stored, auto-derives it
 * (one-time transparent sign) and persists permanently.
 */
function useStoredMapKey(): {
	keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null;
	isLoading: boolean;
} {
	const dAppKit = useDAppKit();
	const account = useCurrentAccount();
	const walletAddress = account?.address;

	const [keyPair, setKeyPair] = useState<{
		publicKey: Uint8Array;
		secretKey: Uint8Array;
	} | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const attemptedRef = useRef<string | null>(null);

	useEffect(() => {
		if (!walletAddress) {
			setKeyPair(null);
			attemptedRef.current = null;
			return;
		}

		// Don't re-attempt for the same address
		if (attemptedRef.current === walletAddress) return;
		attemptedRef.current = walletAddress;

		let cancelled = false;
		const settingsKey = `mapKey:${walletAddress}`;

		async function loadKey() {
			setIsLoading(true);
			try {
				// Check if key is already stored
				const stored = await db.settings.get(settingsKey);
				if (cancelled) return;

				if (stored?.value) {
					const { publicHex, secretHex } = stored.value as {
						publicHex: string;
						secretHex: string;
					};
					if (publicHex && secretHex) {
						setKeyPair({
							publicKey: hexToBytes(publicHex),
							secretKey: hexToBytes(secretHex),
						});
						return;
					}
				}

				// Not stored -- derive from wallet signature (one-time)
				const { signature } = await dAppKit.signPersonalMessage({
					message: new TextEncoder().encode(MAP_KEY_MESSAGE),
				});
				if (cancelled) return;

				const derived = deriveMapKeyFromSignature(signature);

				// Store permanently
				await db.settings.put({
					key: settingsKey,
					value: {
						publicHex: bytesToHex(derived.publicKey),
						secretHex: bytesToHex(derived.secretKey),
					},
				});

				if (!cancelled) {
					setKeyPair(derived);
				}
			} catch {
				// User rejected signing or other error
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		}

		loadKey();
		return () => { cancelled = true; };
	}, [walletAddress, dAppKit]);

	return { keyPair, isLoading };
}

// ── Main Component ──────────────────────────────────────────────────────────

export function PrivateMaps() {
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const tenant = useActiveTenant();
	const client = useSuiClient();
	const dAppKit = useDAppKit();
	const { keyPair, isLoading: isLoadingKey } = useStoredMapKey();

	// Use stored suiAddress for reads (no wallet needed), wallet address for writes
	const suiAddress = activeCharacter?.suiAddress;
	const walletAddress = account?.address;

	const [isSyncing, setIsSyncing] = useState(false);
	const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [showInviteDialog, setShowInviteDialog] = useState(false);
	const [showAddLocationDialog, setShowAddLocationDialog] = useState(false);

	// Read cached maps from IndexedDB
	const maps =
		useLiveQuery(() => db.manifestPrivateMaps.where("tenant").equals(tenant).toArray(), [tenant]) ?? [];

	// Debug: log all cached maps regardless of tenant filter
	useLiveQuery(() => db.manifestPrivateMaps.toArray().then((all) => {
		console.log("[PrivateMaps] all cached maps:", all.map((m) => ({ id: m.id, name: m.name, tenant: m.tenant })));
		console.log("[PrivateMaps] filtering by tenant:", tenant, "-> matched:", maps.length);
		return all;
	}));

	// Read cached locations for selected map
	const locations =
		useLiveQuery(
			() =>
				selectedMapId
					? db.manifestMapLocations.where("mapId").equals(selectedMapId).toArray()
					: ([] as ManifestMapLocation[]),
			[selectedMapId],
		) ?? [];

	const selectedMap = maps.find((m) => m.id === selectedMapId) ?? null;

	// Discover maps from chain -- uses stored suiAddress, no wallet needed
	const handleSync = useCallback(async () => {
		if (!suiAddress) return;
		console.log("[PrivateMaps] handleSync triggered, suiAddress:", suiAddress, "tenant:", tenant);
		setIsSyncing(true);
		try {
			await syncPrivateMapsForUser(client, tenant as TenantId, suiAddress);

			// Decrypt any pending map keys (needs wallet keypair)
			if (keyPair) {
				await decryptMapKeys(keyPair, tenant as TenantId);
			}

			// Sync locations for all maps that have a decryptedMapKey (no keypair needed)
			const cachedMaps = await db.manifestPrivateMaps
				.where("tenant")
				.equals(tenant)
				.toArray();
			for (const m of cachedMaps) {
				if (m.decryptedMapKey) {
					await syncMapLocations(client, m.id, m.decryptedMapKey, tenant as TenantId);
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

	// When key becomes available, decrypt any pending map keys + sync locations
	useEffect(() => {
		const pending = maps.filter((m) => !m.decryptedMapKey && m.encryptedMapKey);
		console.log("[PrivateMaps] keyPair:", !!keyPair, "maps:", maps.length, "pendingDecrypt:", pending.length, "maps:", maps.map((m) => ({ name: m.name, hasDecrypted: !!m.decryptedMapKey, hasEncrypted: !!m.encryptedMapKey })));
		if (keyPair && pending.length > 0) {
			console.log("[PrivateMaps] triggering decryptMapKeys + syncLocations");
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
	}, [keyPair, maps, client, tenant]);

	// Sync locations when a map is selected (or when maps first load)
	useEffect(() => {
		if (!selectedMap?.decryptedMapKey) return;
		syncMapLocations(client, selectedMap.id, selectedMap.decryptedMapKey, tenant as TenantId);
	}, [selectedMap?.id, selectedMap?.decryptedMapKey, client, tenant]);

	// Also sync locations for all decrypted maps on first load
	useEffect(() => {
		if (maps.length === 0) return;
		for (const m of maps) {
			if (m.decryptedMapKey) {
				syncMapLocations(client, m.id, m.decryptedMapKey, tenant as TenantId);
			}
		}
	}, [maps.length]); // eslint-disable-line react-hooks/exhaustive-deps

	const addresses = getContractAddresses(tenant as TenantId);
	const packageId = addresses.privateMap?.packageId;

	return (
		<div className="mx-auto max-w-3xl p-6">
			<Header
				onSync={suiAddress ? handleSync : undefined}
				isSyncing={isSyncing || isLoadingKey}
				onCreate={walletAddress && keyPair ? () => setShowCreateDialog(true) : undefined}
				hasPackageId={!!packageId}
			/>

			{/* Map List */}
			{maps.length === 0 ? (
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
					{maps.map((m) => (
						<MapCard
							key={m.id}
							map={m}
							isSelected={m.id === selectedMapId}
							onSelect={() => setSelectedMapId(m.id === selectedMapId ? null : m.id)}
						/>
					))}
				</div>
			)}

			{/* Selected Map Details */}
			{selectedMap && (
				<div className="mt-6 space-y-4">
					{/* Actions (wallet required) */}
					{walletAddress && keyPair && (
						<div className="flex items-center gap-2">
							{selectedMap.creator === walletAddress && (
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

					{/* Locations Table */}
					<LocationsTable
						locations={locations}
						isCreator={!!walletAddress && selectedMap.creator === walletAddress}
						walletAddress={walletAddress}
						onRemove={
							walletAddress && packageId
								? async (locationId) => {
										const tx = buildRemoveLocation({
											packageId,
											mapId: selectedMap.id,
											locationId,
											senderAddress: walletAddress,
										});
										try {
											await dAppKit.signAndExecuteTransaction({ transaction: tx });
											await db.manifestMapLocations.delete(
												`${selectedMap.id}:${locationId}`,
											);
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
			{showCreateDialog && packageId && walletAddress && keyPair && (
				<CreateMapDialog
					packageId={packageId}
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
		</div>
	);
}

// ── Sub Components ──────────────────────────────────────────────────────────

function Header({
	onSync,
	isSyncing,
	onCreate,
	hasPackageId,
}: {
	onSync?: () => void;
	isSyncing?: boolean;
	onCreate?: () => void;
	hasPackageId?: boolean;
} = {}) {
	return (
		<div className="mb-6 flex items-center justify-between">
			<div>
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<Lock size={24} />
					Private Maps
				</h1>
				<p className="mt-1 text-sm text-zinc-500">
					Encrypted location sharing with trusted players
				</p>
			</div>
			<div className="flex items-center gap-2">
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
}: {
	map: ManifestPrivateMap;
	isSelected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={`w-full rounded-lg border p-4 text-left transition-colors ${
				isSelected
					? "border-cyan-500/50 bg-cyan-500/5"
					: "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
			}`}
		>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<div className="rounded-lg bg-zinc-800 p-2">
						<Lock size={18} className="text-cyan-500" />
					</div>
					<div>
						<p className="text-sm font-medium text-zinc-200">{map.name}</p>
						<p className="font-mono text-xs text-zinc-600">
							{map.id.slice(0, 14)}...{map.id.slice(-6)}
						</p>
					</div>
				</div>
				<div className="text-xs text-zinc-500">{new Date(map.cachedAt).toLocaleDateString()}</div>
			</div>
		</button>
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
		() => (structureIds.length > 0 ? db.deployables.where("objectId").anyOf(structureIds).toArray() : []),
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
		"Refuge": "Refuge",
		"Gate": "Gate",
		"Turret": "Turret",
		"Gatekeeper": "Gatekeeper",
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
									<span className="text-zinc-500"> -- P{loc.planet}-L{loc.lPoint}</span>
								</p>
								{loc.description && <p className="text-xs text-zinc-500">{loc.description}</p>}
								{loc.structureId && (
									<p className="text-xs text-zinc-500">
										{structure
											? <>
												<span className="text-zinc-400">{structure.label}</span>
												{structure.typeName !== structure.label && (
													<span className="text-zinc-600">
														{" "}({structure.typeName})
													</span>
												)}
											</>
											: <span className="font-mono text-zinc-600">{loc.structureId.slice(0, 14)}...</span>
										}
									</p>
								)}
								<p className="mt-0.5 text-xs text-zinc-600">
									Added by {addedByName ?? `${loc.addedBy.slice(0, 10)}...`} --{" "}
									{new Date(loc.addedAtMs).toLocaleDateString()}
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
	walletKeyPair,
	senderAddress,
	tenant,
	onClose,
	onCreated,
}: {
	packageId: string;
	walletKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
	senderAddress: string;
	tenant: string;
	onClose: () => void;
	onCreated: () => void;
}) {
	const dAppKit = useDAppKit();
	const client = useSuiClient();
	const [name, setName] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleCreate = async () => {
		if (!name.trim()) return;
		setIsPending(true);
		setError(null);

		try {
			// Generate ephemeral map keypair
			const mapKeyPair = generateEphemeralX25519Keypair();

			// Self-invite: encrypt map secret key with own wallet-derived X25519 key
			const selfInviteEncrypted = sealForRecipient(mapKeyPair.secretKey, walletKeyPair.publicKey);

			const tx = buildCreateMap({
				packageId,
				name: name.trim(),
				publicKey: mapKeyPair.publicKey,
				selfInviteEncryptedKey: selfInviteEncrypted,
				senderAddress,
			});

			const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
			const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";

			// Wait for the TX to finalize so we can read created object IDs
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
					if (objType.includes("::private_map::PrivateMap")) {
						mapObjectId = change.objectId;
					} else if (objType.includes("::private_map::MapInvite")) {
						inviteObjectId = change.objectId;
					}
				}
			} catch {
				// If we can't read the TX result, fall back to indexer sync
			}

			// Cache the new map directly in IndexedDB without waiting for the indexer
			if (mapObjectId) {
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
			} else {
				// Fallback: wait for indexer and sync
				await new Promise((r) => setTimeout(r, 3000));
				onCreated();
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

			<label className="mb-4 block">
				<span className="mb-1 block text-xs text-zinc-400">Map Name</span>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g., Alliance Intel Map"
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
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
