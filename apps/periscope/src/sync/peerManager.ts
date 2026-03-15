// Multi-peer coordinator — manages connections, heartbeat, and auto-reconnect

import { PeerConnection, type ConnectionState } from "./webrtcConnection";
import { createOfferBlob, parseOfferBlob, createAnswerBlob, parseAnswerBlob } from "./signaling";
import { db } from "@/db";
import type { SyncMessage, TrustTier } from "./types";

const HEARTBEAT_INTERVAL = 30_000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60_000;
const MAX_RECONNECT_RETRIES = 5;

interface ManagedPeer {
	connection: PeerConnection;
	trustTier: TrustTier;
	heartbeatTimer?: ReturnType<typeof setInterval>;
	reconnectAttempts: number;
	reconnectTimer?: ReturnType<typeof setTimeout>;
}

export interface PeerManagerEvents {
	onMessage: (peerId: string, msg: SyncMessage) => void;
	onPeerStateChange: (peerId: string, state: ConnectionState) => void;
}

export class PeerManager {
	private peers = new Map<string, ManagedPeer>();
	private pendingConnections = new Map<string, PeerConnection>();
	private events: PeerManagerEvents;
	private instanceId: string;
	private instanceName: string;
	private characterName?: string;
	private visibilityHandler: () => void;

	constructor(
		events: PeerManagerEvents,
		meta: { instanceId: string; instanceName: string; characterName?: string },
	) {
		this.events = events;
		this.instanceId = meta.instanceId;
		this.instanceName = meta.instanceName;
		this.characterName = meta.characterName;

		this.visibilityHandler = () => {
			if (document.visibilityState === "visible") this.onTabWake();
		};
		document.addEventListener("visibilitychange", this.visibilityHandler);
	}

	getPeerIds(): string[] {
		return [...this.peers.keys()];
	}

	getConnection(peerId: string): PeerConnection | undefined {
		return this.peers.get(peerId)?.connection;
	}

	getTrustTier(peerId: string): TrustTier | undefined {
		return this.peers.get(peerId)?.trustTier;
	}

	/** Create an offer for a new peer pairing */
	async createOffer(trustTier: TrustTier): Promise<{ blob: string; pendingId: string }> {
		const pendingId = `pending-${Date.now()}`;
		const connection = this.createConnection(pendingId);
		this.pendingConnections.set(pendingId, connection);

		connection.createDataChannel();
		const blob = await createOfferBlob(connection.pc, {
			instanceId: this.instanceId,
			instanceName: this.instanceName,
			trustTier,
			characterName: this.characterName,
		});

		return { blob, pendingId };
	}

	/** Accept an incoming offer and generate an answer blob */
	async acceptOffer(offerBlob: string): Promise<{
		answerBlob: string;
		peerId: string;
		peerName: string;
		trustTier: TrustTier;
		characterName?: string;
	}> {
		const offer = await parseOfferBlob(offerBlob);
		const connection = this.createConnection(offer.instanceId);

		await connection.acceptOffer(offer.sdp, offer.candidates);
		const answerBlob = await createAnswerBlob(connection.pc, {
			instanceId: this.instanceId,
			instanceName: this.instanceName,
			trustTier: offer.trustTier,
			characterName: this.characterName,
		});

		this.registerPeer(offer.instanceId, connection, offer.trustTier);

		// Persist peer
		const now = new Date().toISOString();
		await db.syncPeers.put({
			id: offer.instanceId,
			name: offer.instanceName,
			trustTier: offer.trustTier,
			characterName: offer.characterName,
			autoConnect: true,
			lastSeen: now,
			createdAt: now,
		});

		return {
			answerBlob,
			peerId: offer.instanceId,
			peerName: offer.instanceName,
			trustTier: offer.trustTier,
			characterName: offer.characterName,
		};
	}

	/** Complete a pending connection with the answer blob */
	async completeConnection(pendingId: string, answerBlob: string): Promise<{
		peerId: string;
		peerName: string;
		trustTier: TrustTier;
		characterName?: string;
	}> {
		const connection = this.pendingConnections.get(pendingId);
		if (!connection) throw new Error(`No pending connection: ${pendingId}`);
		this.pendingConnections.delete(pendingId);

		const answer = await parseAnswerBlob(answerBlob);
		await connection.completeConnection(answer.sdp, answer.candidates);

		this.registerPeer(answer.instanceId, connection, answer.trustTier);

		// Persist peer
		const now = new Date().toISOString();
		await db.syncPeers.put({
			id: answer.instanceId,
			name: answer.instanceName,
			trustTier: answer.trustTier,
			characterName: answer.characterName,
			autoConnect: true,
			lastSeen: now,
			createdAt: now,
		});

		return {
			peerId: answer.instanceId,
			peerName: answer.instanceName,
			trustTier: answer.trustTier,
			characterName: answer.characterName,
		};
	}

