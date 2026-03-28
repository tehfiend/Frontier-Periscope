import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
	AlertCircle,
	ChevronDown,
	Loader2,
	Plus,
	UserMinus,
	UserPlus,
	Vault,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { TenantId } from "@/chain/config";
import { CopyAddress } from "@/components/CopyAddress";
import { type ColumnDef, DataGrid, excelFilterFn } from "@/components/DataGrid";
import { db } from "@/db";
import type { TreasuryRecord } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";

type BuildStatus = "idle" | "building" | "done" | "error";

// ── Treasury View ─────────────────────────────────────────────────────

export function Treasury() {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: _signAndExecute } = useDAppKit();
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const tenant = useActiveTenant();

	// Treasury state
	const treasuries = useLiveQuery(() => db.treasuries.toArray()) ?? [];
	const [selectedTreasuryId, setSelectedTreasuryId] = useState<string | null>(null);
	const [newTreasuryName, setNewTreasuryName] = useState("");

	const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
	const [buildError, setBuildError] = useState("");

	// Filter treasuries for current user
	const userTreasuries = useMemo(
		() =>
			suiAddress
				? treasuries.filter((t) => t.owner === suiAddress || t.admins.includes(suiAddress))
				: [],
		[treasuries, suiAddress],
	);

	const selectedTreasury = userTreasuries.find((t) => t.id === selectedTreasuryId);

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<Vault size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">Select a character to manage treasuries</p>
					<a
						href="/manifest"
						className="mt-2 inline-block text-xs text-cyan-400 hover:text-cyan-300"
					>
						Go to Manifest &rarr;
					</a>
				</div>
			</div>
		);
	}

	async function handleCreateTreasury() {
		if (!newTreasuryName.trim() || !suiAddress) return;

		setBuildStatus("building");
		setBuildError("");

		try {
			// TODO: Wire to chain-shared buildCreateTreasury once available
			// const addresses = getContractAddresses(tenant);
			// const tx = buildCreateTreasury({
			// 	packageId: addresses.treasury?.packageId ?? "",
			// 	name: newTreasuryName.trim(),
			// 	senderAddress: suiAddress,
			// });
			// const result = await signAndExecute({ transaction: tx });

			// For now, create a local placeholder record
			const record = {
				id: crypto.randomUUID(),
				name: newTreasuryName.trim(),
				owner: suiAddress,
				admins: [],
				balances: [],
				coinType: "",
			};
			await db.treasuries.put(record);

			setNewTreasuryName("");
			setBuildStatus("done");
		} catch (err) {
			setBuildStatus("error");
			setBuildError(err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
			{/* Status Banner */}
			{buildStatus !== "idle" && buildStatus !== "done" && (
				<StatusBanner
					status={buildStatus}
					error={buildError}
					onDismiss={() => {
						setBuildStatus("idle");
						setBuildError("");
					}}
				/>
			)}

			{buildStatus === "done" && (
				<div className="rounded-lg border border-green-900/50 bg-green-950/20 p-4">
					<p className="text-sm text-green-400">Operation completed successfully.</p>
					<button
						type="button"
						onClick={() => setBuildStatus("idle")}
						className="mt-2 text-xs text-zinc-400 hover:text-zinc-300"
					>
						Dismiss
					</button>
				</div>
			)}

			{/* ── Treasury Management Section ──────────────────────────────── */}
			<section>
				<div className="mb-3 flex items-center gap-3">
					<div className="flex items-center gap-2">
						<Vault size={18} className="text-cyan-500" />
						<h2 className="text-sm font-medium text-zinc-100">Treasuries</h2>
					</div>

					{/* Treasury selector */}
					{userTreasuries.length > 0 && (
						<div className="relative max-w-xs min-w-0 flex-1">
							<select
								value={selectedTreasuryId ?? ""}
								onChange={(e) => setSelectedTreasuryId(e.target.value || null)}
								className="w-full appearance-none rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-3 pr-8 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
							>
								<option value="">Select a treasury...</option>
								{userTreasuries.map((t) => (
									<option key={t.id} value={t.id}>
										{t.name} {t.owner === suiAddress ? "(owner)" : "(admin)"}
									</option>
								))}
							</select>
							<ChevronDown
								size={14}
								className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
							/>
						</div>
					)}
				</div>

				{/* Create Treasury */}
				<div className="mb-3 flex items-center gap-2">
					<input
						type="text"
						value={newTreasuryName}
						onChange={(e) => setNewTreasuryName(e.target.value)}
						placeholder="New treasury name..."
						className="max-w-xs rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
					{account ? (
						<button
							type="button"
							onClick={handleCreateTreasury}
							disabled={!newTreasuryName.trim() || buildStatus === "building"}
							className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-4 py-2 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400 disabled:opacity-50"
						>
							<Plus size={14} />
							Create Treasury
						</button>
					) : (
						<span className="text-xs text-zinc-500">Connect wallet</span>
					)}
				</div>

				{/* Treasury Detail */}
				{selectedTreasury && (
					<TreasuryDetail
						treasury={selectedTreasury}
						suiAddress={suiAddress}
						tenant={tenant}
						onStatusChange={(s, e) => {
							setBuildStatus(s);
							setBuildError(e ?? "");
						}}
					/>
				)}
			</section>
		</div>
	);
}

// ── Treasury Detail ───────────────────────────────────────────────────

function TreasuryDetail({
	treasury,
	suiAddress,
	tenant: _tenant,
	onStatusChange,
}: {
	treasury: TreasuryRecord;
	suiAddress: string;
	tenant: TenantId;
	onStatusChange: (status: BuildStatus, error?: string) => void;
}) {
	const _account = useCurrentAccount();
	const { signAndExecuteTransaction: _signAndExecute } = useDAppKit();
	const [addAdminAddress, setAddAdminAddress] = useState("");

	const isOwner = treasury.owner === suiAddress;
	// isAdmin will be used for deposit/withdraw once chain-shared treasury module lands
	const _isAdmin = isOwner || treasury.admins.includes(suiAddress);

	const balanceColumns = useMemo<ColumnDef<(typeof treasury.balances)[0], unknown>[]>(
		() => [
			{
				accessorKey: "symbol",
				header: "Currency",
				size: 100,
				filterFn: excelFilterFn,
			},
			{
				accessorKey: "amount",
				header: "Balance",
				size: 120,
				enableColumnFilter: false,
			},
			{
				accessorKey: "coinType",
				header: "Coin Type",
				size: 200,
				filterFn: excelFilterFn,
				cell: ({ row }) => (
					<span className="truncate font-mono text-xs text-zinc-500">{row.original.coinType}</span>
				),
			},
		],
		[],
	);

	async function handleAddAdmin() {
		if (!addAdminAddress.trim() || !isOwner) return;

		onStatusChange("building");
		try {
			// TODO: Wire to chain-shared buildAddTreasuryAdmin once available
			// const addresses = getContractAddresses(tenant);
			// const tx = buildAddTreasuryAdmin({
			// 	packageId: addresses.treasury?.packageId ?? "",
			// 	treasuryId: treasury.id,
			// 	adminAddress: addAdminAddress.trim(),
			// 	senderAddress: suiAddress,
			// });
			// await signAndExecute({ transaction: tx });

			// Local update
			const updated = [...treasury.admins, addAdminAddress.trim()];
			await db.treasuries.update(treasury.id, { admins: updated });
			setAddAdminAddress("");
			onStatusChange("done");
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	async function handleRemoveAdmin(addr: string) {
		if (!isOwner) return;

		onStatusChange("building");
		try {
			// TODO: Wire to chain-shared buildRemoveTreasuryAdmin once available
			const updated = treasury.admins.filter((a) => a !== addr);
			await db.treasuries.update(treasury.id, { admins: updated });
			onStatusChange("done");
		} catch (err) {
			onStatusChange("error", err instanceof Error ? err.message : String(err));
		}
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="mb-3 flex items-center justify-between">
				<div>
					<h3 className="text-sm font-bold text-zinc-100">{treasury.name}</h3>
					<div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
						<span>Owner:</span>
						<CopyAddress
							address={treasury.owner}
							sliceStart={10}
							sliceEnd={6}
							className="font-mono text-zinc-400"
						/>
						{isOwner && <span className="text-cyan-400">(you)</span>}
					</div>
				</div>
			</div>

			{/* Admins */}
			<div className="mb-3 border-t border-zinc-800 pt-3">
				<p className="mb-1.5 text-xs font-medium text-zinc-400">
					Admins ({treasury.admins.length})
				</p>
				{treasury.admins.length > 0 ? (
					<div className="mb-2 space-y-1">
						{treasury.admins.map((addr) => (
							<div key={addr} className="flex items-center justify-between">
								<CopyAddress
									address={addr}
									sliceStart={12}
									sliceEnd={6}
									className="font-mono text-xs text-zinc-400"
								/>
								{isOwner && (
									<button
										type="button"
										onClick={() => handleRemoveAdmin(addr)}
										className="text-zinc-600 transition-colors hover:text-red-400"
										title="Remove admin"
									>
										<UserMinus size={12} />
									</button>
								)}
							</div>
						))}
					</div>
				) : (
					<p className="mb-2 text-xs text-zinc-600">No admins added yet.</p>
				)}

				{isOwner && (
					<div className="flex items-center gap-2">
						<input
							type="text"
							value={addAdminAddress}
							onChange={(e) => setAddAdminAddress(e.target.value)}
							placeholder="Admin Sui address (0x...)"
							className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
						/>
						<button
							type="button"
							onClick={handleAddAdmin}
							disabled={!addAdminAddress.trim()}
							className="flex items-center gap-1 rounded bg-cyan-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
						>
							<UserPlus size={12} />
							Add
						</button>
					</div>
				)}
			</div>

			{/* Balances */}
			<div className="border-t border-zinc-800 pt-3">
				<p className="mb-2 text-xs font-medium text-zinc-400">Balances</p>
				{treasury.balances.length > 0 ? (
					<DataGrid
						columns={balanceColumns}
						data={treasury.balances}
						keyFn={(r) => r.coinType}
						searchPlaceholder="Search balances..."
						emptyMessage="No balances."
					/>
				) : (
					<p className="text-xs text-zinc-600">
						No balances yet. Deposit funds or set as toll recipient.
					</p>
				)}
			</div>
		</div>
	);
}

// ── Shared UI Components ─────────────────────────────────────────────

function StatusBanner({
	status,
	error,
	onDismiss,
}: {
	status: BuildStatus;
	error: string;
	onDismiss: () => void;
}) {
	const messages: Record<string, string> = {
		building: "Building and publishing on-chain...",
		error: "Operation failed",
	};

	const isError = status === "error";

	return (
		<div
			className={`mb-6 rounded-lg border p-4 ${
				isError ? "border-red-900/50 bg-red-950/20" : "border-cyan-900/50 bg-cyan-950/20"
			}`}
		>
			<div className="flex items-center gap-2">
				{isError ? (
					<AlertCircle size={16} className="text-red-400" />
				) : (
					<Loader2 size={16} className="animate-spin text-cyan-400" />
				)}
				<span className={`text-sm ${isError ? "text-red-300" : "text-cyan-300"}`}>
					{messages[status] ?? "Processing..."}
				</span>
			</div>
			{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
			{isError && (
				<button
					type="button"
					onClick={onDismiss}
					className="mt-2 text-xs text-zinc-400 hover:text-zinc-300"
				>
					Dismiss
				</button>
			)}
		</div>
	);
}

function StatBox({
	label,
	value,
}: {
	label: string;
	value: string;
}) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5">
			<p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
			<p className="mt-0.5 text-sm font-semibold text-zinc-200">{value}</p>
		</div>
	);
}

function FormField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="block">
			<span className="mb-1 block text-xs text-zinc-500">{label}</span>
			{children}
		</div>
	);
}
