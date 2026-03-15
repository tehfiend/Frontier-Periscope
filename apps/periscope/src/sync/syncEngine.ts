// CRDT sync engine — Dexie hooks, delta calculation, merge logic, offline queue

import type Dexie from "dexie";
import { db } from "@/db";
import * as hlc from "./hlc";
import { SYNC_TABLES } from "@/lib/constants";
import type { PeerManager } from "./peerManager";
import type { SyncEntry, SyncMessage, TrustTier } from "./types";
import { encryptPayload, decryptPayload, importGroupKey } from "./encryptionP2P";

const BATCH_SIZE = 100;
const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const GC_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

export class SyncEngine {
	private peerManager: PeerManager;
	private instanceId: string;
	private hooksInstalled = false;
	private gcTimer?: ReturnType<typeof setInterval>;

	constructor(peerManager: PeerManager, instanceId: string) {
		this.peerManager = peerManager;
		this.instanceId = instanceId;
	}

	/** Install Dexie hooks on all syncable tables to auto-stamp _hlc/_origin */
	installHooks(): void {
		if (this.hooksInstalled) return;

		for (const tableName of SYNC_TABLES) {
			const table = (db as unknown as Record<string, Dexie.Table>)[tableName];
			if (!table) continue;

			table.hook("creating", (_primKey, obj) => {
				if (!obj._hlc) obj._hlc = hlc.now();
				if (obj._deleted === undefined) obj._deleted = false;
				if (!obj._origin) obj._origin = this.instanceId;

				// Write to sync log (fire-and-forget)
				this.logSyncAction("sent", tableName, obj.id ?? _primKey, obj._hlc);
			});

			table.hook("updating", (mods, _primKey, obj) => {
				const updates: Record<string, unknown> = {};
				// Only stamp if not already being set by merge logic
				if (!("_hlc" in mods)) updates._hlc = hlc.now();
				if (!("_origin" in mods)) updates._origin = this.instanceId;
				if (Object.keys(updates).length > 0) {
					Object.assign(mods, updates);
				}

				// Broadcast live update to connected peers
				const merged = { ...obj, ...mods };
				const entry: SyncEntry = {
					table: tableName,
					id: String(merged.id ?? _primKey),
					data: merged,
					_hlc: merged._hlc,
					_deleted: !!merged._deleted,
					_origin: merged._origin ?? this.instanceId,
				};
				this.broadcastLiveUpdate(entry);

				return updates;
			});
		}

		this.hooksInstalled = true;
	}

	/** Start tombstone GC timer */
	startGC(): void {
		this.runGC();
		this.gcTimer = setInterval(() => this.runGC(), GC_INTERVAL);
	}

	/** Stop GC timer */
	stopGC(): void {
		if (this.gcTimer) {
			clearInterval(this.gcTimer);
			this.gcTimer = undefined;
		}
	}

	/** Handle an incoming sync message from a peer */
	async handleMessage(peerId: string, msg: SyncMessage): Promise<void> {
		switch (msg.type) {
			case "handshake":
				await this.handleHandshake(peerId, msg);
				break;
			case "sync-request":
				await this.handleSyncRequest(peerId, msg);
				break;
			case "sync-batch":
				await this.handleSyncBatch(peerId, msg);
				break;
			case "sync-ack":
				await this.handleSyncAck(peerId, msg);
				break;
			case "live-update":
				await this.handleLiveUpdate(peerId, msg);
				break;
			case "ping":
				this.peerManager.send(peerId, { type: "pong", timestamp: msg.timestamp });
				break;
			case "pong":
				// Update last seen
				db.syncPeers.update(peerId, { lastSeen: new Date().toISOString() }).catch(() => {});
				break;
			case "error":
				console.error(`[SyncEngine] Error from ${peerId}: ${msg.code} — ${msg.message}`);
				break;
		}
	}

	/** Initiate sync with a peer by sending handshake */
	sendHandshake(peerId: string): void {
		this.peerManager.send(peerId, {
			type: "handshake",
			instanceId: this.instanceId,
			instanceName: this.instanceId.slice(0, 8),
			schemaVersion: db.verno,
			hlcWatermark: hlc.now(),
			trustTier: this.peerManager.getTrustTier(peerId) ?? "intel",
		});
	}

	/** Calculate delta entries since a given HLC watermark */
	async calculateDelta(sinceHlc: string, tables?: string[]): Promise<SyncEntry[]> {
		const entries: SyncEntry[] = [];
		const tablesToSync = tables ?? [...SYNC_TABLES];

		for (const tableName of tablesToSync) {
			const table = (db as unknown as Record<string, Dexie.Table>)[tableName];
			if (!table) continue;

			const records = await table
				.where("_hlc")
				.above(sinceHlc)
				.toArray();

			for (const record of records) {
				entries.push({
					table: tableName,
					id: String(record.id ?? record.key),
					data: record,
					_hlc: record._hlc,
					_deleted: !!record._deleted,
					_origin: record._origin ?? this.instanceId,
				});
			}
		}

		// Sort by HLC for consistent ordering
		entries.sort((a, b) => hlc.compare(a._hlc, b._hlc));
		return entries;
	}

