import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	BookUser,
	ChevronDown,
	Filter,
	Loader2,
	Plus,
	RefreshCw,
	Shield,
	Trash2,
	UserMinus,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	decryptStandingsKeys,
	syncStandingEntries,
	syncStandingsListsForUser,
} from "@/chain/manifest";
import { ContactPicker } from "@/components/ContactPicker";
import { CopyAddress } from "@/components/CopyAddress";
import { db } from "@/db";
import type { ManifestStandingEntry, ManifestStandingsList } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useStoredEncryptionKey } from "@/hooks/useStoredEncryptionKey";
import { useSuiClient } from "@/hooks/useSuiClient";
import {
	STANDING_LABELS,
	type TenantId,
	buildAddEditor,
	buildCreateStandingsList,
	buildInviteStandingsMember,
	buildRemoveEditor,
	buildRemoveStanding,
	buildSetStanding,
	bytesToHex,
	encodeStandingData,
	generateEphemeralX25519Keypair,
	getContractAddresses,
	getPublicKeyForAddress,
	hexToBytes,
	sealForRecipient,
} from "@tehfrontier/chain-shared";

// ── Standing Badge ──────────────────────────────────────────────────────────

const STANDING_STYLES: Record<number, { text: string; bg: string }> = {
	3: { text: "text-blue-400", bg: "bg-blue-400/20" },
	2: { text: "text-blue-300", bg: "bg-blue-300/20" },
	1: { text: "text-blue-200", bg: "bg-blue-200/20" },
	0: { text: "text-zinc-100", bg: "bg-zinc-100/20" },
	"-1": { text: "text-red-200", bg: "bg-red-200/20" },
	"-2": { text: "text-red-300", bg: "bg-red-300/20" },
	"-3": { text: "text-red-400", bg: "bg-red-400/20" },
};

