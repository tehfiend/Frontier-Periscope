import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "@tanstack/react-router";
import {
	ShieldCheck,
	Shield,
	Plus,
	AlertTriangle,
	UserX,
} from "lucide-react";

import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { GroupCard } from "@/components/permissions/GroupCard";
import { GroupEditor } from "@/components/permissions/GroupEditor";
import { PolicyCard } from "@/components/permissions/PolicyCard";
import { BetrayalAlertBanner, ReportBetrayalDialog } from "@/components/permissions/BetrayalAlertBanner";
import { usePermissionGroups } from "@/hooks/usePermissionGroups";
import { useAssemblyPolicies } from "@/hooks/useAssemblyPolicies";
import { usePermissionSync } from "@/hooks/usePermissionSync";
import { useBetrayalResponse } from "@/hooks/useBetrayalResponse";
import { useKillmailMonitor } from "@/hooks/useKillmailMonitor";
import { useOwnedAssemblies, useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { db, notDeleted } from "@/db";
import type { PermissionGroup, MemberKind, GroupMember, BetrayalAlert } from "@/db/types";

type Tab = "groups" | "policies";

export function Permissions() {
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const navigate = useNavigate();
	const [tab, setTab] = useState<Tab>("groups");
	const [editingGroup, setEditingGroup] = useState<PermissionGroup | null>(null);
	const [isCreating, setIsCreating] = useState(false);
	const [showReportDialog, setShowReportDialog] = useState(false);

	const {
		groups,
		members,
		getMembersForGroup,
		createGroup,
		updateGroup,
		deleteGroup,
		addMember,
		removeMember,
	} = usePermissionGroups();

	const {
		policies,
		getPoliciesByType,
		updatePolicy,
		createPolicy,
	} = useAssemblyPolicies();

	const { syncPolicy, isSyncing } = usePermissionSync();
	const tenant = useActiveTenant();
	const { data: assemblyData } = useOwnedAssemblies();
	const extensions = useLiveQuery(() => db.extensions.filter(notDeleted).toArray()) ?? [];

	// Betrayal detection & response
	const {
		pendingAlerts,
		revokeAndBlacklist,
		reportBetrayal,
		dismissAlert,
		dismissAll,
	} = useBetrayalResponse();

	// Background killmail monitoring — cross-references against friendly groups
	useKillmailMonitor();

	const assemblies = assemblyData?.assemblies ?? [];

	// Find which assemblies have ACL extensions
	function assemblyHasAclExtension(assemblyId: string): boolean {
		return extensions.some(
			(e) =>
				e.assemblyId === assemblyId &&
				(e.templateId === "gate_acl" || e.templateId === "turret_acl"),
		);
	}

	// Count policies per group
	function policyCountForGroup(groupId: string): number {
		return policies.filter((p) => p.groupIds.includes(groupId)).length;
	}

	async function handleSaveGroup(data: { name: string; color: string; description?: string }) {
		if (editingGroup) {
			await updateGroup(editingGroup.id, data);
		} else {
			await createGroup(data);
		}
		setEditingGroup(null);
		setIsCreating(false);
	}

	async function handleDeleteGroup(groupId: string) {
		const count = policyCountForGroup(groupId);
		if (count > 0) {
			const ok = window.confirm(
				`This group is used by ${count} polic${count === 1 ? "y" : "ies"}. Removing it will mark those policies as dirty. Continue?`,
			);
			if (!ok) return;
		}
		await deleteGroup(groupId);
	}

	async function handleAddMember(data: {
		kind: MemberKind;
		characterName?: string;
		characterId?: number;
		suiAddress?: string;
		tribeId?: number;
		tribeName?: string;
	}) {
		if (!editingGroup) return;
		await addMember({ groupId: editingGroup.id, ...data });
	}

	async function handleMarkHostile(member: GroupMember) {
		const label = member.kind === "character"
			? (member.characterName ?? `#${member.characterId}`)
			: (member.tribeName ?? `Tribe #${member.tribeId}`);

		const ok = window.confirm(
			`Revoke & Blacklist "${label}"?\n\nThis will:\n- Remove them from all friendly groups\n- Add them to the KOS group\n- Mark all affected policies as dirty`,
		);
		if (!ok) return;

		await revokeAndBlacklist({
			characterId: member.characterId,
			characterName: member.characterName,
			suiAddress: member.suiAddress,
			tribeId: member.tribeId,
			tribeName: member.tribeName,
		});
	}

	async function handleRevokeFromAlert(alert: BetrayalAlert) {
		await revokeAndBlacklist({
			characterId: alert.attackerCharacterId,
			characterName: alert.attackerName,
			suiAddress: alert.attackerAddress,
			tribeId: alert.attackerTribeId,
			alertId: alert.id,
		});
	}

	async function handleReportBetrayal(params: {
		characterId?: number;
		characterName?: string;
		suiAddress?: string;
		tribeId?: number;
	}) {
		await reportBetrayal(params);
	}

	// Auto-create policies for owned assemblies that have ACL extensions but no policy
	const missingPolicies = assemblies.filter(
		(a) =>
			assemblyHasAclExtension(a.objectId) &&
			!policies.some((p) => p.assemblyId === a.objectId),
	);

	const gatePolicies = getPoliciesByType("gate");
	const turretPolicies = getPoliciesByType("turret");

	return (
		<div className="mx-auto max-w-3xl p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<ShieldCheck size={24} className="text-cyan-500" />
						Permissions
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						Manage who can access your smart assemblies
					</p>
				</div>
				<button
					type="button"
					onClick={() => setShowReportDialog(true)}
					className="flex items-center gap-1.5 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-900/40 hover:text-red-300"
					title="Manually report a hostile player or tribe"
				>
					<UserX size={14} />
					Report Hostile
				</button>
			</div>

			{/* Betrayal Alerts */}
			<BetrayalAlertBanner
				alerts={pendingAlerts}
				groups={groups}
				onRevokeAndBlacklist={handleRevokeFromAlert}
				onDismiss={dismissAlert}
				onDismissAll={dismissAll}
			/>

			{/* Tabs */}
			<div className="mb-6 flex gap-1 rounded-lg bg-zinc-900/50 p-1">
				{(["groups", "policies"] as Tab[]).map((t) => (
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
						{t === "groups" ? "Groups" : "Policies"}
					</button>
				))}
			</div>

			{/* Groups Tab */}
			{tab === "groups" && (
				<div className="space-y-3">
					{groups.map((group) => (
						<GroupCard
							key={group.id}
							group={group}
							members={getMembersForGroup(group.id)}
							usedByCount={policyCountForGroup(group.id)}
							onEdit={
								group.isBuiltin
									? undefined
									: () => setEditingGroup(group)
							}
							onDelete={
								group.isBuiltin
									? undefined
									: () => handleDeleteGroup(group.id)
							}
							onMarkHostile={handleMarkHostile}
						/>
					))}

					<button
						type="button"
						onClick={() => setIsCreating(true)}
						className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 py-3 text-sm text-zinc-500 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
					>
						<Plus size={16} />
						Create Group
					</button>
				</div>
			)}

			{/* Policies Tab */}
			{tab === "policies" && (
				<div className="space-y-6">
					{!account && (
						<div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-xs text-zinc-500">
							<Shield size={14} />
							<span>Connect wallet to sync policies to chain</span>
						</div>
					)}

					{/* Auto-create missing policies */}
					{missingPolicies.length > 0 && (
						<div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
							<div className="flex items-center gap-2 text-xs text-amber-400">
								<AlertTriangle size={14} />
								{missingPolicies.length} assembl{missingPolicies.length === 1 ? "y has" : "ies have"} ACL extensions but no policy configured.
							</div>
							<button
								type="button"
								onClick={async () => {
									for (const a of missingPolicies) {
										await createPolicy({
											assemblyId: a.objectId,
											assemblyType: a.type,
											extensionTemplateId: a.type === "gate" ? "gate_acl" : "turret_acl",
										});
									}
								}}
								className="mt-2 text-xs text-cyan-400 hover:text-cyan-300"
							>
								Create default policies &rarr;
							</button>
						</div>
					)}

					{/* Gate policies */}
					{gatePolicies.length > 0 && (
						<div>
							<h2 className="mb-3 text-sm font-medium text-zinc-400">
								Gates ({gatePolicies.length})
							</h2>
							<div className="space-y-3">
								{gatePolicies.map((policy) => (
									<PolicyCard
										key={policy.id}
										policy={policy}
										assembly={assemblies.find((a) => a.objectId === policy.assemblyId)}
										groups={groups}
										hasExtension={assemblyHasAclExtension(policy.assemblyId)}
										isSyncing={isSyncing}
										onUpdatePolicy={(data) => updatePolicy(policy.assemblyId, data)}
										onSync={() => syncPolicy(policy.assemblyId, tenant)}
										onGoToExtensions={() => navigate({ to: "/extensions" })}
									/>
								))}
							</div>
						</div>
					)}

					{/* Turret policies */}
					{turretPolicies.length > 0 && (
						<div>
							<h2 className="mb-3 text-sm font-medium text-zinc-400">
								Turrets ({turretPolicies.length})
							</h2>
							<div className="space-y-3">
								{turretPolicies.map((policy) => (
									<PolicyCard
										key={policy.id}
										policy={policy}
										assembly={assemblies.find((a) => a.objectId === policy.assemblyId)}
										groups={groups}
										hasExtension={assemblyHasAclExtension(policy.assemblyId)}
										isSyncing={isSyncing}
										onUpdatePolicy={(data) => updatePolicy(policy.assemblyId, data)}
										onSync={() => syncPolicy(policy.assemblyId, tenant)}
										onGoToExtensions={() => navigate({ to: "/extensions" })}
									/>
								))}
							</div>
						</div>
					)}

					{policies.length === 0 && missingPolicies.length === 0 && (
						<div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 py-12">
							<ShieldCheck size={48} className="text-zinc-700" />
							<p className="text-sm text-zinc-500">
								No assembly policies configured yet
							</p>
							<p className="text-xs text-zinc-600">
								Deploy an ACL extension on your assemblies first, then configure permissions here
							</p>
						</div>
					)}
				</div>
			)}

			{/* Group editor panel */}
			{(editingGroup || isCreating) && (
				<GroupEditor
					group={editingGroup ?? undefined}
					members={editingGroup ? getMembersForGroup(editingGroup.id) : []}
					onSave={handleSaveGroup}
					onAddMember={handleAddMember}
					onRemoveMember={removeMember}
					onClose={() => {
						setEditingGroup(null);
						setIsCreating(false);
					}}
				/>
			)}

			{/* Report Hostile dialog */}
			<ReportBetrayalDialog
				open={showReportDialog}
				onClose={() => setShowReportDialog(false)}
				onReport={handleReportBetrayal}
			/>
		</div>
	);
}
