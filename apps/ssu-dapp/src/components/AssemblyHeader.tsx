import type { AssemblyData } from "@/hooks/useAssembly";
import { resolveItemName } from "@/lib/items";
import { useQuery } from "@tanstack/react-query";

interface AssemblyHeaderProps {
	assembly: AssemblyData;
	itemId?: string | null;
	ownerCharacterName?: string | null;
	connectedWalletAddress?: string | null;
	connectedCharacterName?: string | null;
	onEdit?: () => void;
}

export function AssemblyHeader({
	assembly,
	itemId,
	ownerCharacterName,
	connectedWalletAddress,
	connectedCharacterName,
	onEdit,
}: AssemblyHeaderProps) {
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
				<div className="flex shrink-0 items-center gap-2">
					{onEdit && (
						<button
							type="button"
							onClick={onEdit}
							className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
							title="Edit metadata"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 20 20"
								fill="currentColor"
								className="h-4 w-4"
							>
								<path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
							</svg>
						</button>
					)}
					<p className="font-mono text-xs text-zinc-600" title={assembly.objectId}>
						{assembly.objectId.slice(0, 10)}...{assembly.objectId.slice(-6)}
					</p>
				</div>
			</div>

			{/* Owner + connected character info */}
			<div className="mt-3 space-y-1 border-t border-zinc-800 pt-2">
				<p className="text-xs text-zinc-500">
					Owner:{" "}
					{ownerCharacterName ? (
						<span className="font-medium text-zinc-300">{ownerCharacterName}</span>
					) : (
						<span className="font-mono text-zinc-600">
							{assembly.ownerCapId.slice(0, 10)}...{assembly.ownerCapId.slice(-4)}
						</span>
					)}
				</p>
				{connectedWalletAddress && (
					<p className="text-xs text-zinc-500">
						Connected as:{" "}
						{connectedCharacterName ? (
							<span className="font-medium text-cyan-400">
								{connectedCharacterName}
							</span>
						) : (
							<span className="font-mono text-zinc-600">
								{connectedWalletAddress.slice(0, 10)}...
								{connectedWalletAddress.slice(-4)}
							</span>
						)}
					</p>
				)}
			</div>

			{assembly.extensionType && (
				<div className="mt-3 border-t border-zinc-800 pt-2">
					<p className="text-xs text-zinc-500">
						Extension:{" "}
						<span className="font-mono text-zinc-400">
							{formatExtensionType(assembly.extensionType)}
						</span>
					</p>
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
			<span
				className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-zinc-600"}`}
			/>
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
