import { Link } from "@tanstack/react-router";
import { useAppStore } from "@/stores/appStore";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { CharacterSwitcher } from "./CharacterSwitcher";
import {
	LayoutDashboard,
	Map,
	Package,
	Box,
	MapPin,
	Target,
	Radio,
	Users,
	Skull,
	Wrench,
	FileText,
	Shield,
	StickyNote,
	Settings,
	PanelLeftClose,
	PanelLeft,
	Wifi,
	Crosshair,
	Boxes,
	SatelliteDish,
	Route,
	Database,
	Cog,
	Building2,
	Coins,
	Flag,
	ShoppingBag,
	Wallet,
	type LucideIcon,
} from "lucide-react";

interface NavItem {
	to: string;
	icon: LucideIcon;
	label: string;
}

interface NavGroup {
	title: string;
	items: NavItem[];
}

const navGroups: NavGroup[] = [
	{
		title: "Overview",
		items: [
			{ to: "/", icon: LayoutDashboard, label: "Dashboard" },
			{ to: "/map", icon: Map, label: "Star Map" },
			{ to: "/jump-planner", icon: Route, label: "Jump Planner" },
			{ to: "/wallet", icon: Wallet, label: "Wallet" },
		],
	},
	{
		title: "Governance",
		items: [
			{ to: "/governance", icon: Building2, label: "Organization" },
			{ to: "/governance/turrets", icon: Crosshair, label: "Turrets" },
			{ to: "/governance/finance", icon: Coins, label: "Finance" },
			{ to: "/governance/trade", icon: ShoppingBag, label: "Trade" },
			{ to: "/governance/claims", icon: Flag, label: "Claims" },
		],
	},
	{
		title: "Intelligence",
		items: [
			{ to: "/radar", icon: SatelliteDish, label: "Radar" },
			{ to: "/intel", icon: Radio, label: "Intel Channel" },
			{ to: "/targets", icon: Target, label: "Watchlist" },
			{ to: "/players", icon: Users, label: "Players" },
			{ to: "/killmails", icon: Skull, label: "Killmails" },
			{ to: "/manifest", icon: Database, label: "Manifest" },
		],
	},
	{
		title: "Assets",
		items: [
			{ to: "/deployables", icon: Package, label: "Deployables" },
			{ to: "/assemblies", icon: Box, label: "Assemblies" },
			{ to: "/assets", icon: Boxes, label: "Assets" },
			{ to: "/locations", icon: MapPin, label: "Locations" },
		],
	},
	{
		title: "Tools",
		items: [
			{ to: "/blueprints", icon: Wrench, label: "Blueprints" },
			{ to: "/logs", icon: FileText, label: "Log Analyzer" },
			{ to: "/opsec", icon: Shield, label: "OPSEC" },
			{ to: "/notes", icon: StickyNote, label: "Notes" },
		],
	},
	{
		title: "Network",
		items: [
			{ to: "/peers", icon: Wifi, label: "P2P Sync" },
			{ to: "/workers", icon: Cog, label: "Workers" },
		],
	},
];

function NavLink({ to, icon: Icon, label }: NavItem) {
	const collapsed = useAppStore((s) => s.sidebarCollapsed);

	return (
		<Link
			to={to}
			activeOptions={{ exact: to === "/" }}
			className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-100"
			activeProps={{
				className:
					"flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/15 hover:text-cyan-300",
			}}
		>
			<Icon size={18} className="shrink-0" />
			{!collapsed && <span>{label}</span>}
		</Link>
	);
}

const SERVER_DOTS: Record<string, string> = {
	stillness: "bg-green-500",
	utopia: "bg-amber-500",
};

export function Sidebar() {
	const collapsed = useAppStore((s) => s.sidebarCollapsed);
	const toggleSidebar = useAppStore((s) => s.toggleSidebar);
	const tenant = useActiveTenant();

	return (
		<aside
			className={`flex h-full flex-col border-r border-zinc-800 bg-zinc-950 transition-all ${
				collapsed ? "w-16" : "w-56"
			}`}
		>
			{/* Logo + Server Indicator */}
			<div className="flex h-14 items-center gap-3 border-b border-zinc-800 px-4">
				<img src="/periscope.svg" alt="Periscope" className="h-6 w-6 shrink-0" style={{ filter: "invert(73%) sepia(65%) saturate(500%) hue-rotate(140deg) brightness(95%)" }} />
				{!collapsed && (
					<div className="flex items-center gap-2">
						<span className="text-sm font-semibold text-zinc-100">EF Periscope</span>
						<span
							className={`h-2 w-2 shrink-0 rounded-full ${SERVER_DOTS[tenant] ?? "bg-zinc-500"}`}
							title={tenant}
						/>
						<span className="text-[10px] capitalize text-zinc-600">{tenant}</span>
					</div>
				)}
			</div>

			{/* Character Switcher */}
			<CharacterSwitcher />

			{/* Navigation */}
			<nav className="flex-1 overflow-y-auto px-2 py-4">
				{navGroups.map((group) => (
					<div key={group.title} className="mb-4">
						{!collapsed && (
							<h3 className="mb-1 px-3 text-xs font-medium uppercase tracking-wider text-zinc-600">
								{group.title}
							</h3>
						)}
						<div className="space-y-0.5">
							{group.items.map((item) => (
								<NavLink key={item.to} {...item} />
							))}
						</div>
					</div>
				))}
			</nav>

			{/* Footer */}
			<div className="border-t border-zinc-800 p-2">
				<NavLink to="/settings" icon={Settings} label="Settings" />
				<button
					type="button"
					onClick={toggleSidebar}
					className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
				>
					{collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
					{!collapsed && <span>Collapse</span>}
				</button>
			</div>
		</aside>
	);
}
