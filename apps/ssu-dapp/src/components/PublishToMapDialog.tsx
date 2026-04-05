import { useDAppKit } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyAddress } from "./CopyAddress";

import { useSuiClient } from "@/hooks/useSuiClient";
import { getTenant } from "@/lib/constants";
import {
	type TenantId,
	buildAddLocation,
	buildAddLocationEncrypted,
	encodeLocationData,
	getContractAddresses,
	hexToBytes,
	queryMapInvitesForUser,
	queryMapInvitesV2ForUser,
	queryPrivateMap,
	queryPrivateMapV2,
	sealForRecipient,
} from "@tehfrontier/chain-shared";

interface PublishToMapDialogProps {
	ssuObjectId: string;
	walletAddress: string;
	onClose: () => void;
}

interface ResolvedMap {
	version: "v1" | "v2";
	inviteObjectId: string;
	mapId: string;
	name: string;
	publicKey: string;
}

export function PublishToMapDialog({
	ssuObjectId,
	walletAddress,
	onClose,
}: PublishToMapDialogProps) {
	const client = useSuiClient();
	const dAppKit = useDAppKit();
	const tenant = getTenant() as TenantId;
	const addresses = getContractAddresses(tenant);
	const packageIdV1 = addresses.privateMap?.packageId;
	const packageIdV2 = addresses.privateMapStandings?.packageId;

	const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
	const [systemId, setSystemId] = useState<number | null>(null);
	const [systemSearch, setSystemSearch] = useState("");
	const [showSystemResults, setShowSystemResults] = useState(false);
	const [planet, setPlanet] = useState("1");
	const [lPoint, setLPoint] = useState("1");
	const [description, setDescription] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Lazy-load system labels for search
	const { data: systemLabels } = useQuery({
		queryKey: ["stellarLabels"],
		queryFn: async () => {
			const resp = await fetch("/data/stellar_labels.json");
			return (await resp.json()) as Record<string, string>;
		},
		staleTime: Number.POSITIVE_INFINITY,
	});

	// Build searchable entries once
	const systemEntries = useMemo(() => {
		if (!systemLabels) return [];
		return Object.entries(systemLabels).map(([id, name]) => ({
			id: Number(id),
			name: name as string,
		}));
	}, [systemLabels]);

	// Filter by search query
	const filteredSystems = useMemo(() => {
		if (!systemSearch.trim() || !systemEntries.length) return [];
		const q = systemSearch.toLowerCase();
		return systemEntries.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20);
	}, [systemSearch, systemEntries]);

	const selectedSystemName = systemId
		? (systemLabels?.[String(systemId)] ?? `System ${systemId}`)
		: "";

	// Fetch user's map invites from both V1 and V2 contracts (no key needed)
	const { data: resolvedMaps, isLoading: mapsLoading } = useQuery({
		queryKey: ["mapInvites", packageIdV1, packageIdV2, walletAddress],
		queryFn: async (): Promise<ResolvedMap[]> => {
			const maps: ResolvedMap[] = [];

			// Query V1 maps
			if (packageIdV1) {
				try {
					const invites = await queryMapInvitesForUser(client, packageIdV1, walletAddress);
					const resolved = await Promise.all(
						invites.map((invite) => queryPrivateMap(client, invite.mapId).then((map) =>
							map ? { version: "v1" as const, inviteObjectId: invite.objectId, mapId: map.objectId, name: map.name, publicKey: map.publicKey } : null,
						)),
					);
					for (const r of resolved) {
						if (r) maps.push(r);
					}
				} catch (e) {
					console.warn("[PublishToMap] V1 query failed:", e);
				}
			}

			// Query V2 maps
			if (packageIdV2) {
				try {
					const invites = await queryMapInvitesV2ForUser(client, packageIdV2, walletAddress);
					const resolved = await Promise.all(
						invites.map((invite) => queryPrivateMapV2(client, invite.mapId).then((map) =>
							map && map.mode === 0 && map.publicKey ? { version: "v2" as const, inviteObjectId: invite.objectId, mapId: map.objectId, name: map.name, publicKey: map.publicKey } : null,
						)),
					);
					for (const r of resolved) {
						if (r) maps.push(r);
					}
				} catch (e) {
					console.warn("[PublishToMap] V2 query failed:", e);
				}
			}

			return maps;
		},
		enabled: !!(packageIdV1 || packageIdV2),
		staleTime: 60_000,
	});

	// Auto-select the first map when maps load
	const firstMapId = resolvedMaps?.[0]?.mapId ?? null;
	useEffect(() => {
		if (firstMapId) {
			setSelectedMapId((prev) => prev ?? firstMapId);
		}
	}, [firstMapId]);

	const solarSystemId = systemId ?? 0;
	const planetNum = Number(planet) || 0;
	const lPointNum = Number(lPoint) || 0;

	// Derive key and publish in a single action
	const handlePublish = useCallback(async () => {
		if (!selectedMapId) return;
		if (!systemId || solarSystemId <= 0) {
			setError("Select a solar system");
			return;
		}
		setIsPending(true);
		setError(null);

		try {
			const resolved = resolvedMaps?.find((m) => m.mapId === selectedMapId);
			if (!resolved) throw new Error("Map not found");

			// Encrypt location data with map's public key
			const plaintext = encodeLocationData({
				solarSystemId,
				planet: planetNum,
				lPoint: lPointNum,
				description: description.trim() || undefined,
			});

			const mapPublicKey = hexToBytes(resolved.publicKey);
			const encryptedData = sealForRecipient(plaintext, mapPublicKey);

			const packageId = resolved.version === "v2" ? packageIdV2 : packageIdV1;
			if (!packageId) throw new Error("Map contract not available");

			const tx =
				resolved.version === "v2"
					? buildAddLocationEncrypted({
							packageId,
							mapId: selectedMapId,
							inviteId: resolved.inviteObjectId,
							structureId: ssuObjectId,
							encryptedData,
							senderAddress: walletAddress,
						})
					: buildAddLocation({
							packageId,
							mapId: selectedMapId,
							inviteId: resolved.inviteObjectId,
							structureId: ssuObjectId,
							encryptedData,
							senderAddress: walletAddress,
						});

			await dAppKit.signAndExecuteTransaction({ transaction: tx });
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	}, [
		selectedMapId,
		packageIdV1,
		packageIdV2,
		resolvedMaps,
		systemId,
		solarSystemId,
		planetNum,
		lPointNum,
		description,
		ssuObjectId,
		walletAddress,
		dAppKit,
		onClose,
	]);

	if (!packageIdV1 && !packageIdV2) {
		return (
			<DialogOverlay onClose={onClose}>
				<h2 className="mb-4 text-lg font-semibold text-zinc-100">Publish to Map</h2>
				<p className="text-sm text-zinc-500">Private Map contract not deployed for this tenant.</p>
				<div className="mt-4 flex justify-end">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-300"
					>
						Close
					</button>
				</div>
			</DialogOverlay>
		);
	}

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Publish to Map</h2>

			{/* Location inputs */}
			<div className="mb-4 space-y-2">
				<div className="relative">
					<label htmlFor="publish-system" className="mb-1 block text-xs text-zinc-400">
						Solar System
					</label>
					<input
						id="publish-system"
						type="text"
						value={systemId ? systemSearch || selectedSystemName : systemSearch}
						onChange={(e) => {
							setSystemSearch(e.target.value);
							setSystemId(null);
							setShowSystemResults(true);
						}}
						onFocus={() => systemSearch && setShowSystemResults(true)}
						onBlur={() => setTimeout(() => setShowSystemResults(false), 200)}
						placeholder="Type to search systems..."
						className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
					{systemId && (
						<span className="absolute right-2 top-7 text-[10px] text-zinc-600">#{systemId}</span>
					)}
					{showSystemResults && filteredSystems.length > 0 && (
						<div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 shadow-lg">
							{filteredSystems.map((sys) => (
								<button
									key={sys.id}
									type="button"
									onMouseDown={() => {
										setSystemId(sys.id);
										setSystemSearch(sys.name);
										setShowSystemResults(false);
									}}
									className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700"
								>
									{sys.name}
									<span className="ml-2 text-[10px] text-zinc-600">#{sys.id}</span>
								</button>
							))}
						</div>
					)}
					{showSystemResults &&
						systemSearch.length >= 2 &&
						filteredSystems.length === 0 &&
						systemLabels && (
							<div className="absolute z-10 mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-xs text-zinc-500">
								No systems found
							</div>
						)}
				</div>
				<div className="flex gap-2">
					<div className="flex-1">
						<label htmlFor="publish-planet" className="mb-1 block text-xs text-zinc-400">
							Planet
						</label>
						<input
							id="publish-planet"
							type="number"
							min={1}
							max={13}
							value={planet}
							onChange={(e) => setPlanet(e.target.value)}
							className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
						/>
					</div>
					<div className="flex-1">
						<span className="mb-1 block text-xs text-zinc-400">L-Point</span>
						<div className="flex gap-1">
							{[1, 2, 3, 4, 5].map((n) => (
								<button
									key={n}
									type="button"
									onClick={() => setLPoint(String(n))}
									className={`flex-1 rounded-lg border px-1 py-2 text-sm transition-colors ${
										lPoint === String(n)
											? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
											: "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
									}`}
								>
									L{n}
								</button>
							))}
						</div>
					</div>
				</div>
				{systemId && (
					<p className="text-xs text-zinc-500">
						Location: {selectedSystemName} -- P{planetNum}-L{lPointNum}
					</p>
				)}
			</div>

			{mapsLoading ? (
				<p className="py-8 text-center text-sm text-zinc-500">Loading maps...</p>
			) : !resolvedMaps || resolvedMaps.length === 0 ? (
				<p className="py-8 text-center text-sm text-zinc-500">
					No private maps found. Ask a map creator to invite you.
				</p>
			) : (
				<>
					<span className="mb-1 block text-xs text-zinc-400">Select Map</span>
					<div className="mb-3 max-h-48 space-y-1 overflow-y-auto">
						{resolvedMaps.map((rm) => (
							<button
								key={rm.mapId}
								type="button"
								onClick={() => setSelectedMapId(rm.mapId)}
								className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
									selectedMapId === rm.mapId
										? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
										: "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600"
								}`}
							>
								{rm.name}
								<CopyAddress
									address={rm.mapId}
									sliceStart={10}
									sliceEnd={4}
									className="ml-2 text-xs text-zinc-600"
								/>
							</button>
						))}
					</div>

					<label className="mb-4 block">
						<span className="mb-1 block text-xs text-zinc-400">Description (optional)</span>
						<input
							type="text"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="e.g., Alliance trade hub"
							className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
						/>
					</label>
				</>
			)}

			{error && (
				<div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handlePublish}
					disabled={!selectedMapId || isPending}
					className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending ? "Publishing..." : "Publish"}
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
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
				{children}
			</div>
		</div>
	);
}
