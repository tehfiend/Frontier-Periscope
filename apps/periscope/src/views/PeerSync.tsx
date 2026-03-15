// Peer management view — pairing, peer list, sharing groups, diagnostics

import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useSyncStore } from "@/stores/syncStore";
import { usePeerSync } from "@/hooks/usePeerSync";
import { generateGroupKey } from "@/sync/encryptionP2P";
import type { TrustTier } from "@/sync/types";
import type { SharingGroup } from "@/db/types";
import { SYNC_TABLES } from "@/lib/constants";
import {
	Wifi,
	Plus,
	Copy,
	Check,
	Trash2,
	Unplug,
	RefreshCw,
	Shield,
	Monitor,
	Users,
	Key,
	Activity,
	HardDrive,
} from "lucide-react";

export function PeerSync() {
	const instanceId = useLiveQuery(() => db.settings.get("instanceId")) as
		| { key: string; value: string }
		| undefined;
	const savedPeers = useLiveQuery(() => db.syncPeers.toArray()) ?? [];
	const sharingGroups = useLiveQuery(() => db.sharingGroups.toArray()) ?? [];
	const syncLogCount = useLiveQuery(() => db.syncLog.count()) ?? 0;
	const peers = useSyncStore((s) => s.peers);

	return (
		<div className="mx-auto max-w-3xl p-6">
			<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
				<Wifi size={24} className="text-cyan-500" />
				P2P Network
			</h1>
			<p className="mt-1 text-sm text-zinc-500">
				Peer-to-peer sync between browser instances. No server required.
			</p>

			{/* Section 1: This Instance */}
			<section className="mt-8">
				<h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-400">
					<Monitor size={16} />
					This Instance
				</h2>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<div className="grid grid-cols-2 gap-2 text-sm">
						<span className="text-zinc-500">Instance ID</span>
						<span className="font-mono text-zinc-300">{instanceId?.value ?? "—"}</span>
					</div>
				</div>
			</section>

			{/* Section 2: Pairing */}
			<section className="mt-8">
				<h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-400">
					<Plus size={16} />
					Pair New Peer
				</h2>
				<PairingPanel />
			</section>

			{/* Section 3: Connected Peers */}
			<section className="mt-8">
				<h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-400">
					<Users size={16} />
					Peers ({savedPeers.length})
				</h2>
				{savedPeers.length > 0 ? (
					<div className="space-y-2">
						{savedPeers.map((peer) => {
							const live = peers.get(peer.id);
							return (
								<PeerRow
									key={peer.id}
									peerId={peer.id}
									name={peer.name}
									trustTier={peer.trustTier}
									characterName={peer.characterName}
									status={live?.status ?? "disconnected"}
									lastSeen={peer.lastSeen}
								/>
							);
						})}
					</div>
				) : (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-500">
						No peers paired yet. Use the pairing section above to connect.
					</div>
				)}
			</section>

			{/* Section 4: Sharing Groups (intel peers) */}
			<section className="mt-8">
				<h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-400">
					<Shield size={16} />
					Sharing Groups
				</h2>
				<SharingGroupsPanel groups={sharingGroups} />
			</section>

			{/* Section 5: Diagnostics */}
			<section className="mt-8">
				<h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-400">
					<Activity size={16} />
					Diagnostics
				</h2>
				<DiagnosticsPanel syncLogCount={syncLogCount} />
			</section>
		</div>
	);
}

// ── Pairing Panel ──────────────────────────────────────────────────────────────

