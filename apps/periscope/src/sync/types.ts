// P2P sync type definitions — transient/network types (persisted types in db/types.ts)

export type TrustTier = "multibox" | "intel";
export type PeerStatus = "disconnected" | "connecting" | "connected" | "syncing" | "error";

export interface PeerState {
	instanceId: string;
	name: string;
	trustTier: TrustTier;
	status: PeerStatus;
	characterName?: string;
	lastSeen?: string;
	lastSyncHlc?: string;
	error?: string;
}

// ── Sync Messages ─────────────────────────────────────────────────────────────

export type SyncMessage =
	| HandshakeMessage
	| SyncRequestMessage
	| SyncBatchMessage
	| SyncAckMessage
	| LiveUpdateMessage
	| PingMessage
	| PongMessage
	| ErrorMessage;

export interface HandshakeMessage {
	type: "handshake";
	instanceId: string;
	instanceName: string;
	characterName?: string;
	trustTier: TrustTier;
	schemaVersion: number;
	hlcWatermark: string;
	groupId?: string;
}

export interface SyncRequestMessage {
	type: "sync-request";
	sinceHlc: string;
	tables?: string[];
}

export interface SyncBatchMessage {
	type: "sync-batch";
	entries: SyncEntry[];
	isLast: boolean;
	batchIndex: number;
}

export interface SyncAckMessage {
	type: "sync-ack";
	highestHlc: string;
	recordCount: number;
}

export interface LiveUpdateMessage {
	type: "live-update";
	entry: SyncEntry;
}

export interface PingMessage {
	type: "ping";
	timestamp: number;
}

export interface PongMessage {
	type: "pong";
	timestamp: number;
}

export interface ErrorMessage {
	type: "error";
	code: string;
	message: string;
}

// ── Sync Data ─────────────────────────────────────────────────────────────────

export interface SyncEntry {
	table: string;
	id: string;
	data: Record<string, unknown>;
	_hlc: string;
	_deleted: boolean;
	_origin: string;
}

export interface IntelShareConfig {
	tables: string[];
	tags?: string[];
	groupKey?: string;
}
