import { useState } from "react";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useLiveQuery } from "dexie-react-hooks";
import {
	Flag,
	Plus,
	Loader2,
	AlertCircle,
	Trash2,
	Edit2,
	MapPin,
	Info,
} from "lucide-react";
import { WalletConnect } from "@/components/WalletConnect";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { db, notDeleted } from "@/db";
import type { SystemClaimRecord, SystemNickname } from "@/db/types";
import {
	buildCreateClaim,
	buildRemoveClaim,
	getContractAddresses,
	type TenantId as ChainTenantId,
} from "@tehfrontier/chain-shared";

type Tab = "claims" | "nicknames";

export function GovernanceClaims() {
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const tenant = useActiveTenant();
	const [tab, setTab] = useState<Tab>("claims");

	const org = useLiveQuery(() => db.organizations.filter(notDeleted).first());
	const claims = useLiveQuery(
		() => org ? db.systemClaims.where("orgId").equals(org.id).filter(notDeleted).toArray() : [],
		[org?.id],
	);
	const nicknames = useLiveQuery(() => db.systemNicknames.toArray());
	const systems = useLiveQuery(() => db.solarSystems.toArray());

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<Flag size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">Select a character to manage claims</p>
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

	return (
		<div className="mx-auto max-w-3xl p-6">
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<Flag size={24} className="text-cyan-500" />
						Claims
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						System sovereignty claims and personal nicknames
					</p>
				</div>
				<WalletConnect />
			</div>

			{/* Tabs */}
			<div className="mb-6 flex gap-1 rounded-lg bg-zinc-900/50 p-1">
				{(["claims", "nicknames"] as Tab[]).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
							tab === t
								? "bg-zinc-800 text-cyan-400"
								: "text-zinc-500 hover:text-zinc-300"
						}`}
					>
						{t === "claims" ? `Governance Claims${claims?.length ? ` (${claims.length})` : ""}` : `Nicknames${nicknames?.length ? ` (${nicknames.length})` : ""}`}
					</button>
				))}
			</div>

			{tab === "claims" && (
				<ClaimsTab
					org={org}
					claims={claims ?? []}
					systems={systems ?? []}
					chainObjectId={org?.chainObjectId}
					tenant={tenant}
				/>
			)}

			{tab === "nicknames" && (
				<NicknamesTab nicknames={nicknames ?? []} systems={systems ?? []} />
			)}
		</div>
	);
}

function ClaimsTab({
	org,
	claims,
	systems,
	chainObjectId,
	tenant,
}: {
	org: { id: string; name: string } | undefined;
	claims: SystemClaimRecord[];
	systems: Array<{ id: number; name?: string }>;
	chainObjectId: string | undefined;
	tenant: string;
}) {
	const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
	const [adding, setAdding] = useState(false);
	const [systemId, setSystemId] = useState("");
	const [claimName, setClaimName] = useState("");
	const [weight, setWeight] = useState(100);
	const [chainWarning, setChainWarning] = useState("");

	if (!org) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
				<AlertCircle size={32} className="text-zinc-600" />
				<p className="text-sm text-zinc-500">
					Create an organization first
				</p>
				<a
					href="/governance"
					className="text-xs text-cyan-400 hover:text-cyan-300"
				>
					Go to Organization →
				</a>
			</div>
		);
	}

	function getSystemName(sid: number): string {
		return systems.find((s) => s.id === sid)?.name ?? `System ${sid}`;
	}

	async function handleAdd() {
		if (!systemId.trim()) return;
		setChainWarning("");

		// Always store locally
		const now = new Date().toISOString();
		await db.systemClaims.add({
			id: crypto.randomUUID(),
			orgId: org!.id,
			systemId: Number(systemId),
			name: claimName.trim() || getSystemName(Number(systemId)),
			status: "active",
			weight,
			createdAt: now,
			updatedAt: now,
		});

		// Attempt chain TX if org is published
		if (chainObjectId) {
			try {
				const addresses = getContractAddresses(
					tenant as ChainTenantId,
				);
				if (
					addresses.governance?.packageId &&
					addresses.governance?.claimsRegistryObjectId
				) {
					const tx = buildCreateClaim(
						addresses.governance.packageId,
						addresses.governance.claimsRegistryObjectId,
						chainObjectId,
						Number(systemId),
						claimName.trim() ||
							getSystemName(Number(systemId)),
						weight,
					);
					await signAndExecute({ transaction: tx });
				}
			} catch (err) {
				setChainWarning(
					`Saved locally, but chain TX failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		setSystemId("");
		setClaimName("");
		setWeight(100);
		setAdding(false);
	}

	async function handleRemove(claimId: string, claim: SystemClaimRecord) {
		setChainWarning("");

		// Always remove locally
		await db.systemClaims.delete(claimId);

		// Attempt chain TX if org is published
		if (chainObjectId) {
			try {
				const addresses = getContractAddresses(
					tenant as ChainTenantId,
				);
				if (
					addresses.governance?.packageId &&
					addresses.governance?.claimsRegistryObjectId
				) {
					const tx = buildRemoveClaim(
						addresses.governance.packageId,
						addresses.governance.claimsRegistryObjectId,
						chainObjectId,
						claim.systemId,
					);
					await signAndExecute({ transaction: tx });
				}
			} catch (err) {
				setChainWarning(
					`Removed locally, but chain TX failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	// Group by contested status
	const contested = new Map<number, SystemClaimRecord[]>();
	for (const c of claims) {
		const list = contested.get(c.systemId) ?? [];
		list.push(c);
		contested.set(c.systemId, list);
	}

	return (
		<div>
			{!chainObjectId && (
				<div className="mb-4 flex items-center gap-1.5 text-xs text-amber-400/80">
					<Info size={12} />
					<span>
						Organization not published to chain yet — changes are
						local only
					</span>
				</div>
			)}

			{chainWarning && (
				<p className="mb-4 text-xs text-amber-400">{chainWarning}</p>
			)}

			{claims.length > 0 && (
				<div className="mb-6 space-y-2">
					{claims.map((c) => (
						<div
							key={c.id}
							className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3"
						>
							<div className="flex items-center gap-3">
								<Flag
									size={14}
									className={
										c.status === "contested"
											? "text-amber-400"
											: "text-cyan-500"
									}
								/>
								<div>
									<span className="text-sm text-zinc-200">
										{c.name}
									</span>
									<span className="ml-2 text-xs text-zinc-600">
										{getSystemName(c.systemId)}
									</span>
								</div>
							</div>
							<div className="flex items-center gap-3">
								<span className="text-xs text-zinc-500">
									Weight: {c.weight}
								</span>
								{c.status === "contested" && (
									<span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-400">
										Contested
									</span>
								)}
								<button
									type="button"
									onClick={() => handleRemove(c.id, c)}
									className="text-zinc-600 transition-colors hover:text-red-400"
								>
									<Trash2 size={14} />
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			{adding ? (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<div className="space-y-3">
						<div>
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">System ID</label>
							<input
								type="number"
								value={systemId}
								onChange={(e) => setSystemId(e.target.value)}
								placeholder="e.g., 30003692"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
						</div>
						<div>
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">Claim Name (optional)</label>
							<input
								type="text"
								value={claimName}
								onChange={(e) => setClaimName(e.target.value)}
								placeholder="e.g., Home Base"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
								maxLength={200}
							/>
						</div>
						<div>
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">Weight</label>
							<input
								type="number"
								value={weight}
								onChange={(e) => setWeight(Number(e.target.value))}
								min={0}
								className="w-32 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
							/>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={handleAdd}
								disabled={!systemId.trim()}
								className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Create Claim
							</button>
							<button
								type="button"
								onClick={() => setAdding(false)}
								className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-300"
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setAdding(true)}
					className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 py-3 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
				>
					<Plus size={16} />
					Claim System
				</button>
			)}
		</div>
	);
}

function NicknamesTab({
	nicknames,
	systems,
}: {
	nicknames: SystemNickname[];
	systems: Array<{ id: number; name?: string }>;
}) {
	const [adding, setAdding] = useState(false);
	const [systemId, setSystemId] = useState("");
	const [nickname, setNickname] = useState("");

	function getSystemName(sid: number): string {
		return systems.find((s) => s.id === sid)?.name ?? `System ${sid}`;
	}

	async function handleAdd() {
		if (!systemId.trim() || !nickname.trim()) return;
		await db.systemNicknames.put({
			id: `nick-${systemId}`,
			systemId: Number(systemId),
			name: nickname.trim(),
		});
		setSystemId("");
		setNickname("");
		setAdding(false);
	}

	async function handleRemove(id: string) {
		await db.systemNicknames.delete(id);
	}

	return (
		<div>
			<p className="mb-4 text-xs text-zinc-600">
				Personal nicknames for star systems. Local only, not shared or synced.
			</p>

			{nicknames.length > 0 && (
				<div className="mb-6 space-y-2">
					{nicknames.map((n) => (
						<div key={n.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
							<div className="flex items-center gap-3">
								<MapPin size={14} className="text-zinc-500" />
								<div>
									<span className="text-sm text-zinc-200">{n.name}</span>
									<span className="ml-2 text-xs text-zinc-600">
										{getSystemName(n.systemId)}
									</span>
								</div>
							</div>
							<button
								type="button"
								onClick={() => handleRemove(n.id)}
								className="text-zinc-600 transition-colors hover:text-red-400"
							>
								<Trash2 size={14} />
							</button>
						</div>
					))}
				</div>
			)}

			{adding ? (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<div className="space-y-3">
						<div>
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">System ID</label>
							<input
								type="number"
								value={systemId}
								onChange={(e) => setSystemId(e.target.value)}
								placeholder="e.g., 30003692"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
							/>
						</div>
						<div>
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">Nickname</label>
							<input
								type="text"
								value={nickname}
								onChange={(e) => setNickname(e.target.value)}
								placeholder="e.g., The Citadel"
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
								maxLength={100}
							/>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={handleAdd}
								disabled={!systemId.trim() || !nickname.trim()}
								className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Save
							</button>
							<button
								type="button"
								onClick={() => setAdding(false)}
								className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-zinc-300"
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setAdding(true)}
					className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 py-3 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
				>
					<Plus size={16} />
					Add Nickname
				</button>
			)}
		</div>
	);
}