function PairingPanel() {
	const { createOffer, acceptOffer, completeConnection } = usePeerSync();
	const pairingOffer = useSyncStore((s) => s.pairingOffer);

	const [mode, setMode] = useState<"idle" | "create" | "join">("idle");
	const [trustTier, setTrustTier] = useState<TrustTier>("multibox");
	const [inputBlob, setInputBlob] = useState("");
	const [answerBlob, setAnswerBlob] = useState("");
	const [status, setStatus] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const handleCreateOffer = useCallback(async () => {
		try {
			setStatus("Generating offer...");
			const blob = await createOffer(trustTier);
			setStatus("Offer created. Share the code below with your peer.");
			setMode("create");
		} catch (e) {
			setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
		}
	}, [createOffer, trustTier]);

	const handleAcceptOffer = useCallback(async () => {
		if (!inputBlob.trim()) return;
		try {
			setStatus("Processing offer...");
			const result = await acceptOffer(inputBlob.trim());
			setAnswerBlob("");
			setStatus(`Connected to ${result.peerName}. Share the answer code below.`);
			// The answer blob would be shown if we had it — for now, it's auto-completed
		} catch (e) {
			setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
		}
	}, [acceptOffer, inputBlob]);

	const handleCompleteConnection = useCallback(async () => {
		if (!inputBlob.trim()) return;
		try {
			setStatus("Completing connection...");
			const result = await completeConnection(inputBlob.trim());
			setStatus(`Connected to ${result.peerName}!`);
			setMode("idle");
			setInputBlob("");
		} catch (e) {
			setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
		}
	}, [completeConnection, inputBlob]);

	const copyToClipboard = useCallback(async (text: string) => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, []);

	if (mode === "idle") {
		return (
			<div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="flex items-center gap-3">
					<label className="text-xs text-zinc-500">Trust tier:</label>
					<select
						value={trustTier}
						onChange={(e) => setTrustTier(e.target.value as TrustTier)}
						className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:outline-none"
					>
						<option value="multibox">Multi-box (full sync)</option>
						<option value="intel">Intel (selective sharing)</option>
					</select>
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={handleCreateOffer}
						className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
					>
						<Plus size={14} />
						Generate Pairing Code
					</button>
					<button
						type="button"
						onClick={() => setMode("join")}
						className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
					>
						<RefreshCw size={14} />
						Enter Pairing Code
					</button>
				</div>
				{status && <p className="text-xs text-zinc-400">{status}</p>}
			</div>
		);
	}

	if (mode === "create") {
		return (
			<div className="space-y-3 rounded-lg border border-cyan-900/50 bg-zinc-900/50 p-4">
				<p className="text-sm text-zinc-400">
					Share this code with the other browser. They should click "Enter Pairing Code" and paste it.
				</p>
				{pairingOffer && (
					<div className="relative">
						<textarea
							value={pairingOffer}
							readOnly
							rows={3}
							className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-300 focus:outline-none"
						/>
						<button
							type="button"
							onClick={() => copyToClipboard(pairingOffer)}
							className="absolute right-2 top-2 rounded bg-zinc-700 p-1 text-zinc-400 hover:text-zinc-200"
						>
							{copied ? <Check size={14} /> : <Copy size={14} />}
						</button>
					</div>
				)}
				<p className="text-sm text-zinc-400">
					After the other browser processes the code, paste their answer code below:
				</p>
				<textarea
					value={inputBlob}
					onChange={(e) => setInputBlob(e.target.value)}
					placeholder="Paste answer code here..."
					rows={3}
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
				/>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={handleCompleteConnection}
						disabled={!inputBlob.trim()}
						className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
					>
						Connect
					</button>
					<button
						type="button"
						onClick={() => { setMode("idle"); setInputBlob(""); setStatus(null); }}
						className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
					>
						Cancel
					</button>
				</div>
				{status && <p className="text-xs text-zinc-400">{status}</p>}
			</div>
		);
	}

	// mode === "join"
	return (
		<div className="space-y-3 rounded-lg border border-cyan-900/50 bg-zinc-900/50 p-4">
			<p className="text-sm text-zinc-400">
				Paste the pairing code from the other browser:
			</p>
			<textarea
				value={inputBlob}
				onChange={(e) => setInputBlob(e.target.value)}
				placeholder="Paste pairing code here..."
				rows={3}
				className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
			/>
			{answerBlob && (
				<>
					<p className="text-sm text-zinc-400">Share this answer code back:</p>
					<div className="relative">
						<textarea
							value={answerBlob}
							readOnly
							rows={3}
							className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-300 focus:outline-none"
						/>
						<button
							type="button"
							onClick={() => copyToClipboard(answerBlob)}
							className="absolute right-2 top-2 rounded bg-zinc-700 p-1 text-zinc-400 hover:text-zinc-200"
						>
							{copied ? <Check size={14} /> : <Copy size={14} />}
						</button>
					</div>
				</>
			)}
			<div className="flex gap-2">
				<button
					type="button"
					onClick={handleAcceptOffer}
					disabled={!inputBlob.trim()}
					className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					Accept & Generate Answer
				</button>
				<button
					type="button"
					onClick={() => { setMode("idle"); setInputBlob(""); setAnswerBlob(""); setStatus(null); }}
					className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
				>
					Cancel
				</button>
			</div>
			{status && <p className="text-xs text-zinc-400">{status}</p>}
		</div>
	);
}

