import type { TenantId } from "@/chain/config";
import { buildConfigureGateStandings, buildConfigureSsuStandings } from "@/chain/transactions";
import { db } from "@/db";
import type { StructureExtensionConfig } from "@/db/types";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { REGISTRY_STANDING_LABELS, standingToDisplay } from "@tehfrontier/chain-shared";
import { AlertCircle, CheckCircle2, Loader2, Settings2 } from "lucide-react";
import { useState } from "react";
import { RegistrySelector } from "./RegistrySelector";
import { TurretPublishFlow } from "./TurretPublishFlow";

// ── Types ───────────────────────────────────────────────────────────────────

interface StandingsExtensionPanelProps {
	assemblyId: string;
	assemblyType: string;
	/** "gate" | "storage_unit" | "turret" -- the structure category for config sections */
	structureKind: "gate" | "ssu" | "turret";
	tenant: TenantId;
	/** Character Sui object ID (needed for turret publish flow) */
	characterId?: string;
	/** OwnerCap object ID (needed for turret publish flow) */
	ownerCapId?: string;
	/** Existing config (if reconfiguring) */
	existingConfig?: StructureExtensionConfig;
	onConfigured?: () => void;
}

type ConfigStatus = "idle" | "building" | "signing" | "confirming" | "done" | "error";

// ── Standing Slider ─────────────────────────────────────────────────────────

function StandingSlider({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
}) {
	const displayVal = standingToDisplay(value);
	const standingName = REGISTRY_STANDING_LABELS.get(value) ?? `${value}`;

	return (
		<div>
			<label className="mb-1.5 block text-xs font-medium text-zinc-400">
				{label}: <span className="text-zinc-200">{standingName}</span>
				<span className="ml-1 text-zinc-600">
					({displayVal >= 0 ? "+" : ""}
					{displayVal})
				</span>
			</label>
			<input
				type="range"
				min={0}
				max={6}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="w-full accent-cyan-500"
			/>
			<div className="mt-0.5 flex justify-between text-[10px] text-zinc-600">
				<span>Opposition</span>
				<span>Neutral</span>
				<span>Full Trust</span>
			</div>
		</div>
	);
}

// ── Gate Config ─────────────────────────────────────────────────────────────

function GateStandingsConfig({
	values,
	onChange,
}: {
	values: GateConfigValues;
	onChange: (v: GateConfigValues) => void;
}) {
	const durationMinutes = Math.round(Number(values.permitDurationMs) / 60_000);

	return (
		<div className="space-y-4">
			<StandingSlider
				label="Min Access"
				value={values.minAccess}
				onChange={(v) => onChange({ ...values, minAccess: v })}
			/>
			<StandingSlider
				label="Free Access"
				value={values.freeAccess}
				onChange={(v) => onChange({ ...values, freeAccess: v })}
			/>

			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">Toll Fee (SUI)</label>
				<input
					type="text"
					value={values.tollFee}
					onChange={(e) => onChange({ ...values, tollFee: e.target.value })}
					placeholder="0"
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
				<p className="mt-1 text-xs text-zinc-600">
					Gate tolls are always paid in SUI. Custom currency tolls require a world contract upgrade.
				</p>
			</div>

			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">Toll Recipient</label>
				<input
					type="text"
					value={values.tollRecipient}
					onChange={(e) => onChange({ ...values, tollRecipient: e.target.value })}
					placeholder="0x..."
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>

			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					Permit Duration: {durationMinutes} min
				</label>
				<input
					type="range"
					min={1}
					max={60}
					value={durationMinutes}
					onChange={(e) =>
						onChange({ ...values, permitDurationMs: BigInt(Number(e.target.value) * 60_000) })
					}
					className="w-full accent-cyan-500"
				/>
				<div className="mt-0.5 flex justify-between text-[10px] text-zinc-600">
					<span>1 min</span>
					<span>60 min</span>
				</div>
			</div>
		</div>
	);
}

// ── SSU Config ──────────────────────────────────────────────────────────────

