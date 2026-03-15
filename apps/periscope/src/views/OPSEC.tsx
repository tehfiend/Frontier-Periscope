import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import {
	Shield,
	AlertTriangle,
	CheckCircle,
	Eye,
	Package,
	Users,
	User,
	Lock,
	Unlock,
} from "lucide-react";
import type { DeployableIntel } from "@/db/types";
import { FUEL_CRITICAL_HOURS, FUEL_WARNING_HOURS } from "@/lib/constants";

type RiskLevel = "safe" | "caution" | "warning" | "critical";

const RISK_CONFIG: Record<RiskLevel, { label: string; color: string; bg: string; icon: typeof Shield }> = {
	safe: { label: "Safe", color: "text-green-400", bg: "border-green-900/50 bg-green-950/20", icon: CheckCircle },
	caution: { label: "Caution", color: "text-yellow-400", bg: "border-yellow-900/50 bg-yellow-950/20", icon: Eye },
	warning: { label: "Warning", color: "text-orange-400", bg: "border-orange-900/50 bg-orange-950/20", icon: AlertTriangle },
	critical: { label: "Critical", color: "text-red-500", bg: "border-red-900/50 bg-red-950/20", icon: AlertTriangle },
};

export function OPSEC() {
	const { activeCharacter, isFiltered, activeSuiAddresses } = useActiveCharacter();
	const deployables = useLiveQuery(
		() =>
			isFiltered && activeSuiAddresses.length > 0
				? db.deployables.where("owner").anyOf(activeSuiAddresses).filter(notDeleted).toArray()
				: db.deployables.filter(notDeleted).toArray(),
		[isFiltered, activeSuiAddresses],
	);
	const targets = useLiveQuery(() => db.targets.filter(notDeleted).toArray());
	const players = useLiveQuery(() => db.players.filter(notDeleted).toArray());
	const assemblies = useLiveQuery(() => db.assemblies.filter(notDeleted).toArray());
	const chatIntel = useLiveQuery(() => db.chatIntel.filter(notDeleted).toArray());

	const address = activeSuiAddresses[0] as string | undefined;

	// Calculate OPSEC metrics
	const metrics = useMemo(() => {
		const m = {
			totalDeployables: deployables?.length ?? 0,
			onlineDeployables: deployables?.filter((d) => d.status === "online").length ?? 0,
			fuelCritical: deployables?.filter((d) => {
				if (!d.fuelExpiresAt) return false;
				const hoursLeft = (new Date(d.fuelExpiresAt).getTime() - Date.now()) / 3600000;
				return hoursLeft > 0 && hoursLeft < FUEL_CRITICAL_HOURS;
			}).length ?? 0,
			hostileTargets: targets?.filter((t) => t.watchStatus === "active").length ?? 0,
			hostilePlayers: players?.filter((p) => p.threat === "hostile" || p.threat === "critical").length ?? 0,
			observedAssemblies: assemblies?.length ?? 0,
			activeIntel: chatIntel?.filter((i) => {
				const age = (Date.now() - new Date(i.createdAt).getTime()) / 60000;
				return age < 60;
			}).length ?? 0,
			hasEncryption: false, // TODO: check if encryption is configured
			hasBackup: false, // TODO: check backup status
		};
		return m;
	}, [deployables, targets, players, assemblies, chatIntel]);

	// Risk assessment per deployable
	const deployableRisks = useMemo(() => {
		if (!deployables) return [];

		return deployables.map((d) => assessDeployableRisk(d));
	}, [deployables]);

	// Overall risk level
	const overallRisk = useMemo((): RiskLevel => {
		if (metrics.fuelCritical > 0) return "critical";
		if (metrics.hostilePlayers > 0 || metrics.activeIntel > 0) return "warning";
		if (metrics.hostileTargets > 0) return "caution";
		return "safe";
	}, [metrics]);

	const overallConfig = RISK_CONFIG[overallRisk];
	const OverallIcon = overallConfig.icon;

	return (
		<div className="p-6">
			{/* Header */}
			<div className="flex items-center gap-3">
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<Shield size={24} className="text-rose-500" />
					OPSEC Dashboard
				</h1>
				{isFiltered && activeCharacter && (
					<span className="flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-3 py-1 text-xs text-cyan-400">
						<User size={12} />
						{activeCharacter.characterName}
					</span>
				)}
			</div>
			<p className="mt-1 text-sm text-zinc-400">
				Operational security assessment for your EVE Frontier presence
			</p>

			{/* Overall Status */}
			<div className={`mt-6 rounded-lg border p-6 ${overallConfig.bg}`}>
				<div className="flex items-center gap-4">
					<OverallIcon size={32} className={overallConfig.color} />
					<div>
						<p className={`text-lg font-bold ${overallConfig.color}`}>
							Overall Status: {overallConfig.label}
						</p>
						<p className="text-sm text-zinc-400">
							{overallRisk === "safe" && "No immediate risks detected"}
							{overallRisk === "caution" && "Minor exposure detected — review recommendations"}
							{overallRisk === "warning" && "Active threats or low fuel — action recommended"}
							{overallRisk === "critical" && "Critical issues require immediate attention"}
						</p>
					</div>
				</div>
			</div>

			{/* Metrics Grid */}
			<div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
				<MetricCard
					icon={Package}
					label="Deployables"
					value={`${metrics.onlineDeployables}/${metrics.totalDeployables}`}
					sub="online"
					color="text-emerald-400"
				/>
				<MetricCard
					icon={AlertTriangle}
					label="Fuel Critical"
					value={metrics.fuelCritical}
					sub="< 6 hours"
					color={metrics.fuelCritical > 0 ? "text-red-400" : "text-green-400"}
				/>
				<MetricCard
					icon={Users}
					label="Hostile Players"
					value={metrics.hostilePlayers}
					sub="tracked"
					color={metrics.hostilePlayers > 0 ? "text-orange-400" : "text-green-400"}
				/>
				<MetricCard
					icon={Eye}
					label="Active Intel"
					value={metrics.activeIntel}
					sub="< 1 hour"
					color={metrics.activeIntel > 0 ? "text-yellow-400" : "text-zinc-500"}
				/>
			</div>

			{/* Security Checklist */}
			<h2 className="mt-8 mb-3 text-sm font-medium text-zinc-400">Security Checklist</h2>
			<div className="space-y-2">
				<ChecklistItem
					ok={!!address}
					label="Sui address configured"
					detail={address ? `${address.slice(0, 10)}...` : "Set in Settings"}
				/>
				<ChecklistItem
					ok={metrics.totalDeployables > 0}
					label="Assemblies discovered"
					detail={`${metrics.totalDeployables} deployables tracked`}
				/>
				<ChecklistItem
					ok={metrics.fuelCritical === 0}
					label="All fuel levels healthy"
					detail={metrics.fuelCritical > 0 ? `${metrics.fuelCritical} assemblies need fuel` : "No fuel warnings"}
				/>
				<ChecklistItem
					ok={metrics.onlineDeployables === metrics.totalDeployables}
					label="All assemblies online"
					detail={metrics.totalDeployables > 0 ? `${metrics.onlineDeployables}/${metrics.totalDeployables} online` : "No assemblies to check"}
				/>
			</div>

			{/* Deployable Risk Table */}
			{deployableRisks.length > 0 && (
				<>
					<h2 className="mt-8 mb-3 text-sm font-medium text-zinc-400">Assembly Risk Assessment</h2>
					<div className="space-y-2">
						{deployableRisks
							.sort((a, b) => {
								const order: Record<RiskLevel, number> = { critical: 0, warning: 1, caution: 2, safe: 3 };
								return order[a.risk] - order[b.risk];
							})
							.map((item) => {
								const cfg = RISK_CONFIG[item.risk];
								const Icon = cfg.icon;
								return (
									<div key={item.deployable.id} className={`rounded-lg border p-3 ${cfg.bg}`}>
										<div className="flex items-center gap-3">
											<Icon size={16} className={cfg.color} />
											<span className="font-mono text-sm text-zinc-200">{item.deployable.label}</span>
											<span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cfg.color}`}>
												{cfg.label}
											</span>
											<span className="ml-auto text-xs text-zinc-500">
												{item.reasons.join(" · ")}
											</span>
										</div>
									</div>
								);
							})}
					</div>
				</>
			)}
		</div>
	);
}

const RISK_PRIORITY: Record<RiskLevel, number> = { critical: 3, warning: 2, caution: 1, safe: 0 };

function elevateRisk(current: RiskLevel, candidate: RiskLevel): RiskLevel {
	return RISK_PRIORITY[candidate] > RISK_PRIORITY[current] ? candidate : current;
}

function assessDeployableRisk(d: DeployableIntel): { deployable: DeployableIntel; risk: RiskLevel; reasons: string[] } {
	let risk: RiskLevel = "safe";
	const reasons: string[] = [];

	if (d.fuelExpiresAt) {
		const hoursLeft = (new Date(d.fuelExpiresAt).getTime() - Date.now()) / 3600000;
		if (hoursLeft <= 0) {
			risk = elevateRisk(risk, "critical");
			reasons.push("Fuel depleted");
		} else if (hoursLeft < FUEL_CRITICAL_HOURS) {
			risk = elevateRisk(risk, "warning");
			reasons.push(`Fuel critical: ${Math.floor(hoursLeft)}h remaining`);
		} else if (hoursLeft < FUEL_WARNING_HOURS) {
			risk = elevateRisk(risk, "caution");
			reasons.push(`Low fuel: ${Math.floor(hoursLeft)}h remaining`);
		}
	}

	if (d.status === "offline") {
		risk = elevateRisk(risk, "caution");
		reasons.push("Assembly offline");
	}

	if (reasons.length === 0) reasons.push("No issues detected");

	return { deployable: d, risk, reasons };
}

function MetricCard({
	icon: Icon,
	label,
	value,
	sub,
	color,
}: {
	icon: typeof Shield;
	label: string;
	value: string | number;
	sub: string;
	color: string;
}) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="flex items-center gap-2">
				<Icon size={16} className={color} />
				<span className="text-xs text-zinc-500">{label}</span>
			</div>
			<p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
			<p className="text-xs text-zinc-600">{sub}</p>
		</div>
	);
}

function ChecklistItem({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
	return (
		<div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
			{ok ? (
				<CheckCircle size={16} className="shrink-0 text-green-400" />
			) : (
				<AlertTriangle size={16} className="shrink-0 text-yellow-400" />
			)}
			<div className="flex-1">
				<span className="text-sm text-zinc-200">{label}</span>
			</div>
			<span className="text-xs text-zinc-500">{detail}</span>
		</div>
	);
}
