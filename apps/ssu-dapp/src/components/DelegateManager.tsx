import type { CharacterSearchResult } from "@/hooks/useCharacterSearch";
import { useCharacterSearch } from "@/hooks/useCharacterSearch";
import { useCharacterNames } from "@/hooks/useCharacterNames";
import { useSignAndExecute } from "@/hooks/useSignAndExecute";
import type { SsuConfigResult } from "@/hooks/useSsuConfig";
import { useSuiClient } from "@/hooks/useSuiClient";
import { decodeErrorMessage } from "@/lib/errors";
import { getTenant, getWorldPackageId } from "@/lib/constants";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { queryMarketDetails } from "@tehfrontier/chain-shared";
import { useState } from "react";
import { CopyAddress } from "./CopyAddress";

interface DelegateManagerProps {
	ssuConfig: SsuConfigResult;
}

/**
 * Resolve the wallet address for a Character.
 * Characters are shared objects (no direct owner). The link is:
 * wallet -> PlayerProfile(character_id) -> Character.
 * We scan PlayerProfiles to find the one referencing this character.
 */
const FIND_PROFILE_BY_CHARACTER = `
	query($type: String!, $first: Int, $after: String) {
		objects(filter: { type: $type }, first: $first, after: $after) {
			nodes {
				owner { ... on AddressOwner { address { address } } }
				asMoveObject { contents { json } }
			}
			pageInfo { hasNextPage endCursor }
		}
	}
`;

