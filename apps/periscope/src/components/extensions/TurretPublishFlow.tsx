import { EXTENSION_TEMPLATES, TENANTS, type TenantId } from "@/chain/config";
import { buildAuthorizeExtension } from "@/chain/transactions";
import { db } from "@/db";
import type { StructureExtensionConfig } from "@/db/types";
import { useSuiClient } from "@/hooks/useSuiClient";
import { walletErrorMessage } from "@/lib/format";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import {
	DEFAULT_TURRET_PRIORITY_CONFIG,
	SHIP_CLASSES,
	buildPublishTurret,
	parsePublishTurretResult,
} from "@tehfrontier/chain-shared";
import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

interface TurretPublishFlowProps {
	assemblyId: string;
	assemblyType: string;
	characterId: string;
	ownerCapId: string;
	tenant: TenantId;
	existingConfig?: StructureExtensionConfig;
	onConfigured?: () => void;
}

type FlowStep = "configure" | "publishing" | "authorizing" | "done" | "error";

// ── Ship class dropdown options ─────────────────────────────────────────────

const SHIP_CLASS_OPTIONS = [
	{ value: 0, label: "None (disabled)" },
	...(Object.values(SHIP_CLASSES) as ReadonlyArray<{ groupId: number; label: string }>).map(
		(sc) => ({
			value: sc.groupId,
			label: `${sc.label} (${sc.groupId})`,
		}),
	),
];

// ── Weight Slider ───────────────────────────────────────────────────────────

function WeightSlider({
	label,
	value,
	onChange,
	min = 0,
	max = 255,
	helpText,
}: {
	label: string;
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
	helpText?: string;
}) {
	return (
		<div>
			{/* biome-ignore lint/a11y/noLabelWithoutControl: input is adjacent, label text describes it */}
			<label className="mb-1.5 block text-xs font-medium text-zinc-400">
				{label}: <span className="font-mono text-zinc-200">{value}</span>
			</label>
			<input
				type="range"
				min={min}
				max={max}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="w-full accent-cyan-500"
			/>
			{helpText && <p className="mt-0.5 text-[10px] text-zinc-600">{helpText}</p>}
		</div>
	);
}

// ── Main Component ──────────────────────────────────────────────────────────

