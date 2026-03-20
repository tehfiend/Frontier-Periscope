interface ExtensionInfoProps {
	extensionType: string | null;
	isOwner: boolean;
}

/**
 * Display extension type and provide authorize/remove controls for owners.
 */
export function ExtensionInfo({ extensionType, isOwner }: ExtensionInfoProps) {
	if (!extensionType && !isOwner) return null;

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h3 className="mb-3 text-sm font-medium text-zinc-300">Extension</h3>

			{extensionType ? (
				<div className="space-y-3">
					<div>
						<p className="text-xs text-zinc-500">Registered Extension</p>
						<p className="mt-0.5 break-all font-mono text-xs text-zinc-300">{extensionType}</p>
					</div>

					{isOwner && (
						<div className="space-y-1">
							<button
								type="button"
								disabled
								title="Not yet supported on-chain (world-contracts PR #137)"
								className="cursor-not-allowed rounded-lg bg-red-600/80 px-3 py-1.5 text-xs font-medium text-white opacity-40"
							>
								Remove Extension
							</button>
							<p className="text-[10px] text-zinc-600">Not yet supported on-chain</p>
						</div>
					)}
				</div>
			) : (
				<p className="text-xs text-zinc-600">No extension configured</p>
			)}
		</div>
	);
}
