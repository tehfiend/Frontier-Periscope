import { FolderOpen } from "lucide-react";
import { requestDirectoryAccess } from "@/lib/logFileAccess";

export function GrantAccessView({
	onGrant,
}: { onGrant: (h: FileSystemDirectoryHandle) => void }) {
	async function handleGrant() {
		const handle = await requestDirectoryAccess();
		if (handle) onGrant(handle);
	}

	return (
		<div className="flex h-full items-center justify-center">
			<div className="max-w-lg space-y-6 text-center">
				<FolderOpen size={48} className="mx-auto text-teal-500" />
				<div>
					<h2 className="text-xl font-bold text-zinc-100">Connect Game Logs</h2>
					<p className="mt-2 text-sm text-zinc-400">
						Grant read access to your game log directory to enable live mining rates, DPS
						tracking, and session analytics.
					</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-left">
					<p className="text-xs font-medium text-zinc-400">
						Navigate to this folder in the picker:
					</p>
					<p className="mt-1.5 select-all rounded bg-zinc-800/80 px-2.5 py-1.5 font-mono text-sm text-zinc-200">
						Documents &rsaquo; Frontier &rsaquo; logs
					</p>
					<p className="mt-2 text-xs text-zinc-600">
						The picker will open in your Documents folder. Navigate into{" "}
						<span className="text-zinc-400">Frontier</span> &rarr;{" "}
						<span className="text-zinc-400">logs</span>, then click
						&ldquo;Select Folder&rdquo;. This gives access to both game logs
						and chat logs (for travel tracking). You only need to do this once.
					</p>
				</div>
				<button
					type="button"
					onClick={handleGrant}
					className="rounded-lg bg-teal-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
				>
					Select Log Directory
				</button>
			</div>
		</div>
	);
}
