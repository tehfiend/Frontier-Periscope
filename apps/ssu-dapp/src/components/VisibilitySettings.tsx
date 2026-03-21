import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { decodeErrorMessage } from "@/lib/errors";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { buildSetVisibility } from "@tehfrontier/chain-shared";
import { useState } from "react";

interface VisibilitySettingsProps {
	ssuConfig: SsuConfigResult;
}

export function VisibilitySettings({ ssuConfig }: VisibilitySettingsProps) {
	const account = useCurrentAccount();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	async function handleToggle() {
		if (!account?.address) return;
		setError(null);
		setSuccess(null);

		try {
			const tx = buildSetVisibility({
				packageId: ssuConfig.packageId,
				ssuConfigId: ssuConfig.ssuConfigId,
				isPublic: !ssuConfig.isPublic,
				senderAddress: account.address,
			});
			await signAndExecute(tx);
			setSuccess(`SSU is now ${ssuConfig.isPublic ? "private" : "public"}`);
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	return (
		<div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
			<div>
				<p className="text-xs text-zinc-400">
					Visibility:{" "}
					<span className={ssuConfig.isPublic ? "text-emerald-400" : "text-zinc-500"}>
						{ssuConfig.isPublic ? "Public" : "Private"}
					</span>
				</p>
				<p className="text-[10px] text-zinc-600">
					{ssuConfig.isPublic
						? "This SSU is discoverable in cross-market queries."
						: "This SSU is only visible via direct link."}
				</p>
				{error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
				{success && <p className="mt-1 text-[10px] text-emerald-400">{success}</p>}
			</div>
			<button
				type="button"
				onClick={handleToggle}
				disabled={isPending}
				className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
			>
				{isPending ? "Saving..." : ssuConfig.isPublic ? "Make Private" : "Make Public"}
			</button>
		</div>
	);
}