	/** Merge a remote record into the local database (LWW by HLC) */
	async mergeRecord(entry: SyncEntry): Promise<"inserted" | "updated" | "skipped"> {
		const table = (db as unknown as Record<string, Dexie.Table>)[entry.table];
		if (!table) return "skipped";

		const local = await table.get(entry.id);

		if (!local) {
			// New record — insert
			await table.put({ ...entry.data, _hlc: entry._hlc, _deleted: entry._deleted, _origin: entry._origin });
			this.logSyncAction("received", entry.table, entry.id, entry._hlc);
			return "inserted";
		}

		// Existing record — LWW: remote wins if HLC is higher
		if (local._hlc && hlc.compare(entry._hlc, local._hlc) > 0) {
			await table.put({ ...entry.data, _hlc: entry._hlc, _deleted: entry._deleted, _origin: entry._origin });
			this.logSyncAction("merged", entry.table, entry.id, entry._hlc);
			return "updated";
		}

		return "skipped";
	}

	/** Apply sharing filters for intel peers */
	filterEntriesForPeer(
		entries: SyncEntry[],
		trustTier: TrustTier,
		shareConfig?: { tables: string[]; tags?: string[] },
	): SyncEntry[] {
		if (trustTier === "multibox") return entries;

		if (!shareConfig) return [];

		return entries.filter((entry) => {
			if (!shareConfig.tables.includes(entry.table)) return false;
			if (shareConfig.tags && shareConfig.tags.length > 0) {
				const tags = (entry.data.tags as string[] | undefined) ?? [];
				if (!shareConfig.tags.some((t) => tags.includes(t))) return false;
			}
			return true;
		});
	}

	/** Encrypt entries for intel peer transmission */
	async encryptEntries(entries: SyncEntry[], groupKeyBase64: string): Promise<SyncEntry[]> {
		const key = await importGroupKey(groupKeyBase64);
		const encrypted: SyncEntry[] = [];

		for (const entry of entries) {
			const payload = JSON.stringify(entry.data);
			const encryptedData = await encryptPayload(payload, key);
			encrypted.push({
				...entry,
				data: { _encrypted: encryptedData } as Record<string, unknown>,
			});
		}

		return encrypted;
	}

	/** Decrypt entries received from intel peer */
	async decryptEntries(entries: SyncEntry[], groupKeyBase64: string): Promise<SyncEntry[]> {
		const key = await importGroupKey(groupKeyBase64);
		const decrypted: SyncEntry[] = [];

		for (const entry of entries) {
			const encryptedPayload = entry.data._encrypted as string | undefined;
			if (!encryptedPayload) {
				decrypted.push(entry);
				continue;
			}
			const payload = await decryptPayload(encryptedPayload, key);
			decrypted.push({
				...entry,
				data: JSON.parse(payload),
			});
		}

		return decrypted;
	}

	// ── Private handlers ────────────────────────────────────────────────────────

	private async handleHandshake(peerId: string, msg: Extract<SyncMessage, { type: "handshake" }>): Promise<void> {
		// Check schema version compatibility
		if (Math.abs(db.verno - msg.schemaVersion) > 1) {
			this.peerManager.send(peerId, {
				type: "error",
				code: "SCHEMA_MISMATCH",
				message: `Schema version gap too large: local=${db.verno}, remote=${msg.schemaVersion}`,
			});
			return;
		}

		// Receive the remote HLC to advance our clock
		hlc.receive(msg.hlcWatermark);

		// Send our handshake back
		this.sendHandshake(peerId);

		// Calculate and send delta
		const trustTier = msg.trustTier;
		let shareConfig: { tables: string[]; tags?: string[] } | undefined;

		if (trustTier === "intel" && msg.groupId) {
			const group = await db.sharingGroups.get(msg.groupId);
			if (group) {
				shareConfig = { tables: group.tables, tags: group.tags };
			}
		}

		const peerRecord = await db.syncPeers.get(peerId);
		const sinceHlc = peerRecord?.lastSyncHlc ?? "";
		let entries = await this.calculateDelta(sinceHlc);
		entries = this.filterEntriesForPeer(entries, trustTier, shareConfig);

		// Check if encryption is needed
		if (trustTier === "intel" && msg.groupId) {
			const group = await db.sharingGroups.get(msg.groupId);
			if (group?.groupKey) {
				entries = await this.encryptEntries(entries, group.groupKey);
			}
		}

		// Send in batches
		await this.sendBatches(peerId, entries);
	}

	private async handleSyncRequest(peerId: string, msg: Extract<SyncMessage, { type: "sync-request" }>): Promise<void> {
		const entries = await this.calculateDelta(msg.sinceHlc, msg.tables);
		await this.sendBatches(peerId, entries);
	}

