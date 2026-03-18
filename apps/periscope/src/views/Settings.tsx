import { useState, useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { db, notDeleted } from "@/db";
import type { CharacterRecord, CharacterSource } from "@/db/types";
import { TENANTS, type TenantId } from "@/chain/config";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { exportData, importData } from "@/lib/dataExport";
import { fetchAndStoreGameTypes } from "@/lib/worldApi";
import { getBackupHandle, requestBackupDirectory, clearBackupHandle, writeAutoBackup } from "@/lib/autoBackup";
import { lookupCharacterByItemId } from "@/chain/client";
import { AddCharacterDialog } from "@/components/AddCharacterDialog";
import { getStoredHandle, requestDirectoryAccess } from "@/lib/logFileAccess";
import { Settings as SettingsIcon, Database, Users, User, Trash2, Download, Upload, HardDrive, FolderOpen, FolderX, RefreshCw, Link2, Unlink, Plus, Wallet, Gamepad2, PenLine, Search, Loader2, ExternalLink, FileText, Server } from "lucide-react";

export function Settings() {
	const meta = useLiveQuery(() => db.cacheMetadata.get("stellarData"));
	const typesMeta = useLiveQuery(() => db.cacheMetadata.get("gameTypes"));
	const [typesStatus, setTypesStatus] = useState<string | null>(null);
	const [fetchingTypes, setFetchingTypes] = useState(false);
	const characters = useLiveQuery(() => db.characters.filter(notDeleted).toArray()) ?? [];

	async function clearStaticData() {
		if (!confirm("Clear all star map data? It will be reloaded on next app start.")) return;
		await db.solarSystems.clear();
		await db.constellations.clear();
		await db.regions.clear();
		await db.jumps.clear();
		await db.cacheMetadata.delete("stellarData");
	}

	async function clearAllData() {
		if (!confirm("Delete ALL data including intel? This cannot be undone.")) return;
		await db.delete();
		window.location.reload();
	}

	return (
		<div className="mx-auto max-w-2xl p-6">
			<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
				<SettingsIcon size={24} />
				Settings
			</h1>

			{/* Server */}
			<ServerSection />

			{/* Characters */}
			<CharacterSection characters={characters} />

			{/* Game Logs Directory */}
			<GameLogsSection />

			{/* Static Data */}
			<section className="mt-8">
				<h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-400">
					<Database size={16} />
					Static Data
				</h2>
				<div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					{meta ? (
						<>
							<div className="grid grid-cols-2 gap-2 text-sm">
								<span className="text-zinc-500">Version</span>
								<span className="text-zinc-300">{meta.version}</span>
								<span className="text-zinc-500">Imported</span>
								<span className="text-zinc-300">{new Date(meta.importedAt).toLocaleDateString()}</span>
								{meta.counts &&
									Object.entries(meta.counts).map(([key, val]) => (
										<>
											<span key={`${key}-label`} className="text-zinc-500 capitalize">
												{key}
											</span>
											<span key={`${key}-val`} className="text-zinc-300">
												{val.toLocaleString()}
											</span>
										</>
									))}
							</div>
							<button
								type="button"
								onClick={clearStaticData}
								className="text-xs text-zinc-500 transition-colors hover:text-red-400"
							>
								Clear & reload static data
							</button>
						</>
					) : (
						<p className="text-sm text-zinc-500">No static data loaded. Restart the app to import.</p>
					)}
				</div>
			</section>

			{/* Game Types (World API) */}
			<section className="mt-8">
				<h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-400">
					<Database size={16} />
					Game Types (World API)
				</h2>
				<div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					{typesMeta ? (
						<div className="flex items-center justify-between">
							<div className="grid grid-cols-2 gap-2 text-sm">
								<span className="text-zinc-500">Types</span>
								<span className="text-zinc-300">{typesMeta.counts?.types?.toLocaleString()}</span>
								<span className="text-zinc-500">Fetched</span>
								<span className="text-zinc-300">{new Date(typesMeta.importedAt).toLocaleDateString()}</span>
							</div>
							<button
								type="button"
								disabled={fetchingTypes}
								onClick={async () => {
									setFetchingTypes(true);
									setTypesStatus("Fetching...");
									try {
										const count = await fetchAndStoreGameTypes();
										setTypesStatus(`Updated: ${count} types`);
									} catch (err) {
										setTypesStatus(`Failed: ${err}`);
									} finally {
										setFetchingTypes(false);
									}
								}}
								className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-cyan-400 disabled:opacity-50"
							>
								<RefreshCw size={12} />
								Refresh
							</button>
						</div>
					) : (
						<div className="flex items-center justify-between">
							<p className="text-sm text-zinc-500">Not yet fetched from World API.</p>
							<button
								type="button"
								disabled={fetchingTypes}
								onClick={async () => {
									setFetchingTypes(true);
									setTypesStatus("Fetching...");
									try {
										const count = await fetchAndStoreGameTypes();
										setTypesStatus(`Fetched ${count} types`);
									} catch (err) {
										setTypesStatus(`Failed: ${err}`);
									} finally {
										setFetchingTypes(false);
									}
								}}
								className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
							>
								<Download size={12} />
								{fetchingTypes ? "Fetching..." : "Fetch Types"}
							</button>
						</div>
					)}
					{typesStatus && <p className="text-xs text-zinc-400">{typesStatus}</p>}
				</div>
			</section>

			{/* Backup & Restore */}
			<BackupRestore />

			{/* Danger Zone */}
			<section className="mt-8">
				<h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-red-400">
					<Trash2 size={16} />
					Danger Zone
				</h2>
				<div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4">
					<p className="mb-3 text-sm text-zinc-400">
						Permanently delete the entire database including all intel, settings, and static data.
					</p>
					<button
						type="button"
						onClick={clearAllData}
						className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-900/50"
					>
						Delete All Data
					</button>
				</div>
			</section>
		</div>
	);
}

const SERVER_OPTIONS: { id: TenantId; label: string; description: string; color: string }[] = [
	{ id: "stillness", label: "Stillness", description: "Production", color: "bg-green-500" },
	{ id: "utopia", label: "Utopia", description: "Sandbox", color: "bg-amber-500" },
];

function ServerSection() {
	const tenant = useActiveTenant();
	const queryClient = useQueryClient();
	const { disconnectWallet } = useDAppKit();

	async function handleSelectServer(id: TenantId) {
		if (id === tenant) return;
		await db.settings.put({ key: "tenant", value: id });
		// Invalidate all React Query caches so views re-fetch with new tenant
		queryClient.invalidateQueries();
		// Silently disconnect wallet — auto-connect will reconnect with new zkLogin address
		try {
			disconnectWallet();
		} catch {
			// Ignore — wallet may not be connected
		}
	}

	return (
		<section className="mt-8">
			<h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-400">
				<Server size={16} />
				Server
			</h2>
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<p className="mb-4 text-sm text-zinc-500">
					Select which EVE Frontier server to connect to. Switching servers
					will disconnect your wallet and refresh all data.
				</p>
				<div className="flex gap-3">
					{SERVER_OPTIONS.map((opt) => (
						<button
							key={opt.id}
							type="button"
							onClick={() => handleSelectServer(opt.id)}
							className={`flex flex-1 items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
								tenant === opt.id
									? "border-cyan-500/50 bg-cyan-500/5"
									: "border-zinc-800 hover:border-zinc-700"
							}`}
						>
							<span
								className={`h-3 w-3 shrink-0 rounded-full ${opt.color}`}
							/>
							<div className="text-left">
								<p
									className={`text-sm font-medium ${
										tenant === opt.id
											? "text-cyan-400"
											: "text-zinc-300"
									}`}
								>
									{opt.label}
								</p>
								<p className="text-xs text-zinc-600">
									{opt.description}
								</p>
							</div>
						</button>
					))}
				</div>
			</div>
		</section>
	);
}

function BackupRestore() {
	const fileRef = useRef<HTMLInputElement>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [hasBackupDir, setHasBackupDir] = useState(false);

	useEffect(() => {
		getBackupHandle().then((h) => setHasBackupDir(!!h));
	}, []);

	async function handleExport() {
		try {
			setStatus("Exporting...");
			await exportData();
			setStatus("Backup downloaded.");
		} catch (err) {
			setStatus(`Export failed: ${err}`);
		}
	}

	async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		try {
			setStatus("Importing...");
			const result = await importData(file);
			setStatus(`Imported ${result.recordsImported.toLocaleString()} records across ${result.tablesImported} tables.`);
		} catch (err) {
			setStatus(`Import failed: ${err}`);
		}
		if (fileRef.current) fileRef.current.value = "";
	}

	async function handleSetBackupDir() {
		const handle = await requestBackupDirectory();
		if (handle) {
			setHasBackupDir(true);
			setStatus("Auto-backup directory set.");
		}
	}

	async function handleClearBackupDir() {
		await clearBackupHandle();
		setHasBackupDir(false);
		setStatus("Auto-backup directory removed.");
	}

	async function handleBackupNow() {
		try {
			setStatus("Writing backup...");
			const ok = await writeAutoBackup();
			setStatus(ok ? "Backup written to directory." : "No backup directory configured.");
		} catch (err) {
			setStatus(`Backup failed: ${err}`);
		}
	}

	return (
		<section className="mt-8">
			<h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-400">
				<HardDrive size={16} />
				Backup &amp; Restore
			</h2>
			<div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<p className="text-sm text-zinc-500">
					Export all intel, log data, and settings as a JSON file.
					Static star map data is excluded (reloaded automatically).
				</p>
				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={handleExport}
						className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
					>
						<Download size={14} />
						Export Backup
					</button>
					<label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100">
						<Upload size={14} />
						Import Backup
						<input
							ref={fileRef}
							type="file"
							accept=".json"
							onChange={handleImport}
							className="hidden"
						/>
					</label>
				</div>

				{/* Auto-backup directory */}
				<div className="border-t border-zinc-800 pt-4">
					<p className="mb-3 text-sm text-zinc-500">
						Auto-backup: save backups to a directory on your computer (Chromium only).
					</p>
					<div className="flex flex-wrap items-center gap-3">
						{hasBackupDir ? (
							<>
								<button
									type="button"
									onClick={handleBackupNow}
									className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
								>
									<Download size={14} />
									Backup Now
								</button>
								<button
									type="button"
									onClick={handleClearBackupDir}
									className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-red-400"
								>
									<FolderX size={14} />
									Remove directory
								</button>
							</>
						) : (
							<button
								type="button"
								onClick={handleSetBackupDir}
								className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
							>
								<FolderOpen size={14} />
								Set Backup Directory
							</button>
						)}
					</div>
				</div>

				{status && (
					<p className="text-xs text-zinc-400">{status}</p>
				)}
			</div>
		</section>
	);
}