export function TurretPublishFlow({
	assemblyId,
	assemblyType,
	characterId,
	ownerCapId,
	tenant,
	existingConfig,
	onConfigured,
}: TurretPublishFlowProps) {
	const account = useCurrentAccount();
	const { signAndExecuteTransaction: signAndExecute } = useDAppKit();
	const suiClient = useSuiClient();

	// ── Weight state ────────────────────────────────────────────────────────
	const [defaultWeight, setDefaultWeight] = useState(
		existingConfig?.defaultWeight ?? DEFAULT_TURRET_PRIORITY_CONFIG.defaultWeight,
	);
	const [kosWeight, setKosWeight] = useState(
		existingConfig?.kosWeight ?? DEFAULT_TURRET_PRIORITY_CONFIG.kosWeight,
	);
	const [aggressorBonus, setAggressorBonus] = useState(
		existingConfig?.aggressorBonus ?? DEFAULT_TURRET_PRIORITY_CONFIG.aggressorBonus,
	);
	const [betrayalBonus, setBetrayalBonus] = useState(
		existingConfig?.betrayalBonus ?? DEFAULT_TURRET_PRIORITY_CONFIG.betrayalBonus,
	);
	const [lowHpBonus, setLowHpBonus] = useState(
		existingConfig?.lowHpBonus ?? DEFAULT_TURRET_PRIORITY_CONFIG.lowHpBonus,
	);
	const [lowHpThreshold, setLowHpThreshold] = useState(
		existingConfig?.lowHpThreshold ?? DEFAULT_TURRET_PRIORITY_CONFIG.lowHpThreshold,
	);
	const [classBonus, setClassBonus] = useState(
		existingConfig?.classBonus ?? DEFAULT_TURRET_PRIORITY_CONFIG.classBonus,
	);
	const [effectiveClass0, setEffectiveClass0] = useState(
		existingConfig?.effectiveClasses?.[0] ?? 0,
	);
	const [effectiveClass1, setEffectiveClass1] = useState(
		existingConfig?.effectiveClasses?.[1] ?? 0,
	);

	// ── Flow state ──────────────────────────────────────────────────────────
	const [step, setStep] = useState<FlowStep>("configure");
	const [error, setError] = useState<string | null>(null);
	const [txDigest, setTxDigest] = useState<string | null>(null);

	const isProcessing = step === "publishing" || step === "authorizing";

	async function handlePublish() {
		if (!account) return;

		setStep("publishing");
		setError(null);
		setTxDigest(null);

		try {
			// Step 1: Build and publish the turret package
			const worldPackageId = TENANTS[tenant].worldPackageId;
			const { tx: publishTx, moduleName } = await buildPublishTurret(
				{
					defaultWeight,
					kosWeight,
					aggressorBonus,
					betrayalBonus,
					lowHpBonus,
					lowHpThreshold,
					classBonus,
					effectiveClasses: [effectiveClass0, effectiveClass1],
				},
				worldPackageId,
			);

			const publishResult = await signAndExecute({ transaction: publishTx });
			const publishDigest =
				publishResult.Transaction?.digest ?? publishResult.FailedTransaction?.digest ?? "";

			if (!publishDigest) {
				throw new Error("Publish transaction returned no digest");
			}

			// Wait for transaction and parse the published package ID
			const fullResult = await suiClient.waitForTransaction({
				digest: publishDigest,
				include: { effects: true, objectTypes: true },
			});
			const fullTx = fullResult.Transaction ?? fullResult.FailedTransaction;
			if (!fullTx) {
				throw new Error(
					`Transaction not found after waiting. Check explorer for digest: ${publishDigest}`,
				);
			}
			const changedObjects = fullTx.effects?.changedObjects ?? [];
			const objectTypesMap = fullTx?.objectTypes ?? {};

			const objectChanges = changedObjects.map(
				(change: { outputState?: string; idOperation?: string; objectId: string }) => {
					if (change.outputState === "PackageWrite" && change.idOperation === "Created") {
						return { type: "published", packageId: change.objectId };
					}
					return {
						type: change.idOperation === "Created" ? "created" : "mutated",
						objectId: change.objectId,
						objectType: objectTypesMap[change.objectId],
					};
				},
			);

			const parsed = parsePublishTurretResult(objectChanges);
			if (!parsed) {
				throw new Error(
					"Turret published but could not parse result. Check transaction on explorer.",
				);
			}

			const publishedPackageId = parsed.packageId;
			const effectiveModuleName = parsed.moduleName || moduleName;

			// Step 2: Authorize the published extension on the turret
			setStep("authorizing");

			// Construct a synthetic ExtensionTemplate for the newly published turret
			const turretTemplate = EXTENSION_TEMPLATES.find((t) => t.id === "turret_standings");
			if (!turretTemplate) {
				throw new Error("Turret standings template not found in EXTENSION_TEMPLATES");
			}

			const syntheticTemplate = {
				...turretTemplate,
				packageIds: { ...turretTemplate.packageIds, [tenant]: publishedPackageId },
				witnessType: `${effectiveModuleName}::TurretPriorityAuth`,
			};

			const authTx = buildAuthorizeExtension({
				tenant,
				template: syntheticTemplate,
				assemblyType: assemblyType as
					| "turret"
					| "gate"
					| "storage_unit"
					| "smart_storage_unit"
					| "network_node"
					| "protocol_depot",
				assemblyId,
				characterId,
				ownerCapId,
				senderAddress: account.address,
			});

			const authResult = await signAndExecute({ transaction: authTx });
			const authDigest =
				authResult.Transaction?.digest ?? authResult.FailedTransaction?.digest ?? "";

			setTxDigest(authDigest);

			// Step 3: Save config to IndexedDB
			const config: StructureExtensionConfig = {
				id: assemblyId,
				assemblyId,
				assemblyType,
				defaultWeight,
				kosWeight,
				aggressorBonus,
				betrayalBonus,
				lowHpBonus,
				lowHpThreshold,
				classBonus,
				effectiveClasses: [effectiveClass0, effectiveClass1],
				publishedPackageId,
				publishedAt: new Date().toISOString(),
			};
			await db.structureExtensionConfigs.put(config);

			// Record extension in extensions table
			const now = new Date().toISOString();
			await db.extensions.put({
				id: `${assemblyId}-turret_standings`,
				assemblyId,
				assemblyType: assemblyType as
					| "turret"
					| "gate"
					| "storage_unit"
					| "smart_storage_unit"
					| "network_node"
					| "protocol_depot",
				templateId: "turret_standings",
				templateName: "Periscope Turret",
				status: "authorized",
				txDigest: authDigest,
				authorizedAt: now,
				owner: account.address,
				createdAt: now,
				updatedAt: now,
			});

			setStep("done");
			onConfigured?.();
		} catch (err) {
			setStep("error");
			setError(walletErrorMessage(err));
		}
	}

	return (
		<div className="space-y-4">
			{/* Amber notice banner */}
			<div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
				<div className="flex items-start gap-2">
					<AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
					<p className="text-xs text-amber-300">
						This is a simplified weights-only turret configuration. Standings-based targeting
						(friend/foe lists derived from your registry) requires shared object support for
						turrets, which CCP has confirmed will be added after the hackathon. Once available,
						Periscope will support full registry-driven turret targeting -- no republish needed.
					</p>
				</div>
			</div>

			{/* Configure step */}
			{step === "configure" && (
				<div className="space-y-4">
					<h4 className="text-xs font-medium text-zinc-400">Targeting Weights</h4>

					<WeightSlider
						label="Default Weight"
						value={defaultWeight}
						onChange={setDefaultWeight}
						helpText="Base priority for unlisted targets."
					/>
					<WeightSlider
						label="KOS Weight"
						value={kosWeight}
						onChange={setKosWeight}
						helpText="Priority for Kill-On-Sight targets."
					/>
					<WeightSlider
						label="Aggressor Bonus"
						value={aggressorBonus}
						onChange={setAggressorBonus}
						helpText="Extra priority for targets actively attacking."
					/>
					<WeightSlider
						label="Betrayal Bonus"
						value={betrayalBonus}
						onChange={setBetrayalBonus}
						helpText="Extra priority for friendlies who attack (spy/traitor)."
					/>
					<WeightSlider
						label="Low HP Bonus"
						value={lowHpBonus}
						onChange={setLowHpBonus}
						helpText="Extra priority for low-health targets."
					/>
					<WeightSlider
						label="Low HP Threshold"
						value={lowHpThreshold}
						onChange={setLowHpThreshold}
						max={100}
						helpText="HP percentage below which the low HP bonus applies."
					/>
					<WeightSlider
						label="Class Bonus"
						value={classBonus}
						onChange={setClassBonus}
						helpText="Extra priority for effective ship class matches."
					/>

					<div>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: label describes the select group below */}
						<label className="mb-1.5 block text-xs font-medium text-zinc-400">
							Effective Ship Classes
						</label>
						<p className="mb-2 text-[10px] text-zinc-600">
							Ship classes this turret is effective against. Matched targets get the class bonus.
						</p>
						<div className="space-y-2">
							<select
								value={effectiveClass0}
								onChange={(e) => setEffectiveClass0(Number(e.target.value))}
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
							>
								{SHIP_CLASS_OPTIONS.map((opt) => (
									<option key={`c0-${opt.value}`} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
							<select
								value={effectiveClass1}
								onChange={(e) => setEffectiveClass1(Number(e.target.value))}
								className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none"
							>
								{SHIP_CLASS_OPTIONS.map((opt) => (
									<option key={`c1-${opt.value}`} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						</div>
					</div>

					{/* Publish button */}
					<button
						type="button"
						onClick={handlePublish}
						disabled={!account || !ownerCapId}
						className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{existingConfig?.publishedPackageId
							? "Republish & Authorize Turret"
							: "Publish & Authorize Turret"}
					</button>

					{!ownerCapId && (
						<p className="text-xs text-amber-400">
							Could not find OwnerCap for this assembly. It may be stored in your Character
							keychain.
						</p>
					)}
				</div>
			)}

			{/* Publishing / Authorizing steps */}
			{isProcessing && (
				<div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-3">
					<div className="flex items-center gap-2">
						<Loader2 size={14} className="animate-spin text-cyan-400" />
						<span className="text-xs text-cyan-300">
							{step === "publishing" && "Publishing turret package via wallet..."}
							{step === "authorizing" && "Authorizing extension on turret..."}
						</span>
					</div>
				</div>
			)}

			{/* Error state */}
			{step === "error" && (
				<div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3">
					<div className="flex items-center gap-2">
						<AlertCircle size={14} className="text-red-400" />
						<span className="text-xs text-red-300">Configuration failed</span>
					</div>
					{error && <p className="mt-1 text-xs text-red-400">{error}</p>}
					<button
						type="button"
						onClick={() => {
							setStep("configure");
							setError(null);
						}}
						className="mt-2 text-xs text-zinc-400 hover:text-zinc-300"
					>
						Try again
					</button>
				</div>
			)}

			{/* Done state */}
			{step === "done" && (
				<div className="rounded-lg border border-green-900/50 bg-green-950/20 p-3">
					<div className="flex items-center gap-2">
						<CheckCircle2 size={14} className="text-green-400" />
						<span className="text-xs text-green-300">
							Turret published and authorized successfully!
						</span>
					</div>
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
				</div>
			)}
		</div>
	);
}
