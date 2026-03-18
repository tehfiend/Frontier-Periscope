import { useState, useCallback, useEffect } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useSuiClient } from "@/hooks/useSuiClient";
import { db, notDeleted } from "@/db";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { TENANTS, type TenantId } from "@/chain/config";
import { discoverCharacterAndAssemblies } from "@/chain/queries";
import { fetchCharacterByAddress, searchCachedCharacters } from "@/chain/manifest";
import { parseLogFilename, parseHeader, decodeChatLog } from "@/lib/logParser";
import { lookupCharacterByItemId } from "@/chain/client";
import { getStoredHandle, requestDirectoryAccess, verifyPermission } from "@/lib/logFileAccess";
import { useAppStore } from "@/stores/appStore";
import {
	X,
	Wallet,
	FolderOpen,
	Search,
	PenLine,
	Loader2,
	Check,
	User,
	Plus,
	AlertCircle,
	RefreshCw,
} from "lucide-react";
import type { ManifestCharacter } from "@/db/types";

// ── Types ────────────────────────────────────────────────────────────────────

type Method = "wallet" | "logs" | "search" | "manual";

interface DiscoveredChar {
	characterId?: string;
	characterName: string;
	suiAddress?: string;
	tribeId?: number;
	tribe?: string;
	manifestId?: string;
	source: "wallet" | "log" | "manual";
	alreadyAdded?: boolean;
	/** Earliest log date (YYYYMMDD) */
	firstSeen?: string;
	/** Latest log date (YYYYMMDD) */
	lastSeen?: string;
}

interface Props {
	open: boolean;
	onClose: () => void;
}

// ── Tab config ───────────────────────────────────────────────────────────────

