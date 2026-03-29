import { db, notDeleted } from "@/db";
import type { DeployableIntel } from "@/db/types";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useContacts } from "@/hooks/useContacts";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { FUEL_CRITICAL_HOURS, FUEL_WARNING_HOURS } from "@/lib/constants";
import { Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import {
	BookUser,
	Coins,
	Lock,
	type LucideIcon,
	Map as MapIcon,
	Package,
	Radio,
	Telescope,
	User,
} from "lucide-react";
import type { ReactNode } from "react";

// ── Quick Action Links ───────────────────────────────────────────────────────

const quickActions = [
	{ to: "/sonar", icon: Radio, label: "Sonar" },
	{ to: "/structures", icon: Package, label: "Structures" },
	{ to: "/map", icon: MapIcon, label: "Star Map" },
	{ to: "/private-maps", icon: Lock, label: "Private Maps" },
	{ to: "/standings", icon: BookUser, label: "Standings" },
	{ to: "/currencies", icon: Coins, label: "Currencies" },
] as const;

// ── DashboardCard ────────────────────────────────────────────────────────────

function DashboardCard({
	icon: Icon,
	title,
	to,
	children,
}: {
	icon: LucideIcon;
	title: string;
	to: string;
	children: ReactNode;
}) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
			<div className="mb-3 flex items-center gap-2">
				<Icon size={18} className="shrink-0 text-zinc-400" />
				<h3 className="text-sm font-medium text-zinc-200">{title}</h3>
			</div>
			<div className="mb-4 min-h-[3rem] text-sm text-zinc-400">{children}</div>
			<Link to={to} className="text-xs text-cyan-400 transition-colors hover:text-cyan-300">
				View all &rarr;
			</Link>
		</div>
	);
}

// ── Fuel Helpers ─────────────────────────────────────────────────────────────