// ── Peer Row ──────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
	connected: { label: "Connected", color: "bg-green-500/20 text-green-400" },
	syncing: { label: "Syncing", color: "bg-yellow-500/20 text-yellow-400" },
	connecting: { label: "Connecting", color: "bg-yellow-500/20 text-yellow-400" },
	disconnected: { label: "Offline", color: "bg-zinc-500/20 text-zinc-400" },
	error: { label: "Error", color: "bg-red-500/20 text-red-400" },
};

const TIER_BADGE: Record<string, { label: string; color: string }> = {
	multibox: { label: "Multi-box", color: "bg-cyan-500/20 text-cyan-400" },
	intel: { label: "Intel", color: "bg-purple-500/20 text-purple-400" },
};

function PeerRow({
	peerId,
	name,
	trustTier,
	characterName,
	status,
	lastSeen,
}: {
	peerId: string;
	name: string;
	trustTier: TrustTier;
	characterName?: string;
	status: string;
	lastSeen?: string;
}) {
	const { disconnectPeer, removePeer } = usePeerSync();

	const statusBadge = STATUS_BADGE[status] ?? STATUS_BADGE.disconnected;
	const tierBadge = TIER_BADGE[trustTier] ?? TIER_BADGE.intel;

	return (
		<div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-zinc-100">{name}</span>
					{characterName && (
						<span className="text-xs text-zinc-500">{characterName}</span>
					)}
				</div>
				<span className="font-mono text-xs text-zinc-600">{peerId.slice(0, 16)}...</span>
			</div>

			<span className={`rounded px-2 py-0.5 text-xs font-medium ${tierBadge.color}`}>
				{tierBadge.label}
			</span>
			<span className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadge.color}`}>
				{statusBadge.label}
			</span>

			{lastSeen && (
				<span className="text-xs text-zinc-600">
					{new Date(lastSeen).toLocaleTimeString()}
				</span>
			)}

			<div className="flex shrink-0 gap-1">
				{status === "connected" && (
					<button
						type="button"
						onClick={() => disconnectPeer(peerId)}
						className="rounded p-1 text-zinc-600 hover:text-yellow-400"
						title="Disconnect"
					>
						<Unplug size={14} />
					</button>
				)}
				<button
					type="button"
					onClick={() => {
						if (confirm(`Remove peer "${name}"?`)) removePeer(peerId);
					}}
					className="rounded p-1 text-zinc-600 hover:text-red-400"
					title="Remove"
				>
					<Trash2 size={14} />
				</button>
			</div>
		</div>
	);
}

// ── Sharing Groups Panel ──────────────────────────────────────────────────────

function SharingGroupsPanel({ groups }: { groups: SharingGroup[] }) {
	const [showCreate, setShowCreate] = useState(false);
	const [name, setName] = useState("");
	const [selectedTables, setSelectedTables] = useState<string[]>(["players", "killmails", "chatIntel"]);
	const [status, setStatus] = useState<string | null>(null);

	async function createGroup() {
		if (!name.trim()) return;
		const groupKey = await generateGroupKey();
		const now = new Date().toISOString();
		await db.sharingGroups.put({
			id: crypto.randomUUID(),
			name: name.trim(),
			groupKey,
			tables: selectedTables,
			memberInstanceIds: [],
			createdAt: now,
			updatedAt: now,
		});
		setName("");
		setShowCreate(false);
		setStatus("Group created. Share the group key with allies.");
	}

	async function deleteGroup(id: string) {
		if (!confirm("Delete this sharing group?")) return;
		await db.sharingGroups.delete(id);
	}

	const [copied, setCopied] = useState<string | null>(null);
	async function copyKey(key: string, id: string) {
		await navigator.clipboard.writeText(key);
		setCopied(id);
		setTimeout(() => setCopied(null), 2000);
	}

	return (
		<div className="space-y-3">
			{groups.map((g) => (
				<div key={g.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<div className="flex items-center justify-between">
						<div>
							<span className="text-sm font-medium text-zinc-100">{g.name}</span>
							<div className="mt-0.5 flex gap-1">
								{g.tables.map((t) => (
									<span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
										{t}
									</span>
								))}
							</div>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => copyKey(g.groupKey, g.id)}
								className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
								title="Copy group key"
							>
								<Key size={12} />
								{copied === g.id ? "Copied!" : "Copy Key"}
							</button>
							<button
								type="button"
								onClick={() => deleteGroup(g.id)}
								className="text-zinc-600 hover:text-red-400"
							>
								<Trash2 size={14} />
							</button>
						</div>
					</div>
				</div>
			))}

			{showCreate ? (
				<div className="space-y-3 rounded-lg border border-purple-900/50 bg-zinc-900/50 p-4">
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Group name"
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-purple-600 focus:outline-none"
					/>
					<div>
						<label className="mb-1 block text-xs text-zinc-500">Tables to share:</label>
						<div className="flex flex-wrap gap-1">
							{SYNC_TABLES.map((t) => (
								<button
									key={t}
									type="button"
									onClick={() =>
										setSelectedTables((prev) =>
											prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
										)
									}
									className={`rounded px-2 py-1 text-xs transition-colors ${
										selectedTables.includes(t)
											? "bg-purple-600/30 text-purple-300"
											: "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
									}`}
								>
									{t}
								</button>
							))}
						</div>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={createGroup}
							disabled={!name.trim()}
							className="rounded bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
						>
							Create Group
						</button>
						<button
							type="button"
							onClick={() => setShowCreate(false)}
							className="text-sm text-zinc-400 hover:text-zinc-200"
						>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setShowCreate(true)}
					className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 py-3 text-sm text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
				>
					<Plus size={14} />
					Create Sharing Group
				</button>
			)}

			{status && <p className="text-xs text-zinc-400">{status}</p>}
		</div>
	);
}

// ── Diagnostics Panel ────────────────────────────────────────────────────────

function DiagnosticsPanel({ syncLogCount }: { syncLogCount: number }) {
	const [tombstoneCount, setTombstoneCount] = useState<number | null>(null);

	async function countTombstones() {
		let count = 0;
		for (const tableName of SYNC_TABLES) {
			const table = (db as unknown as Record<string, import("dexie").Table>)[tableName];
			if (!table) continue;
			const tombstones = await table.filter((r: { _deleted?: boolean }) => !!r._deleted).count();
			count += tombstones;
		}
		setTombstoneCount(count);
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="grid grid-cols-2 gap-2 text-sm">
				<span className="text-zinc-500">Sync log entries</span>
				<span className="text-zinc-300">{syncLogCount.toLocaleString()}</span>
				<span className="text-zinc-500">Tombstones</span>
				<span className="text-zinc-300">
					{tombstoneCount !== null ? tombstoneCount.toLocaleString() : "—"}
					<button
						type="button"
						onClick={countTombstones}
						className="ml-2 text-xs text-zinc-500 hover:text-zinc-300"
					>
						Count
					</button>
				</span>
			</div>
			<div className="mt-3 flex gap-2">
				<button
					type="button"
					onClick={async () => {
						if (confirm("Clear sync log?")) await db.syncLog.clear();
					}}
					className="flex items-center gap-1 text-xs text-zinc-500 hover:text-red-400"
				>
					<HardDrive size={12} />
					Clear Sync Log
				</button>
			</div>
		</div>
	);
}
