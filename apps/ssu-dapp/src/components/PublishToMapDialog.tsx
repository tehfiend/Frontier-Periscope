import { useDAppKit } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useMapKey } from "@/hooks/useMapKey";
import { useSuiClient } from "@/hooks/useSuiClient";
import { getTenant } from "@/lib/constants";
import {
	type MapInviteInfo,
	type PrivateMapInfo,
	type TenantId,
	buildAddLocation,
	encodeLocationData,
	getContractAddresses,
	hexToBytes,
	queryMapInvitesForUser,
	queryPrivateMap,
	sealForRecipient,
} from "@tehfrontier/chain-shared";

interface PublishToMapDialogProps {
	ssuObjectId: string;
	solarSystemId: number;
	planet: number;
	lPoint: number;
	walletAddress: string;
	onClose: () => void;
}

interface ResolvedMap {
	invite: MapInviteInfo;
	map: PrivateMapInfo;
}

export function PublishToMapDialog({
	ssuObjectId,
	solarSystemId,
	planet,
	lPoint,
	walletAddress,
	onClose,
}: PublishToMapDialogProps) {
	const client = useSuiClient();
	const dAppKit = useDAppKit();
	const tenant = getTenant() as TenantId;
	const addresses = getContractAddresses(tenant);
	const packageId = addresses.privateMap?.packageId;

	const { keyPair, deriveKey, isDerivingKey } = useMapKey();
	const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
	const [description, setDescription] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Fetch user's map invites + resolve map names
	const { data: resolvedMaps, isLoading: mapsLoading } = useQuery({
		queryKey: ["mapInvites", packageId, walletAddress],
		queryFn: async (): Promise<ResolvedMap[]> => {
			if (!packageId) return [];
			const invites = await queryMapInvitesForUser(client, packageId, walletAddress);
			const maps: ResolvedMap[] = [];
			for (const invite of invites) {
				const map = await queryPrivateMap(client, invite.mapId);
				if (map) {
					maps.push({ invite, map });
				}
			}
			return maps;
		},
		enabled: !!packageId && !!keyPair,
		staleTime: 60_000,
	});

	const handlePublish = useCallback(async () => {
		if (!keyPair || !selectedMapId || !packageId) return;
		setIsPending(true);
		setError(null);

		try {
			const resolved = resolvedMaps?.find((m) => m.map.objectId === selectedMapId);
			if (!resolved) throw new Error("Map not found");

			// Encrypt location data with map's public key
			const plaintext = encodeLocationData({
				solarSystemId,
				planet,
				lPoint,
				description: description.trim() || undefined,
			});

			const mapPublicKey = hexToBytes(resolved.map.publicKey);
			const encryptedData = sealForRecipient(plaintext, mapPublicKey);

			const tx = buildAddLocation({
				packageId,
				mapId: selectedMapId,
				inviteId: resolved.invite.objectId,
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
		keyPair,
		selectedMapId,
		packageId,
		resolvedMaps,
		solarSystemId,
		planet,
		lPoint,
		description,
		ssuObjectId,
		walletAddress,
		dAppKit,
		onClose,
	]);

	if (!packageId) {
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

	// Step 1: Derive key
	if (!keyPair) {
		return (
			<DialogOverlay onClose={onClose}>
				<h2 className="mb-4 text-lg font-semibold text-zinc-100">Publish to Map</h2>
				<p className="mb-4 text-sm text-zinc-400">
					Sign a message to derive your map encryption key.
				</p>
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
						onClick={deriveKey}
						disabled={isDerivingKey}
						className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
					>
						{isDerivingKey ? "Signing..." : "Derive Key"}
					</button>
				</div>
			</DialogOverlay>
		);
	}

	// Step 2: Select map + publish
	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Publish to Map</h2>

			<div className="mb-3 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
				<span className="text-zinc-500">Location: </span>
				System {solarSystemId} -- P{planet}-L{lPoint}
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
								key={rm.map.objectId}
								type="button"
								onClick={() => setSelectedMapId(rm.map.objectId)}
								className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
									selectedMapId === rm.map.objectId
										? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
										: "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600"
								}`}
							>
								{rm.map.name}
								<span className="ml-2 font-mono text-xs text-zinc-600">
									{rm.map.objectId.slice(0, 10)}...
								</span>
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
