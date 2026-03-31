import type { TenantId } from "@/chain/config";
import { syncMapLocations, syncMapLocationsV2 } from "@/chain/manifest";
import { db } from "@/db";
import type { ManifestPrivateMap, ManifestPrivateMapV2 } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useSuiClient } from "@/hooks/useSuiClient";
import { walletErrorMessage } from "@/lib/format";
import { buildAddLocationTx } from "@/lib/mapLocation";
import { useAppStore } from "@/stores/appStore";
import type { StructureRow } from "@/views/Deployables";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { getContractAddresses } from "@tehfrontier/chain-shared";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, Loader2, MapPin } from "lucide-react";
import { useMemo, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

interface AddToMapDialogProps {
	structureRow: StructureRow;
	onClose: () => void;
	onAdded?: () => void;
}

type MapOption =
	| { version: "v1"; map: ManifestPrivateMap }
	| { version: "v2"; map: ManifestPrivateMapV2 };

// ── Component ───────────────────────────────────────────────────────────────

export function AddToMapDialog({ structureRow, onClose, onAdded }: AddToMapDialogProps) {
	const tenant = useActiveTenant();
	const account = useCurrentAccount();
	const client = useSuiClient();
	const dAppKit = useDAppKit();
	const { activeCharacter } = useActiveCharacter();
	const defaultMapId = useAppStore((s) => s.defaultMapId);

	// Read all maps from IndexedDB
	const mapsV1 =
		useLiveQuery(() => db.manifestPrivateMaps.where("tenant").equals(tenant).toArray(), [tenant]) ??
		[];
	const mapsV2 =
		useLiveQuery(
			() => db.manifestPrivateMapsV2.where("tenant").equals(tenant).toArray(),
			[tenant],
		) ?? [];

	// Build map options -- V1 maps need decryptedMapKey, V2 all included
	const mapOptions = useMemo(() => {
		const opts: MapOption[] = [];
		for (const m of mapsV1) {
			if (m.decryptedMapKey && !m._archived) {
				opts.push({ version: "v1", map: m });
			}
		}
		for (const m of mapsV2) {
			if (!m._archived) {
				opts.push({ version: "v2", map: m });
			}
		}
		return opts;
	}, [mapsV1, mapsV2]);

	// Contract addresses
	const addresses = getContractAddresses(tenant as TenantId);
	const packageIdV1 = addresses.privateMap?.packageId;
	const packageIdV2 = addresses.privateMapStandings?.packageId;

	// Form state
	const [selectedMapId, setSelectedMapId] = useState<string>(defaultMapId ?? "");
	const [description, setDescription] = useState(structureRow.label);
	const [structureId, setStructureId] = useState(structureRow.objectId);

	// Parse location from structureRow.lPoint (e.g. "P2-L3")
	const parsedLocation = useMemo(() => {
		const result = { systemId: "", planet: "", lPoint: "" };
		if (structureRow.systemId) result.systemId = String(structureRow.systemId);
		if (structureRow.lPoint) {
			const matchFull = structureRow.lPoint.match(/^P(\d+)-L([1-5])$/);
			if (matchFull) {
				result.planet = matchFull[1];
				result.lPoint = matchFull[2];
			} else {
				const matchSimple = structureRow.lPoint.match(/^L([1-5])$/);
				if (matchSimple) {
					result.lPoint = matchSimple[1];
				}
			}
		}
		return result;
	}, [structureRow.systemId, structureRow.lPoint]);

	const [solarSystemId, setSolarSystemId] = useState(parsedLocation.systemId);
	const [planet, setPlanet] = useState(parsedLocation.planet);
	const [lPoint, setLPoint] = useState(parsedLocation.lPoint);
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const selectedOption = mapOptions.find((o) => o.map.id === selectedMapId);

	const handleAdd = async () => {
		if (!solarSystemId || !planet || !lPoint || !selectedOption || !account) return;
		setIsPending(true);
		setError(null);

		try {
			const opt = selectedOption;
			let pkgId: string | undefined;
			let mapPublicKey: string | undefined;
			let inviteId: string | undefined;

			if (opt.version === "v1") {
				pkgId = packageIdV1;
				mapPublicKey = opt.map.publicKey;
				inviteId = opt.map.inviteId;
			} else {
				pkgId = packageIdV2;
				mapPublicKey = opt.map.publicKey;
				inviteId = opt.map.inviteId;
			}

			if (!pkgId) {
				setError("Map contract not configured for this tenant");
				return;
			}

			// Resolve charId and tribeId for V2 standings
			let charId: number | undefined;
			let tribeId: number | undefined;
			let registryId: string | undefined;

			if (opt.version === "v2" && opt.map.mode === 1) {
				registryId = opt.map.registryId;
				// Resolve from active character or manifest
				if (activeCharacter?.characterId) {
					charId = Number(activeCharacter.characterId);
				}
				tribeId = activeCharacter?.tribeId ?? undefined;

				// Fallback: lookup from manifest characters
				if ((charId == null || tribeId == null) && account.address) {
					const mc = await db.manifestCharacters
						.where("suiAddress")
						.equals(account.address)
						.first();
					if (mc) {
						if (charId == null) charId = Number(mc.characterItemId);
						if (tribeId == null) tribeId = mc.tribeId;
					}
				}
			}

			const tx = buildAddLocationTx({
				mapVersion: opt.version,
				mapMode: opt.version === "v2" ? opt.map.mode : 0,
				packageId: pkgId,
				mapId: opt.map.id,
				inviteId,
				structureId: structureId.trim() || undefined,
				locationData: {
					solarSystemId: Number(solarSystemId),
					planet: Number(planet),
					lPoint: Number(lPoint),
					description: description.trim() || undefined,
				},
				senderAddress: account.address,
				mapPublicKey,
				registryId,
				tribeId,
				charId,
			});

			await dAppKit.signAndExecuteTransaction({ transaction: tx });

			// Wait for indexer
			await new Promise((r) => setTimeout(r, 2000));

			// Sync map locations
			if (opt.version === "v1" && (opt.map as ManifestPrivateMap).decryptedMapKey) {
				const v1Map = opt.map as ManifestPrivateMap;
				if (v1Map.decryptedMapKey) {
					await syncMapLocations(client, v1Map.id, v1Map.decryptedMapKey, tenant as TenantId);
				}
			} else if (opt.version === "v2") {
				const v2Map = opt.map as ManifestPrivateMapV2;
				if (v2Map.mode === 1) {
					await syncMapLocationsV2(client, v2Map.id, 1, undefined, undefined, tenant as TenantId);
				} else if (v2Map.decryptedMapKey && v2Map.publicKey) {
					await syncMapLocationsV2(
						client,
						v2Map.id,
						0,
						v2Map.decryptedMapKey,
						v2Map.publicKey,
						tenant as TenantId,
					);
				}
			}

			// Update local structure location if it was empty
			if (!structureRow.systemId && solarSystemId) {
				const lPointStr =
					planet && lPoint ? `P${planet}-L${lPoint}` : lPoint ? `L${lPoint}` : undefined;
				const now = new Date().toISOString();
				const updateData = {
					systemId: Number(solarSystemId),
					lPoint: lPointStr,
					updatedAt: now,
				};
				if (structureRow.source === "deployables") {
					await db.deployables.update(structureRow.id, updateData);
				} else {
					await db.assemblies.update(structureRow.id, updateData);
				}
			}

			onAdded?.();
			onClose();
		} catch (err) {
			setError(walletErrorMessage(err));
		} finally {
			setIsPending(false);
		}
	};

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
				<h2 className="mb-4 text-lg font-semibold text-zinc-100">Add to Map</h2>
				<p className="mb-3 text-xs text-zinc-500">
					Structure: <span className="text-zinc-300">{structureRow.label}</span>
				</p>

				{/* Map selector */}
				<label className="mb-3 block">
					<span className="mb-1 block text-xs text-zinc-400">Map</span>
					<select
						value={selectedMapId}
						onChange={(e) => setSelectedMapId(e.target.value)}
						className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
					>
						<option value="">Select a map...</option>
						{mapOptions.map((opt) => (
							<option key={opt.map.id} value={opt.map.id}>
								{opt.map.name}
								{opt.version === "v2"
									? ` [V2 ${(opt.map as ManifestPrivateMapV2).mode === 0 ? "Encrypted" : "Standings"}]`
									: " [V1]"}
							</option>
						))}
					</select>
				</label>

				{/* Location fields */}
				<div className="mb-3 grid grid-cols-3 gap-3">
					<label className="block">
						<span className="mb-1 block text-xs text-zinc-400">System ID</span>
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
					<span className="mb-1 block text-xs text-zinc-400">Description</span>
					<input
						type="text"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="e.g., Main trade hub SSU"
						className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</label>

				<label className="mb-4 block">
					<span className="mb-1 block text-xs text-zinc-400">Structure ID</span>
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

				{mapOptions.length === 0 && (
					<div className="mb-4 rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-xs text-zinc-500">
						No maps available. Sync your maps on the Private Maps page first.
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
						disabled={
							!solarSystemId || !planet || !lPoint || !selectedOption || !account || isPending
						}
						className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
					>
						{isPending && <Loader2 size={14} className="animate-spin" />}
						<MapPin size={14} />
						Add Location
					</button>
				</div>
			</div>
		</div>
	);
}