function StandingBadge({ standing }: { standing: number }) {
	const style = STANDING_STYLES[standing] ?? STANDING_STYLES[0];
	const label = STANDING_LABELS.get(standing) ?? "Unknown";
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.text} ${style.bg}`}
		>
			{standing > 0 ? `+${standing}` : standing} {label}
		</span>
	);
}

// ── Main Component ──────────────────────────────────────────────────────────

export function Standings() {
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const tenant = useActiveTenant();
	const client = useSuiClient();
	const dAppKit = useDAppKit();
	const { keyPair, isLoading: isLoadingKey } = useStoredEncryptionKey();

	const suiAddress = activeCharacter?.suiAddress;
	const walletAddress = account?.address;

	const [isSyncing, setIsSyncing] = useState(false);
	const [selectedListId, setSelectedListId] = useState<string | null>(null);
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [showInviteDialog, setShowInviteDialog] = useState(false);
	const [showSetStandingDialog, setShowSetStandingDialog] = useState(false);
	const [showAddEditorDialog, setShowAddEditorDialog] = useState(false);
	const [filterKind, setFilterKind] = useState<"all" | "character" | "tribe">("all");
	const [filterStanding, setFilterStanding] = useState<number | null>(null);

	// Read cached lists from IndexedDB
	const lists =
		useLiveQuery(
			() => db.manifestStandingsLists.where("tenant").equals(tenant).toArray(),
			[tenant],
		) ?? [];

	// Read cached entries for selected list
	const allEntries =
		useLiveQuery(
			() =>
				selectedListId
					? db.manifestStandingEntries.where("listId").equals(selectedListId).toArray()
					: ([] as ManifestStandingEntry[]),
			[selectedListId],
		) ?? [];

	// Apply filters
	const entries = useMemo(() => {
		let filtered = allEntries;
		if (filterKind !== "all") {
			filtered = filtered.filter((e) => e.kind === filterKind);
		}
		if (filterStanding !== null) {
			filtered = filtered.filter((e) => e.standing === filterStanding);
		}
		return filtered.sort((a, b) => b.standing - a.standing || a.label.localeCompare(b.label));
	}, [allEntries, filterKind, filterStanding]);

	const selectedList = lists.find((l) => l.id === selectedListId) ?? null;

	const addresses = getContractAddresses(tenant as TenantId);
	const packageId = addresses.standings?.packageId;

	// Discover lists from chain
	const handleSync = useCallback(async () => {
		if (!suiAddress) return;
		console.log(
			"[Standings] handleSync triggered, suiAddress:",
			suiAddress,
			"tenant:",
			tenant,
		);
		setIsSyncing(true);
		try {
			await syncStandingsListsForUser(client, tenant as TenantId, suiAddress);

			// Decrypt any pending list keys (needs wallet keypair)
			if (keyPair) {
				await decryptStandingsKeys(keyPair, tenant as TenantId);
			}

			// Sync entries for all lists that have a decryptedListKey
			const cachedLists = await db.manifestStandingsLists
				.where("tenant")
				.equals(tenant)
				.toArray();
			for (const l of cachedLists) {
				if (l.decryptedListKey) {
					await syncStandingEntries(
						client,
						l.id,
						l.decryptedListKey,
						tenant as TenantId,
					);
				}
			}
		} catch {
			// Sync error -- silently continue
		} finally {
			setIsSyncing(false);
		}
	}, [suiAddress, keyPair, client, tenant]);

	// Auto-sync when suiAddress is available
	const syncedRef = useRef<string | null>(null);
	useEffect(() => {
		if (suiAddress && syncedRef.current !== suiAddress) {
			syncedRef.current = suiAddress;
			handleSync();
		}
	}, [suiAddress, handleSync]);

	// When key becomes available, decrypt pending list keys + sync entries
	useEffect(() => {
		const pending = lists.filter((l) => !l.decryptedListKey && l.encryptedListKey);
		if (keyPair && pending.length > 0) {
			decryptStandingsKeys(keyPair, tenant as TenantId).then(() => {
				db.manifestStandingsLists
					.where("tenant")
					.equals(tenant)
					.toArray()
					.then((cachedLists) => {
						for (const l of cachedLists) {
							if (l.decryptedListKey) {
								syncStandingEntries(
									client,
									l.id,
									l.decryptedListKey,
									tenant as TenantId,
								);
							}
						}
					});
			});
		}
	}, [keyPair, lists, client, tenant]);

	// Sync entries when a list is selected
	useEffect(() => {
		if (!selectedList?.decryptedListKey) return;
		syncStandingEntries(
			client,
			selectedList.id,
			selectedList.decryptedListKey,
			tenant as TenantId,
		);
	}, [selectedList?.id, selectedList?.decryptedListKey, client, tenant]);

	// Resolve character/tribe names for entries
	const characterIds = useMemo(
		() =>
			entries
				.filter((e) => e.kind === "character" && e.characterId != null)
				.map((e) => e.characterId as number),
		[entries],
	);
	const tribeIds = useMemo(
		() =>
			entries
				.filter((e) => e.kind === "tribe" && e.tribeId != null)
				.map((e) => e.tribeId as number),
		[entries],
	);

	const manifestChars = useLiveQuery(
		() =>
			characterIds.length > 0
				? db.manifestCharacters
						.filter((c) => characterIds.includes(Number(c.characterItemId)))
						.toArray()
				: [],
		[characterIds.join(",")],
	);
	const charNameMap = useMemo(() => {
		const map = new Map<number, string>();
		for (const c of manifestChars ?? []) {
			if (c.name && c.characterItemId) {
				map.set(Number(c.characterItemId), c.name);
			}
		}
		return map;
	}, [manifestChars]);

	const manifestTribes = useLiveQuery(
		() =>
			tribeIds.length > 0 ? db.manifestTribes.where("id").anyOf(tribeIds).toArray() : [],
		[tribeIds.join(",")],
	);
	const tribeNameMap = useMemo(() => {
		const map = new Map<number, string>();
		for (const t of manifestTribes ?? []) {
			map.set(t.id, t.name);
		}
		return map;
	}, [manifestTribes]);

	// Entry count per list
	const entryCountMap = useLiveQuery(async () => {
		const map = new Map<string, number>();
		for (const l of lists) {
			const count = await db.manifestStandingEntries
				.where("listId")
				.equals(l.id)
				.count();
			map.set(l.id, count);
		}
		return map;
	}, [lists.map((l) => l.id).join(",")]);

	const isCreator = !!(walletAddress && selectedList && selectedList.creator === walletAddress);
	const isEditor = !!(selectedList?.isEditor);

	return (
		<div className="flex h-full gap-6 p-6">
			{/* Left: List Panel */}
			<div className="w-72 shrink-0 space-y-3">
				<div className="flex items-center justify-between">
					<h1 className="flex items-center gap-2 text-lg font-bold text-zinc-100">
						<BookUser size={20} />
						Standings
					</h1>
					<div className="flex items-center gap-1.5">
						{suiAddress && (
							<button
								type="button"
								onClick={handleSync}
								disabled={isSyncing}
								className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
								title="Sync from chain"
							>
								<RefreshCw
									size={14}
									className={isSyncing ? "animate-spin" : ""}
								/>
							</button>
						)}
						{walletAddress && keyPair && packageId && (
							<button
								type="button"
								onClick={() => setShowCreateDialog(true)}
								className="flex items-center gap-1 rounded-lg bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
							>
								<Plus size={12} />
								Create
							</button>
						)}
					</div>
				</div>
				<p className="text-xs text-zinc-600">
					Encrypted contact standings shared with trusted players
				</p>

				{lists.length === 0 ? (
					<div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 py-12">
						<Shield size={36} className="text-zinc-700" />
						<p className="text-xs text-zinc-500">
							{isSyncing || isLoadingKey
								? "Syncing..."
								: !suiAddress
									? "Select a character to discover your standings."
									: "No standings lists found."}
						</p>
					</div>
				) : (
					<div className="space-y-1.5">
						{lists.map((l) => (
							<button
								key={l.id}
								type="button"
								onClick={() =>
									setSelectedListId(l.id === selectedListId ? null : l.id)
								}
								className={`w-full rounded-lg border p-3 text-left transition-colors ${
									l.id === selectedListId
										? "border-cyan-500/50 bg-cyan-500/5"
										: "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
								}`}
							>
								<div className="flex items-center justify-between">
									<p className="truncate text-sm font-medium text-zinc-200">
										{l.name}
									</p>
									<span className="shrink-0 text-xs text-zinc-600">
										{entryCountMap?.get(l.id) ?? 0}
									</span>
								</div>
								{l.description && (
									<p className="mt-0.5 truncate text-xs text-zinc-500">
										{l.description}
									</p>
								)}
							</button>
						))}
					</div>
				)}
			</div>

			{/* Right: Detail Panel */}
			<div className="min-w-0 flex-1">
				{selectedList ? (
					<div className="space-y-4">
						{/* List Header */}
						<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
							<div className="flex items-start justify-between">
								<div>
									<h2 className="text-lg font-semibold text-zinc-100">
										{selectedList.name}
									</h2>
									{selectedList.description && (
										<p className="mt-0.5 text-sm text-zinc-500">
											{selectedList.description}
										</p>
									)}
									<div className="mt-2 flex items-center gap-3 text-xs text-zinc-600">
										<span>
											Creator:{" "}
											<CopyAddress
												address={selectedList.creator}
												sliceStart={8}
												sliceEnd={4}
												className="text-zinc-500"
											/>
										</span>
										<span>
											{selectedList.editors.length} editor
											{selectedList.editors.length !== 1 ? "s" : ""}
										</span>
									</div>

									{/* Editor list (visible to all) */}
									{selectedList.editors.length > 0 && (
										<div className="mt-2">
											<p className="text-xs text-zinc-600">Editors:</p>
											<div className="mt-1 flex flex-wrap gap-1.5">
												{selectedList.editors.map((addr) => (
													<span
														key={addr}
														className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400"
													>
														<CopyAddress
															address={addr}
															sliceStart={6}
															sliceEnd={4}
															className="text-zinc-500"
														/>
														{isCreator && addr !== walletAddress && (
															<button
																type="button"
																onClick={async () => {
																	if (!packageId || !walletAddress)
																		return;
																	try {
																		const tx = buildRemoveEditor({
																			packageId,
																			listId: selectedList.id,
																			editorAddress: addr,
																			senderAddress:
																				walletAddress,
																		});
																		await dAppKit.signAndExecuteTransaction(
																			{ transaction: tx },
																		);
																		await new Promise((r) =>
																			setTimeout(r, 2000),
																		);
																		handleSync();
																	} catch {
																		// TX failed
																	}
																}}
																title="Remove editor"
																className="text-zinc-600 hover:text-red-400"
															>
																<UserMinus size={10} />
															</button>
														)}
													</span>
												))}
											</div>
										</div>
									)}
								</div>

								{/* Actions */}
								<div className="flex items-center gap-1.5">
									{walletAddress && isEditor && packageId && (
										<button
											type="button"
											onClick={() => setShowSetStandingDialog(true)}
											className="flex items-center gap-1 rounded-lg bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
										>
											<Plus size={12} />
											Set Standing
										</button>
									)}
									{isCreator && packageId && (
										<>
											<button
												type="button"
												onClick={() => setShowInviteDialog(true)}
												className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
											>
												<UserPlus size={12} />
												Invite
											</button>
											<button
												type="button"
												onClick={() => setShowAddEditorDialog(true)}
												className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
											>
												<UserPlus size={12} />
												Add Editor
											</button>
										</>
									)}
								</div>
							</div>
						</div>

						{/* Filters */}
						<div className="flex items-center gap-3">
							<div className="flex items-center gap-1.5">
								<Filter size={14} className="text-zinc-600" />
								<select
									value={filterKind}
									onChange={(e) =>
										setFilterKind(
											e.target.value as "all" | "character" | "tribe",
										)
									}
									className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-cyan-500 focus:outline-none"
								>
									<option value="all">All Types</option>
									<option value="character">Characters</option>
									<option value="tribe">Tribes</option>
								</select>
							</div>
							<select
								value={filterStanding ?? ""}
								onChange={(e) =>
									setFilterStanding(
										e.target.value === "" ? null : Number(e.target.value),
									)
								}
								className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-cyan-500 focus:outline-none"
							>
								<option value="">All Standings</option>
								{[3, 2, 1, 0, -1, -2, -3].map((v) => (
									<option key={v} value={v}>
										{v > 0 ? `+${v}` : v}{" "}
										{STANDING_LABELS.get(v) ?? "Unknown"}
									</option>
								))}
							</select>
							<span className="text-xs text-zinc-600">
								{entries.length} entr{entries.length !== 1 ? "ies" : "y"}
							</span>
						</div>

						{/* Entries */}
						{entries.length === 0 ? (
							<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center text-sm text-zinc-600">
								{allEntries.length === 0
									? "No standing entries yet"
									: "No entries match the current filters"}
							</div>
						) : (
							<div className="divide-y divide-zinc-800/50 rounded-lg border border-zinc-800 bg-zinc-900/50">
								{entries.map((entry) => {
									const name =
										entry.kind === "character" && entry.characterId != null
											? charNameMap.get(entry.characterId) ??
												`Character #${entry.characterId}`
											: entry.kind === "tribe" && entry.tribeId != null
												? tribeNameMap.get(entry.tribeId) ??
													`Tribe #${entry.tribeId}`
												: entry.label;
									const canRemove =
										isCreator ||
										(walletAddress && entry.addedBy === walletAddress);
									return (
										<div
											key={entry.id}
											className="flex items-center justify-between px-4 py-3"
										>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<span className="text-sm font-medium text-zinc-200">
														{name}
													</span>
													<span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
														{entry.kind}
													</span>
													<StandingBadge standing={entry.standing} />
												</div>
												{entry.description && (
													<p className="mt-0.5 text-xs text-zinc-500">
														{entry.description}
													</p>
												)}
												<p className="mt-0.5 text-[10px] text-zinc-600">
													Updated{" "}
													{new Date(
														entry.updatedAtMs,
													).toLocaleDateString()}
												</p>
											</div>
											{canRemove && packageId && walletAddress && (
												<button
													type="button"
													onClick={async () => {
														try {
															const tx = buildRemoveStanding({
																packageId,
																listId: entry.listId,
																entryId: entry.entryId,
																senderAddress: walletAddress,
															});
															await dAppKit.signAndExecuteTransaction(
																{ transaction: tx },
															);
															await db.manifestStandingEntries.delete(
																entry.id,
															);
														} catch {
															// TX failed
														}
													}}
													title="Remove standing"
													className="shrink-0 rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
												>
													<Trash2 size={14} />
												</button>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-3">
						<BookUser size={48} className="text-zinc-800" />
						<p className="text-sm text-zinc-600">
							Select a standings list to view entries
						</p>
					</div>
				)}
			</div>

			{/* Dialogs */}
			{showCreateDialog && packageId && walletAddress && keyPair && (
				<CreateListDialog
					packageId={packageId}
					walletKeyPair={keyPair}
					senderAddress={walletAddress}
					tenant={tenant}
					onClose={() => setShowCreateDialog(false)}
					onCreated={handleSync}
				/>
			)}

			{showInviteDialog && selectedList && packageId && walletAddress && (
				<InviteMemberDialog
					packageId={packageId}
					list={selectedList}
					senderAddress={walletAddress}
					onClose={() => setShowInviteDialog(false)}
					onInvited={handleSync}
				/>
			)}

			{showSetStandingDialog && selectedList && packageId && walletAddress && (
				<SetStandingDialog
					packageId={packageId}
					list={selectedList}
					senderAddress={walletAddress}
					tenant={tenant}
					onClose={() => setShowSetStandingDialog(false)}
					onAdded={() => {
						if (selectedList.decryptedListKey) {
							syncStandingEntries(
								client,
								selectedList.id,
								selectedList.decryptedListKey,
								tenant as TenantId,
							);
						}
					}}
				/>
			)}

			{showAddEditorDialog && selectedList && packageId && walletAddress && (
				<AddEditorDialog
					packageId={packageId}
					listId={selectedList.id}
					senderAddress={walletAddress}
					onClose={() => setShowAddEditorDialog(false)}
					onAdded={handleSync}
				/>
			)}
		</div>
	);
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

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

