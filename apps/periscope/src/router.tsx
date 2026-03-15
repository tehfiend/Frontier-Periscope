import { lazy, Suspense } from "react";
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/views/Dashboard";
import { Deployables } from "@/views/Deployables";
import { Assemblies } from "@/views/Assemblies";
import { Locations } from "@/views/Locations";
import { Targets } from "@/views/Targets";
import { Intel } from "@/views/Intel";
import { Players } from "@/views/Players";
import { Killmails } from "@/views/Killmails";
import { Blueprints } from "@/views/Blueprints";
import { OPSEC } from "@/views/OPSEC";
import { Notes } from "@/views/Notes";
import { Settings } from "@/views/Settings";
import { Extensions } from "@/views/Extensions";
import { Permissions } from "@/views/Permissions";
import { Setup } from "@/views/Setup";
import { Assets } from "@/views/Assets";
import { Radar } from "@/views/Radar";
import { JumpPlanner } from "@/views/JumpPlanner";
import { Manifest } from "@/views/Manifest";
import { Workers } from "@/views/Workers";
import { GovernanceDashboard } from "@/views/GovernanceDashboard";
import { GovernanceTurrets } from "@/views/GovernanceTurrets";
import { GovernanceFinance } from "@/views/GovernanceFinance";
import { GovernanceClaims } from "@/views/GovernanceClaims";
import { GovernanceTrade } from "@/views/GovernanceTrade";

// Lazy-load heavy views that pull in large deps
const LazyStarMap = lazy(() => import("@/views/StarMap").then((m) => ({ default: m.StarMap })));
const LazyLogs = lazy(() => import("@/views/Logs").then((m) => ({ default: m.Logs })));
const LazyPeerSync = lazy(() => import("@/views/PeerSync").then((m) => ({ default: m.PeerSync })));

function LoadingFallback() {
	return (
		<div className="flex h-full items-center justify-center">
			<div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
		</div>
	);
}

function StarMapPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyStarMap />
		</Suspense>
	);
}

function LogsPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyLogs />
		</Suspense>
	);
}

function PeerSyncPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyPeerSync />
		</Suspense>
	);
}

const rootRoute = createRootRoute({
	component: Layout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: Dashboard,
});

const mapRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/map",
	component: StarMapPage,
});

const deployablesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/deployables",
	component: Deployables,
});

const assembliesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assemblies",
	component: Assemblies,
});

const locationsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/locations",
	component: Locations,
});

const targetsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/targets",
	component: Targets,
});

const intelRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/intel",
	component: Intel,
});

const playersRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/players",
	component: Players,
});

const killmailsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/killmails",
	component: Killmails,
});

const blueprintsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/blueprints",
	component: Blueprints,
});

const logsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/logs",
	component: LogsPage,
});

const opsecRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/opsec",
	component: OPSEC,
});

const notesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/notes",
	component: Notes,
});

// Old routes — redirect to governance
const extensionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/extensions",
	component: Extensions,
});

const permissionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/permissions",
	component: Permissions,
});

const turretConfigRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/turret-config",
	beforeLoad: () => {
		throw redirect({ to: "/governance/turrets" });
	},
});

// Governance routes
const governanceRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/governance",
	component: GovernanceDashboard,
});

const governanceTurretsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/governance/turrets",
	component: GovernanceTurrets,
});

const governanceFinanceRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/governance/finance",
	component: GovernanceFinance,
});

const governanceClaimsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/governance/claims",
	component: GovernanceClaims,
});

const governanceTradeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/governance/trade",
	component: GovernanceTrade,
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: Settings,
});

const peersRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/peers",
	component: PeerSyncPage,
});

const assetsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assets",
	component: Assets,
});

const manifestRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/manifest",
	component: Manifest,
});

const jumpPlannerRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/jump-planner",
	component: JumpPlanner,
});

const radarRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/radar",
	component: Radar,
});

const workersRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/workers",
	component: Workers,
});

const setupRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/setup",
	component: Setup,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	mapRoute,
	deployablesRoute,
	assembliesRoute,
	locationsRoute,
	targetsRoute,
	intelRoute,
	playersRoute,
	killmailsRoute,
	blueprintsRoute,
	logsRoute,
	opsecRoute,
	notesRoute,
	extensionsRoute,
	permissionsRoute,
	turretConfigRoute,
	governanceRoute,
	governanceTurretsRoute,
	governanceFinanceRoute,
	governanceClaimsRoute,
	governanceTradeRoute,
	assetsRoute,
	manifestRoute,
	jumpPlannerRoute,
	radarRoute,
	peersRoute,
	workersRoute,
	settingsRoute,
	setupRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
