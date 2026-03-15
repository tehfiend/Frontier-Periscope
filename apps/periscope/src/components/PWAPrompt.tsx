import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";

export function PWAPrompt() {
	const {
		needRefresh: [needRefresh, setNeedRefresh],
		updateServiceWorker,
	} = useRegisterSW({
		onRegisteredSW(_swUrl, r) {
			// Check for updates every 30 minutes
			if (r) {
				setInterval(() => r.update(), 30 * 60 * 1000);
			}
		},
	});

	if (!needRefresh) return null;

	return (
		<div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-cyan-800 bg-zinc-900 px-4 py-3 shadow-lg">
			<RefreshCw size={16} className="shrink-0 text-cyan-400" />
			<p className="text-sm text-zinc-200">New version available</p>
			<button
				type="button"
				onClick={() => updateServiceWorker(true)}
				className="rounded bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-500"
			>
				Update
			</button>
			<button
				type="button"
				onClick={() => setNeedRefresh(false)}
				className="text-zinc-500 hover:text-zinc-300"
			>
				<X size={14} />
			</button>
		</div>
	);
}