	/** Send a message to a specific peer */
	send(peerId: string, msg: SyncMessage): boolean {
		const peer = this.peers.get(peerId);
		if (!peer) return false;
		return peer.connection.send(msg);
	}

	/** Send a message to all connected peers */
	broadcast(msg: SyncMessage): void {
		for (const [, peer] of this.peers) {
			peer.connection.send(msg);
		}
	}

	/** Disconnect a peer (keeps DB entry) */
	disconnect(peerId: string): void {
		const peer = this.peers.get(peerId);
		if (!peer) return;
		if (peer.heartbeatTimer) clearInterval(peer.heartbeatTimer);
		if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
		peer.connection.close();
		this.peers.delete(peerId);
	}

	/** Remove a peer entirely (disconnect + delete from DB) */
	async removePeer(peerId: string): Promise<void> {
		this.disconnect(peerId);
		await db.syncPeers.delete(peerId);
	}

	/** Clean up all resources */
	destroy(): void {
		document.removeEventListener("visibilitychange", this.visibilityHandler);
		for (const [id] of this.peers) {
			this.disconnect(id);
		}
		for (const [, conn] of this.pendingConnections) {
			conn.close();
		}
		this.pendingConnections.clear();
	}

	private createConnection(routingId: string): PeerConnection {
		const conn = new PeerConnection({
			onMessage: (msg) => {
				const peerId = this.findPeerIdByConnection(conn) ?? routingId;
				this.events.onMessage(peerId, msg);
			},
			onStateChange: (state) => {
				const peerId = this.findPeerIdByConnection(conn);
				if (peerId) {
					this.handleStateChange(peerId, state);
					this.events.onPeerStateChange(peerId, state);
				}
			},
		});
		return conn;
	}

	private findPeerIdByConnection(conn: PeerConnection): string | undefined {
		for (const [id, peer] of this.peers) {
			if (peer.connection === conn) return id;
		}
		return undefined;
	}

	private registerPeer(peerId: string, connection: PeerConnection, trustTier: TrustTier): void {
		// Clean up any existing connection to this peer
		if (this.peers.has(peerId)) {
			this.disconnect(peerId);
		}

		const managed: ManagedPeer = {
			connection,
			trustTier,
			reconnectAttempts: 0,
		};

		// Start heartbeat
		managed.heartbeatTimer = setInterval(() => {
			connection.send({ type: "ping", timestamp: Date.now() });
		}, HEARTBEAT_INTERVAL);

		this.peers.set(peerId, managed);
	}

	private handleStateChange(peerId: string, state: ConnectionState): void {
		const peer = this.peers.get(peerId);
		if (!peer) return;

		if (state === "connected") {
			peer.reconnectAttempts = 0;
			db.syncPeers.update(peerId, { lastSeen: new Date().toISOString() }).catch(() => {});
		}

		if (state === "disconnected" || state === "failed") {
			if (peer.heartbeatTimer) {
				clearInterval(peer.heartbeatTimer);
				peer.heartbeatTimer = undefined;
			}
			this.scheduleReconnect(peerId);
		}
	}

	private scheduleReconnect(peerId: string): void {
		const peer = this.peers.get(peerId);
		if (!peer || peer.reconnectAttempts >= MAX_RECONNECT_RETRIES) return;

		const delay = Math.min(
			RECONNECT_BASE_MS * 2 ** peer.reconnectAttempts,
			RECONNECT_MAX_MS,
		);
		peer.reconnectAttempts++;

		peer.reconnectTimer = setTimeout(() => {
			// Reconnection requires a new signaling exchange — we can't auto-reconnect
			// without a signaling server. Just notify the UI that the peer is offline.
			console.log(`[PeerManager] Peer ${peerId} reconnect attempt ${peer.reconnectAttempts} — requires re-pairing`);
		}, delay);
	}

	private onTabWake(): void {
		// Send a ping to all connected peers to check liveness
		for (const [, peer] of this.peers) {
			if (peer.connection.state === "connected") {
				peer.connection.send({ type: "ping", timestamp: Date.now() });
			}
		}
	}
}
