import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import {
	type SharedAclInfo,
	buildConfigureAcl,
	buildRemoveSharedAclConfig,
	buildSetSharedAclConfig,
	queryAclConfig,
	queryAclDetails,
	queryAllSharedAcls,
} from "@tehfrontier/chain-shared";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	AlertCircle,
	CheckCircle2,
	ExternalLink,
	Link2,
	Loader2,
	Plus,
	Search,
	Shield,
	Unlink,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSuiClient } from "@/hooks/useSuiClient";
import type { TenantId } from "@/chain/config";

interface AclEditorProps {
	assemblyId: string;
	packageId: string;
	configObjectId: string;
	aclRegistryPackageId?: string;
	tenant: TenantId;
}

type SyncStatus = "idle" | "loading" | "saving" | "signing" | "done" | "error";
type AclMode = "inline" | "shared";

interface SharedAclBinding {
	sharedAclId: string;
	permitDurationMs: number;
}

export function AclEditor({
	assemblyId,
	packageId,
	configObjectId,
	aclRegistryPackageId,
	tenant,
}: AclEditorProps) {
	const account = useCurrentAccount();
	const client = useSuiClient();
	const dAppKit = useDAppKit();

	// Inline ACL state
	const [isAllowlist, setIsAllowlist] = useState(true);
	const [tribeIds, setTribeIds] = useState<number[]>([]);
	const [characterIds, setCharacterIds] = useState<number[]>([]);
	const [permitDurationMin, setPermitDurationMin] = useState(10);
	const [newTribeId, setNewTribeId] = useState("");
	const [newCharId, setNewCharId] = useState("");

	// Mode toggle
	const [aclMode, setAclMode] = useState<AclMode>("inline");

	// Shared ACL state
	const [sharedAclBinding, setSharedAclBinding] = useState<SharedAclBinding | null>(null);
	const [selectedSharedAclId, setSelectedSharedAclId] = useState("");
	const [sharedPermitDurationMin, setSharedPermitDurationMin] = useState(10);
	const [availableAcls, setAvailableAcls] = useState<SharedAclInfo[]>([]);
	const [selectedAclDetails, setSelectedAclDetails] = useState<SharedAclInfo | null>(null);
	const [aclSearchQuery, setAclSearchQuery] = useState("");
	const [loadingAcls, setLoadingAcls] = useState(false);

	// General status
	const [status, setStatus] = useState<SyncStatus>("idle");
	const [error, setError] = useState<string>();
	const [txDigest, setTxDigest] = useState<string>();

	// Load current config from chain (both inline and shared)
	useEffect(() => {
		async function load() {
			setStatus("loading");
			try {
				// Load inline config
				const config = await queryAclConfig(client, configObjectId, assemblyId);
				if (config) {
					setIsAllowlist(config.isAllowlist);
					setTribeIds(config.tribeIds);
					setCharacterIds(config.characterIds);
					setPermitDurationMin(Math.round(config.permitDurationMs / 60_000));
				}

				// Check for shared ACL binding
				const binding = await detectSharedAclBinding(
					client,
					configObjectId,
					assemblyId,
					packageId,
				);
				if (binding) {
					setSharedAclBinding(binding);
					setSelectedSharedAclId(binding.sharedAclId);
					setSharedPermitDurationMin(
						Math.round(binding.permitDurationMs / 60_000),
					);
					setAclMode("shared");

					const details = await queryAclDetails(client, binding.sharedAclId);
					if (details) {
						setSelectedAclDetails(details);
					}
				}

				setStatus("idle");
			} catch (err) {
				setStatus("error");
				setError(err instanceof Error ? err.message : "Failed to load config");
			}
		}
		load();
	}, [client, configObjectId, assemblyId, packageId]);

	// Load available shared ACLs when switching to shared mode
	const loadAvailableAcls = useCallback(async () => {
		if (!aclRegistryPackageId) return;
		setLoadingAcls(true);
		try {
			const acls = await queryAllSharedAcls(client, aclRegistryPackageId);
			setAvailableAcls(acls);
		} catch {
			// Silently fail -- user can still enter an ID manually
		}
		setLoadingAcls(false);
	}, [client, aclRegistryPackageId]);

	useEffect(() => {
		if (aclMode === "shared" && aclRegistryPackageId) {
			loadAvailableAcls();
		}
	}, [aclMode, aclRegistryPackageId, loadAvailableAcls]);

	// Load details when a shared ACL is selected
	useEffect(() => {
		async function loadDetails() {
			if (!selectedSharedAclId || selectedSharedAclId.length < 10) {
				setSelectedAclDetails(null);
				return;
			}
			try {
				const details = await queryAclDetails(client, selectedSharedAclId);
				setSelectedAclDetails(details);
			} catch {
				setSelectedAclDetails(null);
			}
		}
		loadDetails();
	}, [client, selectedSharedAclId]);

	// -- Inline ACL handlers --

	async function handleSync() {
		if (!account) return;
		setStatus("saving");
		setError(undefined);
		setTxDigest(undefined);

		try {
			const tx = buildConfigureAcl({
				tenant,
				packageId,
				configObjectId,
				gateId: assemblyId,
				isAllowlist,
				tribeIds,
				characterIds,
				permitDurationMs: permitDurationMin * 60_000,
				senderAddress: account.address,
			});

			setStatus("signing");
			const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
			const digest =
				result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";
			setTxDigest(digest);
			setStatus("done");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	}

	// -- Shared ACL handlers --

	async function handleBindSharedAcl() {
		if (!account || !selectedSharedAclId) return;
		setStatus("saving");
		setError(undefined);
		setTxDigest(undefined);

		try {
			const tx = buildSetSharedAclConfig({
				packageId,
				configObjectId,
				gateId: assemblyId,
				sharedAclId: selectedSharedAclId,
				permitDurationMs: sharedPermitDurationMin * 60_000,
				senderAddress: account.address,
			});

			setStatus("signing");
			const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
			const digest =
				result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";
			setTxDigest(digest);
			setSharedAclBinding({
				sharedAclId: selectedSharedAclId,
				permitDurationMs: sharedPermitDurationMin * 60_000,
			});
			setStatus("done");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	}

	async function handleRemoveSharedAcl() {
		if (!account) return;
		setStatus("saving");
		setError(undefined);
		setTxDigest(undefined);

		try {
			const tx = buildRemoveSharedAclConfig({
				packageId,
				configObjectId,
				gateId: assemblyId,
				senderAddress: account.address,
			});

			setStatus("signing");
			const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
			const digest =
				result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";
			setTxDigest(digest);
			setSharedAclBinding(null);
			setSelectedSharedAclId("");
			setSelectedAclDetails(null);
			setAclMode("inline");
			setStatus("done");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	}

	// -- List helpers --

	function addTribe() {
		const id = Number(newTribeId);
		if (id > 0 && !tribeIds.includes(id)) {
			setTribeIds([...tribeIds, id]);
			setNewTribeId("");
		}
	}

	function addCharacter() {
		const id = Number(newCharId);
		if (id > 0 && !characterIds.includes(id)) {
			setCharacterIds([...characterIds, id]);
			setNewCharId("");
		}
	}

	const filteredAcls = aclSearchQuery
		? availableAcls.filter(
				(acl) =>
					acl.name.toLowerCase().includes(aclSearchQuery.toLowerCase()) ||
					acl.objectId.includes(aclSearchQuery),
			)
		: availableAcls;

	const isLoading = status === "loading";
	const isSaving = status === "saving" || status === "signing";

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<h2 className="mb-4 text-sm font-medium text-zinc-400">ACL Configuration</h2>

			{isLoading && (
				<div className="flex items-center gap-2 text-sm text-cyan-400">
					<Loader2 size={16} className="animate-spin" />
					Loading on-chain config...
				</div>
			)}

			{!isLoading && (
				<div className="space-y-4">
					{/* ACL Mode toggle */}
					<div>
						<label className="mb-1 block text-xs text-zinc-500">ACL Source</label>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setAclMode("inline")}
								className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${
									aclMode === "inline"
										? "bg-cyan-500/20 text-cyan-400"
										: "bg-zinc-800 text-zinc-500"
								}`}
							>
								<Shield size={12} />
								Inline ACL
							</button>
							<button
								type="button"
								onClick={() => setAclMode("shared")}
								className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${
									aclMode === "shared"
										? "bg-cyan-500/20 text-cyan-400"
										: "bg-zinc-800 text-zinc-500"
								}`}
							>
								<Link2 size={12} />
								Shared ACL
							</button>
						</div>
					</div>

					{/* -- Inline ACL Form -- */}
					{aclMode === "inline" && (
						<>
							{/* Shared ACL active indicator */}
							{sharedAclBinding && (
								<div className="flex items-center gap-2 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-xs text-amber-400">
									<AlertCircle size={14} />
									This gate has a shared ACL bound. The inline config below is
									separate -- switch to "Shared ACL" mode to manage it.
								</div>
							)}

							{/* Mode toggle */}
							<div>
								<label className="mb-1 block text-xs text-zinc-500">
									Mode
								</label>
								<div className="flex gap-2">
									<button
										type="button"
										onClick={() => setIsAllowlist(true)}
										className={`rounded px-3 py-1.5 text-xs font-medium ${
											isAllowlist
												? "bg-cyan-500/20 text-cyan-400"
												: "bg-zinc-800 text-zinc-500"
										}`}
									>
										Allowlist
									</button>
									<button
										type="button"
										onClick={() => setIsAllowlist(false)}
										className={`rounded px-3 py-1.5 text-xs font-medium ${
											!isAllowlist
												? "bg-cyan-500/20 text-cyan-400"
												: "bg-zinc-800 text-zinc-500"
										}`}
									>
										Denylist
									</button>
								</div>
							</div>

							{/* Tribe IDs */}
							<div>
								<label className="mb-1 block text-xs text-zinc-500">
									Tribe IDs ({tribeIds.length})
								</label>
								<div className="flex flex-wrap gap-1.5">
									{tribeIds.map((id) => (
										<span
											key={id}
											className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200"
										>
											#{id}
											<button
												type="button"
												onClick={() =>
													setTribeIds(
														tribeIds.filter((t) => t !== id),
													)
												}
												className="text-zinc-500 hover:text-red-400"
											>
												<X size={12} />
											</button>
										</span>
									))}
								</div>
								<div className="mt-1.5 flex gap-1.5">
									<input
										type="number"
										value={newTribeId}
										onChange={(e) => setNewTribeId(e.target.value)}
										placeholder="Tribe ID"
										className="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
										onKeyDown={(e) => e.key === "Enter" && addTribe()}
									/>
									<button
										type="button"
										onClick={addTribe}
										disabled={!newTribeId}
										className="rounded bg-zinc-800 px-2 py-1 text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
									>
										<Plus size={14} />
									</button>
								</div>
							</div>

							{/* Character IDs */}
							<div>
								<label className="mb-1 block text-xs text-zinc-500">
									Character IDs ({characterIds.length})
								</label>
								<div className="flex flex-wrap gap-1.5">
									{characterIds.map((id) => (
										<span
											key={id}
											className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200"
										>
											#{id}
											<button
												type="button"
												onClick={() =>
													setCharacterIds(
														characterIds.filter((c) => c !== id),
													)
												}
												className="text-zinc-500 hover:text-red-400"
											>
												<X size={12} />
											</button>
										</span>
									))}
								</div>
								<div className="mt-1.5 flex gap-1.5">
									<input
										type="number"
										value={newCharId}
										onChange={(e) => setNewCharId(e.target.value)}
										placeholder="Character ID"
										className="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
										onKeyDown={(e) =>
											e.key === "Enter" && addCharacter()
										}
									/>
									<button
										type="button"
										onClick={addCharacter}
										disabled={!newCharId}
										className="rounded bg-zinc-800 px-2 py-1 text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
									>
										<Plus size={14} />
									</button>
								</div>
							</div>

							{/* Permit duration */}
							<div>
								<label className="mb-1 block text-xs text-zinc-500">
									Permit duration (min)
								</label>
								<input
									type="number"
									value={permitDurationMin}
									onChange={(e) =>
										setPermitDurationMin(Number(e.target.value))
									}
									min={1}
									className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
								/>
							</div>

							{/* Vector size warning */}
							{tribeIds.length + characterIds.length > 80 && (
								<p className="text-xs text-amber-400">
									Large ACL lists (&gt;100 entries) may exceed gas limits.
									Consider using tribe-level grouping.
								</p>
							)}

							{/* Sync button */}
							<button
								type="button"
								onClick={handleSync}
								disabled={isSaving}
								className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{isSaving ? (
									<span className="flex items-center justify-center gap-2">
										<Loader2 size={16} className="animate-spin" />
										{status === "signing"
											? "Waiting for wallet..."
											: "Building transaction..."}
									</span>
								) : (
									"Sync to Chain"
								)}
							</button>
						</>
					)}

					{/* -- Shared ACL Section -- */}
					{aclMode === "shared" && (
						<>
							{/* Current binding indicator */}
							{sharedAclBinding && (
								<div className="rounded border border-emerald-900/50 bg-emerald-950/20 p-3">
									<div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-400">
										<Link2 size={14} />
										Shared ACL Bound
									</div>
									{selectedAclDetails ? (
										<div className="space-y-1">
											<p className="text-sm text-zinc-200">
												{selectedAclDetails.name || "(unnamed)"}
											</p>
											<p className="font-mono text-[10px] text-zinc-500">
												{sharedAclBinding.sharedAclId}
											</p>
											<div className="flex gap-3 text-[10px] text-zinc-500">
												<span
													className={`rounded-full px-1.5 py-0.5 font-medium ${
														selectedAclDetails.isAllowlist
															? "bg-emerald-500/10 text-emerald-400"
															: "bg-red-500/10 text-red-400"
													}`}
												>
													{selectedAclDetails.isAllowlist
														? "Allowlist"
														: "Denylist"}
												</span>
												<span>
													{selectedAclDetails.allowedTribes.length}{" "}
													tribe
													{selectedAclDetails.allowedTribes
														.length !== 1
														? "s"
														: ""}
												</span>
												<span>
													{
														selectedAclDetails.allowedCharacters
															.length
													}{" "}
													character
													{selectedAclDetails.allowedCharacters
														.length !== 1
														? "s"
														: ""}
												</span>
											</div>
											<p className="text-[10px] text-zinc-600">
												Permit duration:{" "}
												{Math.round(
													sharedAclBinding.permitDurationMs / 60_000,
												)}{" "}
												min
											</p>
										</div>
									) : (
										<p className="font-mono text-xs text-zinc-500">
											{sharedAclBinding.sharedAclId}
										</p>
									)}

									{/* Remove binding button */}
									<button
										type="button"
										onClick={handleRemoveSharedAcl}
										disabled={isSaving}
										className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-900/50 bg-red-950/20 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{isSaving ? (
											<>
												<Loader2 size={14} className="animate-spin" />
												{status === "signing"
													? "Waiting for wallet..."
													: "Removing..."}
											</>
										) : (
											<>
												<Unlink size={14} />
												Remove Shared ACL
											</>
										)}
									</button>
								</div>
							)}

							{/* Search/select shared ACL */}
							<div>
								<label className="mb-1 block text-xs text-zinc-500">
									{sharedAclBinding
										? "Change Shared ACL"
										: "Select Shared ACL"}
								</label>

								{/* Manual ID input */}
								<input
									type="text"
									value={selectedSharedAclId}
									onChange={(e) =>
										setSelectedSharedAclId(e.target.value)
									}
									placeholder="0x... (SharedAcl object ID)"
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>

								{/* Browse available ACLs */}
								{aclRegistryPackageId && (
									<div className="mt-2">
										<div className="relative">
											<Search
												size={14}
												className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600"
											/>
											<input
												type="text"
												value={aclSearchQuery}
												onChange={(e) =>
													setAclSearchQuery(e.target.value)
												}
												placeholder="Search ACLs by name or ID..."
												className="w-full rounded border border-zinc-700 bg-zinc-800 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
											/>
										</div>

										{loadingAcls && (
											<div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
												<Loader2 size={12} className="animate-spin" />
												Loading ACLs...
											</div>
										)}

										{!loadingAcls && filteredAcls.length > 0 && (
											<div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
												{filteredAcls.map((acl) => (
													<button
														type="button"
														key={acl.objectId}
														onClick={() =>
															setSelectedSharedAclId(
																acl.objectId,
															)
														}
														className={`flex w-full items-center justify-between rounded border px-3 py-2 text-left text-xs transition-colors ${
															selectedSharedAclId ===
															acl.objectId
																? "border-cyan-500/50 bg-cyan-950/20 text-cyan-400"
																: "border-zinc-800 bg-zinc-900/30 text-zinc-300 hover:border-zinc-700"
														}`}
													>
														<div className="min-w-0 flex-1">
															<div className="flex items-center gap-2">
																<span className="truncate font-medium">
																	{acl.name || "(unnamed)"}
																</span>
																<span
																	className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
																		acl.isAllowlist
																			? "bg-emerald-500/10 text-emerald-400"
																			: "bg-red-500/10 text-red-400"
																	}`}
																>
																	{acl.isAllowlist
																		? "Allow"
																		: "Deny"}
																</span>
															</div>
															<p className="mt-0.5 font-mono text-[10px] text-zinc-600">
																{acl.objectId.slice(0, 16)}
																...
																{acl.objectId.slice(-8)}
															</p>
														</div>
														{selectedSharedAclId ===
															acl.objectId && (
															<CheckCircle2
																size={14}
																className="shrink-0 text-cyan-400"
															/>
														)}
													</button>
												))}
											</div>
										)}

										{!loadingAcls && filteredAcls.length === 0 && (
											<p className="mt-2 text-[10px] text-zinc-600">
												No shared ACLs found. Create one in the "Shared
												ACLs" sub-tab first.
											</p>
										)}
									</div>
								)}

								{!aclRegistryPackageId && (
									<p className="mt-1.5 text-[10px] text-zinc-600">
										ACL Registry not configured. Paste a SharedAcl object ID
										directly above.
									</p>
								)}
							</div>

							{/* Selected ACL details preview */}
							{selectedAclDetails &&
								selectedSharedAclId !==
									sharedAclBinding?.sharedAclId && (
									<div className="rounded border border-zinc-800 bg-zinc-900/30 p-3">
										<p className="mb-1 text-xs font-medium text-zinc-300">
											{selectedAclDetails.name || "(unnamed)"}
										</p>
										<div className="space-y-0.5 text-[10px] text-zinc-500">
											<div className="flex gap-3">
												<span
													className={`rounded-full px-1.5 py-0.5 font-medium ${
														selectedAclDetails.isAllowlist
															? "bg-emerald-500/10 text-emerald-400"
															: "bg-red-500/10 text-red-400"
													}`}
												>
													{selectedAclDetails.isAllowlist
														? "Allowlist"
														: "Denylist"}
												</span>
												<span>
													{selectedAclDetails.allowedTribes.length}{" "}
													tribe
													{selectedAclDetails.allowedTribes
														.length !== 1
														? "s"
														: ""}
												</span>
												<span>
													{
														selectedAclDetails.allowedCharacters
															.length
													}{" "}
													character
													{selectedAclDetails.allowedCharacters
														.length !== 1
														? "s"
														: ""}
												</span>
											</div>
											{selectedAclDetails.allowedTribes.length > 0 && (
												<p>
													Tribes:{" "}
													{selectedAclDetails.allowedTribes
														.map((t) => `#${t}`)
														.join(", ")}
												</p>
											)}
											{selectedAclDetails.allowedCharacters.length >
												0 && (
												<p>
													Characters:{" "}
													{selectedAclDetails.allowedCharacters
														.map((c) => `#${c}`)
														.join(", ")}
												</p>
											)}
											<p>
												Creator:{" "}
												{selectedAclDetails.creator.slice(0, 12)}
												...{selectedAclDetails.creator.slice(-6)}
											</p>
										</div>
									</div>
								)}

							{/* Permit duration */}
							<div>
								<label className="mb-1 block text-xs text-zinc-500">
									Permit duration (min)
								</label>
								<input
									type="number"
									value={sharedPermitDurationMin}
									onChange={(e) =>
										setSharedPermitDurationMin(Number(e.target.value))
									}
									min={1}
									className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
								/>
							</div>

							{/* Bind button */}
							<button
								type="button"
								onClick={handleBindSharedAcl}
								disabled={isSaving || !selectedSharedAclId}
								className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{isSaving ? (
									<span className="flex items-center justify-center gap-2">
										<Loader2 size={16} className="animate-spin" />
										{status === "signing"
											? "Waiting for wallet..."
											: "Building transaction..."}
									</span>
								) : sharedAclBinding ? (
									"Update Shared ACL Binding"
								) : (
									"Bind Shared ACL"
								)}
							</button>
						</>
					)}

					{/* Status messages */}
					{status === "done" && (
						<div className="flex items-center gap-2 rounded border border-green-900/50 bg-green-950/20 p-2 text-xs text-green-400">
							<CheckCircle2 size={14} />
							Config synced to chain
							{txDigest && (
								<a
									href={`https://suiscan.xyz/testnet/tx/${txDigest}`}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center gap-0.5 text-cyan-400 hover:text-cyan-300"
								>
									View <ExternalLink size={10} />
								</a>
							)}
						</div>
					)}
					{status === "error" && error && (
						<div className="flex items-center gap-2 rounded border border-red-900/50 bg-red-950/20 p-2 text-xs text-red-400">
							<AlertCircle size={14} />
							{error}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// -- Helper: detect shared ACL binding via dynamic field scan --

async function detectSharedAclBinding(
	client: SuiGraphQLClient,
	configObjectId: string,
	gateId: string,
	_packageId: string,
): Promise<SharedAclBinding | null> {
	const QUERY = `
		query($parentId: SuiAddress!, $first: Int) {
			object(address: $parentId) {
				dynamicFields(first: $first) {
					nodes {
						name { json type { repr } }
						value {
							... on MoveValue { json type { repr } }
							... on MoveObject {
								contents { json type { repr } }
							}
						}
					}
				}
			}
		}
	`;

	interface DfResponse {
		object: {
			dynamicFields: {
				nodes: Array<{
					name: { json: unknown; type: { repr: string } };
					value:
						| { json: unknown; type: { repr: string } }
						| { contents: { json: unknown; type: { repr: string } } };
				}>;
			};
		} | null;
	}

	try {
		const result = await client.query<DfResponse, { parentId: string; first: number }>({
			query: QUERY,
			variables: { parentId: configObjectId, first: 100 },
		});

		const nodes = result.data?.object?.dynamicFields?.nodes;
		if (!nodes) return null;

		for (const node of nodes) {
			if (!node.name.type.repr.includes("SharedAclKey")) continue;

			const keyJson = node.name.json as Record<string, unknown> | null;
			if (keyJson?.gate_id !== gateId) continue;

			const val = node.value as Record<string, unknown>;
			let fields: Record<string, unknown> | null = null;

			if ("json" in val && val.json) {
				fields = val.json as Record<string, unknown>;
			} else if ("contents" in val) {
				const contents = val.contents as { json: unknown } | undefined;
				fields = (contents?.json as Record<string, unknown>) ?? null;
			}

			if (!fields) continue;

			return {
				sharedAclId: String(fields.shared_acl_id ?? ""),
				permitDurationMs: Number(fields.permit_duration_ms ?? 600_000),
			};
		}
	} catch {
		// Silently fail
	}

	return null;
}
