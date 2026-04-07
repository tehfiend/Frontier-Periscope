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
const LazyCurrencies = lazy(() =>
	import("@/views/Currencies").then((m) => ({ default: m.Currencies })),
);
const LazyPrivateMaps = lazy(() =>
	import("@/views/PrivateMaps").then((m) => ({ default: m.PrivateMaps })),
);
const LazyStandings = lazy(() =>
	import("@/views/Standings").then((m) => ({ default: m.Standings })),
);
const LazyDashboard = lazy(() =>
	import("@/views/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const LazyReleaseNotes = lazy(() =>
	import("@/views/ReleaseNotes").then((m) => ({ default: m.ReleaseNotes })),
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

function CurrenciesPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyCurrencies />
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

function DashboardPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyDashboard />
		</Suspense>
	);
}

function ReleaseNotesPage() {
	return (
		<Suspense fallback={<LoadingFallback />}>
			<LazyReleaseNotes />
		</Suspense>
	);
}

const rootRoute = createRootRoute({
	component: Layout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: DashboardPage,
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

const currenciesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/currencies",
	component: CurrenciesPage,
});

const releaseNotesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/release-notes",
	component: ReleaseNotesPage,
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
	currenciesRoute,
	assetsRoute,
	manifestRoute,
	walletRoute,
	jumpPlannerRoute,
	privateMapsRoute,
	standingsRoute,
	workersRoute,
	releaseNotesRoute,
	settingsRoute,
	setupRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
