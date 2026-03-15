import { useState, useEffect } from "react";
import {
	useCurrentAccount,
	useSignAndExecuteTransaction,
	useSuiClient,
} from "@mysten/dapp-kit";
import {
	queryAdminConfig,
	buildAddAdmin,
	buildRemoveAdmin,
	buildAddAdminTribe,
	buildRemoveAdminTribe,
	type AdminConfig,
} from "@tehfrontier/chain-shared";
import {
	Shield,
	Plus,
	X,
	Loader2,
	AlertCircle,
	Crown,
} from "lucide-react";

interface AdminPanelProps {
	packageId: string;
	configObjectId: string;
}

export function AdminPanel({ packageId, configObjectId }: AdminPanelProps) {
	const account = useCurrentAccount();
	const client = useSuiClient();
	const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

	const [config, setConfig] = useState<AdminConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [newAdmin, setNewAdmin] = useState("");
	const [newTribe, setNewTribe] = useState("");
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);

	const isOwner = account && config && account.address === config.owner;

	useEffect(() => {
		async function load() {
			setLoading(true);
			try {
				const result = await queryAdminConfig(client, configObjectId);
				setConfig(result);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to load admin config");
			}
			setLoading(false);
		}
		load();
	}, [client, configObjectId]);

	async function handleAddAdmin() {
		if (!account || !newAdmin.trim()) return;
		setBusy(true);
		setError(undefined);
		try {
			const tx = buildAddAdmin({
				packageId,
				configObjectId,
				adminAddress: newAdmin.trim(),
				senderAddress: account.address,
			});
			await signAndExecute({ transaction: tx });
			setNewAdmin("");
			// Reload config
			const result = await queryAdminConfig(client, configObjectId);
			setConfig(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
		setBusy(false);
	}

	async function handleRemoveAdmin(address: string) {
		if (!account) return;
		setBusy(true);
		setError(undefined);
		try {
			const tx = buildRemoveAdmin({
				packageId,
				configObjectId,
				adminAddress: address,
				senderAddress: account.address,
			});
			await signAndExecute({ transaction: tx });
			const result = await queryAdminConfig(client, configObjectId);
			setConfig(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
		setBusy(false);
	}

	async function handleAddAdminTribe() {
		if (!account || !newTribe.trim()) return;
		setBusy(true);
		setError(undefined);
		try {
			const tx = buildAddAdminTribe({
				packageId,
				configObjectId,
				tribeId: Number(newTribe),
				senderAddress: account.address,
			});
			await signAndExecute({ transaction: tx });
			setNewTribe("");
			const result = await queryAdminConfig(client, configObjectId);
			setConfig(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
		setBusy(false);
	}

	async function handleRemoveAdminTribe(tribeId: number) {
		if (!account) return;
		setBusy(true);
		setError(undefined);
		try {
			const tx = buildRemoveAdminTribe({
				packageId,
				configObjectId,
				tribeId,
				senderAddress: account.address,
			});
			await signAndExecute({ transaction: tx });
			const result = await queryAdminConfig(client, configObjectId);
			setConfig(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
		setBusy(false);
	}

	if (loading) {
		return (
			<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
				<div className="flex items-center gap-2 text-sm text-zinc-400">
					<Loader2 size={16} className="animate-spin" />
					Loading admin config...
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-400">
				<Shield size={14} />
				Admin Management
				{isOwner && (
					<span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
						<Crown size={10} />
						Owner
					</span>
				)}
			</h2>

			{config && (
				<div className="space-y-4">
					{/* Owner */}
					<div>
						<label className="mb-1 block text-xs text-zinc-500">Owner</label>
						<p className="font-mono text-xs text-zinc-400">
							{config.owner.slice(0, 16)}...{config.owner.slice(-8)}
						</p>
					</div>

					{/* Co-admins */}
					<div>
						<label className="mb-1 block text-xs text-zinc-500">
							Co-Admins ({config.admins.length})
						</label>
						{config.admins.map((admin) => (
							<div
								key={admin}
								className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/30 px-3 py-1.5 mb-1"
							>
								<span className="font-mono text-xs text-zinc-300">
									{admin.slice(0, 12)}...{admin.slice(-6)}
								</span>
								{isOwner && (
									<button
										type="button"
										onClick={() => handleRemoveAdmin(admin)}
										disabled={busy}
										className="text-zinc-600 hover:text-red-400 disabled:opacity-50"
									>
										<X size={14} />
									</button>
								)}
							</div>
						))}
						{isOwner && (
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
									disabled={busy || !newAdmin.trim()}
									className="rounded bg-zinc-800 px-2 py-1 text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
								>
									<Plus size={14} />
								</button>
							</div>
						)}
					</div>

					{/* Admin tribes */}
					<div>
						<label className="mb-1 block text-xs text-zinc-500">
							Admin Tribes ({config.adminTribes.length})
						</label>
						<p className="mb-1.5 text-xs text-zinc-600">
							Any character in these tribes can configure gates
						</p>
						<div className="flex flex-wrap gap-1.5">
							{config.adminTribes.map((tribe) => (
								<span
									key={tribe}
									className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200"
								>
									Tribe #{tribe}
									{isOwner && (
										<button
											type="button"
											onClick={() => handleRemoveAdminTribe(tribe)}
											disabled={busy}
											className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
										>
											<X size={12} />
										</button>
									)}
								</span>
							))}
						</div>
						{isOwner && (
							<div className="mt-1.5 flex gap-1.5">
								<input
									type="number"
									value={newTribe}
									onChange={(e) => setNewTribe(e.target.value)}
									placeholder="Tribe ID"
									className="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none"
								/>
								<button
									type="button"
									onClick={handleAddAdminTribe}
									disabled={busy || !newTribe.trim()}
									className="rounded bg-zinc-800 px-2 py-1 text-zinc-400 hover:text-cyan-400 disabled:opacity-50"
								>
									<Plus size={14} />
								</button>
							</div>
						)}
					</div>

					{!isOwner && (
						<p className="text-xs text-zinc-600">
							Only the contract owner can add/remove admins and admin tribes.
						</p>
					)}
				</div>
			)}

			{error && (
				<div className="mt-3 flex items-center gap-2 rounded border border-red-900/50 bg-red-950/20 p-2 text-xs text-red-400">
					<AlertCircle size={14} />
					{error}
				</div>
			)}
		</div>
	);
}
