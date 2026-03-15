import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { Loader2, CheckCircle2, AlertCircle, ExternalLink, Crosshair } from "lucide-react";
import { db } from "@/db";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant, useOwnedAssemblies } from "@/hooks/useOwnedAssemblies";
import { useExtensionDeploy } from "@/hooks/useExtensionDeploy";
import { TurretPriorityForm } from "@/components/extensions/TurretPriorityForm";
import { TENANTS } from "@/chain/config";
import { SHIP_CLASSES, TURRET_TYPES, DEFAULT_TURRET_PRIORITY_CONFIG, type TurretPriorityConfig } from "@tehfrontier/chain-shared";

type BuildStatus = "idle" | "building-package" | "authorizing" | "signing" | "done" | "error";

const statusMessages: Record<BuildStatus, string> = {
	idle: "",
	"building-package": "Building & publishing turret package...",
	authorizing: "Building authorize transaction...",
	signing: "Waiting for wallet signature...",
	done: "Turret extension deployed!",
	error: "Deployment failed",
};

export function TurretConfig() {
	const account = useCurrentAccount();
	const { activeCharacter } = useActiveCharacter();
	const suiAddress = activeCharacter?.suiAddress;
	const tenant = useActiveTenant();
	const { data: discovery, isLoading: loadingAssemblies } = useOwnedAssemblies();

	const [selectedTurretId, setSelectedTurretId] = useState<string>("");
	const [config, setConfig] = useState<TurretPriorityConfig>({ ...DEFAULT_TURRET_PRIORITY_CONFIG });
	const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
	const [buildError, setBuildError] = useState<string>("");
	const [txDigest, setTxDigest] = useState<string>("");

	const { deploy, status: deployStatus, error: deployError } = useExtensionDeploy();

	// Filter to turrets only
	const turrets = discovery?.assemblies.filter((a) => a.type === "turret") ?? [];
	const selectedTurret = turrets.find((t) => t.objectId === selectedTurretId);

	// Auto-fill effective classes when turret is selected
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

	const gasStationUrl = TENANTS[tenant].gasStationUrl;
	const isProcessing = buildStatus === "building-package" || buildStatus === "authorizing" || buildStatus === "signing";

	async function handleDeploy() {
		if (!selectedTurret || !account || !discovery?.character) return;

		setBuildStatus("building-package");
		setBuildError("");
		setTxDigest("");

		try {
			// Step 1: Build + publish via gas station
			const buildRes = await fetch(`${gasStationUrl}/build-turret`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(config),
			});

			if (!buildRes.ok) {
				const err = await buildRes.json().catch(() => ({ error: "Build failed" }));
				throw new Error(err.error ?? `Build failed: ${buildRes.status}`);
			}

			const { packageId } = (await buildRes.json()) as { packageId: string };

			// Step 2: Authorize extension on the turret
			setBuildStatus("authorizing");

			// Create a dynamic template for the freshly published package
			const dynamicTemplate = {
				id: "turret_priority_custom",
				name: "Custom Turret Priority",
				description: "Custom-built turret priority extension",
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

			// Store config in extension record
			const now = new Date().toISOString();
			await db.extensions.put({
				id: `${selectedTurret.objectId}-turret_priority_custom`,
				assemblyId: selectedTurret.objectId,
				assemblyType: "turret",
				templateId: "turret_priority_custom",
				templateName: "Custom Turret Priority",
				status: "configured",
				configuration: config as unknown as Record<string, unknown>,
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

	function handleReset() {
		setBuildStatus("idle");
		setBuildError("");
		setTxDigest("");
	}

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
			{/* Header */}
			<div className="mb-6">
				<h1 className="text-xl font-semibold text-zinc-100">Turret Priority Config</h1>
				<p className="mt-1 text-sm text-zinc-500">
					Customize targeting rules, build a Move package, and deploy to your turret.
				</p>
			</div>

			{/* Gas Station Status */}
			{!gasStationUrl && (
				<div className="mb-6 rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
					<p className="text-sm text-amber-400">
						Gas station not configured for {tenant}. Add <code className="text-amber-300">gasStationUrl</code> to tenant config.
					</p>
				</div>
			)}

			{/* Turret Selector */}
			<div className="mb-6">
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					Select Turret
				</label>
				{loadingAssemblies ? (
					<div className="flex items-center gap-2 text-sm text-zinc-500">
						<Loader2 size={14} className="animate-spin" />
						Loading turrets...
					</div>
				) : turrets.length === 0 ? (
					<p className="text-sm text-zinc-600">No turrets found. Deploy a turret in-game first.</p>
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
				{selectedTurret && (
					<p className="mt-1 font-mono text-xs text-zinc-600">{selectedTurret.objectId}</p>
				)}
			</div>

			{/* Config Form */}
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
							{txDigest && (
								<a
									href={`https://suiscan.xyz/testnet/tx/${txDigest}`}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-2 flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
								>
									View on Suiscan <ExternalLink size={12} />
								</a>
							)}
							{(buildStatus === "done" || buildStatus === "error") && (
								<button
									type="button"
									onClick={handleReset}
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
										Could not find OwnerCap for this turret. It may be in your Character keychain.
									</p>
								</div>
							) : (
								<button
									type="button"
									onClick={handleDeploy}
									disabled={!gasStationUrl || isProcessing}
									className="w-full rounded-lg bg-cyan-600 py-3 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
								>
									Build & Deploy Custom Extension
								</button>
							)}
						</div>
					)}
				</>
			)}
		</div>
	);
}
