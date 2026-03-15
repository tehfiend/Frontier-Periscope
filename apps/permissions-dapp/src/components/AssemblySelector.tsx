import { useState } from "react";
import { Search, Box } from "lucide-react";

interface AssemblySelectorProps {
	walletAddress: string;
	selectedId: string;
	onSelect: (id: string) => void;
}

export function AssemblySelector({ walletAddress, selectedId, onSelect }: AssemblySelectorProps) {
	const [inputId, setInputId] = useState(selectedId);

	function handleSelect() {
		if (inputId.trim()) {
			onSelect(inputId.trim());
		}
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<h2 className="mb-3 text-sm font-medium text-zinc-400">
				<Box size={14} className="mr-1.5 inline" />
				Select Assembly
			</h2>

			<div className="flex gap-2">
				<input
					type="text"
					value={inputId}
					onChange={(e) => setInputId(e.target.value)}
					placeholder="Assembly Object ID (0x...)"
					className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
				<button
					type="button"
					onClick={handleSelect}
					disabled={!inputId.trim()}
					className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Search size={16} />
				</button>
			</div>

			{selectedId && (
				<p className="mt-2 font-mono text-xs text-zinc-600">
					Selected: {selectedId.slice(0, 16)}...{selectedId.slice(-8)}
				</p>
			)}

			<p className="mt-2 text-xs text-zinc-600">
				Connected: {walletAddress.slice(0, 10)}...{walletAddress.slice(-6)}
			</p>
		</div>
	);
}
