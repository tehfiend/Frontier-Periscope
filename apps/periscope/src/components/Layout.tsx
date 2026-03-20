import { useChainSonar } from "@/hooks/useChainSonar";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useLocalSonar } from "@/hooks/useLocalSonar";
import { useLogWatcher } from "@/hooks/useLogWatcher";
import { useNotifications } from "@/hooks/useNotifications";
import { useSonarAlerts } from "@/hooks/useSonarAlerts";
import { Outlet } from "@tanstack/react-router";
import { CommandPalette } from "./CommandPalette";
import { ErrorBoundary } from "./ErrorBoundary";
import { PWAPrompt } from "./PWAPrompt";
import { Sidebar } from "./Sidebar";

export function Layout() {
	useNotifications();
	useKeyboardShortcuts();
	useLogWatcher();
	useLocalSonar();
	useChainSonar();
	useSonarAlerts();

	return (
		<div className="flex h-screen overflow-hidden bg-zinc-950">
			<Sidebar />
			<div className="flex min-w-0 flex-1 flex-col">
				<main className="min-w-0 flex-1 overflow-y-auto">
					<ErrorBoundary>
						<Outlet />
					</ErrorBoundary>
				</main>
			</div>
			<CommandPalette />
			<PWAPrompt />
		</div>
	);
}
