import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useAppStore } from "@/stores/appStore";
import { useSonarStore } from "@/stores/sonarStore";
import { Link } from "@tanstack/react-router";
import {
	BookUser,
	Boxes,
	Cog,
	Coins,
	Database,
	LayoutDashboard,
	Lock,
	type LucideIcon,
	Map as MapIcon,
	Package,
	PanelLeft,
	PanelLeftClose,
	Radio,
	Route,
	Settings,
	Skull,
	Wallet,
	Wrench,
} from "lucide-react";
import { useState } from "react";
import { ChangelogModal } from "./ChangelogModal";
import { CharacterSwitcher } from "./CharacterSwitcher";
import { WalletConnect } from "./WalletConnect";

interface NavItem {
	to: string;
	icon: LucideIcon;
	label: string;
	/** Optional: render a status dot next to the label */
	statusDot?: boolean;
	/** When true, only highlight when path matches exactly (needed for "/" prefix) */
	exact?: boolean;
}

interface NavGroup {
	title: string;
	items: NavItem[];
}

const navGroups: NavGroup[] = [
	{
		title: "Intel",
		items: [
			{ to: "/sonar", icon: Radio, label: "Sonar", statusDot: true },
			{ to: "/killmails", icon: Skull, label: "Killmails" },
			{ to: "/standings", icon: BookUser, label: "Standings" },
			{ to: "/private-maps", icon: Lock, label: "Private Maps" },
			{ to: "/manifest", icon: Database, label: "Manifest" },
		],
	},
	{
		title: "Assets",
		items: [
			{ to: "/structures", icon: Package, label: "Structures" },
			{ to: "/assets", icon: Boxes, label: "Inventory" },
			{ to: "/wallet", icon: Wallet, label: "Wallet" },
			{ to: "/currencies", icon: Coins, label: "Currencies" },
		],
	},
	{
		title: "Navigation",
		items: [
			{ to: "/map", icon: MapIcon, label: "Star Map" },
			{ to: "/jump-planner", icon: Route, label: "Jump Planner" },
		],
	},
	{
		title: "System",
		items: [
			{ to: "/blueprints", icon: Wrench, label: "Blueprints" },
			{ to: "/workers", icon: Cog, label: "Workers" },
			{ to: "/settings", icon: Settings, label: "Settings" },
		],
	},
];

function useSonarDots(): { local: string; chain: string } {
	const localEnabled = useSonarStore((s) => s.localEnabled);
	const chainEnabled = useSonarStore((s) => s.chainEnabled);
	const localStatus = useSonarStore((s) => s.localStatus);
	const chainStatus = useSonarStore((s) => s.chainStatus);

	function dotColor(enabled: boolean, status: string, activeColor: string): string {
		if (!enabled) return "bg-zinc-600";
		if (status === "error") return "bg-red-500";
		if (status === "active") return activeColor;
		return "bg-zinc-600";
	}

	return {
		local: dotColor(localEnabled, localStatus, "bg-green-400"),
		chain: dotColor(chainEnabled, chainStatus, "bg-orange-400"),
	};
}

function NavLink({ to, icon: Icon, label, statusDot, exact }: NavItem) {
	const collapsed = useAppStore((s) => s.sidebarCollapsed);
	const dots = useSonarDots();

	return (
		<Link
			to={to}
			activeOptions={{ exact: !!exact }}
			className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-100"
			activeProps={{
				className:
					"flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/15 hover:text-cyan-300",
			}}
		>
			<Icon size={18} className="shrink-0" />
			{!collapsed && (
				<span className="flex items-center gap-1.5">
					{label}
					{statusDot && (
						<>
							<span
								className={`inline-block h-1.5 w-1.5 rounded-full ${dots.local}`}
								title="Local Sonar"
							/>
							<span
								className={`inline-block h-1.5 w-1.5 rounded-full ${dots.chain}`}
								title="Chain Sonar"
							/>
						</>
					)}
				</span>
			)}
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
	const [changelogOpen, setChangelogOpen] = useState(false);

	return (
		<>
			<aside
				className={`flex h-full flex-col border-r border-zinc-800 bg-zinc-950 transition-all ${
					collapsed ? "w-16" : "w-56"
				}`}
			>
				{/* Logo + Server Indicator */}
				<div className="flex h-14 items-center gap-3 border-b border-zinc-800 px-4">
					<img
						src="/periscope.svg"
						alt="Periscope"
						className="h-6 w-6 shrink-0"
						style={{
							filter: "invert(73%) sepia(65%) saturate(500%) hue-rotate(140deg) brightness(95%)",
						}}
					/>
					{!collapsed && (
						<div className="flex items-center gap-2">
							<span className="text-sm font-semibold text-zinc-100">Frontier Periscope</span>
							<span
								className={`h-2 w-2 shrink-0 rounded-full ${SERVER_DOTS[tenant] ?? "bg-zinc-500"}`}
								title={tenant}
							/>
							<span className="text-[10px] capitalize text-zinc-600">{tenant}</span>
						</div>
					)}
				</div>

				{/* Character Switcher + Wallet */}
				<CharacterSwitcher />
				<div className="px-2 pb-2">
					<WalletConnect />
				</div>

				{/* Navigation */}
				<nav className="flex-1 overflow-y-auto px-2 py-4">
					<div className="mb-4">
						<NavLink to="/" icon={LayoutDashboard} label="Dashboard" exact />
					</div>
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
					{!collapsed && (
						<button
							type="button"
							onClick={() => setChangelogOpen(true)}
							className="w-full px-3 pt-1 text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
						>
							v{__APP_VERSION__}
						</button>
					)}
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

			<ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
		</>
	);
}