function computeFuelSummary(deployables: DeployableIntel[]) {
	const now = Date.now();
	let critical = 0;
	let warning = 0;
	let healthy = 0;
	let noFuel = 0;

	for (const d of deployables) {
		if (!d.fuelExpiresAt) {
			noFuel++;
			continue;
		}
		const hoursLeft = (new Date(d.fuelExpiresAt).getTime() - now) / (1000 * 60 * 60);
		if (hoursLeft <= FUEL_CRITICAL_HOURS) {
			critical++;
		} else if (hoursLeft <= FUEL_WARNING_HOURS) {
			warning++;
		} else {
			healthy++;
		}
	}

	return { critical, warning, healthy, noFuel };
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function Dashboard() {
	const tenant = useActiveTenant();
	const { activeCharacter, allCharacters, activeSuiAddresses } = useActiveCharacter();
	const contacts = useContacts();

	// Private maps
	const privateMapsV1Count =
		useLiveQuery(() => db.manifestPrivateMaps.where("tenant").equals(tenant).count(), [tenant]) ??
		0;
	const privateMapsV2Count =
		useLiveQuery(() => db.manifestPrivateMapsV2.where("tenant").equals(tenant).count(), [tenant]) ??
		0;
	const mapLocationCount =
		useLiveQuery(() => db.manifestMapLocations.where("tenant").equals(tenant).count(), [tenant]) ??
		0;

	// Markets & registries -- from manifest cache (Plan 04)
	const marketCount = useLiveQuery(() => db.manifestMarkets.count()) ?? 0;
	const registryCount = useLiveQuery(() => db.manifestRegistries.count()) ?? 0;

	// Owned deployables (need full records for fuel calculation)
	const ownedDeployables =
		useLiveQuery(
			() =>
				activeSuiAddresses.length > 0
					? db.deployables.where("owner").anyOf(activeSuiAddresses).filter(notDeleted).toArray()
					: ([] as DeployableIntel[]),
			[activeSuiAddresses],
		) ?? [];

	const totalMaps = privateMapsV1Count + privateMapsV2Count;
	const contactCount = contacts.length;
	const fuel = computeFuelSummary(ownedDeployables);

	return (
		<div className="flex h-full flex-col overflow-y-auto">
			<div className="mx-auto w-full max-w-4xl px-6 py-8">
				{/* Header */}
				<div className="mb-6">
					<div className="flex items-center gap-3">
						<Telescope size={28} className="text-cyan-500" />
						<div>
							<h1 className="text-xl font-semibold text-zinc-100">Frontier Periscope</h1>
							<p className="text-sm text-zinc-500">Dashboard</p>
						</div>
					</div>
				</div>

				{/* Quick Actions */}
				<div className="mb-6 flex flex-wrap gap-2">
					{quickActions.map((action) => (
						<Link
							key={action.to}
							to={action.to}
							className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
						>
							<action.icon size={14} />
							{action.label}
						</Link>
					))}
				</div>

				{/* Module Cards Grid */}
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{/* Characters */}
					<DashboardCard icon={User} title="Characters" to="/settings">
						{allCharacters.length > 0 ? (
							<div>
								{activeCharacter ? (
									<p className="text-zinc-200">
										{activeCharacter.characterName}
										{activeCharacter.tribe && (
											<span className="ml-1.5 text-zinc-500">[{activeCharacter.tribe}]</span>
										)}
									</p>
								) : (
									<p className="text-zinc-200">All characters</p>
								)}
								<p className="mt-1 text-xs text-zinc-500">
									{allCharacters.length} character{allCharacters.length !== 1 && "s"} configured
								</p>
							</div>
						) : (
							<p>
								Add a character to get started. Characters link your in-game identity to on-chain
								data, enabling structure sync, sonar tracking, and private maps.
							</p>
						)}
					</DashboardCard>

					{/* Private Maps */}
					<DashboardCard icon={Lock} title="Private Maps" to="/private-maps">
						{totalMaps > 0 ? (
							<p>
								<span className="text-zinc-200">
									{totalMaps} map{totalMaps !== 1 && "s"}
								</span>
								<span className="mx-1.5 text-zinc-600">&middot;</span>
								<span className="text-zinc-200">
									{mapLocationCount} location{mapLocationCount !== 1 && "s"}
								</span>
							</p>
						) : (
							<p>
								Private maps store encrypted structure locations that only invited members can see.
								Use them to share intel with allies without revealing positions publicly.
							</p>
						)}
					</DashboardCard>

					{/* Standings */}
					<DashboardCard icon={BookUser} title="Standings" to="/standings">
						{contactCount > 0 || registryCount > 0 ? (
							<p>
								<span className="text-zinc-200">
									{contactCount} contact{contactCount !== 1 && "s"}
								</span>
								<span className="mx-1.5 text-zinc-600">&middot;</span>
								<span className="text-zinc-200">
									{registryCount} registr{registryCount !== 1 ? "ies" : "y"}
								</span>
							</p>
						) : (
							<p>
								Standings control who can interact with your structures -- gate access, SSU
								deposits, turret targeting. Create a registry to define friend/foe rules, or add
								contacts for private tracking.
							</p>
						)}
					</DashboardCard>

					{/* Markets */}
					<DashboardCard icon={Coins} title="Currencies" to="/currencies">
						{marketCount > 0 ? (
							<p>
								<span className="text-zinc-200">
									{marketCount} market{marketCount !== 1 && "s"}
								</span>
							</p>
						) : (
							<p>
								Governance markets let you publish custom tokens and manage buy/sell orders. Create
								a token to power your organization's economy.
							</p>
						)}
					</DashboardCard>

					{/* Structures */}
					<DashboardCard icon={Package} title="Structures" to="/structures">
						{ownedDeployables.length > 0 ? (
							<div>
								<p className="text-zinc-200">
									{ownedDeployables.length} structure
									{ownedDeployables.length !== 1 && "s"}
								</p>
								<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
									{fuel.critical > 0 && (
										<span className="text-red-400">{fuel.critical} critical</span>
									)}
									{fuel.warning > 0 && (
										<span className="text-amber-400">{fuel.warning} warning</span>
									)}
									{fuel.healthy > 0 && (
										<span className="text-green-400">{fuel.healthy} healthy</span>
									)}
									{fuel.noFuel > 0 && <span className="text-zinc-500">{fuel.noFuel} no data</span>}
								</div>
							</div>
						) : (
							<p>
								Sync your structures from the blockchain to track fuel levels, manage extensions,
								and monitor locations.
							</p>
						)}
					</DashboardCard>
				</div>
			</div>
		</div>
	);
}
