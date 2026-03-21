import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	Key,
	Loader2,
	Lock,
	MapPin,
	Plus,
	RefreshCw,
	Shield,
	Trash2,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { syncMapLocations, syncPrivateMapsForUser } from "@/chain/manifest";
import { db } from "@/db";
import type { ManifestMapLocation, ManifestPrivateMap } from "@/db/types";
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
	hexToBytes,
	sealForRecipient,
} from "@tehfrontier/chain-shared";

// ── Key Derivation Hook ─────────────────────────────────────────────────────

const MAP_KEY_MESSAGE = "TehFrontier Map Key v1";

function useMapKey(): {
	keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null;
	deriveKey: () => Promise<void>;
	isDerivingKey: boolean;
} {
	const dAppKit = useDAppKit();
	const [keyPair, setKeyPair] = useState<{
		publicKey: Uint8Array;
		secretKey: Uint8Array;
	} | null>(null);
	const [isDerivingKey, setIsDerivingKey] = useState(false);

	const deriveKey = useCallback(async () => {
		setIsDerivingKey(true);
		try {
			const { signature } = await dAppKit.signPersonalMessage({
				message: new TextEncoder().encode(MAP_KEY_MESSAGE),
			});
			const derived = deriveMapKeyFromSignature(signature);
			setKeyPair(derived);
		} catch {
			// User rejected or signing failed
		} finally {
			setIsDerivingKey(false);
		}
	}, [dAppKit]);

	return { keyPair, deriveKey, isDerivingKey };
}

// ── Main Component ──────────────────────────────────────────────────────────