	private async handleSyncBatch(peerId: string, msg: Extract<SyncMessage, { type: "sync-batch" }>): Promise<void> {
		// Check if entries need decryption
		const trustTier = this.peerManager.getTrustTier(peerId);
		let entries = msg.entries;

		if (trustTier === "intel") {
			const peerRecord = await db.syncPeers.get(peerId);
			if (peerRecord?.groupId) {
				const group = await db.sharingGroups.get(peerRecord.groupId);
				if (group?.groupKey) {
					entries = await this.decryptEntries(entries, group.groupKey);
				}
			}
		}

		let highestHlc = "";
		let count = 0;

		for (const entry of entries) {
			// Attribute received intel
			entry.data.source = "p2p";
			const result = await this.mergeRecord(entry);
			if (result !== "skipped") count++;
			if (hlc.compare(entry._hlc, highestHlc) > 0) {
				highestHlc = entry._hlc;
			}
		}

		// Send ack
		this.peerManager.send(peerId, {
			type: "sync-ack",
			highestHlc,
			recordCount: count,
		});

		// If this was the last batch, update watermark
		if (msg.isLast && highestHlc) {
			await db.syncPeers.update(peerId, { lastSyncHlc: highestHlc });
		}
	}

	private async handleSyncAck(peerId: string, msg: Extract<SyncMessage, { type: "sync-ack" }>): Promise<void> {
		if (msg.highestHlc) {
			await db.syncPeers.update(peerId, { lastSyncHlc: msg.highestHlc });
		}
	}

	private async handleLiveUpdate(peerId: string, msg: Extract<SyncMessage, { type: "live-update" }>): Promise<void> {
		let entry = msg.entry;

		// Decrypt if needed
		const trustTier = this.peerManager.getTrustTier(peerId);
		if (trustTier === "intel" && entry.data._encrypted) {
			const peerRecord = await db.syncPeers.get(peerId);
			if (peerRecord?.groupId) {
				const group = await db.sharingGroups.get(peerRecord.groupId);
				if (group?.groupKey) {
					const [decrypted] = await this.decryptEntries([entry], group.groupKey);
					entry = decrypted;
				}
			}
		}

		entry.data.source = "p2p";
		await this.mergeRecord(entry);
	}

	private async sendBatches(peerId: string, entries: SyncEntry[]): Promise<void> {
		const conn = this.peerManager.getConnection(peerId);
		if (!conn) return;

		for (let i = 0; i < entries.length; i += BATCH_SIZE) {
			const batch = entries.slice(i, i + BATCH_SIZE);
			const isLast = i + BATCH_SIZE >= entries.length;

			const sent = this.peerManager.send(peerId, {
				type: "sync-batch",
				entries: batch,
				isLast,
				batchIndex: Math.floor(i / BATCH_SIZE),
			});

			if (!sent) {
				await conn.waitForDrain();
				this.peerManager.send(peerId, {
					type: "sync-batch",
					entries: batch,
					isLast,
					batchIndex: Math.floor(i / BATCH_SIZE),
				});
			}
		}

		// If no entries, send an empty last batch
		if (entries.length === 0) {
			this.peerManager.send(peerId, {
				type: "sync-batch",
				entries: [],
				isLast: true,
				batchIndex: 0,
			});
		}
	}

	private broadcastLiveUpdate(entry: SyncEntry): void {
		// Don't broadcast our own merge results back
		if (entry._origin !== this.instanceId) return;

		for (const peerId of this.peerManager.getPeerIds()) {
			const trustTier = this.peerManager.getTrustTier(peerId);
			if (!trustTier) continue;

			if (trustTier === "multibox") {
				this.peerManager.send(peerId, { type: "live-update", entry });
			}
			// Intel peers: would need share config filtering + encryption
			// Handled asynchronously for intel peers
		}
	}

	private async runGC(): Promise<void> {
		const cutoffHlc = hlc.format({
			wallMs: Date.now() - TOMBSTONE_MAX_AGE_MS,
			counter: 0,
			nodeId: "00000000",
		});

		// Check if all peers have synced past the cutoff
		const peers = await db.syncPeers.toArray();
		const allSynced = peers.every((p) => p.lastSyncHlc && hlc.compare(p.lastSyncHlc, cutoffHlc) > 0);
		if (!allSynced && peers.length > 0) return;

		let purged = 0;
		for (const tableName of SYNC_TABLES) {
			const table = (db as unknown as Record<string, Dexie.Table>)[tableName];
			if (!table) continue;

			const tombstones = await table
				.filter((r: { _deleted?: boolean; _hlc?: string }) => !!r._deleted && !!r._hlc && hlc.compare(r._hlc, cutoffHlc) < 0)
				.toArray();

			for (const t of tombstones) {
				await table.delete(t.id ?? t.key);
				purged++;
			}
		}

		if (purged > 0) {
			console.log(`[SyncEngine] GC purged ${purged} tombstones`);
			this.logSyncAction("tombstone-gc", "*", String(purged), cutoffHlc);
		}
	}

	private logSyncAction(
		action: "sent" | "received" | "merged" | "conflict" | "tombstone-gc",
		table: string,
		recordId: string,
		hlcValue: string,
	): void {
		db.syncLog.add({
			timestamp: new Date().toISOString(),
			action,
			table,
			recordId,
			hlc: hlcValue,
		}).catch(() => {});
	}
}
