import { useRegisterSW } from "virtual:pwa-register/react";
import { Download, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

let deferredPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAPrompt() {
	const [showReload, setShowReload] = useState(false);

	useRegisterSW({
		onRegisteredSW(_swUrl, r) {
			// Check for updates every 5 minutes
			if (r) {
				setInterval(() => r.update(), 5 * 60 * 1000);
			}
		},
		onNeedRefresh() {
			// Auto-update mode still fires this when a new SW is waiting
			setShowReload(true);
		},
	});

	const [canInstall, setCanInstall] = useState(false);
	const [dismissed, setDismissed] = useState(false);

	useEffect(() => {
		const handler = (e: Event) => {
			e.preventDefault();
			deferredPrompt = e as BeforeInstallPromptEvent;
			setCanInstall(true);
		};
		window.addEventListener("beforeinstallprompt", handler);

		// Hide install prompt if app is already installed
		window.addEventListener("appinstalled", () => {
			deferredPrompt = null;
			setCanInstall(false);
		});

		return () => window.removeEventListener("beforeinstallprompt", handler);
	}, []);

	const handleInstall = useCallback(async () => {
		if (!deferredPrompt) return;
		await deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;
		if (outcome === "accepted") {
			deferredPrompt = null;
			setCanInstall(false);
		}
	}, []);

	return (
		<>
			{/* Install prompt */}
			{canInstall && !dismissed && (
				<div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-cyan-800 bg-zinc-900 px-4 py-3 shadow-lg">
					<Download size={16} className="shrink-0 text-cyan-400" />
					<p className="text-sm text-zinc-200">Install as desktop app</p>
					<button
						type="button"
						onClick={handleInstall}
						className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-500"
					>
						Install
					</button>
					<button
						type="button"
						onClick={() => setDismissed(true)}
						className="text-zinc-500 hover:text-zinc-300"
					>
						<X size={14} />
					</button>
				</div>
			)}

			{/* Update available -- reload to activate */}
			{showReload && (
				<div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-cyan-800 bg-zinc-900 px-4 py-3 shadow-lg">
					<RefreshCw size={16} className="shrink-0 text-cyan-400" />
					<p className="text-sm text-zinc-200">New version available</p>
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-500"
					>
						Reload
					</button>
					<button
						type="button"
						onClick={() => setShowReload(false)}
						className="text-zinc-500 hover:text-zinc-300"
					>
						<X size={14} />
					</button>
				</div>
			)}
		</>
	);
}
