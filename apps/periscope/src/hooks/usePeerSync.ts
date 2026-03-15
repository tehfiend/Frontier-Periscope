// Bootstrap hook for P2P sync — mounts in Layout, manages lifecycle

import { useEffect, useRef, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { PeerManager } from "@/sync/peerManager";
import { SyncEngine } from "@/sync/syncEngine";
import * as hlc from "@/sync/hlc";
import { useSyncStore } from "@/stores/syncStore";
import type { TrustTier, PeerStatus } from "@/sync/types";
import type { ConnectionState } from "@/sync/webrtcConnection";

function connectionToPeerStatus(state: ConnectionState): PeerStatus {
	switch (state) {
		case "connected":
			return "connected";
		case "connecting":
			return "connecting";
		case "disconnected":
			return "disconnected";
		case "failed":
			return "error";
		default:
			return "disconnected";
	}
}

export function usePeerSync() {
	const peerManagerRef = useRef<PeerManager | null>(null);
	const syncEngineRef = useRef<SyncEngine | null>(null);

	const instanceId = useLiveQuery(() => db.settings.get("instanceId")) as
		| { key: string; value: string }
		| undefined;

	const { setPeerState, updatePeerStatus, removePeer, setPairingOffer } = useSyncStore();

	// Initialize on mount
	useEffect(() => {
		if (!instanceId?.value) return;

		const id = instanceId.value;
		hlc.init(id.slice(0, 8));

		const manager = new PeerManager(
			{
				onMessage: (peerId, msg) => {
					syncEngineRef.current?.handleMessage(peerId, msg);
				},
				onPeerStateChange: (peerId, state) => {
					const status = connectionToPeerStatus(state);
					updatePeerStatus(peerId, status);

					// On connect, send handshake to initiate sync
					if (state === "connected") {
						syncEngineRef.current?.sendHandshake(peerId);
					}
				},
			},
			{ instanceId: id, instanceName: id.slice(0, 8) },
		);

		const engine = new SyncEngine(manager, id);
		engine.installHooks();
		engine.startGC();

		peerManagerRef.current = manager;
		syncEngineRef.current = engine;

		// Load saved peers into store
		db.syncPeers.toArray().then((peers) => {
			for (const peer of peers) {
				setPeerState(peer.id, {
					instanceId: peer.id,
					name: peer.name,
					trustTier: peer.trustTier,
					status: "disconnected",
					characterName: peer.characterName,
					lastSeen: peer.lastSeen,
				});
			}
		});

		return () => {
			engine.stopGC();
			manager.destroy();
			peerManagerRef.current = null;
			syncEngineRef.current = null;
		};
	}, [instanceId?.value, setPeerState, updatePeerStatus]);

	const createOffer = useCallback(
		async (trustTier: TrustTier): Promise<string> => {
			if (!peerManagerRef.current) throw new Error("Peer manager not initialized");
			const { blob, pendingId } = await peerManagerRef.current.createOffer(trustTier);
			setPairingOffer(blob, pendingId);
			return blob;
		},
		[setPairingOffer],
	);

	const acceptOffer = useCallback(
		async (offerBlob: string) => {
			if (!peerManagerRef.current) throw new Error("Peer manager not initialized");
			const result = await peerManagerRef.current.acceptOffer(offerBlob);
			setPeerState(result.peerId, {
				instanceId: result.peerId,
				name: result.peerName,
				trustTier: result.trustTier,
				status: "connecting",
				characterName: result.characterName,
			});
			return result;
		},
		[setPeerState],
	);

	const completeConnection = useCallback(
		async (answerBlob: string) => {
			if (!peerManagerRef.current) throw new Error("Peer manager not initialized");
			const pendingId = useSyncStore.getState().pendingId;
			if (!pendingId) throw new Error("No pending connection");
			const result = await peerManagerRef.current.completeConnection(pendingId, answerBlob);
			setPeerState(result.peerId, {
				instanceId: result.peerId,
				name: result.peerName,
				trustTier: result.trustTier,
				status: "connecting",
				characterName: result.characterName,
			});
			setPairingOffer(null);
			return result;
		},
		[setPeerState, setPairingOffer],
	);

	const disconnectPeer = useCallback((peerId: string) => {
		peerManagerRef.current?.disconnect(peerId);
		updatePeerStatus(peerId, "disconnected");
	}, [updatePeerStatus]);

	const removePeerFn = useCallback(
		async (peerId: string) => {
			await peerManagerRef.current?.removePeer(peerId);
			removePeer(peerId);
		},
		[removePeer],
	);

	return {
		createOffer,
		acceptOffer,
		completeConnection,
		disconnectPeer,
		removePeer: removePeerFn,
	};
}
