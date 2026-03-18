import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { buildCreateAcl } from "@tehfrontier/chain-shared";
import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { useSignAndExecute } from "../hooks/useSignAndExecute";

interface CreateAclFormProps {
	packageId: string;
	onCreated: () => void;
	onCancel: () => void;
}

export function CreateAclForm({ packageId, onCreated, onCancel }: CreateAclFormProps) {
	const account = useCurrentAccount();
	const { mutateAsync, isPending } = useSignAndExecute();

	const [name, setName] = useState("");
	const [isAllowlist, setIsAllowlist] = useState(true);
	const [tribeIds, setTribeIds] = useState<number[]>([]);
	const [characterIds, setCharacterIds] = useState<number[]>([]);
	const [newTribeId, setNewTribeId] = useState("");
	const [newCharId, setNewCharId] = useState("");
	const [error, setError] = useState<string>();
	const [txDigest, setTxDigest] = useState<string>();
	const [done, setDone] = useState(false);

	async function handleCreate() {
		if (!account || !name.trim()) return;
		setError(undefined);
		setTxDigest(undefined);

		try {
			const tx = buildCreateAcl({
				packageId,
				name: name.trim(),
				isAllowlist,
				tribes: tribeIds,
				characters: characterIds,
				senderAddress: account.address,
			});

			const result = (await mutateAsync(tx)) as Record<string, unknown>;
			const txResult = result?.Transaction as Record<string, unknown> | undefined;
			const digest = (txResult?.digest as string) ?? "";
			setTxDigest(digest);
			setDone(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

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

	if (done) {
		return (
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="flex flex-col items-center gap-3 py-8">
					<CheckCircle2 size={32} className="text-green-400" />
					<p className="text-sm text-green-400">Shared ACL created successfully</p>
					{txDigest && (
						<a
							href={`https://suiscan.xyz/testnet/tx/${txDigest}`}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
						>
							View transaction <ExternalLink size={10} />
						</a>
					)}
					<button
						type="button"
						onClick={onCreated}
						className="mt-2 rounded bg-cyan-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-cyan-500"
					>
						Back to ACLs
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="mb-4 flex items-center gap-2">
				<button type="button" onClick={onCancel} className="text-zinc-500 hover:text-zinc-300">
					<ArrowLeft size={16} />
				</button>
				<h2 className="text-sm font-medium text-zinc-400">Create Shared ACL</h2>
			</div>

			<div className="space-y-4">
				{/* Name */}
				<div>
					<label className="mb-1 block text-xs text-zinc-500">ACL Name</label>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g., Tribe Gate Access"
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</div>

				{/* Mode toggle */}
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

				{/* Tribe IDs */}
				<div>
					<label className="mb-1 block text-xs text-zinc-500">Tribe IDs ({tribeIds.length})</label>
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
							onKeyDown={(e) => e.key === "Enter" && addCharacter()}
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

				{/* Error */}
				{error && (
					<div className="flex items-center gap-2 rounded border border-red-900/50 bg-red-950/20 p-2 text-xs text-red-400">
						<AlertCircle size={14} />
						{error}
					</div>
				)}

				{/* Create button */}
				<button
					type="button"
					onClick={handleCreate}
					disabled={isPending || !name.trim()}
					className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isPending ? (
						<span className="flex items-center justify-center gap-2">
							<Loader2 size={16} className="animate-spin" />
							Creating ACL...
						</span>
					) : (
						"Create Shared ACL"
					)}
				</button>
			</div>
		</div>
	);
}
