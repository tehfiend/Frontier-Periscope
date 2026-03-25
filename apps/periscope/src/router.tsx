import { Layout } from "@/components/Layout";
import { Assets } from "@/views/Assets";
import { Blueprints } from "@/views/Blueprints";
import { Deployables } from "@/views/Deployables";
import { JumpPlanner } from "@/views/JumpPlanner";
import { Killmails } from "@/views/Killmails";
import { Settings } from "@/views/Settings";
import { Setup } from "@/views/Setup";
import { Workers } from "@/views/Workers";
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

// Lazy-load heavy views that pull in large deps
const LazyStarMap = lazy(() => import("@/views/StarMap").then((m) => ({ default: m.StarMap })));
const LazySonar = lazy(() => import("@/views/Sonar").then((m) => ({ default: m.Sonar })));
const LazyManifest = lazy(() => import("@/views/Manifest").then((m) => ({ default: m.Manifest })));
const LazyWallet = lazy(() => import("@/views/Wallet").then((m) => ({ default: m.Wallet })));
const LazyMarket = lazy(() => import("@/views/Market").then((m) => ({ default: m.Market })));
const LazyPrivateMaps = lazy(() =>
	import("@/views/PrivateMaps").then((m) => ({ default: m.PrivateMaps })),
);
const LazyStandings = lazy(() =>
	import("@/views/Standings").then((m) => ({ default: m.Standings })),
);

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

function SonarPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazySonar />
		</Suspense>
	);
}

function ManifestPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyManifest />
		</Suspense>
	);
}

function WalletPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyWallet />
		</Suspense>
	);
}

function MarketPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyMarket />
		</Suspense>
	);
}

function PrivateMapsPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyPrivateMaps />
		</Suspense>
	);
}

function StandingsPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyStandings />
		</Suspense>
	);
}

const rootRoute = createRootRoute({
	component: Layout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	beforeLoad: () => {
		throw redirect({ to: "/sonar" });
	},
});

const mapRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/map",
	component: StarMapPage,
});

const structuresRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/structures",
	component: Deployables,
});

const deployablesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/deployables",
	beforeLoad: () => {
		throw redirect({ to: "/structures" });
	},
});

const assembliesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assemblies",
	beforeLoad: () => {
		throw redirect({ to: "/structures" });
	},
});

const locationsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/locations",
	beforeLoad: () => {
		throw redirect({ to: "/structures" });
	},
});

const targetsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/targets",
	beforeLoad: () => {
		throw redirect({ to: "/sonar" });
	},
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
	beforeLoad: () => {
		throw redirect({ to: "/sonar" });
	},
});

const sonarRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/sonar",
	component: SonarPage,
});

const extensionsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/extensions",
	beforeLoad: () => {
		throw redirect({ to: "/structures" });
	},
});

const marketsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/markets",
	component: MarketPage,
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: Settings,
});

const assetsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/assets",
	component: Assets,
});

const manifestRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/manifest",
	component: ManifestPage,
});

const walletRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/wallet",
	component: WalletPage,
});

const jumpPlannerRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/jump-planner",
	component: JumpPlanner,
});

const privateMapsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/private-maps",
	component: PrivateMapsPage,
});

const standingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/standings",
	component: StandingsPage,
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
	structuresRoute,
	deployablesRoute,
	assembliesRoute,
	locationsRoute,
	targetsRoute,
	killmailsRoute,
	blueprintsRoute,
	logsRoute,
	sonarRoute,
	extensionsRoute,
	marketsRoute,
	assetsRoute,
	manifestRoute,
	walletRoute,
	jumpPlannerRoute,
	privateMapsRoute,
	standingsRoute,

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
