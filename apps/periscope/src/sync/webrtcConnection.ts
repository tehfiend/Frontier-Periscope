// WebRTC DataChannel lifecycle wrapper

import type { SyncMessage } from "./types";

const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const BUFFER_HIGH_WATER = 1024 * 1024; // 1MB

export type ConnectionState = "new" | "connecting" | "connected" | "disconnected" | "failed";

export interface PeerConnectionEvents {
	onMessage: (msg: SyncMessage) => void;
	onStateChange: (state: ConnectionState) => void;
}

export class PeerConnection {
	readonly pc: RTCPeerConnection;
	private dc: RTCDataChannel | null = null;
	private events: PeerConnectionEvents;
	private _state: ConnectionState = "new";

	constructor(events: PeerConnectionEvents) {
		this.events = events;
		this.pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });

		this.pc.onconnectionstatechange = () => {
			const s = this.pc.connectionState;
			if (s === "connected") this.setState("connected");
			else if (s === "disconnected" || s === "closed") this.setState("disconnected");
			else if (s === "failed") this.setState("failed");
		};
	}

	get state(): ConnectionState {
		return this._state;
	}

	private setState(state: ConnectionState): void {
		if (this._state === state) return;
		this._state = state;
		this.events.onStateChange(state);
	}

	/** Create a DataChannel and prepare for offer generation (initiator side) */
	createDataChannel(): void {
		this.dc = this.pc.createDataChannel("sync", { ordered: true });
		this.setupDataChannel(this.dc);
		this.setState("connecting");
	}

	/** Accept an offer SDP + candidates from the remote peer (responder side) */
	async acceptOffer(sdp: string, candidates: RTCIceCandidateInit[]): Promise<void> {
		this.pc.ondatachannel = (event) => {
			this.dc = event.channel;
			this.setupDataChannel(this.dc);
		};
		await this.pc.setRemoteDescription({ type: "offer", sdp });
		for (const c of candidates) {
			await this.pc.addIceCandidate(c);
		}
		this.setState("connecting");
	}

	/** Complete the connection by applying the answer SDP + candidates */
	async completeConnection(sdp: string, candidates: RTCIceCandidateInit[]): Promise<void> {
		await this.pc.setRemoteDescription({ type: "answer", sdp });
		for (const c of candidates) {
			await this.pc.addIceCandidate(c);
		}
	}

	/** Send a sync message. Returns false if buffer is full (backpressure). */
	send(msg: SyncMessage): boolean {
		if (!this.dc || this.dc.readyState !== "open") return false;
		if (this.dc.bufferedAmount > BUFFER_HIGH_WATER) return false;
		this.dc.send(JSON.stringify(msg));
		return true;
	}

	/** Wait for buffer to drain below high-water mark */
	waitForDrain(): Promise<void> {
		if (!this.dc || this.dc.bufferedAmount <= BUFFER_HIGH_WATER) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			const check = () => {
				if (!this.dc || this.dc.bufferedAmount <= BUFFER_HIGH_WATER) {
					resolve();
				} else {
					setTimeout(check, 50);
				}
			};
			setTimeout(check, 50);
		});
	}

	close(): void {
		this.dc?.close();
		this.pc.close();
		this.setState("disconnected");
	}

	private setupDataChannel(dc: RTCDataChannel): void {
		dc.onopen = () => this.setState("connected");
		dc.onclose = () => this.setState("disconnected");
		dc.onerror = () => this.setState("failed");
		dc.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data) as SyncMessage;
				this.events.onMessage(msg);
			} catch {
				console.error("[PeerConnection] Invalid message:", event.data);
			}
		};
	}
}