export function PrivateMaps() {
	const account = useCurrentAccount();
	const tenant = useActiveTenant();
	const client = useSuiClient();
	const dAppKit = useDAppKit();
	const { keyPair, deriveKey, isDerivingKey } = useMapKey();

	const [isSyncing, setIsSyncing] = useState(false);
	const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [showInviteDialog, setShowInviteDialog] = useState(false);
	const [showAddLocationDialog, setShowAddLocationDialog] = useState(false);

	// Read cached maps from IndexedDB
	const maps =
		useLiveQuery(() => db.manifestPrivateMaps.where("tenant").equals(tenant).toArray()) ?? [];

	// Read cached locations for selected map
	const locations =
		useLiveQuery(
			() =>
				selectedMapId
					? db.manifestMapLocations.where("mapId").equals(selectedMapId).toArray()
					: Promise.resolve([]),
			[selectedMapId],
		) ?? [];

	const selectedMap = maps.find((m) => m.id === selectedMapId) ?? null;

	// Sync maps when key is derived
	const handleSync = useCallback(async () => {
		if (!keyPair || !account?.address) return;
		setIsSyncing(true);
		try {
			await syncPrivateMapsForUser(client, tenant as TenantId, account.address, keyPair);

			// Also sync locations for each map
			const cachedMaps = await db.manifestPrivateMaps.where("tenant").equals(tenant).toArray();
			for (const m of cachedMaps) {
				await syncMapLocations(client, m.id, m.decryptedMapKey, tenant as TenantId);
			}
		} catch {
			// Sync error -- silently continue
		} finally {
			setIsSyncing(false);
		}
	}, [keyPair, account?.address, client, tenant]);

	// Auto-sync on first key derivation
	useEffect(() => {
		if (keyPair && account?.address) {
			handleSync();
		}
	}, [keyPair, account?.address, handleSync]);

	// No wallet
	if (!account) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<Header />
				<EmptyState
					icon={<Lock size={48} className="text-zinc-700" />}
					title="Connect your wallet"
					description="Private Maps require a wallet connection for key derivation and on-chain operations."
				/>
			</div>
		);
	}

	// No key derived yet
	if (!keyPair) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<Header />
				<div className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
					<Key size={48} className="text-zinc-600" />
					<p className="text-sm text-zinc-400">Derive your map key to access encrypted maps</p>
					<p className="max-w-md text-center text-xs text-zinc-600">
						Your wallet will sign a message to derive a deterministic encryption key. This key is
						never stored -- it is re-derived each session.
					</p>
					<button
						type="button"
						onClick={deriveKey}
						disabled={isDerivingKey}
						className="mt-2 flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
					>
						{isDerivingKey ? (
							<>
								<Loader2 size={16} className="animate-spin" />
								Signing...
							</>
						) : (
							<>
								<Key size={16} />
								Derive Map Key
							</>
						)}
					</button>
				</div>
			</div>
		);
	}

	const addresses = getContractAddresses(tenant as TenantId);
	const packageId = addresses.privateMap?.packageId;

	return (
		<div className="mx-auto max-w-3xl p-6">
			<Header
				onSync={handleSync}
				isSyncing={isSyncing}
				onCreate={() => setShowCreateDialog(true)}
				hasPackageId={!!packageId}
			/>

			{/* Map List */}
			{maps.length === 0 ? (
				<EmptyState
					icon={<Shield size={48} className="text-zinc-700" />}
					title="No private maps"
					description={
						isSyncing ? "Syncing..." : "Create a map or ask a map creator to invite you."
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
					{/* Actions */}
					<div className="flex items-center gap-2">
						{selectedMap.creator === account.address && (
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

					{/* Locations Table */}
					<LocationsTable
						locations={locations}
						isCreator={selectedMap.creator === account.address}
						walletAddress={account.address}
						onRemove={async (locationId) => {
							if (!packageId) return;
							const tx = buildRemoveLocation({
								packageId,
								mapId: selectedMap.id,
								locationId,
								senderAddress: account.address,
							});
							try {
								await dAppKit.signAndExecuteTransaction({ transaction: tx });
								// Remove from cache
								await db.manifestMapLocations.delete(`${selectedMap.id}:${locationId}`);
							} catch {
								// TX failed
							}
						}}
					/>
				</div>
			)}

			{/* Dialogs */}
			{showCreateDialog && packageId && (
				<CreateMapDialog
					packageId={packageId}
					walletKeyPair={keyPair}
					senderAddress={account.address}
					onClose={() => setShowCreateDialog(false)}
					onCreated={handleSync}
				/>
			)}

			{showInviteDialog && selectedMap && packageId && (
				<InviteMemberDialog
					packageId={packageId}
					map={selectedMap}
					senderAddress={account.address}
					onClose={() => setShowInviteDialog(false)}
				/>
			)}

			{showAddLocationDialog && selectedMap && packageId && (
				<AddLocationDialog
					packageId={packageId}
					map={selectedMap}
					senderAddress={account.address}
					onClose={() => setShowAddLocationDialog(false)}
					onAdded={() =>
						syncMapLocations(
							client,
							selectedMap.id,
							selectedMap.decryptedMapKey,
							tenant as TenantId,
						)
					}
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
	walletAddress: string;
	onRemove: (locationId: number) => void;
}) {
	const sorted = [...locations].sort((a, b) => a.addedAtMs - b.addedAtMs);

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
					const canRemove = isCreator || loc.addedBy === walletAddress;
					return (
						<div key={loc.id} className="flex items-center justify-between px-4 py-3">
							<div>
								<p className="text-sm text-zinc-300">
									System {loc.solarSystemId} -- P{loc.planet}-L{loc.lPoint}
								</p>
								{loc.description && <p className="text-xs text-zinc-500">{loc.description}</p>}
								{loc.structureId && (
									<p className="font-mono text-xs text-zinc-600">
										Structure: {loc.structureId.slice(0, 14)}...
									</p>
								)}
								<p className="mt-0.5 text-xs text-zinc-600">
									Added by {loc.addedBy.slice(0, 10)}... --{" "}
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
	onClose,
	onCreated,
}: {
	packageId: string;
	walletKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
	senderAddress: string;
	onClose: () => void;
	onCreated: () => void;
}) {
	const dAppKit = useDAppKit();
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

			await dAppKit.signAndExecuteTransaction({ transaction: tx });
			// Wait for indexer
			await new Promise((r) => setTimeout(r, 2000));
			onCreated();
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
