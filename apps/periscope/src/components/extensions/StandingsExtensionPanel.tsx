import type { TenantId } from "@/chain/config";
import { buildConfigureGateStandings, buildConfigureSsuStandings } from "@/chain/transactions";
import { db } from "@/db";
import type { StructureExtensionConfig } from "@/db/types";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { REGISTRY_STANDING_LABELS, standingToDisplay } from "@tehfrontier/chain-shared";
import { AlertCircle, CheckCircle2, Loader2, Settings2 } from "lucide-react";
import { useState } from "react";
import { MarketSelector } from "./MarketSelector";
import { RegistrySelector } from "./RegistrySelector";

// ── Types ───────────────────────────────────────────────────────────────────

interface StandingsExtensionPanelProps {
	assemblyId: string;
	assemblyType: string;
	/** "gate" | "storage_unit" | "turret" -- the structure category for config sections */
	structureKind: "gate" | "ssu" | "turret";
	tenant: TenantId;
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
					Toll for characters between minAccess and freeAccess. 0 = no toll.
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
				<MarketSelector
					value={values.marketId}
					onChange={(marketId) => onChange({ ...values, marketId })}
				/>
				<p className="mt-1 text-xs text-zinc-600">
					Link a Market object to enable trading on this SSU.
				</p>
			</div>
		</div>
	);
}

// ── Turret Config ───────────────────────────────────────────────────────────

function TurretStandingsConfig({
	values,
	onChange,
}: {
	values: TurretConfigValues;
	onChange: (v: TurretConfigValues) => void;
}) {
	// Standing levels 0-6 with editable weights
	const standingEntries = Array.from({ length: 7 }, (_, i) => ({
		standing: i,
		label: REGISTRY_STANDING_LABELS.get(i) ?? `${i}`,
		weight: values.standingWeights[i] ?? 0,
	}));

	function updateWeight(standing: number, weight: number) {
		onChange({
			...values,
			standingWeights: { ...values.standingWeights, [standing]: weight },
		});
	}

	return (
		<div className="space-y-4">
			<div>
				<label className="mb-2 block text-xs font-medium text-zinc-400">
					Standing Weight Mapping
				</label>
				<p className="mb-2 text-[10px] text-zinc-600">
					Higher weight = higher targeting priority. Set 0 to ignore.
				</p>
				<div className="space-y-1.5">
					{standingEntries.map((e) => (
						<div key={e.standing} className="flex items-center gap-3">
							<span className="w-20 text-xs text-zinc-400">{e.label}</span>
							<input
								type="range"
								min={0}
								max={100}
								value={e.weight}
								onChange={(ev) => updateWeight(e.standing, Number(ev.target.value))}
								className="flex-1 accent-cyan-500"
							/>
							<span className="w-8 text-right font-mono text-xs text-zinc-300">{e.weight}</span>
						</div>
					))}
				</div>
			</div>

			<div>
				<label className="mb-1.5 block text-xs font-medium text-zinc-400">
					Aggressor Bonus: {values.aggressorBonus}
				</label>
				<input
					type="range"
					min={0}
					max={100}
					value={values.aggressorBonus}
					onChange={(e) => onChange({ ...values, aggressorBonus: Number(e.target.value) })}
					className="w-full accent-cyan-500"
				/>
				<p className="mt-0.5 text-[10px] text-zinc-600">
					Extra priority for targets actively attacking. 0 = disabled.
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

interface TurretConfigValues {
	standingWeights: Record<number, number>;
	aggressorBonus: number;
}

// ── Main Panel ──────────────────────────────────────────────────────────────

export function StandingsExtensionPanel({
	assemblyId,
	assemblyType,
	structureKind,
	tenant,
	existingConfig,
	onConfigured,
}: StandingsExtensionPanelProps) {
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

	// Turret config
	const [turretConfig, setTurretConfig] = useState<TurretConfigValues>({
		standingWeights: existingConfig?.standingWeights ?? {
			0: 100, // Opposition -- highest priority
			1: 80, // Hostile
			2: 50, // Unfriendly
			3: 30, // Neutral
			4: 10, // Friendly
			5: 0, // Ally -- don't target
			6: 0, // Full Trust -- don't target
		},
		aggressorBonus: existingConfig?.aggressorBonus ?? 40,
	});

	const [status, setStatus] = useState<ConfigStatus>("idle");
	const [error, setError] = useState<string | null>(null);

	const isConfiguring = status === "building" || status === "signing" || status === "confirming";

	async function handleApply() {
		if (!account || !registryId) return;

		setStatus("building");
		setError(null);

		try {
			let tx: import("@mysten/sui/transactions").Transaction | undefined;

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
			} else if (structureKind === "ssu") {
				tx = buildConfigureSsuStandings({
					tenant,
					ssuId: assemblyId,
					registryId,
					minDeposit: ssuConfig.minDeposit,
					minWithdraw: ssuConfig.minWithdraw,
					senderAddress: account.address,
				});
			} else {
				// Turret -- config is stored locally, no on-chain TX needed
				await saveConfigToDb();
				setStatus("done");
				onConfigured?.();
				return;
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
			...(structureKind === "turret" && {
				standingWeights: turretConfig.standingWeights,
				aggressorBonus: turretConfig.aggressorBonus,
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
					{structureKind === "turret" && (
						<TurretStandingsConfig values={turretConfig} onChange={setTurretConfig} />
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
