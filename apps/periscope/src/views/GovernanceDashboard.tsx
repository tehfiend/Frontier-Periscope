import { useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { useLiveQuery } from "dexie-react-hooks";
import {
	Building2,
	Plus,
	Loader2,
	Users,
	Shield,
	Crown,
	Crosshair,
	Coins,
	Flag,
	ShoppingBag,
	AlertCircle,
	Trash2,
	Info,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { WalletConnect } from "@/components/WalletConnect";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { db, notDeleted } from "@/db";
import type { OrgTier, OrgTierMember } from "@/db/types";
import {
	buildCreateOrg,
	buildAddToTier,
	buildRemoveFromTier,
	getContractAddresses,
	type TenantId as ChainTenantId,
} from "@tehfrontier/chain-shared";

const tierConfig = {
	stakeholder: { label: "Stakeholders", icon: Crown, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
	member: { label: "Members", icon: Users, color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/30" },
	serf: { label: "Serfs", icon: Shield, color: "text-zinc-400", bg: "bg-zinc-500/10", border: "border-zinc-500/30" },
	opposition: { label: "Opposition", icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
} as const;

export function GovernanceDashboard() {
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const tenant = useActiveTenant();

	const org = useLiveQuery(() =>
		db.organizations.filter(notDeleted).first(),
	);
	const tierMembers = useLiveQuery(() =>
		org ? db.orgTierMembers.where("orgId").equals(org.id).filter(notDeleted).toArray() : [],
		[org?.id],
	);

	const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
	const suiClient = useSuiClient();

	const [creating, setCreating] = useState(false);
	const [orgName, setOrgName] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState("");

	const address = activeCharacter?.suiAddress ?? account?.address;

	// Determine if sole proprietorship mode
	const isSoleProp = org && tierMembers
		? tierMembers.filter((m) => m.tier === "stakeholder").length <= 1 &&
		  tierMembers.filter((m) => m.tier === "member").length === 0 &&
		  tierMembers.filter((m) => m.tier === "serf").length === 0
		: false;

	async function handleCreateOrg() {
		if (!orgName.trim() || !address) return;
		setIsSubmitting(true);
		setError("");

		try {
			const addresses = getContractAddresses(tenant as ChainTenantId);
			if (!addresses.governance?.packageId) {
				throw new Error(
					"Governance contracts not deployed for this server",
				);
			}

			// Build and execute the on-chain create_and_share TX
			const tx = buildCreateOrg(
				addresses.governance.packageId,
				orgName.trim(),
			);
			const result = await signAndExecute({ transaction: tx });

			// Fetch full TX response to get objectChanges
			const txResponse = await suiClient.waitForTransaction({
				digest: result.digest,
				options: { showObjectChanges: true },
			});

			// Extract the Organization object ID from objectChanges
			const orgCreated = txResponse.objectChanges?.find(
				(change) =>
					change.type === "created" &&
					change.objectType.includes("::org::Organization"),
			);
			const chainObjectId =
				orgCreated && orgCreated.type === "created"
					? orgCreated.objectId
					: undefined;

			// Store locally with the chain object ID
			const now = new Date().toISOString();
			const id = crypto.randomUUID();
			await db.organizations.add({
				id,
				name: orgName.trim(),
				chainObjectId,
				creator: address,
				createdAt: now,
				updatedAt: now,
			});

			// Add creator as stakeholder
			await db.orgTierMembers.add({
				id: crypto.randomUUID(),
				orgId: id,
				tier: "stakeholder",
				kind: "character",
				suiAddress: address,
				characterName: activeCharacter?.characterName,
				characterId: activeCharacter?.characterId
					? Number(activeCharacter.characterId)
					: undefined,
				createdAt: now,
			});

			setOrgName("");
			setCreating(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsSubmitting(false);
		}
	}

	// No wallet / character
	if (!address) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<Header />
				<div className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
					<Building2 size={48} className="text-zinc-700" />
					<p className="text-sm text-zinc-500">Connect your wallet to manage your organization</p>
					<WalletConnect />
				</div>
			</div>
		);
	}

	// No org yet
	if (!org) {
		return (
			<div className="mx-auto max-w-3xl p-6">
				<Header />
				{creating ? (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
						<h2 className="mb-4 text-lg font-medium text-zinc-100">Create Organization</h2>
						<div className="mb-4">
							<label className="mb-1.5 block text-xs font-medium text-zinc-400">
								Organization Name
							</label>
							<input
								type="text"
								value={orgName}
								onChange={(e) => setOrgName(e.target.value)}
								placeholder="Enter organization name..."
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
								maxLength={100}
								autoFocus
							/>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={handleCreateOrg}
								disabled={!orgName.trim() || isSubmitting}
								className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{isSubmitting ? (
									<span className="flex items-center gap-2">
										<Loader2 size={14} className="animate-spin" /> Creating...
									</span>
								) : (
									"Create"
								)}
							</button>
							<button
								type="button"
								onClick={() => setCreating(false)}
								className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-300"
							>
								Cancel
							</button>
						</div>
						{error && (
							<p className="mt-3 text-xs text-red-400">{error}</p>
						)}
					</div>
				) : (
					<div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/30 py-16">
						<Building2 size={48} className="text-zinc-700" />
						<p className="text-sm text-zinc-500">No organization found</p>
						<button
							type="button"
							onClick={() => setCreating(true)}
							className="flex items-center gap-2 rounded-lg bg-cyan-600/20 px-4 py-2 text-sm font-medium text-cyan-400 transition-colors hover:bg-cyan-600/30"
						>
							<Plus size={16} />
							Create Organization
						</button>
					</div>
				)}
			</div>
		);
	}

	// Has org — show dashboard
	const membersPerTier = (tier: OrgTier) =>
		(tierMembers ?? []).filter((m) => m.tier === tier);

	return (
		<div className="mx-auto max-w-3xl p-6">
			<Header orgName={org.name} />

			{/* Quick Actions */}
			<div className="mb-6 grid grid-cols-4 gap-3">
				<QuickAction to="/governance/turrets" icon={Crosshair} label="Turrets" />
				<QuickAction to="/governance/finance" icon={Coins} label="Finance" />
				<QuickAction to="/governance/trade" icon={ShoppingBag} label="Trade" />
				<QuickAction to="/governance/claims" icon={Flag} label="Claims" />
			</div>

			{/* Sole Prop Banner */}
			{isSoleProp && (
				<div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-500">
					Operating as <span className="text-zinc-300">Sole Proprietorship</span> — add members to enable full organization features.
				</div>
			)}

			{/* Tier Panels */}
			{isSoleProp ? (
				// Simplified: just show opposition panel
				<TierPanel
					tier="opposition"
					members={membersPerTier("opposition")}
					orgId={org.id}
					chainObjectId={org.chainObjectId}
					tenant={tenant}
				/>
			) : (
				// Full view: all four tiers
				<div className="space-y-4">
					{(["stakeholder", "member", "serf", "opposition"] as OrgTier[]).map((tier) => (
						<TierPanel
							key={tier}
							tier={tier}
							members={membersPerTier(tier)}
							orgId={org.id}
							chainObjectId={org.chainObjectId}
							tenant={tenant}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function Header({ orgName }: { orgName?: string }) {
	return (
		<div className="mb-6 flex items-center justify-between">
			<div>
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<Building2 size={24} className="text-cyan-500" />
					{orgName ?? "Governance"}
				</h1>
				<p className="mt-1 text-sm text-zinc-500">
					{orgName ? "Organization Dashboard" : "Manage your governance organization"}
				</p>
			</div>
			<WalletConnect />
		</div>
	);
}

function QuickAction({ to, icon: Icon, label }: { to: string; icon: typeof Crosshair; label: string }) {
	return (
		<Link
			to={to}
			className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
		>
			<Icon size={16} className="text-cyan-500" />
			{label}
		</Link>
	);
}

function TierPanel({
	tier,
	members,
	orgId,
	chainObjectId,
	tenant,
}: {
	tier: OrgTier;
	members: OrgTierMember[];
	orgId: string;
	chainObjectId: string | undefined;
	tenant: string;
}) {
	const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
	const [adding, setAdding] = useState(false);
	const [addKind, setAddKind] = useState<"character" | "tribe">("character");
	const [addValue, setAddValue] = useState("");
	const [addName, setAddName] = useState("");
	const [chainWarning, setChainWarning] = useState("");

	const cfg = tierConfig[tier];
	const Icon = cfg.icon;

	async function handleAdd() {
		if (!addValue.trim()) return;
		setChainWarning("");

		// Always store locally
		const now = new Date().toISOString();
		await db.orgTierMembers.add({
			id: crypto.randomUUID(),
			orgId,
			tier,
			kind: addKind,
			...(addKind === "character"
				? {
						characterId: Number(addValue) || undefined,
						characterName: addName || undefined,
						suiAddress: addValue.startsWith("0x")
							? addValue
							: undefined,
					}
				: {
						tribeId: Number(addValue) || undefined,
						tribeName: addName || undefined,
					}),
			createdAt: now,
		});

		// Attempt chain TX if org is published
		if (chainObjectId) {
			try {
				const addresses = getContractAddresses(
					tenant as ChainTenantId,
				);
				if (addresses.governance?.packageId) {
					const entities =
						addKind === "tribe"
							? { tribeIds: [Number(addValue)] }
							: addValue.startsWith("0x")
								? { addresses: [addValue] }
								: { characterIds: [Number(addValue)] };
					const tx = buildAddToTier(
						addresses.governance.packageId,
						chainObjectId,
						tier,
						entities,
					);
					await signAndExecute({ transaction: tx });
				}
			} catch (err) {
				setChainWarning(
					`Saved locally, but chain TX failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		setAddValue("");
		setAddName("");
		setAdding(false);
	}

	async function handleRemove(memberId: string, member: OrgTierMember) {
		setChainWarning("");

		// Always remove locally
		await db.orgTierMembers.delete(memberId);

		// Attempt chain TX if org is published
		if (chainObjectId) {
			try {
				const addresses = getContractAddresses(
					tenant as ChainTenantId,
				);
				if (addresses.governance?.packageId) {
					const entities =
						member.kind === "tribe" && member.tribeId
							? { tribeIds: [member.tribeId] }
							: member.suiAddress
								? { addresses: [member.suiAddress] }
								: member.characterId
									? { characterIds: [member.characterId] }
									: {};
					const tx = buildRemoveFromTier(
						addresses.governance.packageId,
						chainObjectId,
						tier,
						entities,
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

	return (
		<div className={`rounded-lg border ${cfg.border} ${cfg.bg} p-4`}>
			<div className="mb-3 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Icon size={16} className={cfg.color} />
					<span className={`text-sm font-medium ${cfg.color}`}>
						{cfg.label}
					</span>
					<span className="text-xs text-zinc-600">
						({members.length})
					</span>
				</div>
				<button
					type="button"
					onClick={() => setAdding(!adding)}
					className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
				>
					{adding ? "Cancel" : "+ Add"}
				</button>
			</div>

			{!chainObjectId && (
				<div className="mb-2 flex items-center gap-1.5 text-xs text-amber-400/80">
					<Info size={12} />
					<span>
						Organization not published to chain yet — changes are
						local only
					</span>
				</div>
			)}

			{chainWarning && (
				<p className="mb-2 text-xs text-amber-400">{chainWarning}</p>
			)}

			{adding && (
				<div className="mb-3 flex gap-2">
					<select
						value={addKind}
						onChange={(e) =>
							setAddKind(
								e.target.value as "character" | "tribe",
							)
						}
						className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300"
					>
						<option value="character">Character</option>
						<option value="tribe">Tribe</option>
					</select>
					<input
						type="text"
						value={addValue}
						onChange={(e) => setAddValue(e.target.value)}
						placeholder={
							addKind === "character"
								? "Character ID or address"
								: "Tribe ID"
						}
						className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
					<input
						type="text"
						value={addName}
						onChange={(e) => setAddName(e.target.value)}
						placeholder="Name (optional)"
						className="w-32 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
					<button
						type="button"
						onClick={handleAdd}
						disabled={!addValue.trim()}
						className="rounded bg-cyan-600/20 px-3 py-1.5 text-xs text-cyan-400 transition-colors hover:bg-cyan-600/30 disabled:opacity-40"
					>
						Add
					</button>
				</div>
			)}

			{members.length === 0 ? (
				<p className="text-xs text-zinc-600">
					No {cfg.label.toLowerCase()} yet
				</p>
			) : (
				<div className="space-y-1">
					{members.map((m) => (
						<div
							key={m.id}
							className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-zinc-800/30"
						>
							<div className="flex items-center gap-2">
								<span className="text-zinc-300">
									{m.kind === "character"
										? (m.characterName ??
											m.suiAddress?.slice(0, 10) ??
											`#${m.characterId}`)
										: (m.tribeName ??
											`Tribe #${m.tribeId}`)}
								</span>
								<span className="text-zinc-600">
									{m.kind}
								</span>
							</div>
							<button
								type="button"
								onClick={() => handleRemove(m.id, m)}
								className="text-zinc-600 transition-colors hover:text-red-400"
								title="Remove"
							>
								<Trash2 size={12} />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
