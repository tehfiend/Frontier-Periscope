import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { REGISTRY_STANDING_LABELS } from "@tehfrontier/chain-shared";
import { CopyAddress } from "./CopyAddress";

interface SsuConfigInfoProps {
	ssuConfig: SsuConfigResult;
}

/**
 * Display the SSU's standings configuration: registry, standing thresholds,
 * and currency (if a market is linked).
 */
export function SsuConfigInfo({ ssuConfig }: SsuConfigInfoProps) {
	const minDepLabel = REGISTRY_STANDING_LABELS.get(ssuConfig.minDeposit ?? 3) ?? "Neutral";
	const minWdLabel = REGISTRY_STANDING_LABELS.get(ssuConfig.minWithdraw ?? 3) ?? "Neutral";

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h3 className="mb-3 text-sm font-medium text-zinc-300">Standings Configuration</h3>
			<div className="space-y-2">
				{ssuConfig.registryId && (
					<div className="flex items-center justify-between">
						<span className="text-xs text-zinc-500">Registry</span>
						<CopyAddress address={ssuConfig.registryId} />
					</div>
				)}

				{ssuConfig.minDeposit != null && (
					<div className="flex items-center justify-between">
						<span className="text-xs text-zinc-500">Min Deposit</span>
						<span className="text-xs text-zinc-300">{minDepLabel}</span>
					</div>
				)}

				{ssuConfig.minWithdraw != null && (
					<div className="flex items-center justify-between">
						<span className="text-xs text-zinc-500">Min Withdraw</span>
						<span className="text-xs text-zinc-300">{minWdLabel}</span>
					</div>
				)}

				{ssuConfig.coinType && (
					<div className="flex items-center justify-between">
						<span className="text-xs text-zinc-500">Currency</span>
						<span className="text-xs text-zinc-300 font-mono">
							{ssuConfig.coinType.split("::").pop()}
						</span>
					</div>
				)}

				{ssuConfig.owner && (
					<div className="flex items-center justify-between">
						<span className="text-xs text-zinc-500">Config Owner</span>
						<CopyAddress address={ssuConfig.owner} />
					</div>
				)}
			</div>
		</div>
	);
}
