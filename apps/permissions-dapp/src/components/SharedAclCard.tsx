import type { SharedAclInfo } from "@tehfrontier/chain-shared";
import { ChevronRight, Crown } from "lucide-react";

interface SharedAclCardProps {
	acl: SharedAclInfo;
	isOwner: boolean;
	onSelect: () => void;
}

export function SharedAclCard({ acl, isOwner, onSelect }: SharedAclCardProps) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-medium text-zinc-200">
						{acl.name || "(unnamed)"}
					</span>
					{isOwner && (
						<span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
							<Crown size={10} />
							Creator
						</span>
					)}
					<span
						className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
							acl.isAllowlist ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
						}`}
					>
						{acl.isAllowlist ? "Allowlist" : "Denylist"}
					</span>
				</div>
				<p className="mt-0.5 font-mono text-[10px] text-zinc-600">
					{acl.objectId.slice(0, 16)}...{acl.objectId.slice(-8)}
				</p>
				<div className="mt-1 flex gap-3 text-[10px] text-zinc-500">
					<span>
						{acl.allowedTribes.length} tribe{acl.allowedTribes.length !== 1 ? "s" : ""}
					</span>
					<span>
						{acl.allowedCharacters.length} character
						{acl.allowedCharacters.length !== 1 ? "s" : ""}
					</span>
					<span>
						{acl.admins.length} admin{acl.admins.length !== 1 ? "s" : ""}
					</span>
				</div>
			</div>
			<ChevronRight size={16} className="shrink-0 text-zinc-600" />
		</button>
	);
}