function CreateListDialog({
	packageId,
	walletKeyPair,
	senderAddress,
	tenant,
	onClose,
	onCreated,
}: {
	packageId: string;
	walletKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
	senderAddress: string;
	tenant: string;
	onClose: () => void;
	onCreated: () => void;
}) {
	const dAppKit = useDAppKit();
	const client = useSuiClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleCreate = async () => {
		if (!name.trim()) return;
		setIsPending(true);
		setError(null);

		try {
			// Generate ephemeral list keypair
			const listKeyPair = generateEphemeralX25519Keypair();

			// Self-invite: encrypt list secret key with own wallet-derived X25519 key
			const selfInviteEncrypted = sealForRecipient(
				listKeyPair.secretKey,
				walletKeyPair.publicKey,
			);

			const tx = buildCreateStandingsList({
				packageId,
				name: name.trim(),
				description: description.trim(),
				publicKey: bytesToHex(listKeyPair.publicKey),
				selfInviteEncryptedKey: bytesToHex(selfInviteEncrypted),
				senderAddress,
			});

			const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
			const digest =
				result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";

			// Try to read created object IDs for instant cache
			let listObjectId: string | undefined;
			let inviteObjectId: string | undefined;
			try {
				const fullResult = await client.waitForTransaction({
					digest,
					include: { effects: true, objectTypes: true },
				});
				const fullTx = fullResult.Transaction ?? fullResult.FailedTransaction;
				const changedObjects = fullTx?.effects?.changedObjects ?? [];
				const objectTypesMap = fullTx?.objectTypes ?? {};

				for (const change of changedObjects) {
					const objType = objectTypesMap[change.objectId] ?? "";
					if (objType.includes("::standings::StandingsList")) {
						listObjectId = change.objectId;
					} else if (objType.includes("::standings::StandingsInvite")) {
						inviteObjectId = change.objectId;
					}
				}
			} catch {
				// If we can't read the TX result, fall back to indexer sync
			}

			// Cache directly if possible
			if (listObjectId) {
				const entry: ManifestStandingsList = {
					id: listObjectId,
					name: name.trim(),
					description: description.trim(),
					creator: senderAddress,
					publicKey: bytesToHex(listKeyPair.publicKey),
					decryptedListKey: bytesToHex(listKeyPair.secretKey),
					inviteId: inviteObjectId ?? "",
					editors: [],
					isEditor: true,
					tenant,
					cachedAt: new Date().toISOString(),
				};
				await db.manifestStandingsLists.put(entry);
			} else {
				await new Promise((r) => setTimeout(r, 3000));
				onCreated();
			}

			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	};

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Create Standings List</h2>

			<label className="mb-3 block">
				<span className="mb-1 block text-xs text-zinc-400">List Name</span>
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g., Alliance Contacts"
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			<label className="mb-4 block">
				<span className="mb-1 block text-xs text-zinc-400">Description (optional)</span>
				<textarea
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="e.g., Shared contact standings for our alliance"
					rows={2}
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleCreate}
					disabled={!name.trim() || isPending}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					Create
				</button>
			</div>
		</DialogOverlay>
	);
}