export function DelegateManager({ ssuConfig }: DelegateManagerProps) {
	const account = useCurrentAccount();
	const client = useSuiClient();
	const { mutateAsync: signAndExecute, isPending } = useSignAndExecute();
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCharacter, setSelectedCharacter] = useState<CharacterSearchResult | null>(null);
	const [manualAddress, setManualAddress] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const { data: searchResults, isLoading: searchLoading } = useCharacterSearch(searchQuery);
	const { data: delegateNames } = useCharacterNames(ssuConfig.delegates);

	function clearForm() {
		setSearchQuery("");
		setSelectedCharacter(null);
		setManualAddress("");
		setError(null);
		setSuccess(null);
	}

	async function resolveWalletAddress(characterObjectId: string): Promise<string | null> {
		const worldPkg = getWorldPackageId(getTenant());
		const profileType = `${worldPkg}::character::PlayerProfile`;

		interface ProfileResponse {
			objects: {
				nodes: Array<{
					owner?: { address?: { address: string } };
					asMoveObject?: { contents?: { json: Record<string, unknown> } };
				}>;
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
			};
		}

		let cursor: string | null = null;
		for (let page = 0; page < 20; page++) {
			const r: { data?: ProfileResponse | null } = await client.query({
				query: FIND_PROFILE_BY_CHARACTER,
				variables: { type: profileType, first: 50, after: cursor },
			});

			for (const node of r.data?.objects?.nodes ?? []) {
				const json = node.asMoveObject?.contents?.json;
				if (!json) continue;
				if (String(json.character_id ?? "") === characterObjectId) {
					return node.owner?.address?.address ?? null;
				}
			}

			const pi = r.data?.objects?.pageInfo;
			if (!pi?.hasNextPage) break;
			cursor = pi.endCursor;
		}

		return null;
	}

	/** Fetch the market's current authorized list (returns [] if no market). */
	async function getMarketAuthorized(): Promise<string[]> {
		if (!ssuConfig.marketId) return [];
		try {
			const info = await queryMarketDetails(client, ssuConfig.marketId);
			return info?.authorized ?? [];
		} catch {
			return [];
		}
	}

	async function handleAdd() {
		if (!account?.address) return;
		setError(null);
		setSuccess(null);

		let delegateAddress: string;

		if (selectedCharacter) {
			// Resolve wallet address from character
			const addr = await resolveWalletAddress(selectedCharacter.characterObjectId);
			if (!addr) {
				setError("Could not resolve wallet address for this character");
				return;
			}
			delegateAddress = addr;
		} else {
			// Manual address entry
			const addr = manualAddress.trim();
			if (!/^0x[0-9a-fA-F]{64}$/.test(addr)) {
				setError("Enter a valid Sui address (0x + 64 hex characters)");
				return;
			}
			delegateAddress = addr;
		}

		try {
			const tx = new Transaction();
			tx.setSender(account.address);

			// 1. Add SSU delegate
			tx.moveCall({
				target: `${ssuConfig.packageId}::ssu_unified::add_delegate`,
				arguments: [tx.object(ssuConfig.ssuConfigId), tx.pure.address(delegateAddress)],
			});

			// 2. Also authorize on the linked Market (skip if already authorized)
			if (ssuConfig.marketId && ssuConfig.coinType && ssuConfig.marketPackageId) {
				const authorized = await getMarketAuthorized();
				if (!authorized.includes(delegateAddress)) {
					tx.moveCall({
						target: `${ssuConfig.marketPackageId}::market::add_authorized`,
						typeArguments: [ssuConfig.coinType],
						arguments: [tx.object(ssuConfig.marketId), tx.pure.address(delegateAddress)],
					});
				}
			}

			await signAndExecute(tx);
			setSuccess(
				selectedCharacter
					? `Added ${selectedCharacter.characterName} as delegate`
					: "Delegate added",
			);
			clearForm();
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	async function handleRemove(delegate: string) {
		if (!account?.address) return;
		setError(null);
		setSuccess(null);

		try {
			const tx = new Transaction();
			tx.setSender(account.address);

			// 1. Remove SSU delegate
			tx.moveCall({
				target: `${ssuConfig.packageId}::ssu_unified::remove_delegate`,
				arguments: [tx.object(ssuConfig.ssuConfigId), tx.pure.address(delegate)],
			});

			// 2. Also remove from Market authorized list (only if they're on it)
			if (ssuConfig.marketId && ssuConfig.coinType && ssuConfig.marketPackageId) {
				const authorized = await getMarketAuthorized();
				if (authorized.includes(delegate)) {
					tx.moveCall({
						target: `${ssuConfig.marketPackageId}::market::remove_authorized`,
						typeArguments: [ssuConfig.coinType],
						arguments: [tx.object(ssuConfig.marketId), tx.pure.address(delegate)],
					});
				}
			}

			await signAndExecute(tx);
			setSuccess("Delegate removed");
		} catch (err) {
			setError(decodeErrorMessage(String(err)));
		}
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h3 className="mb-3 text-sm font-medium text-zinc-300">Delegates</h3>

			{ssuConfig.delegates.length > 0 ? (
				<div className="mb-3 space-y-1.5">
					{ssuConfig.delegates.map((d) => {
						const name = delegateNames?.get(d);
						return (
							<div key={d} className="flex items-center justify-between">
								<span className="flex items-center gap-1.5">
									{name && <span className="text-xs text-zinc-200">{name}</span>}
									<CopyAddress address={d} className={`text-xs ${name ? "text-zinc-500" : "text-zinc-300"}`} />
								</span>
								<button
									type="button"
									onClick={() => handleRemove(d)}
									disabled={isPending}
									className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50"
								>
									Remove
								</button>
							</div>
						);
					})}
				</div>
			) : (
				<p className="mb-3 text-xs text-zinc-600">No delegates</p>
			)}

			{/* Add delegate */}
			<div className="space-y-2">
				{/* Character search */}
				<input
					type="text"
					value={selectedCharacter ? "" : searchQuery}
					onChange={(e) => {
						setSearchQuery(e.target.value);
						setSelectedCharacter(null);
						setManualAddress("");
						setError(null);
						setSuccess(null);
					}}
					placeholder="Search character name..."
					disabled={!!selectedCharacter}
					className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
				/>

				{/* Search results dropdown */}
				{!selectedCharacter && searchResults && searchResults.length > 0 && (
					<div className="max-h-32 overflow-y-auto rounded border border-zinc-700 bg-zinc-800">
						{searchResults.map((c) => (
							<button
								key={c.characterObjectId}
								type="button"
								onClick={() => {
									setSelectedCharacter(c);
									setSearchQuery("");
								}}
								className="w-full px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700"
							>
								{c.characterName}
							</button>
						))}
					</div>
				)}
				{!selectedCharacter &&
					searchQuery.length >= 2 &&
					!searchLoading &&
					searchResults?.length === 0 && (
						<p className="text-[10px] text-zinc-600">No characters found</p>
					)}
				{searchLoading && searchQuery.length >= 2 && (
					<p className="text-[10px] text-zinc-500">Searching...</p>
				)}

				{/* Selected character */}
				{selectedCharacter && (
					<div className="flex items-center justify-between rounded border border-cyan-800 bg-cyan-900/20 px-2 py-1.5">
						<span className="text-xs text-cyan-300">{selectedCharacter.characterName}</span>
						<button
							type="button"
							onClick={() => {
								setSelectedCharacter(null);
								setSearchQuery("");
							}}
							className="text-[10px] text-zinc-500 hover:text-zinc-300"
						>
							Change
						</button>
					</div>
				)}

				{/* Manual address fallback */}
				{!selectedCharacter && searchQuery.length === 0 && (
					<input
						type="text"
						value={manualAddress}
						onChange={(e) => {
							setManualAddress(e.target.value);
							setError(null);
							setSuccess(null);
						}}
						placeholder="or paste 0x... address"
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				)}

				<button
					type="button"
					onClick={handleAdd}
					disabled={isPending || (!selectedCharacter && !manualAddress.trim())}
					className="w-full rounded bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500 disabled:opacity-50"
				>
					{isPending ? "Adding..." : "Add Delegate"}
				</button>
			</div>

			{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
			{success && <p className="mt-2 text-xs text-emerald-400">{success}</p>}
		</div>
	);
}