function SsuStandingsConfig({
	values,
	onChange,
}: {
	values: SsuConfigValues;
	onChange: (v: SsuConfigValues) => void;
}) {
	return (
		<div className="space-y-4">
			<StandingSlider
				label="Min Deposit Standing"
				value={values.minDeposit}
				onChange={(v) => onChange({ ...values, minDeposit: v })}
			/>
			<StandingSlider
				label="Min Withdraw Standing"
				value={values.minWithdraw}
				onChange={(v) => onChange({ ...values, minWithdraw: v })}
			/>

			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					Market ID (optional)
				</label>
				<input
					type="text"
					value={values.marketId}
					onChange={(e) => onChange({ ...values, marketId: e.target.value })}
					placeholder="0x... (leave blank for no market link)"
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
				<p className="mt-1 text-xs text-zinc-600">
					Link a Market object to enable trading on this SSU.
				</p>
			</div>
		</div>
	);
}

// ── Config Value Types ──────────────────────────────────────────────────────

interface GateConfigValues {
	minAccess: number;
	freeAccess: number;
	tollFee: string;
	tollRecipient: string;
	permitDurationMs: bigint;
}

interface SsuConfigValues {
	minDeposit: number;
	minWithdraw: number;
	marketId: string;
}

// ── Main Panel ──────────────────────────────────────────────────────────────

export function StandingsExtensionPanel({
	assemblyId,
	assemblyType,
	structureKind,
	tenant,
	characterId,
	ownerCapId,
	existingConfig,
	onConfigured,
}: StandingsExtensionPanelProps) {
	// Early return for turrets -- delegate to TurretPublishFlow
	if (structureKind === "turret") {
		return (
			<TurretPublishFlow
				assemblyId={assemblyId}
				assemblyType={assemblyType}
				characterId={characterId ?? ""}
				ownerCapId={ownerCapId ?? ""}
				tenant={tenant}
				existingConfig={existingConfig}
				onConfigured={onConfigured}
			/>
		);
	}

	return (
		<StandingsExtensionPanelInner
			assemblyId={assemblyId}
			assemblyType={assemblyType}
			structureKind={structureKind}
			tenant={tenant}
			existingConfig={existingConfig}
			onConfigured={onConfigured}
		/>
	);
}