function InviteMemberDialog({
	packageId,
	list,
	senderAddress,
	onClose,
	onInvited,
}: {
	packageId: string;
	list: ManifestStandingsList;
	senderAddress: string;
	onClose: () => void;
	onInvited: () => void;
}) {
	const dAppKit = useDAppKit();
	const client = useSuiClient();
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleInvite = useCallback(
		async (character: { suiAddress: string; name: string }) => {
			setIsPending(true);
			setError(null);

			try {
				// Get recipient's X25519 public key from their on-chain transactions
				const recipientX25519PubKey = await getPublicKeyForAddress(
					client,
					character.suiAddress,
				);

				// Decrypt our own list key, then re-encrypt for the recipient
				if (!list.decryptedListKey)
					throw new Error("List key not yet decrypted. Connect wallet first.");
				const listSecretKey = hexToBytes(list.decryptedListKey);
				const encryptedForRecipient = sealForRecipient(
					listSecretKey,
					recipientX25519PubKey,
				);

				const tx = buildInviteStandingsMember({
					packageId,
					listId: list.id,
					recipient: character.suiAddress,
					encryptedListKey: bytesToHex(encryptedForRecipient),
					senderAddress,
				});

				await dAppKit.signAndExecuteTransaction({ transaction: tx });
				onInvited();
				onClose();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setIsPending(false);
			}
		},
		[client, dAppKit, list, packageId, senderAddress, onClose, onInvited],
	);

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Invite Member</h2>
			<p className="mb-3 text-xs text-zinc-500">
				List: <span className="text-zinc-300">{list.name}</span>
			</p>

			<div className="mb-4">
				<span className="mb-1 block text-xs text-zinc-400">Search Character</span>
				<ContactPicker
					onSelect={(char) => handleInvite(char)}
					placeholder="Search by name or address..."
				/>
			</div>

			<p className="mb-4 text-xs text-zinc-600">
				The recipient's Ed25519 public key will be extracted from their on-chain
				transactions. Only Ed25519 wallets are supported.
			</p>

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			{isPending && (
				<div className="mb-4 flex items-center justify-center gap-2 text-sm text-zinc-400">
					<Loader2 size={14} className="animate-spin" />
					Inviting...
				</div>
			)}

			<div className="flex justify-end">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
			</div>
		</DialogOverlay>
	);
}

