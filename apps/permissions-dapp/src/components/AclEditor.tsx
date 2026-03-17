import { useState, useEffect } from "react";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import {
	queryAclConfig,
	buildConfigureAcl,
	type AclConfig,
} from "@tehfrontier/chain-shared";
import {
	Loader2,
	CheckCircle2,
	AlertCircle,
	Plus,
	X,
	ExternalLink,
} from "lucide-react";

interface AclEditorProps {
	assemblyId: string;
	packageId: string;
	configObjectId: string;
}

type SyncStatus = "idle" | "loading" | "saving" | "signing" | "done" | "error";

export function AclEditor({ assemblyId, packageId, configObjectId }: AclEditorProps) {
	const account = useCurrentAccount();
	const client = useCurrentClient() as SuiGraphQLClient;
	const dAppKit = useDAppKit();

	const [isAllowlist, setIsAllowlist] = useState(true);
	const [tribeIds, setTribeIds] = useState<number[]>([]);
	const [characterIds, setCharacterIds] = useState<number[]>([]);
	const [permitDurationMin, setPermitDurationMin] = useState(10);
	const [newTribeId, setNewTribeId] = useState("");
	const [newCharId, setNewCharId] = useState("");
	const [status, setStatus] = useState<SyncStatus>("idle");
	const [error, setError] = useState<string>();
	const [txDigest, setTxDigest] = useState<string>();

	// Load current config from chain
	useEffect(() => {
		async function load() {
			setStatus("loading");
			try {
				const config = await queryAclConfig(client, configObjectId, assemblyId);
				if (config) {
					setIsAllowlist(config.isAllowlist);
					setTribeIds(config.tribeIds);
					setCharacterIds(config.characterIds);
					setPermitDurationMin(Math.round(config.permitDurationMs / 60_000));
				}
				setStatus("idle");
			} catch (err) {
				setStatus("error");
				setError(err instanceof Error ? err.message : "Failed to load config");
			}
		}
		load();
	}, [client, configObjectId, assemblyId]);

	async function handleSync() {
		if (!account) return;
		setStatus("saving");
		setError(undefined);
		setTxDigest(undefined);

		try {
			const tx = buildConfigureAcl({
				tenant: "utopia",
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
			const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest ?? "";
			setTxDigest(digest);
			setStatus("done");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStatus("error");
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

					{/* Permit duration */}
					<div>
						<label className="mb-1 block text-xs text-zinc-500">Permit duration (min)</label>
						<input
							type="number"
							value={permitDurationMin}
							onChange={(e) => setPermitDurationMin(Number(e.target.value))}
							min={1}
							className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
						/>
					</div>

					{/* Vector size warning */}
					{(tribeIds.length + characterIds.length) > 80 && (
						<p className="text-xs text-amber-400">
							Large ACL lists (&gt;100 entries) may exceed gas limits. Consider using tribe-level grouping.
						</p>
					)}

					{/* Status */}
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
								{status === "signing" ? "Waiting for wallet..." : "Building transaction..."}
							</span>
						) : (
							"Sync to Chain"
						)}
					</button>
				</div>
			)}
		</div>
	);
}
