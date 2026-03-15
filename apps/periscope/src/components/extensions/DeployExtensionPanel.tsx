import { useState } from "react";
import { X, Loader2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { TemplateCard } from "./TemplateCard";
import { ConfigForm, type ConfigValues } from "./ConfigForm";
import { getTemplatesForAssemblyType, type ExtensionTemplate, type TenantId } from "@/chain/config";
import { useExtensionDeploy, type DeployStatus } from "@/hooks/useExtensionDeploy";
import type { OwnedAssembly } from "@/chain/queries";

interface DeployExtensionPanelProps {
	assembly: OwnedAssembly;
	characterId: string;
	tenant: TenantId;
	onClose: () => void;
}

const statusMessages: Record<DeployStatus, string> = {
	idle: "",
	building: "Building transaction...",
	signing: "Waiting for wallet signature...",
	confirming: "Confirming on-chain...",
	done: "Extension deployed successfully!",
	error: "Deployment failed",
};

export function DeployExtensionPanel({
	assembly,
	characterId,
	tenant,
	onClose,
}: DeployExtensionPanelProps) {
	const templates = getTemplatesForAssemblyType(assembly.type);
	const [selected, setSelected] = useState<ExtensionTemplate | null>(null);
	const [config, setConfig] = useState<ConfigValues>({});
	const { deploy, reset, status, txDigest, error } = useExtensionDeploy();

	const isDeploying = status === "building" || status === "signing" || status === "confirming";

	function handleDeploy() {
		if (!selected || !assembly.ownerCapId) return;

		deploy({
			template: selected,
			assemblyId: assembly.objectId,
			assemblyType: assembly.type,
			characterId,
			ownerCapId: assembly.ownerCapId,
			tenant,
			config: selected.hasConfig ? {
				allowedTribes: config.allowedTribes,
				permitDurationMs: config.permitDurationMs,
			} : undefined,
		});
	}

	function handleBack() {
		reset();
		setSelected(null);
		setConfig({});
	}

	const packageAvailable = selected?.packageIds[tenant];

	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
			<div
				className="h-full w-full max-w-lg overflow-y-auto bg-zinc-950 border-l border-zinc-800 p-6"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="mb-6 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-zinc-100">
						Deploy Extension
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
					>
						<X size={20} />
					</button>
				</div>

				{/* Assembly info */}
				<div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
					<p className="text-xs text-zinc-500">Target Assembly</p>
					<p className="text-sm text-zinc-200 capitalize">{assembly.type.replace("_", " ")}</p>
					<p className="mt-0.5 font-mono text-xs text-zinc-600">{assembly.objectId}</p>
				</div>

				{/* Status feedback */}
				{status !== "idle" && (
					<div className={`mb-6 rounded-lg border p-4 ${
						status === "done"
							? "border-green-900/50 bg-green-950/20"
							: status === "error"
								? "border-red-900/50 bg-red-950/20"
								: "border-cyan-900/50 bg-cyan-950/20"
					}`}>
						<div className="flex items-center gap-2">
							{status === "done" && <CheckCircle2 size={16} className="text-green-400" />}
							{status === "error" && <AlertCircle size={16} className="text-red-400" />}
							{isDeploying && <Loader2 size={16} className="animate-spin text-cyan-400" />}
							<span className={`text-sm ${
								status === "done" ? "text-green-300" : status === "error" ? "text-red-300" : "text-cyan-300"
							}`}>
								{statusMessages[status]}
							</span>
						</div>
						{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
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
						{(status === "done" || status === "error") && (
							<button
								type="button"
								onClick={handleBack}
								className="mt-3 text-xs text-zinc-400 hover:text-zinc-300"
							>
								{status === "done" ? "Deploy another" : "Try again"}
							</button>
						)}
					</div>
				)}

				{/* Template selection */}
				{!selected ? (
					<div>
						<h3 className="mb-3 text-sm font-medium text-zinc-400">
							Available Templates
						</h3>
						<div className="space-y-3">
							{templates.map((template) => (
								<TemplateCard
									key={template.id}
									template={template}
									tenant={tenant}
									onClick={() => setSelected(template)}
								/>
							))}
							{templates.length === 0 && (
								<p className="text-sm text-zinc-600">
									No templates available for this assembly type
								</p>
							)}
						</div>
					</div>
				) : (
					<div>
						<button
							type="button"
							onClick={handleBack}
							className="mb-4 text-xs text-zinc-500 hover:text-zinc-300"
						>
							&larr; Back to templates
						</button>

						<TemplateCard template={selected} tenant={tenant} />

						{/* Config form for configurable templates */}
						{selected.hasConfig && (
							<div className="mt-4">
								<h3 className="mb-3 text-sm font-medium text-zinc-400">
									Configuration
								</h3>
								<ConfigForm
									templateId={selected.id}
									values={config}
									onChange={setConfig}
								/>
							</div>
						)}

						{/* Deploy button */}
						<div className="mt-6">
							{!packageAvailable ? (
								<div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
									<p className="text-xs text-amber-400">
										This extension has not been published to {tenant} yet.
										Publish the Move contract first, then update the package ID in config.
									</p>
								</div>
							) : !assembly.ownerCapId ? (
								<div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
									<p className="text-xs text-amber-400">
										Could not find OwnerCap for this assembly. It may be stored in your Character keychain.
									</p>
								</div>
							) : (
								<button
									type="button"
									onClick={handleDeploy}
									disabled={isDeploying}
									className="w-full rounded-lg bg-cyan-600 py-3 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{isDeploying ? (
										<span className="flex items-center justify-center gap-2">
											<Loader2 size={16} className="animate-spin" />
											{statusMessages[status]}
										</span>
									) : (
										"Authorize & Deploy"
									)}
								</button>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
