import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useLiveQuery } from "dexie-react-hooks";
import { Crosshair, Loader2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { TurretPriorityForm } from "@/components/extensions/TurretPriorityForm";
import { useOwnedAssemblies, useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useExtensionDeploy } from "@/hooks/useExtensionDeploy";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { TENANTS } from "@/chain/config";
import { TURRET_TYPES, SHIP_CLASSES, DEFAULT_TURRET_PRIORITY_CONFIG, type TurretPriorityConfig } from "@tehfrontier/chain-shared";
import { db, notDeleted } from "@/db";

type BuildStatus = "idle" | "building-package" | "authorizing" | "signing" | "done" | "error";

const statusMessages: Record<BuildStatus, string> = {
	idle: "",
	"building-package": "Building & publishing turret package...",
	authorizing: "Building authorize transaction...",
	signing: "Waiting for wallet signature...",
	done: "Turret extension deployed!",
	error: "Deployment failed",
};

export function GovernanceTurrets() {
	const account = useCurrentAccount();
	const tenant = useActiveTenant();
	const { activeCharacter } = useActiveCharacter();
	const { data: discovery, isLoading: loadingAssemblies } = useOwnedAssemblies();

	const org = useLiveQuery(() => db.organizations.filter(notDeleted).first());
	const tierMembers = useLiveQuery(
		() => org ? db.orgTierMembers.where("orgId").equals(org.id).filter(notDeleted).toArray() : [],
		[org?.id],
	);

	const [selectedTurretId, setSelectedTurretId] = useState("");
	const [mode, setMode] = useState<"public" | "private">("public");
	const [config, setConfig] = useState<TurretPriorityConfig>({ ...DEFAULT_TURRET_PRIORITY_CONFIG });
	const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
	const [buildError, setBuildError] = useState("");

	const { deploy, error: deployError } = useExtensionDeploy();

	const turrets = discovery?.assemblies.filter((a) => a.type === "turret") ?? [];
	const selectedTurret = turrets.find((t) => t.objectId === selectedTurretId);
	const gasStationUrl = TENANTS[tenant].gasStationUrl;
	const isProcessing = buildStatus === "building-package" || buildStatus === "authorizing" || buildStatus === "signing";

	function handleTurretSelect(turretId: string) {
		setSelectedTurretId(turretId);
		const turret = turrets.find((t) => t.objectId === turretId);
		if (turret) {
			const ttInfo = Object.values(TURRET_TYPES).find((tt) => tt.typeId === turret.typeId);
			if (ttInfo) {
				const effectiveGroupIds: number[] = ttInfo.effective
					.map((key) => SHIP_CLASSES[key]?.groupId)
					.filter((id) => id != null);
				setConfig((prev) => ({ ...prev, effectiveClasses: effectiveGroupIds }));
			}
		}
	}

	async function handleDeploy() {
		if (!selectedTurret || !account || !discovery?.character || !gasStationUrl) return;

		if (org && !org.chainObjectId) {
			setBuildError(
				"Publish your organization to chain first (Governance \u2192 Create)",
			);
			return;
		}

		setBuildStatus("building-package");
		setBuildError("");

		try {
			// Build via governance turret endpoint if org exists, otherwise standard
			const endpoint = org
				? `${gasStationUrl}/build-governance-turret`
				: `${gasStationUrl}/build-turret`;

			const body = org
				? { orgObjectId: org.chainObjectId ?? org.id, mode, turretType: String(selectedTurret.typeId), weightOverrides: config }
				: config;

			const buildRes = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (!buildRes.ok) {
				const err = await buildRes.json().catch(() => ({ error: "Build failed" }));
				throw new Error(err.error ?? `Build failed: ${buildRes.status}`);
			}

			const { packageId } = (await buildRes.json()) as { packageId: string };

			setBuildStatus("authorizing");

			const dynamicTemplate = {
				id: "turret_priority_custom",
				name: org ? `${org.name} Turret (${mode})` : "Custom Turret Priority",
				description: org ? `Governance turret for ${org.name}` : "Custom-built turret priority extension",
				assemblyTypes: ["turret" as const],
				hasConfig: false,
				packageIds: { [tenant]: packageId },
				configObjectIds: {},
				witnessType: "turret_priority::TurretPriorityAuth",
			};

			setBuildStatus("signing");

			await deploy({
				template: dynamicTemplate,
				assemblyId: selectedTurret.objectId,
				assemblyType: "turret",
				characterId: discovery.character.characterObjectId,
				ownerCapId: selectedTurret.ownerCapId!,
				tenant,
			});

			setBuildStatus("done");

			const now = new Date().toISOString();
			await db.extensions.put({
				id: `${selectedTurret.objectId}-turret_priority_custom`,
				assemblyId: selectedTurret.objectId,
				assemblyType: "turret",
				templateId: "turret_priority_custom",
				templateName: org ? `${org.name} Turret (${mode})` : "Custom Turret Priority",
				status: "configured",
				configuration: { ...config, orgMode: mode, orgId: org?.id } as unknown as Record<string, unknown>,
				authorizedAt: now,
				owner: suiAddress,
				createdAt: now,
				updatedAt: now,
			});
		} catch (err) {
			setBuildStatus("error");
			setBuildError(err instanceof Error ? err.message : String(err));
		}
	}

	const suiAddress = activeCharacter?.suiAddress;

	if (!activeCharacter || !suiAddress) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<Crosshair size={48} className="mx-auto mb-4 text-zinc-700" />
					<p className="text-sm text-zinc-500">Select a character to configure turrets</p>
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
		<div className="mx-auto max-w-2xl p-6">
			<div className="mb-6">
				<h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-100">
					<Crosshair size={20} className="text-cyan-500" />
					Governance Turrets
				</h1>
				<p className="mt-1 text-sm text-zinc-500">
					{org
						? `Configure turret targeting from ${org.name} membership`
						: "Build custom turret priority extensions"}
				</p>
			</div>

			{!gasStationUrl && (
				<div className="mb-6 rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
					<p className="text-sm text-amber-400">
						Gas station not configured for this server.
					</p>
				</div>
			)}

			{/* Mode toggle (only with org) */}
			{org && (
				<div className="mb-6">
					<label className="mb-1.5 block text-xs font-medium text-zinc-400">Targeting Mode</label>
					<div className="flex gap-2">
						{(["public", "private"] as const).map((m) => (
							<button
								key={m}
								type="button"
								onClick={() => setMode(m)}
								className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
									mode === m
										? "bg-cyan-600/20 text-cyan-400"
										: "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
								}`}
							>
								{m === "public" ? "Public" : "Private"}
							</button>
						))}
					</div>
					<p className="mt-1.5 text-xs text-zinc-600">
						{mode === "public"
							? "Shoot opposition, protect all friendly tiers"
							: "Only protect friendly tiers, hostile to everyone else"}
					</p>
				</div>
			)}

			{/* Turret Selector */}
			<div className="mb-6">
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">Select Turret</label>
				{loadingAssemblies ? (
					<div className="flex items-center gap-2 text-sm text-zinc-500">
						<Loader2 size={14} className="animate-spin" />
						Loading turrets...
					</div>
				) : turrets.length === 0 ? (
					<p className="text-sm text-zinc-600">No turrets found.</p>
				) : (
					<select
						value={selectedTurretId}
						onChange={(e) => handleTurretSelect(e.target.value)}
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
					>
						<option value="">Choose a turret...</option>
						{turrets.map((t) => {
							const ttInfo = Object.values(TURRET_TYPES).find((tt) => tt.typeId === t.typeId);
							return (
								<option key={t.objectId} value={t.objectId}>
									{ttInfo?.label ?? `Turret (${t.typeId})`} — {t.objectId.slice(0, 10)}...
								</option>
							);
						})}
					</select>
				)}
			</div>

			{/* Org membership preview */}
			{org && tierMembers && selectedTurret && (
				<div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<h3 className="mb-2 text-xs font-medium text-zinc-400">Resolved from Organization</h3>
					<div className="space-y-1 text-xs">
						<div className="flex justify-between">
							<span className="text-green-400">Friendly tribes:</span>
							<span className="text-zinc-300">
								{[
									...new Set([
										...(tierMembers.filter((m) => m.tier !== "opposition" && m.kind === "tribe").map((m) => m.tribeId)),
									]),
								].filter(Boolean).length}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-green-400">Friendly characters:</span>
							<span className="text-zinc-300">
								{tierMembers.filter((m) => m.tier !== "opposition" && m.kind === "character").length}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-red-400">KOS tribes:</span>
							<span className="text-zinc-300">
								{tierMembers.filter((m) => m.tier === "opposition" && m.kind === "tribe").length}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-red-400">KOS characters:</span>
							<span className="text-zinc-300">
								{tierMembers.filter((m) => m.tier === "opposition" && m.kind === "character").length}
							</span>
						</div>
					</div>
				</div>
			)}

			{/* Config Form (weight tuning) */}
			{selectedTurret && (
				<>
					<TurretPriorityForm
						config={config}
						onChange={setConfig}
						turretTypeId={selectedTurret.typeId}
					/>

					{/* Status Feedback */}
					{buildStatus !== "idle" && (
						<div
							className={`mt-6 rounded-lg border p-4 ${
								buildStatus === "done"
									? "border-green-900/50 bg-green-950/20"
									: buildStatus === "error"
										? "border-red-900/50 bg-red-950/20"
										: "border-cyan-900/50 bg-cyan-950/20"
							}`}
						>
							<div className="flex items-center gap-2">
								{buildStatus === "done" && <CheckCircle2 size={16} className="text-green-400" />}
								{buildStatus === "error" && <AlertCircle size={16} className="text-red-400" />}
								{isProcessing && <Loader2 size={16} className="animate-spin text-cyan-400" />}
								<span
									className={`text-sm ${
										buildStatus === "done"
											? "text-green-300"
											: buildStatus === "error"
												? "text-red-300"
												: "text-cyan-300"
									}`}
								>
									{statusMessages[buildStatus]}
								</span>
							</div>
							{buildError && <p className="mt-2 text-xs text-red-400">{buildError}</p>}
							{deployError && <p className="mt-2 text-xs text-red-400">{deployError}</p>}
							{(buildStatus === "done" || buildStatus === "error") && (
								<button
									type="button"
									onClick={() => { setBuildStatus("idle"); setBuildError(""); }}
									className="mt-3 text-xs text-zinc-400 hover:text-zinc-300"
								>
									{buildStatus === "done" ? "Configure another" : "Try again"}
								</button>
							)}
						</div>
					)}

					{/* Deploy Button */}
					{buildStatus === "idle" && (
						<div className="mt-6">
							{!selectedTurret.ownerCapId ? (
								<div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
									<p className="text-xs text-amber-400">
										Could not find OwnerCap for this turret.
									</p>
								</div>
							) : (
								<button
									type="button"
									onClick={handleDeploy}
									disabled={!gasStationUrl || isProcessing}
									className="w-full rounded-lg bg-cyan-600 py-3 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
								>
									Build & Deploy {org ? `${mode === "public" ? "Public" : "Private"} Governance` : "Custom"} Turret
								</button>
							)}
						</div>
					)}
				</>
			)}
		</div>
	);
}