function SourceBadge({ source }: { source?: CharacterSource }) {
	switch (source) {
		case "log":
			return (
				<span className="inline-flex items-center gap-1 rounded bg-emerald-900/30 px-1.5 py-0.5 text-[10px] text-emerald-400" title="Auto-detected from game logs">
					<Gamepad2 size={10} /> Log
				</span>
			);
		case "wallet":
			return (
				<span className="inline-flex items-center gap-1 rounded bg-violet-900/30 px-1.5 py-0.5 text-[10px] text-violet-400" title="Detected from wallet connection">
					<Wallet size={10} /> Wallet
				</span>
			);
		case "manual":
			return (
				<span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400" title="Manually entered">
					<PenLine size={10} /> Manual
				</span>
			);
		default:
			return null;
	}
}

function CharacterCard({ character }: { character: CharacterRecord }) {
	const [editing, setEditing] = useState(false);
	const [address, setAddress] = useState(character.suiAddress ?? "");
	const [resolving, setResolving] = useState(false);
	const [resolveStatus, setResolveStatus] = useState<string | null>(null);

	async function handleLink() {
		const trimmed = address.trim();
		await db.characters.update(character.id, {
			suiAddress: trimmed || undefined,
			updatedAt: new Date().toISOString(),
		});
		setEditing(false);
	}

	async function handleUnlink() {
		await db.characters.update(character.id, {
			suiAddress: undefined,
			updatedAt: new Date().toISOString(),
		});
		setAddress("");
	}

	async function handleDelete() {
		if (!confirm(`Remove character "${character.characterName}"? This won't delete associated logs.`))
			return;
		await db.characters.update(character.id, { _deleted: true, updatedAt: new Date().toISOString() });
	}

	async function handleResolveFromChain() {
		if (!character.characterId) {
			setResolveStatus("No character ID — chain lookup requires a game log detection first");
			return;
		}
		setResolving(true);
		setResolveStatus("Searching chain...");
		try {
			const result = await lookupCharacterByItemId(
				character.characterId,
				(character.tenant as TenantId) || "stillness",
			);
			if (result) {
				const updates: Record<string, unknown> = {
					suiAddress: result.suiAddress,
					tribeId: result.tribeId,
					tribe: result.tribeName,
					characterName: result.characterName || character.characterName,
					manifestId: result.characterObjectId,
					tenant: result.tenant || character.tenant,
					updatedAt: new Date().toISOString(),
				};
				await db.characters.update(character.id, updates);
				setAddress(result.suiAddress);
				setResolveStatus(
					`Resolved: ${result.characterName}${result.tribeName ? ` (${result.tribeName})` : ""}`,
				);
			} else {
				setResolveStatus("Character not found on chain");
			}
		} catch (err) {
			setResolveStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
		}
		setResolving(false);
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="flex items-start justify-between">
				<div className="flex items-center gap-2">
					<User size={16} className="text-cyan-500" />
					<div>
						<div className="flex items-center gap-2">
							<p className="text-sm font-medium text-zinc-200">{character.characterName}</p>
							<SourceBadge source={character.source} />
							{character.tenant && (
								<span
									className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] capitalize ${
										character.tenant === "stillness"
											? "bg-green-900/30 text-green-400"
											: "bg-amber-900/30 text-amber-400"
									}`}
								>
									{character.tenant}
								</span>
							)}
							{character.isActive && (
								<span className="h-1.5 w-1.5 rounded-full bg-green-500" title="Online" />
							)}
						</div>
						<p className="text-xs text-zinc-600">
							{character.characterId ? `ID: ${character.characterId}` : "No game ID"}
							{character.tribeId ? ` · Tribe #${character.tribeId}` : ""}
							{character.tribe ? ` (${character.tribe})` : ""}
						</p>
					</div>
				</div>
				<button
					type="button"
					onClick={handleDelete}
					className="text-zinc-600 transition-colors hover:text-red-400"
					title="Remove character"
				>
					<Trash2 size={14} />
				</button>
			</div>

			{/* Sui Address */}
			<div className="mt-3">
				{character.suiAddress && !editing ? (
					<div className="flex items-center gap-2">
						<Link2 size={12} className="shrink-0 text-cyan-500" />
						<span className="flex-1 truncate font-mono text-xs text-zinc-400">
							{character.suiAddress}
						</span>
						<a
							href={`https://suiscan.xyz/testnet/account/${character.suiAddress}`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-zinc-600 hover:text-cyan-400"
							title="View on Suiscan"
						>
							<ExternalLink size={11} />
						</a>
						<button
							type="button"
							onClick={() => setEditing(true)}
							className="text-xs text-zinc-500 hover:text-zinc-300"
						>
							Edit
						</button>
						<button
							type="button"
							onClick={handleUnlink}
							className="text-xs text-zinc-500 hover:text-red-400"
						>
							<Unlink size={12} />
						</button>
					</div>
				) : (
					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<input
								type="text"
								value={address}
								onChange={(e) => setAddress(e.target.value)}
								placeholder="0x... Sui address"
								className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
							<button
								type="button"
								onClick={handleLink}
								className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500"
							>
								Link
							</button>
							{editing && (
								<button
									type="button"
									onClick={() => {
										setEditing(false);
										setAddress(character.suiAddress ?? "");
									}}
									className="text-xs text-zinc-500 hover:text-zinc-300"
								>
									Cancel
								</button>
							)}
						</div>
						{!character.suiAddress && character.characterId && (
							<button
								type="button"
								onClick={handleResolveFromChain}
								disabled={resolving}
								className="flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-cyan-400 disabled:opacity-50"
							>
								{resolving ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />}
								Resolve from chain
							</button>
						)}
					</div>
				)}
			</div>

			{resolveStatus && (
				<p className="mt-2 text-xs text-zinc-500">{resolveStatus}</p>
			)}

			{character.manifestId && (
				<p className="mt-2 text-xs text-zinc-600">
					Manifest: <span className="font-mono">{character.manifestId.slice(0, 12)}...</span>
				</p>
			)}
		</div>
	);
}

function GameLogsSection() {
	const [dirName, setDirName] = useState<string | null>(null);
	const [checking, setChecking] = useState(true);

	useEffect(() => {
		getStoredHandle().then((h) => {
			setDirName(h?.name ?? null);
			setChecking(false);
		});
	}, []);

	async function handleChange() {
		const handle = await requestDirectoryAccess();
		if (handle) setDirName(handle.name);
	}

	async function handleClear() {
		await db.settings.delete("logDirectoryHandle");
		setDirName(null);
	}

	return (
		<section className="mt-8">
			<h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-400">
				<FileText size={16} />
				Game Logs Directory
			</h2>
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				{checking ? (
					<p className="text-sm text-zinc-600">Checking...</p>
				) : dirName ? (
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<FolderOpen size={14} className="text-cyan-500" />
							<span className="text-sm text-zinc-300">{dirName}</span>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={handleChange}
								className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
							>
								Change
							</button>
							<button
								type="button"
								onClick={handleClear}
								className="text-xs text-zinc-500 transition-colors hover:text-red-400"
							>
								<FolderX size={12} />
							</button>
						</div>
					</div>
				) : (
					<div className="flex items-center justify-between">
						<p className="text-sm text-zinc-500">
							No log directory set. Point to your <code className="rounded bg-zinc-800 px-1 text-zinc-400">Documents/Frontier/logs</code> folder.
						</p>
						<button
							type="button"
							onClick={handleChange}
							className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
						>
							<FolderOpen size={12} />
							Select
						</button>
					</div>
				)}
			</div>
		</section>
	);
}

function CharacterSection({ characters }: { characters: CharacterRecord[] }) {
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<>
			<section className="mt-8">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="flex items-center gap-2 text-sm font-medium text-zinc-400">
						<Users size={16} />
						Characters
					</h2>
					<button
						type="button"
						onClick={() => setDialogOpen(true)}
						className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
					>
						<Plus size={12} />
						Add Character
					</button>
				</div>
				<div className="space-y-3">
					{characters.map((char) => (
						<CharacterCard key={char.id} character={char} />
					))}
					{characters.length === 0 && (
						<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-500">
							No characters yet. Click "Add Character" to get started.
						</div>
					)}
				</div>
			</section>

			<AddCharacterDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
		</>
	);
}