const methods: { id: Method; label: string; icon: typeof Wallet }[] = [
	{ id: "wallet", label: "Wallet", icon: Wallet },
	{ id: "logs", label: "Game Logs", icon: FolderOpen },
	{ id: "search", label: "Search", icon: Search },
	{ id: "manual", label: "Manual", icon: PenLine },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format YYYYMMDD log date string for display */
function formatLogDate(dateStr: string): string {
	if (dateStr.length !== 8) return dateStr;
	const y = dateStr.slice(0, 4);
	const m = dateStr.slice(4, 6);
	const d = dateStr.slice(6, 8);
	return new Date(`${y}-${m}-${d}`).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

async function resolveFromManifest(char: DiscoveredChar): Promise<DiscoveredChar> {
	// If already has address, nothing to resolve
	if (char.suiAddress) return char;

	// Try manifest cache by characterId (item_id)
	if (char.characterId) {
		const match = await db.manifestCharacters
			.where("characterItemId")
			.equals(char.characterId)
			.first();
		if (match) {
			let tribeName = char.tribe;
			if (!tribeName && match.tribeId) {
				const tribe = await db.manifestTribes.get(match.tribeId);
				tribeName = tribe?.name;
			}
			return {
				...char,
				suiAddress: match.suiAddress || char.suiAddress,
				tribeId: match.tribeId || char.tribeId,
				tribe: tribeName,
				manifestId: match.id,
			};
		}
	}

	// Try manifest cache by name
	if (char.characterName) {
		const match = await db.manifestCharacters
			.where("name")
			.equals(char.characterName)
			.first();
		if (match) {
			let tribeName = char.tribe;
			if (!tribeName && match.tribeId) {
				const tribe = await db.manifestTribes.get(match.tribeId);
				tribeName = tribe?.name;
			}
			return {
				...char,
				characterId: char.characterId || match.characterItemId || undefined,
				suiAddress: match.suiAddress || char.suiAddress,
				tribeId: match.tribeId || char.tribeId,
				tribe: tribeName,
				manifestId: match.id,
			};
		}
	}

	return char;
}

async function addCharacter(char: DiscoveredChar, tenant?: string): Promise<string> {
	// Auto-resolve address from manifest cache if not provided
	const resolved = await resolveFromManifest(char);
	const now = new Date().toISOString();
	const id = resolved.characterId || crypto.randomUUID();

	// Check if already exists (including soft-deleted — un-delete if found)
	if (resolved.characterId) {
		const existing = await db.characters.get(resolved.characterId);
		if (existing) {
			await db.characters.update(existing.id, {
				characterName: resolved.characterName || existing.characterName,
				suiAddress: resolved.suiAddress || existing.suiAddress,
				tribeId: resolved.tribeId || existing.tribeId,
				tribe: resolved.tribe || existing.tribe,
				manifestId: resolved.manifestId || existing.manifestId,
				source: resolved.source || existing.source,
				tenant,
				_deleted: false,
				updatedAt: now,
			});
			return existing.id;
		}
	}

	// Check by name (including soft-deleted)
	const byName = await db.characters
		.filter(
			(c) =>
				c.characterName.toLowerCase() === resolved.characterName.toLowerCase(),
		)
		.first();
	if (byName) {
		await db.characters.update(byName.id, {
			characterId: resolved.characterId || byName.characterId,
			suiAddress: resolved.suiAddress || byName.suiAddress,
			tribeId: resolved.tribeId || byName.tribeId,
			tribe: resolved.tribe || byName.tribe,
			manifestId: resolved.manifestId || byName.manifestId,
			source: resolved.source || byName.source,
			tenant,
			_deleted: false,
			updatedAt: now,
		});
		return byName.id;
	}

	await db.characters.add({
		id,
		characterId: resolved.characterId,
		characterName: resolved.characterName,
		suiAddress: resolved.suiAddress,
		tribeId: resolved.tribeId,
		tribe: resolved.tribe,
		manifestId: resolved.manifestId,
		tenant,
		source: resolved.source,
		isActive: false,
		createdAt: now,
		updatedAt: now,
	});
	return id;
}

// ── Wallet Method ────────────────────────────────────────────────────────────

function WalletMethod({ onClose, tenant }: { onClose: () => void; tenant: TenantId }) {
	const account = useCurrentAccount();
	const client = useSuiClient();
	const setActiveCharacterId = useAppStore((s) => s.setActiveCharacterId);
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<DiscoveredChar | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [added, setAdded] = useState(false);

	const handleDetect = useCallback(async () => {
		if (!account) return;
		setLoading(true);
		setError(null);
		setResult(null);
		try {
			const discovery = await discoverCharacterAndAssemblies(
				client,
				account.address,
				tenant,
			);
			if (!discovery.character?.name) {
				setError("No character found for this wallet on this server.");
				return;
			}
			const { name, characterObjectId, characterItemId, tribeId } =
				discovery.character;

			// Check tribe name from manifest
			let tribeName: string | undefined;
			if (tribeId) {
				const tribe = await db.manifestTribes.get(tribeId);
				tribeName = tribe?.name;
			}

			// Check if already added
			const existing = await db.characters.filter(notDeleted).toArray();
			const alreadyAdded =
				existing.some((c) => c.manifestId === characterObjectId) ||
				(characterItemId
					? existing.some((c) => c.characterId === characterItemId)
					: false) ||
				existing.some(
					(c) => c.characterName.toLowerCase() === name.toLowerCase(),
				);

			setResult({
				characterId: characterItemId,
				characterName: name,
				suiAddress: account.address,
				tribeId,
				tribe: tribeName,
				manifestId: characterObjectId,
				source: "wallet",
				alreadyAdded,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [account, client, tenant]);

	async function handleAdd() {
		if (!result) return;
		const id = await addCharacter(result, tenant);
		await db.settings.put({ key: "chainAddress", value: result.suiAddress });
		setActiveCharacterId(id);
		setAdded(true);
	}

	if (!account) {
		return (
			<div className="space-y-3 text-center">
				<AlertCircle size={32} className="mx-auto text-zinc-600" />
				<p className="text-sm text-zinc-400">
					Connect your Sui wallet first, then return here to detect your
					character.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-zinc-800 bg-zinc-800/30 px-3 py-2">
				<p className="text-xs text-zinc-500">Connected wallet</p>
				<p className="truncate font-mono text-sm text-zinc-300">
					{account.address}
				</p>
			</div>

			{!result && !error && (
				<button
					type="button"
					onClick={handleDetect}
					disabled={loading}
					className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{loading ? (
						<Loader2 size={14} className="animate-spin" />
					) : (
						<Search size={14} />
					)}
					{loading ? "Searching chain..." : "Detect Character"}
				</button>
			)}

			{error && (
				<div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-400">
					{error}
				</div>
			)}

			{result && (
				<CharacterResult
					char={result}
					onAdd={handleAdd}
					added={added}
					onDone={onClose}
				/>
			)}
		</div>
	);
}

// ── Logs Method ──────────────────────────────────────────────────────────────

function LogsMethod({ onClose: _onClose, tenant }: { onClose: () => void; tenant: TenantId }) {
	const setActiveCharacterId = useAppStore((s) => s.setActiveCharacterId);
	const [scanning, setScanning] = useState(false);
	const [discovered, setDiscovered] = useState<DiscoveredChar[]>([]);
	const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
	const [hasStoredHandle, setHasStoredHandle] = useState(false);
	const [resolving, setResolving] = useState(false);

	async function resolveFromChain(chars: DiscoveredChar[], t: TenantId) {
		const toResolve = chars.filter((c) => !c.suiAddress && c.characterId);
		if (toResolve.length === 0) return;
		setResolving(true);
		for (const char of toResolve) {
			try {
				const result = await lookupCharacterByItemId(char.characterId!, t);
				if (result) {
					setDiscovered((prev) =>
						prev.map((c) =>
							c.characterId === char.characterId
								? {
										...c,
										suiAddress: result.suiAddress,
										characterName: result.characterName || c.characterName,
										tribeId: result.tribeId,
										tribe: result.tribeName,
									}
								: c,
						),
					);
				}
			} catch {
				// Chain lookup failed — keep file-based data
			}
		}
		setResolving(false);
	}

	// Auto-scan on mount if a stored directory handle exists
	useEffect(() => {
		let cancelled = false;
		getStoredHandle().then((h) => {
			if (cancelled) return;
			if (h) {
				setHasStoredHandle(true);
				handleScan();
			}
		});
		return () => { cancelled = true; };
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function handleScan() {
		setScanning(true);
		try {
			// Reuse stored handle if available, otherwise prompt
			let handle = await getStoredHandle();
			if (handle) {
				const ok = await verifyPermission(handle);
				if (!ok) handle = null;
			}
			if (!handle) {
				handle = await requestDirectoryAccess();
			}
			if (!handle) {
				setScanning(false);
				return;
			}

			// Resolve gamelogs directory
			let gamelogsDir: FileSystemDirectoryHandle;
			try {
				gamelogsDir = await handle.getDirectoryHandle("Gamelogs");
			} catch {
				gamelogsDir = handle;
			}

			// Scan log files for characters, tracking date ranges
			const charMap = new Map<
				string,
				{ name: string; firstDate: string; lastDate: string }
			>();
			for await (const [fileName, entry] of gamelogsDir.entries()) {
				if (entry.kind !== "file" || !fileName.endsWith(".txt")) continue;
				const parsed = parseLogFilename(fileName);
				if (!parsed?.characterId) continue;

				const existing = charMap.get(parsed.characterId);
				if (existing) {
					// Update date range
					if (parsed.date < existing.firstDate) existing.firstDate = parsed.date;
					if (parsed.date > existing.lastDate) existing.lastDate = parsed.date;
				} else {
					// First time seeing this character — read header for name
					const fileHandle = entry as FileSystemFileHandle;
					const file = await fileHandle.getFile();
					const headerText = await file.slice(0, 2048).text();
					const header = parseHeader(headerText);
					charMap.set(parsed.characterId, {
						name: header?.characterName || `Character ${parsed.characterId}`,
						firstDate: parsed.date,
						lastDate: parsed.date,
					});
				}
			}

			// For characters whose game log lacked a Listener line, try chat logs
			const needsName = [...charMap].filter(([, v]) => v.name.startsWith("Character "));
			if (needsName.length > 0) {
				let chatlogsDir: FileSystemDirectoryHandle | null = null;
				try {
					chatlogsDir = await handle.getDirectoryHandle("Chatlogs");
				} catch { /* no Chatlogs dir */ }
				if (chatlogsDir) {
					for (const [charId, info] of needsName) {
						for await (const [chatFileName, chatEntry] of chatlogsDir.entries()) {
							if (chatEntry.kind !== "file") continue;
							if (!chatFileName.includes(`_${charId}.txt`)) continue;
							try {
								const chatFile = await (chatEntry as FileSystemFileHandle).getFile();
								const buf = await chatFile.slice(0, 4096).arrayBuffer();
								const text = decodeChatLog(buf);
								const m = text.match(/Listener:\s+(.+)/);
								if (m) {
									info.name = m[1].trim();
									break;
								}
							} catch { /* skip unreadable */ }
						}
					}
				}
			}

			// Check which are already added
			const existingChars = await db.characters.filter(notDeleted).toArray();
			const existingIds = new Set(existingChars.map((c) => c.characterId));

			const chars: DiscoveredChar[] = Array.from(charMap.entries())
				.map(([characterId, info]) => ({
					characterId,
					characterName: info.name,
					source: "log" as const,
					alreadyAdded: existingIds.has(characterId),
					firstSeen: info.firstDate,
					lastSeen: info.lastDate,
				}))
				.sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));

			setDiscovered(chars);
			setScanning(false);

			// Auto-resolve addresses from blockchain (non-blocking, runs after UI updates)
			resolveFromChain(chars, tenant);
		} catch (err) {
			console.error("Log scan error:", err);
			setScanning(false);
		}
	}

	async function handleAdd(char: DiscoveredChar) {
		const id = await addCharacter(char, tenant);
		setAddedIds((prev) => new Set(prev).add(char.characterId || id));
		setActiveCharacterId(id);
	}

	async function handleAddAll() {
		for (const char of discovered) {
			if (!char.alreadyAdded && !addedIds.has(char.characterId || "")) {
				await handleAdd(char);
			}
		}
	}

	return (
		<div className="space-y-4">
			<p className="text-xs text-zinc-500">
				Scan your game log directory to discover characters. Point to your{" "}
				<code className="rounded bg-zinc-800 px-1 text-zinc-400">
					Documents/Frontier/logs
				</code>{" "}
				folder.
			</p>

			{discovered.length === 0 && !scanning && (
				<button
					type="button"
					onClick={handleScan}
					disabled={scanning}
					className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					<FolderOpen size={14} />
					{hasStoredHandle ? "Scan Log Directory" : "Select Log Directory"}
				</button>
			)}

			{scanning && (
				<div className="flex items-center justify-center gap-2 py-4 text-sm text-zinc-400">
					<Loader2 size={14} className="animate-spin" />
					Scanning game logs...
				</div>
			)}

			{discovered.length > 0 && (
				<>
					<div className="space-y-2">
						{discovered.map((char) => {
							const wasAdded =
								char.alreadyAdded ||
								addedIds.has(char.characterId || "");
							return (
								<div
									key={char.characterId}
									className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/30 px-3 py-2"
								>
									<div className="min-w-0 flex-1">
										<p className="text-sm text-zinc-200">
											{char.characterName}
										</p>
										<p className="text-xs text-zinc-600">
											ID: {char.characterId}
											{char.firstSeen && (
												<span className="ml-2">
													{formatLogDate(char.firstSeen)}
													{char.lastSeen && char.lastSeen !== char.firstSeen
														? ` — ${formatLogDate(char.lastSeen)}`
														: ""}
												</span>
											)}
										</p>
										{char.suiAddress && (
											<p className="truncate font-mono text-[10px] text-cyan-600">
												{char.suiAddress}
											</p>
										)}
									</div>
									{wasAdded ? (
										<span className="flex shrink-0 items-center gap-1 text-xs text-green-500">
											<Check size={12} /> Added
										</span>
									) : (
										<button
											type="button"
											onClick={() => handleAdd(char)}
											className="flex shrink-0 items-center gap-1 rounded bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-cyan-500"
										>
											<Plus size={12} /> Add
										</button>
									)}
								</div>
							);
						})}
					</div>
					<div className="flex gap-2">
						{discovered.some(
							(c) =>
								!c.alreadyAdded &&
								!addedIds.has(c.characterId || ""),
						) && (
							<button
								type="button"
								onClick={handleAddAll}
								className="flex-1 rounded-lg border border-cyan-800 bg-cyan-900/20 py-2 text-sm text-cyan-400 transition-colors hover:bg-cyan-900/40"
							>
								Add All
							</button>
						)}
						<button
							type="button"
							onClick={handleScan}
							disabled={scanning}
							className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50"
						>
							<RefreshCw size={12} />
							Rescan
						</button>
					</div>
					{resolving && (
						<div className="flex items-center gap-2 text-xs text-zinc-500">
							<Loader2 size={12} className="animate-spin" />
							Resolving addresses from chain...
						</div>
					)}
				</>
			)}
		</div>
	);
}

// ── Search Method ────────────────────────────────────────────────────────────

function SearchMethod({ onClose, tenant }: { onClose: () => void; tenant: TenantId }) {
	const client = useSuiClient();
	const setActiveCharacterId = useAppStore((s) => s.setActiveCharacterId);
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(false);
	const [results, setResults] = useState<ManifestCharacter[]>([]);
	const [addressResult, setAddressResult] = useState<DiscoveredChar | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

	const isAddress = query.trim().startsWith("0x");

	async function handleSearch() {
		const q = query.trim();
		if (!q || q.length < 2) return;
		setLoading(true);
		setError(null);
		setResults([]);
		setAddressResult(null);

		try {
			if (isAddress) {
				// Search by Sui address — query chain
				const char = await fetchCharacterByAddress(client, q, tenant);
				if (char) {
					let tribeName: string | undefined;
					if (char.tribeId) {
						const tribe = await db.manifestTribes.get(char.tribeId);
						tribeName = tribe?.name;
					}
					const existing = await db.characters.filter(notDeleted).toArray();
					const alreadyAdded = existing.some(
						(c) =>
							c.manifestId === char.id ||
							c.characterId === char.characterItemId ||
							c.characterName.toLowerCase() === char.name.toLowerCase(),
					);
					setAddressResult({
						characterId: char.characterItemId,
						characterName: char.name || "(unnamed)",
						suiAddress: char.suiAddress,
						tribeId: char.tribeId,
						tribe: tribeName,
						manifestId: char.id,
						source: "manual",
						alreadyAdded,
					});
				} else {
					setError("No character found for this address.");
				}
			} else {
				// Search by name — use manifest cache
				const matches = await searchCachedCharacters(q, 20);
				if (matches.length === 0) {
					setError(
						'No matches in local cache. Run "Discover" on the Manifest page first to populate the cache.',
					);
				} else {
					// Check which are already added
					const existing = await db.characters
						.filter(notDeleted)
						.toArray();
					const existingItemIds = new Set(
						existing.map((c) => c.characterId),
					);
					const existingManifestIds = new Set(
						existing.map((c) => c.manifestId),
					);

					// Mark already added
					const withStatus = matches.map((m) => ({
						...m,
						_alreadyAdded:
							existingItemIds.has(m.characterItemId) ||
							existingManifestIds.has(m.id),
					}));
					setResults(withStatus as typeof matches);
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}

	async function handleAddManifest(m: ManifestCharacter) {
		let tribeName: string | undefined;
		if (m.tribeId) {
			const tribe = await db.manifestTribes.get(m.tribeId);
			tribeName = tribe?.name;
		}
		const id = await addCharacter({
			characterId: m.characterItemId,
			characterName: m.name || "(unnamed)",
			suiAddress: m.suiAddress,
			tribeId: m.tribeId,
			tribe: tribeName,
			manifestId: m.id,
			source: "manual",
		}, tenant);
		setAddedIds((prev) => new Set(prev).add(m.id));
		setActiveCharacterId(id);
	}

	async function handleAddAddress() {
		if (!addressResult) return;
		const id = await addCharacter(addressResult, tenant);
		setActiveCharacterId(id);
		setAddedIds((prev) => new Set(prev).add(addressResult.manifestId || ""));
	}

	return (
		<div className="space-y-4">
			<p className="text-xs text-zinc-500">
				Search by character name (uses local cache) or paste a Sui address
				(queries chain).
			</p>

			<div className="flex gap-2">
				<input
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSearch()}
					placeholder={
						isAddress
							? "0x... Sui address"
							: "Character name..."
					}
					className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
				<button
					type="button"
					onClick={handleSearch}
					disabled={loading || query.trim().length < 2}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{loading ? (
						<Loader2 size={14} className="animate-spin" />
					) : (
						<Search size={14} />
					)}
					{isAddress ? "Lookup" : "Search"}
				</button>
			</div>

			{isAddress && (
				<p className="text-[10px] text-zinc-600">
					Detected Sui address — will query the blockchain directly
				</p>
			)}

			{error && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3 text-sm text-zinc-400">
					{error}
				</div>
			)}

			{/* Address lookup result */}
			{addressResult && (
				<CharacterResult
					char={addressResult}
					onAdd={handleAddAddress}
					added={addedIds.has(addressResult.manifestId || "")}
					onDone={onClose}
				/>
			)}

			{/* Name search results */}
			{results.length > 0 && (
				<div className="max-h-64 space-y-1 overflow-y-auto">
					{results.map((m) => {
						// biome-ignore lint/suspicious/noExplicitAny: extended with _alreadyAdded
						const wasAdded = addedIds.has(m.id) || (m as any)._alreadyAdded;
						return (
							<div
								key={m.id}
								className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/30 px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm text-zinc-200">
										{m.name || "(unnamed)"}
									</p>
									<p className="truncate text-xs text-zinc-600">
										{m.suiAddress.slice(0, 10)}...
										{m.tribeId ? ` · Tribe #${m.tribeId}` : ""}
									</p>
								</div>
								{wasAdded ? (
									<span className="flex items-center gap-1 text-xs text-green-500">
										<Check size={12} /> Added
									</span>
								) : (
									<button
										type="button"
										onClick={() => handleAddManifest(m)}
										className="flex items-center gap-1 rounded bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-cyan-500"
									>
										<Plus size={12} /> Add
									</button>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

// ── Manual Method ────────────────────────────────────────────────────────────

function ManualMethod({ onClose, tenant }: { onClose: () => void; tenant: TenantId }) {
	const setActiveCharacterId = useAppStore((s) => s.setActiveCharacterId);
	const [name, setName] = useState("");
	const [address, setAddress] = useState("");
	const [added, setAdded] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim()) return;

		const id = await addCharacter({
			characterName: name.trim(),
			suiAddress: address.trim() || undefined,
			source: "manual",
		}, tenant);
		setActiveCharacterId(id);
		setAdded(true);
	}

	if (added) {
		return (
			<div className="space-y-3 text-center">
				<Check size={32} className="mx-auto text-green-500" />
				<p className="text-sm text-zinc-300">Character added!</p>
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
				>
					Done
				</button>
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div>
				<label className="mb-1 block text-xs text-zinc-500">
					Character Name
				</label>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Enter character name"
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>
			<div>
				<label className="mb-1 block text-xs text-zinc-500">
					Sui Address (optional)
				</label>
				<input
					type="text"
					value={address}
					onChange={(e) => setAddress(e.target.value)}
					placeholder="0x..."
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>
			<button
				type="submit"
				disabled={!name.trim()}
				className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
			>
				Add Character
			</button>
		</form>
	);
}

// ── Shared Result Card ───────────────────────────────────────────────────────

function CharacterResult({
	char,
	onAdd,
	added,
	onDone,
}: {
	char: DiscoveredChar;
	onAdd: () => void;
	added: boolean;
	onDone: () => void;
}) {
	return (
		<div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-800/30 p-4">
			<div className="flex items-center gap-3">
				<User size={20} className="shrink-0 text-cyan-500" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-zinc-100">
						{char.characterName}
					</p>
					<p className="truncate text-xs text-zinc-500">
						{char.characterId && `ID: ${char.characterId}`}
						{char.tribe && ` · ${char.tribe}`}
						{char.tribeId && !char.tribe && ` · Tribe #${char.tribeId}`}
					</p>
					{char.suiAddress && (
						<p className="truncate font-mono text-xs text-zinc-600">
							{char.suiAddress}
						</p>
					)}
				</div>
			</div>

			{added || char.alreadyAdded ? (
				<div className="flex items-center justify-between">
					<span className="flex items-center gap-1 text-sm text-green-500">
						<Check size={14} />{" "}
						{char.alreadyAdded ? "Already registered" : "Added!"}
					</span>
					<button
						type="button"
						onClick={onDone}
						className="rounded-lg bg-zinc-800 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
					>
						Done
					</button>
				</div>
			) : (
				<button
					type="button"
					onClick={onAdd}
					className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
				>
					<Plus size={14} /> Add Character
				</button>
			)}
		</div>
	);
}

// ── Main Dialog ──────────────────────────────────────────────────────────────

const TENANT_COLORS: Record<TenantId, string> = {
	stillness: "bg-green-500",
	utopia: "bg-amber-500",
};

export function AddCharacterDialog({ open, onClose }: Props) {
	const tenant = useActiveTenant();
	const [method, setMethod] = useState<Method>("wallet");

	// Reset on open
	useEffect(() => {
		if (open) {
			setMethod("wallet");
		}
	}, [open]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
			<div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
					<div className="flex items-center gap-3">
						<h2 className="text-lg font-semibold text-zinc-100">
							Add Character
						</h2>
						<span className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
							<span className={`h-1.5 w-1.5 rounded-full ${TENANT_COLORS[tenant]}`} />
							{TENANTS[tenant].name}
						</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-zinc-500 transition-colors hover:text-zinc-300"
					>
						<X size={18} />
					</button>
				</div>

				<div className="flex border-b border-zinc-800">
					{methods.map((m) => (
						<button
							key={m.id}
							type="button"
							onClick={() => setMethod(m.id)}
							className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-3 text-xs font-medium transition-colors ${
								method === m.id
									? "border-b-2 border-cyan-500 text-cyan-400"
									: "text-zinc-500 hover:text-zinc-300"
							}`}
						>
							<m.icon size={14} />
							{m.label}
						</button>
					))}
				</div>

				{/* Content */}
				<div className="p-5">
					{method === "wallet" && <WalletMethod onClose={onClose} tenant={tenant} />}
					{method === "logs" && <LogsMethod onClose={onClose} tenant={tenant} />}
					{method === "search" && <SearchMethod onClose={onClose} tenant={tenant} />}
					{method === "manual" && <ManualMethod onClose={onClose} tenant={tenant} />}
				</div>
			</div>
		</div>
	);
}