function SetStandingDialog({
	packageId,
	list,
	senderAddress,
	tenant,
	onClose,
	onAdded,
}: {
	packageId: string;
	list: ManifestStandingsList;
	senderAddress: string;
	tenant: string;
	onClose: () => void;
	onAdded: () => void;
}) {
	const dAppKit = useDAppKit();
	const [kind, setKind] = useState<"character" | "tribe">("character");
	const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
	const [selectedCharacterName, setSelectedCharacterName] = useState("");
	const [tribeSearch, setTribeSearch] = useState("");
	const [selectedTribeId, setSelectedTribeId] = useState<number | null>(null);
	const [standing, setStanding] = useState(0);
	const [description, setDescription] = useState("");
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Tribe search from local DB
	const tribeResults = useLiveQuery(() => {
		if (kind !== "tribe" || tribeSearch.length < 2) return [];
		const q = tribeSearch.toLowerCase();
		return db.manifestTribes
			.filter(
				(t) =>
					t.name.toLowerCase().includes(q) ||
					t.nameShort.toLowerCase().includes(q) ||
					String(t.id).includes(q),
			)
			.limit(10)
			.toArray();
	}, [kind, tribeSearch]);

	const handleSubmit = async () => {
		if (kind === "character" && selectedCharacterId == null) return;
		if (kind === "tribe" && selectedTribeId == null) return;

		setIsPending(true);
		setError(null);

		try {
			if (!list.decryptedListKey)
				throw new Error("List key not yet decrypted. Connect wallet first.");

			const label = STANDING_LABELS.get(standing) ?? "Neutral";
			const standingData = {
				kind,
				...(kind === "character" ? { characterId: selectedCharacterId! } : {}),
				...(kind === "tribe" ? { tribeId: selectedTribeId! } : {}),
				standing,
				label,
				description: description.trim(),
			};

			// Encode and encrypt
			const plaintext = encodeStandingData(standingData);
			const listPublicKey = hexToBytes(list.publicKey);
			const encryptedData = sealForRecipient(plaintext, listPublicKey);

			const tx = buildSetStanding({
				packageId,
				listId: list.id,
				inviteId: list.inviteId,
				entryId: null, // new entry
				encryptedData: bytesToHex(encryptedData),
				senderAddress,
			});

			await dAppKit.signAndExecuteTransaction({ transaction: tx });
			await new Promise((r) => setTimeout(r, 2000));
			onAdded();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsPending(false);
		}
	};

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Set Standing</h2>
			<p className="mb-3 text-xs text-zinc-500">
				List: <span className="text-zinc-300">{list.name}</span>
			</p>

			{/* Kind selector */}
			<div className="mb-3 flex gap-2">
				<button
					type="button"
					onClick={() => setKind("character")}
					className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
						kind === "character"
							? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
							: "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
					}`}
				>
					Character
				</button>
				<button
					type="button"
					onClick={() => setKind("tribe")}
					className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
						kind === "tribe"
							? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
							: "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
					}`}
				>
					Tribe
				</button>
			</div>

			{/* Target selection */}
			{kind === "character" ? (
				<div className="mb-3">
					<span className="mb-1 block text-xs text-zinc-400">Character</span>
					{selectedCharacterId != null ? (
						<div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
							<span className="text-sm text-zinc-200">{selectedCharacterName}</span>
							<button
								type="button"
								onClick={() => {
									setSelectedCharacterId(null);
									setSelectedCharacterName("");
								}}
								className="text-xs text-zinc-500 hover:text-zinc-300"
							>
								Change
							</button>
						</div>
					) : (
						<ContactPicker
							onSelect={(char) => {
								setSelectedCharacterId(Number(char.characterItemId));
								setSelectedCharacterName(char.name || char.suiAddress);
							}}
							placeholder="Search characters..."
							tenant={tenant}
						/>
					)}
				</div>
			) : (
				<div className="mb-3">
					<span className="mb-1 block text-xs text-zinc-400">Tribe</span>
					{selectedTribeId != null ? (
						<div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
							<span className="text-sm text-zinc-200">
								{tribeSearch || `Tribe #${selectedTribeId}`}
							</span>
							<button
								type="button"
								onClick={() => {
									setSelectedTribeId(null);
									setTribeSearch("");
								}}
								className="text-xs text-zinc-500 hover:text-zinc-300"
							>
								Change
							</button>
						</div>
					) : (
						<div className="relative">
							<input
								type="text"
								value={tribeSearch}
								onChange={(e) => setTribeSearch(e.target.value)}
								placeholder="Search tribe name or ID..."
								className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
							{(tribeResults ?? []).length > 0 && (
								<div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
									{(tribeResults ?? []).map((tribe) => (
										<button
											key={tribe.id}
											type="button"
											onClick={() => {
												setSelectedTribeId(tribe.id);
												setTribeSearch(tribe.name);
											}}
											className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
										>
											<span>{tribe.name}</span>
											<span className="text-xs text-zinc-600">
												#{tribe.id}
											</span>
										</button>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* Standing selector */}
			<label className="mb-3 block">
				<span className="mb-1 block text-xs text-zinc-400">Standing</span>
				<select
					value={standing}
					onChange={(e) => setStanding(Number(e.target.value))}
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
				>
					{[3, 2, 1, 0, -1, -2, -3].map((v) => (
						<option key={v} value={v}>
							{v > 0 ? `+${v}` : v} {STANDING_LABELS.get(v) ?? "Unknown"}
						</option>
					))}
				</select>
				<div className="mt-1.5">
					<StandingBadge standing={standing} />
				</div>
			</label>

			{/* Description */}
			<label className="mb-4 block">
				<span className="mb-1 block text-xs text-zinc-400">Description (optional)</span>
				<textarea
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="e.g., Trusted trade partner"
					rows={2}
					className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</label>

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleSubmit}
					disabled={
						isPending ||
						(kind === "character" && selectedCharacterId == null) ||
						(kind === "tribe" && selectedTribeId == null)
					}
					className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending && <Loader2 size={14} className="animate-spin" />}
					Set Standing
				</button>
			</div>
		</DialogOverlay>
	);
}

function AddEditorDialog({
	packageId,
	listId,
	senderAddress,
	onClose,
	onAdded,
}: {
	packageId: string;
	listId: string;
	senderAddress: string;
	onClose: () => void;
	onAdded: () => void;
}) {
	const dAppKit = useDAppKit();
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleAdd = useCallback(
		async (character: { suiAddress: string }) => {
			setIsPending(true);
			setError(null);

			try {
				const tx = buildAddEditor({
					packageId,
					listId,
					editorAddress: character.suiAddress,
					senderAddress,
				});

				await dAppKit.signAndExecuteTransaction({ transaction: tx });
				onAdded();
				onClose();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setIsPending(false);
			}
		},
		[dAppKit, packageId, listId, senderAddress, onClose, onAdded],
	);

	return (
		<DialogOverlay onClose={onClose}>
			<h2 className="mb-4 text-lg font-semibold text-zinc-100">Add Editor</h2>
			<p className="mb-3 text-xs text-zinc-500">
				Editors can add and modify standing entries.
			</p>

			<div className="mb-4">
				<span className="mb-1 block text-xs text-zinc-400">Search Character</span>
				<ContactPicker
					onSelect={(char) => handleAdd(char)}
					placeholder="Search by name or address..."
				/>
			</div>

			{error && (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			{isPending && (
				<div className="mb-4 flex items-center justify-center gap-2 text-sm text-zinc-400">
					<Loader2 size={14} className="animate-spin" />
					Adding editor...
				</div>
			)}

			<div className="flex justify-end">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
				>
					Cancel
				</button>
			</div>
		</DialogOverlay>
	);
}