/** Inner panel for gate/SSU standings configuration (uses hooks, cannot be after early return). */
function StandingsExtensionPanelInner({
	assemblyId,
	assemblyType,
	structureKind,
	tenant,
	existingConfig,
	onConfigured,
}: Omit<StandingsExtensionPanelProps, "characterId" | "ownerCapId">) {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();

	// Registry selection
	const [registryId, setRegistryId] = useState<string | null>(existingConfig?.registryId ?? null);

	// Gate config
	const [gateConfig, setGateConfig] = useState<GateConfigValues>({
		minAccess: existingConfig?.minAccess ?? 1,
		freeAccess: existingConfig?.freeAccess ?? 4,
		tollFee: existingConfig?.tollFee ?? "0",
		tollRecipient: existingConfig?.tollRecipient ?? account?.address ?? "",
		permitDurationMs: BigInt(existingConfig?.permitDurationMs ?? 600_000),
	});

	// SSU config
	const [ssuConfig, setSsuConfig] = useState<SsuConfigValues>({
		minDeposit: existingConfig?.minDeposit ?? 3,
		minWithdraw: existingConfig?.minWithdraw ?? 3,
		marketId: existingConfig?.marketId ?? "",
	});

	const [status, setStatus] = useState<ConfigStatus>("idle");
	const [error, setError] = useState<string | null>(null);

	const isConfiguring = status === "building" || status === "signing" || status === "confirming";

	async function handleApply() {
		if (!account || !registryId) return;

		setStatus("building");
		setError(null);

		try {
			let tx: import("@mysten/sui/transactions").Transaction;

			if (structureKind === "gate") {
				tx = buildConfigureGateStandings({
					tenant,
					gateId: assemblyId,
					registryId,
					minAccess: gateConfig.minAccess,
					freeAccess: gateConfig.freeAccess,
					tollFee: BigInt(gateConfig.tollFee || "0"),
					tollRecipient: gateConfig.tollRecipient || account.address,
					permitDurationMs: gateConfig.permitDurationMs,
					senderAddress: account.address,
				});
			} else {
				tx = buildConfigureSsuStandings({
					tenant,
					ssuId: assemblyId,
					registryId,
					minDeposit: ssuConfig.minDeposit,
					minWithdraw: ssuConfig.minWithdraw,
					senderAddress: account.address,
				});
			}

			setStatus("signing");
			await signAndExecute({ transaction: tx });

			// Save config to IndexedDB
			await saveConfigToDb();

			setStatus("done");
			onConfigured?.();
		} catch (err) {
			setStatus("error");
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function saveConfigToDb() {
		if (!registryId) return;

		const registries = await db.subscribedRegistries.where("id").equals(registryId).toArray();
		const registryName = registries[0]?.name;

		const config: StructureExtensionConfig = {
			id: assemblyId,
			assemblyId,
			assemblyType,
			registryId,
			registryName,
			...(structureKind === "gate" && {
				minAccess: gateConfig.minAccess,
				freeAccess: gateConfig.freeAccess,
				tollFee: gateConfig.tollFee,
				tollRecipient: gateConfig.tollRecipient,
				permitDurationMs: Number(gateConfig.permitDurationMs),
			}),
			...(structureKind === "ssu" && {
				minDeposit: ssuConfig.minDeposit,
				minWithdraw: ssuConfig.minWithdraw,
				marketId: ssuConfig.marketId || undefined,
			}),
		};

		await db.structureExtensionConfigs.put(config);
	}

	return (
		<div className="space-y-4">
			{/* Registry selector */}
			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					<Settings2 size={12} className="mr-1 inline" />
					Standings Registry
				</label>
				<RegistrySelector value={registryId} onChange={setRegistryId} tenant={tenant} />
			</div>

			{/* Structure-type-specific config */}
			{registryId && (
				<>
					{structureKind === "gate" && (
						<GateStandingsConfig values={gateConfig} onChange={setGateConfig} />
					)}
					{structureKind === "ssu" && (
						<SsuStandingsConfig values={ssuConfig} onChange={setSsuConfig} />
					)}
				</>
			)}

			{/* Status feedback */}
			{status !== "idle" && status !== "done" && (
				<div
					className={`rounded-lg border p-3 ${
						status === "error"
							? "border-red-900/50 bg-red-950/20"
							: "border-cyan-900/50 bg-cyan-950/20"
					}`}
				>
					<div className="flex items-center gap-2">
						{status === "error" ? (
							<AlertCircle size={14} className="text-red-400" />
						) : (
							<Loader2 size={14} className="animate-spin text-cyan-400" />
						)}
						<span className={`text-xs ${status === "error" ? "text-red-300" : "text-cyan-300"}`}>
							{status === "building" && "Building transaction..."}
							{status === "signing" && "Waiting for wallet signature..."}
							{status === "confirming" && "Confirming on-chain..."}
							{status === "error" && "Configuration failed"}
						</span>
					</div>
					{error && <p className="mt-1 text-xs text-red-400">{error}</p>}
				</div>
			)}

			{status === "done" && (
				<div className="rounded-lg border border-green-900/50 bg-green-950/20 p-3">
					<div className="flex items-center gap-2">
						<CheckCircle2 size={14} className="text-green-400" />
						<span className="text-xs text-green-300">Configuration applied successfully!</span>
					</div>
				</div>
			)}

			{/* Apply button */}
			<button
				type="button"
				onClick={handleApply}
				disabled={!registryId || !account || isConfiguring}
				className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{isConfiguring ? (
					<span className="flex items-center justify-center gap-2">
						<Loader2 size={14} className="animate-spin" />
						Configuring...
					</span>
				) : existingConfig ? (
					"Update Configuration"
				) : (
					"Apply Configuration"
				)}
			</button>
		</div>
	);
}
