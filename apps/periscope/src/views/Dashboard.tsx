import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import {
	Map,
	Package,
	Target,
	Users,
	Radio,
	Skull,
	FileText,
	Shield,
	Database,
	User,
} from "lucide-react";

function StatCard({
	icon: Icon,
	label,
	value,
	color = "text-zinc-400",
}: {
	icon: typeof Map;
	label: string;
	value: string | number;
	color?: string;
}) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="flex items-center gap-3">
				<Icon size={20} className={color} />
				<div>
					<p className="text-xs text-zinc-500">{label}</p>
					<p className="text-lg font-semibold text-zinc-100">{value}</p>
				</div>
			</div>
		</div>
	);
}

export function Dashboard() {
	const { activeCharacter, isFiltered, activeSuiAddresses } = useActiveCharacter();
	const systemCount = useLiveQuery(() => db.solarSystems.count()) ?? 0;
	const regionCount = useLiveQuery(() => db.regions.count()) ?? 0;
	const jumpCount = useLiveQuery(() => db.jumps.count()) ?? 0;
	const deployableCount =
		useLiveQuery(
			() =>
				isFiltered && activeSuiAddresses.length > 0
					? db.deployables.where("owner").anyOf(activeSuiAddresses).filter(notDeleted).count()
					: db.deployables.filter(notDeleted).count(),
			[isFiltered, activeSuiAddresses],
		) ?? 0;
	const targetCount = useLiveQuery(() => db.targets.filter(notDeleted).count()) ?? 0;
	const playerCount = useLiveQuery(() => db.players.filter(notDeleted).count()) ?? 0;
	const killmailCount = useLiveQuery(() => db.killmails.filter(notDeleted).count()) ?? 0;

	return (
		<div className="p-6">
			<div className="flex items-center gap-3">
				<h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
				{isFiltered && activeCharacter && (
					<span className="flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-3 py-1 text-xs text-cyan-400">
						<User size={12} />
						{activeCharacter.characterName}
					</span>
				)}
			</div>
			<p className="mt-1 text-sm text-zinc-400">Frontier Periscope — see without being seen</p>

			{/* Static Data */}
			<h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-medium text-zinc-400">
				<Database size={16} />
				Star Map Data
			</h2>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
				<StatCard icon={Map} label="Solar Systems" value={systemCount.toLocaleString()} color="text-cyan-500" />
				<StatCard icon={Map} label="Regions" value={regionCount.toLocaleString()} color="text-blue-500" />
				<StatCard icon={Map} label="Jump Connections" value={jumpCount.toLocaleString()} color="text-purple-500" />
			</div>

			{/* Intel Summary */}
			<h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-medium text-zinc-400">
				<Shield size={16} />
				Intelligence
			</h2>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
				<StatCard icon={Package} label="Deployables" value={deployableCount} color="text-emerald-500" />
				<StatCard icon={Target} label="Targets" value={targetCount} color="text-orange-500" />
				<StatCard icon={Users} label="Known Players" value={playerCount} color="text-yellow-500" />
				<StatCard icon={Skull} label="Killmails" value={killmailCount} color="text-red-500" />
			</div>

			{/* Quick Actions */}
			<h2 className="mt-8 mb-3 text-sm font-medium text-zinc-400">Quick Start</h2>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				<QuickAction
					icon={Map}
					title="Explore the Star Map"
					description="Navigate 24,000+ systems with 3D visualization"
					to="/map"
				/>
				<QuickAction
					icon={Radio}
					title="Intel Channel"
					description="Monitor chat intel reports in real-time"
					to="/intel"
				/>
				<QuickAction
					icon={FileText}
					title="Log Analyzer"
					description="Parse mining, combat, and travel logs"
					to="/logs"
				/>
			</div>
		</div>
	);
}

function QuickAction({
	icon: Icon,
	title,
	description,
	to,
}: {
	icon: typeof Map;
	title: string;
	description: string;
	to: string;
}) {
	return (
		<a
			href={to}
			className="group rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60"
		>
			<Icon size={24} className="mb-2 text-cyan-500" />
			<h3 className="text-sm font-medium text-zinc-200 group-hover:text-zinc-100">{title}</h3>
			<p className="mt-1 text-xs text-zinc-500">{description}</p>
		</a>
	);
}
