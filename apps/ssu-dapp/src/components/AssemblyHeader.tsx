import type { AssemblyData } from "@/hooks/useAssembly";
import { resolveItemName } from "@/lib/items";
import { useQuery } from "@tanstack/react-query";

interface AssemblyHeaderProps {
	assembly: AssemblyData;
	itemId?: string | null;
}

export function AssemblyHeader({ assembly, itemId }: AssemblyHeaderProps) {
	const name = assembly.metadata?.name || "Unnamed Storage Unit";
	const description = assembly.metadata?.description || null;
	const dappUrl = assembly.metadata?.url || null;

	const { data: typeName } = useQuery({
		queryKey: ["typeName", assembly.typeId],
		queryFn: () => resolveItemName(assembly.typeId),
		staleTime: 5 * 60_000,
	});

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h2 className="truncate text-lg font-semibold text-zinc-100">{name}</h2>
						<StatusBadge status={assembly.status} isOnline={assembly.isOnline} />
					</div>
					<p className="mt-0.5 text-xs text-zinc-500">
						{typeName ?? `Type ${assembly.typeId}`}
						{itemId && <span className="ml-2 font-mono text-zinc-600">#{itemId}</span>}
					</p>
					{description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
				</div>
				<div className="shrink-0 text-right">
					<p className="font-mono text-xs text-zinc-600" title={assembly.objectId}>
						{assembly.objectId.slice(0, 10)}...{assembly.objectId.slice(-6)}
					</p>
				</div>
			</div>

			{assembly.extensionType && (
				<div className="mt-3 border-t border-zinc-800 pt-2">
					<p className="text-xs text-zinc-500">
						Extension:{" "}
						<span className="font-mono text-zinc-400">
							{formatExtensionType(assembly.extensionType)}
						</span>
					</p>
					{isMarketExtension(assembly.extensionType) && (
						<a
							href={buildMarketDappUrl(assembly.objectId)}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-1 inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
						>
							View Market &rarr;
						</a>
					)}
				</div>
			)}

			{dappUrl && (
				<div className="mt-2">
					<p className="text-xs text-zinc-500">
						dApp URL:{" "}
						<a
							href={dappUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="text-cyan-500 hover:text-cyan-400"
						>
							{dappUrl}
						</a>
					</p>
				</div>
			)}
		</div>
	);
}

function StatusBadge({ status, isOnline }: { status: string; isOnline: boolean }) {
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
				isOnline ? "bg-emerald-900/50 text-emerald-400" : "bg-zinc-800 text-zinc-500"
			}`}
		>
			<span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-zinc-600"}`} />
			{status}
		</span>
	);
}

function formatExtensionType(ext: string): string {
	const parts = ext.split("::");
	if (parts.length >= 3) {
		return `${parts[parts.length - 2]}::${parts[parts.length - 1]}`;
	}
	return ext;
}

/** Check if the extension type indicates an SSU market extension */
function isMarketExtension(ext: string): boolean {
	const lower = ext.toLowerCase();
	return lower.includes("ssu_market") || lower.includes("market");
}

/** Build a URL to the SSU market dApp for this SSU */
function buildMarketDappUrl(ssuObjectId: string): string {
	// The market dApp lives on port 3200 in dev, or at a relative path in prod.
	// Use a relative origin assumption -- the market dApp needs a configId
	// which is the SSU object ID for market SSUs.
	const baseUrl = window.location.hostname === "localhost" ? "http://localhost:3200" : "/market";
	return `${baseUrl}?configId=${ssuObjectId}`;
}
