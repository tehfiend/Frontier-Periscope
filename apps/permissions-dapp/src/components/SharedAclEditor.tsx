import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	type SharedAclInfo,
	buildAddAclAdmin,
	buildAddAclCharacter,
	buildAddAclTribe,
	buildRemoveAclAdmin,
	buildRemoveAclCharacter,
	buildRemoveAclTribe,
	buildUpdateAcl,
	queryAclDetails,
} from "@tehfrontier/chain-shared";
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Copy,
	Crown,
	ExternalLink,
	Loader2,
	Plus,
	Shield,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSignAndExecute } from "../hooks/useSignAndExecute";

interface SharedAclEditorProps {
	packageId: string;
	aclId: string;
	onBack: () => void;
	onRefresh: () => void;
}

export function SharedAclEditor({ packageId, aclId, onBack, onRefresh }: SharedAclEditorProps) {
	const account = useCurrentAccount();
	const client = useCurrentClient() as SuiGraphQLClient;
	const { mutateAsync, isPending } = useSignAndExecute();

	const [acl, setAcl] = useState<SharedAclInfo | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const [txDigest, setTxDigest] = useState<string>();
	const [copied, setCopied] = useState(false);

	// Editable state for bulk update
	const [editMode, setEditMode] = useState(false);
	const [isAllowlist, setIsAllowlist] = useState(true);
	const [tribeIds, setTribeIds] = useState<number[]>([]);
	const [characterIds, setCharacterIds] = useState<number[]>([]);
	const [newTribeId, setNewTribeId] = useState("");
	const [newCharId, setNewCharId] = useState("");
	const [newAdmin, setNewAdmin] = useState("");

	const isCreator = account?.address === acl?.creator;
	const isAdmin = isCreator || (acl?.admins ?? []).includes(account?.address ?? "");

	const loadAcl = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			const details = await queryAclDetails(client, aclId);
			setAcl(details);
			if (details) {
				setIsAllowlist(details.isAllowlist);
				setTribeIds([...details.allowedTribes]);
				setCharacterIds([...details.allowedCharacters]);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load ACL");
		}
		setLoading(false);
	}, [client, aclId]);

	useEffect(() => {
		loadAcl();
	}, [loadAcl]);

	async function handleBulkUpdate() {
		if (!account || !acl) return;
		setError(undefined);
		setTxDigest(undefined);
		try {
			const tx = buildUpdateAcl({
				packageId,
				aclId,
				isAllowlist,
				tribes: tribeIds,
				characters: characterIds,
				senderAddress: account.address,
			});
			const result = (await mutateAsync(tx)) as Record<string, unknown>;
			const txResult = result?.Transaction as Record<string, unknown> | undefined;
			setTxDigest((txResult?.digest as string) ?? "");
			setEditMode(false);
			await loadAcl();
			onRefresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleAddAdmin() {
		if (!account || !newAdmin.trim()) return;
		setError(undefined);
		try {
			const tx = buildAddAclAdmin({
				packageId,
				aclId,
				adminAddress: newAdmin.trim(),
				senderAddress: account.address,
			});
			await mutateAsync(tx);
			setNewAdmin("");
			await loadAcl();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleRemoveAdmin(address: string) {
		if (!account) return;
		setError(undefined);
		try {
			const tx = buildRemoveAclAdmin({
				packageId,
				aclId,
				adminAddress: address,
				senderAddress: account.address,
			});
			await mutateAsync(tx);
			await loadAcl();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleIncrementalAddTribe(tribeId: number) {
		if (!account) return;
		setError(undefined);
		try {
			const tx = buildAddAclTribe({
				packageId,
				aclId,
				tribeId,
				senderAddress: account.address,
			});
			await mutateAsync(tx);
			await loadAcl();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleIncrementalRemoveTribe(tribeId: number) {
		if (!account) return;
		setError(undefined);
		try {
			const tx = buildRemoveAclTribe({
				packageId,
				aclId,
				tribeId,
				senderAddress: account.address,
			});
			await mutateAsync(tx);
			await loadAcl();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleIncrementalAddCharacter(charId: number) {
		if (!account) return;
		setError(undefined);
		try {
			const tx = buildAddAclCharacter({
				packageId,
				aclId,
				characterId: charId,
				senderAddress: account.address,
			});
			await mutateAsync(tx);
			await loadAcl();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleIncrementalRemoveCharacter(charId: number) {
		if (!account) return;
		setError(undefined);
		try {
			const tx = buildRemoveAclCharacter({
				packageId,
				aclId,
				characterId: charId,
				senderAddress: account.address,
			});
			await mutateAsync(tx);
			await loadAcl();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	function addTribeLocal() {
		const id = Number(newTribeId);
		if (id > 0 && !tribeIds.includes(id)) {
			setTribeIds([...tribeIds, id]);
			setNewTribeId("");
		}
	}

	function addCharacterLocal() {
		const id = Number(newCharId);
		if (id > 0 && !characterIds.includes(id)) {
			setCharacterIds([...characterIds, id]);
			setNewCharId("");
		}
	}

	function copyObjectId() {
		navigator.clipboard.writeText(aclId);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}

	if (loading) {
		return (
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="flex items-center gap-2 py-8 text-sm text-zinc-400">
					<Loader2 size={16} className="animate-spin" />
					Loading ACL details...
				</div>
			</div>
		);
	}

	if (!acl) {
		return (
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="flex items-center gap-2 mb-4">
					<button type="button" onClick={onBack} className="text-zinc-500 hover:text-zinc-300">
						<ArrowLeft size={16} />
					</button>
					<span className="text-sm text-zinc-500">ACL not found</span>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="flex items-center gap-2 mb-3">
					<button type="button" onClick={onBack} className="text-zinc-500 hover:text-zinc-300">
						<ArrowLeft size={16} />
					</button>
					<h2 className="text-sm font-medium text-zinc-200">{acl.name || "(unnamed)"}</h2>
					{isCreator && (
						<span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
							<Crown size={10} />
							Creator
						</span>
					)}
					<span
						className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
							acl.isAllowlist ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
						}`}
					>
						{acl.isAllowlist ? "Allowlist" : "Denylist"}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					<p className="font-mono text-[11px] text-zinc-500">{aclId}</p>
					<button
						type="button"
						onClick={copyObjectId}
						className="text-zinc-600 hover:text-zinc-400"
					>
						{copied ? <CheckCircle2 size={12} className="text-green-400" /> : <Copy size={12} />}
					</button>
				</div>
				<p className="mt-1 text-[10px] text-zinc-600">
					Creator: {acl.creator.slice(0, 12)}...{acl.creator.slice(-6)}
				</p>
			</div>

			{/* TX success notification */}
			{txDigest && (
				<div className="flex items-center gap-2 rounded border border-green-900/50 bg-green-950/20 p-2 text-xs text-green-400">
					<CheckCircle2 size={14} />
					ACL updated
					<a
						href={`https://suiscan.xyz/testnet/tx/${txDigest}`}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-0.5 text-cyan-400 hover:text-cyan-300"
					>
						View <ExternalLink size={10} />
					</a>
				</div>
			)}

			{/* Members: Tribes and Characters */}
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="flex items-center justify-between mb-3">
					<h3 className="flex items-center gap-1.5 text-sm font-medium text-zinc-400">
						<Shield size={14} />
						Members
					</h3>
					{isAdmin && !editMode && (
						<button
							type="button"
							onClick={() => setEditMode(true)}
							className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:text-cyan-400"
						>
							Bulk Edit
						</button>
					)}
				</div>

				{editMode ? (
					/* Bulk edit mode */
					<div className="space-y-4">
						<div>
							<label className="mb-1 block text-xs text-zinc-500">Mode</label>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => setIsAllowlist(true)}
									className={`rounded px-3 py-1.5 text-xs font-medium ${
										isAllowlist ? "bg-cyan-500/20 text-cyan-400" : "bg-zinc-800 text-zinc-500"
									}`}
								>
									Allowlist
								</button>
								<button
									type="button"
									onClick={() => setIsAllowlist(false)}
									className={`rounded px-3 py-1.5 text-xs font-medium ${
										!isAllowlist ? "bg-cyan-500/20 text-cyan-400" : "bg-zinc-800 text-zinc-500"
									}`}
								>
									Denylist
								</button>
							</div>
						</div>

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
											onClick={() => setTribeIds(tribeIds.filter((t) => t !== id))}
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
									onKeyDown={(e) => e.key === "Enter" && addTribeLocal()}
								/>
								<button
									type="button"
									onClick={addTribeLocal}
									disabled={!newTribeId}
									className="rounded bg-zinc-800 px-2 py-1 text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
								>
									<Plus size={14} />
								</button>
							</div>
						</div>

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
											onClick={() => setCharacterIds(characterIds.filter((c) => c !== id))}
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
									onKeyDown={(e) => e.key === "Enter" && addCharacterLocal()}
								/>
								<button
									type="button"
									onClick={addCharacterLocal}
									disabled={!newCharId}
									className="rounded bg-zinc-800 px-2 py-1 text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
								>
									<Plus size={14} />
								</button>
							</div>
						</div>

						<div className="flex gap-2">
							<button
								type="button"
								onClick={handleBulkUpdate}
								disabled={isPending}
								className="flex-1 rounded-lg bg-cyan-600 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
							>
								{isPending ? (
									<span className="flex items-center justify-center gap-2">
										<Loader2 size={14} className="animate-spin" />
										Saving...
									</span>
								) : (
									"Save Changes"
								)}
							</button>
							<button
								type="button"
								onClick={() => {
									setEditMode(false);
									if (acl) {
										setIsAllowlist(acl.isAllowlist);
										setTribeIds([...acl.allowedTribes]);
										setCharacterIds([...acl.allowedCharacters]);
									}
								}}
								className="rounded-lg bg-zinc-800 px-4 py-2 text-xs text-zinc-400 hover:text-zinc-300"
							>
								Cancel
							</button>
						</div>
					</div>
				) : (
					/* Read mode with incremental add/remove */
					<div className="space-y-4">
						{/* Tribes */}
						<div>
							<label className="mb-1 block text-xs text-zinc-500">
								Tribes ({acl.allowedTribes.length})
							</label>
							<div className="flex flex-wrap gap-1.5">
								{acl.allowedTribes.map((id) => (
									<span
										key={id}
										className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200"
									>
										#{id}
										{isAdmin && (
											<button
												type="button"
												onClick={() => handleIncrementalRemoveTribe(id)}
												disabled={isPending}
												className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
											>
												<X size={12} />
											</button>
										)}
									</span>
								))}
								{acl.allowedTribes.length === 0 && (
									<span className="text-xs text-zinc-600">None</span>
								)}
							</div>
							{isAdmin && (
								<div className="mt-1.5 flex gap-1.5">
									<input
										type="number"
										value={newTribeId}
										onChange={(e) => setNewTribeId(e.target.value)}
										placeholder="Add tribe"
										className="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
										onKeyDown={(e) => {
											if (e.key === "Enter" && newTribeId) {
												handleIncrementalAddTribe(Number(newTribeId));
												setNewTribeId("");
											}
										}}
									/>
									<button
										type="button"
										onClick={() => {
											if (newTribeId) {
												handleIncrementalAddTribe(Number(newTribeId));
												setNewTribeId("");
											}
										}}
										disabled={!newTribeId || isPending}
										className="rounded bg-zinc-800 px-2 py-1 text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
									>
										<Plus size={14} />
									</button>
								</div>
							)}
						</div>

						{/* Characters */}
						<div>
							<label className="mb-1 block text-xs text-zinc-500">
								Characters ({acl.allowedCharacters.length})
							</label>
							<div className="flex flex-wrap gap-1.5">
								{acl.allowedCharacters.map((id) => (
									<span
										key={id}
										className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200"
									>
										#{id}
										{isAdmin && (
											<button
												type="button"
												onClick={() => handleIncrementalRemoveCharacter(id)}
												disabled={isPending}
												className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
											>
												<X size={12} />
											</button>
										)}
									</span>
								))}
								{acl.allowedCharacters.length === 0 && (
									<span className="text-xs text-zinc-600">None</span>
								)}
							</div>
							{isAdmin && (
								<div className="mt-1.5 flex gap-1.5">
									<input
										type="number"
										value={newCharId}
										onChange={(e) => setNewCharId(e.target.value)}
										placeholder="Add character"
										className="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
										onKeyDown={(e) => {
											if (e.key === "Enter" && newCharId) {
												handleIncrementalAddCharacter(Number(newCharId));
												setNewCharId("");
											}
										}}
									/>
									<button
										type="button"
										onClick={() => {
											if (newCharId) {
												handleIncrementalAddCharacter(Number(newCharId));
												setNewCharId("");
											}
										}}
										disabled={!newCharId || isPending}
										className="rounded bg-zinc-800 px-2 py-1 text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
									>
										<Plus size={14} />
									</button>
								</div>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Admin Management (creator only) */}
			{isCreator && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-zinc-400">
						<Crown size={14} />
						Admin Management
					</h3>

					<div>
						<label className="mb-1 block text-xs text-zinc-500">
							Co-Admins ({acl.admins.length})
						</label>
						{acl.admins.map((admin) => (
							<div
								key={admin}
								className="mb-1 flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/30 px-3 py-1.5"
							>
								<span className="font-mono text-xs text-zinc-300">
									{admin.slice(0, 12)}...{admin.slice(-6)}
								</span>
								<button
									type="button"
									onClick={() => handleRemoveAdmin(admin)}
									disabled={isPending}
									className="text-zinc-600 hover:text-red-400 disabled:opacity-50"
								>
									<X size={14} />
								</button>
							</div>
						))}
						{acl.admins.length === 0 && (
							<p className="text-xs text-zinc-600">
								No co-admins. Only the creator can manage this ACL.
							</p>
						)}
						<div className="mt-1.5 flex gap-1.5">
							<input
								type="text"
								value={newAdmin}
								onChange={(e) => setNewAdmin(e.target.value)}
								placeholder="0x... wallet address"
								className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
							/>
							<button
								type="button"
								onClick={handleAddAdmin}
								disabled={isPending || !newAdmin.trim()}
								className="rounded bg-zinc-800 px-2 py-1 text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
							>
								<Plus size={14} />
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Error */}
			{error && (
				<div className="flex items-center gap-2 rounded border border-red-900/50 bg-red-950/20 p-2 text-xs text-red-400">
					<AlertCircle size={14} />
					{error}
				</div>
			)}
		</div>
	);
}
