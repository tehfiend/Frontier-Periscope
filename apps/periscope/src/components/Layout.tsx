import { Outlet } from "@tanstack/react-router";
import { Sidebar } from "./Sidebar";
import { PeerStatusBar } from "./PeerStatusBar";
import { ErrorBoundary } from "./ErrorBoundary";
import { CommandPalette } from "./CommandPalette";
import { PWAPrompt } from "./PWAPrompt";
import { useNotifications } from "@/hooks/useNotifications";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { usePeerSync } from "@/hooks/usePeerSync";

export function Layout() {
	useNotifications();
	useKeyboardShortcuts();
	usePeerSync();

	return (
		<div className="flex h-screen overflow-hidden bg-zinc-950">
			<Sidebar />
			<div className="flex flex-1 flex-col">
				<PeerStatusBar />
				<main className="flex-1 overflow-y-auto">
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
