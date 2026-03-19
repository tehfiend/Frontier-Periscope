import { AssemblyActions } from "@/components/AssemblyActions";
import { AssemblyHeader } from "@/components/AssemblyHeader";
import { ExtensionInfo } from "@/components/ExtensionInfo";
import { InventoryTabs } from "@/components/InventoryTabs";
import { MetadataEditor } from "@/components/MetadataEditor";
import type { TransferContext } from "@/components/TransferDialog";
import { useAssembly } from "@/hooks/useAssembly";
import { useCharacter } from "@/hooks/useCharacter";
import { normalizeId } from "@/hooks/useInventory";
import { useInventory } from "@/hooks/useInventory";
import { useMarketConfig } from "@/hooks/useMarketConfig";
import { useOwnerCap } from "@/hooks/useOwnerCap";
import { useOwnerCharacter } from "@/hooks/useOwnerCharacter";
import { getItemId, getTenant, getWorldPackageId } from "@/lib/constants";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useMemo } from "react";

interface SsuViewProps {
	objectId: string;
}

export function SsuView({ objectId }: SsuViewProps) {
	const account = useCurrentAccount();
	const walletAddress = account?.address;

	// Phase 1: Read-only data
	const {
		data: assembly,
		isLoading: assemblyLoading,
		error: assemblyError,
	} = useAssembly(objectId);

	const { data: inventories, isLoading: inventoryLoading } = useInventory(
		assembly ? objectId : null,
		assembly?.rawJson ?? null,
	);

	// Phase 2: Owner context (only when wallet is connected)
	const { data: character } = useCharacter(walletAddress);
	const { data: ownerCapInfo } = useOwnerCap(character?.characterObjectId, assembly?.ownerCapId);
	const { data: charOwnerCapInfo } = useOwnerCap(
		character?.characterObjectId,
		character?.characterOwnerCapId ?? undefined,
	);

	// SSU owner character name (from ownerCapId)
	const { data: ownerCharacterName } = useOwnerCharacter(assembly?.ownerCapId);

	// MarketConfig detection -- only when SSU has a MarketAuth extension
	const { data: marketConfig } = useMarketConfig(objectId, assembly?.extensionType);

	// Determine if connected wallet is the SSU owner
	// The owner_cap_id on the SSU matches an OwnerCap held by the player's Character
	const isOwner = !!ownerCapInfo && !!character;

	// Determine if connected wallet is the MarketConfig admin
	const isMarketAdmin = !!marketConfig && !!walletAddress && marketConfig.admin === walletAddress;

	// Build transfer context for inter-slot item transfers
	const transferContext = useMemo<TransferContext | null>(() => {
		// Need at least a character to transfer (either as owner or as market participant)
		if (!character || !assembly) return null;

		// Without market extension, require SSU ownership for transfers
		if (!marketConfig && !isOwner) return null;
		if (!marketConfig && !ownerCapInfo) return null;

		const worldPkg = getWorldPackageId(getTenant());
		const slotCaps = new Map<string, { info: typeof ownerCapInfo; typeArg: string }>();

		// Extension/owner inventory: keyed by SSU's owner_cap_id (only if user is SSU owner)
		if (isOwner && ownerCapInfo) {
			const ownerKey = normalizeId(assembly.ownerCapId);
			slotCaps.set(ownerKey, {
				info: ownerCapInfo,
				typeArg: `${worldPkg}::storage_unit::StorageUnit`,
			});
		}

		// Player inventory: keyed by Character's owner_cap_id
		if (charOwnerCapInfo && character.characterOwnerCapId) {
			const charKey = normalizeId(character.characterOwnerCapId);
			slotCaps.set(charKey, {
				info: charOwnerCapInfo,
				typeArg: `${worldPkg}::character::Character`,
			});
		}

		return {
			ssuObjectId: objectId,
			characterObjectId: character.characterObjectId,
			characterName: character.characterName,
			slotCaps,
			marketConfigId: marketConfig?.configObjectId,
			marketPackageId: marketConfig?.packageId,
			isAdmin: isMarketAdmin,
		};
	}, [isOwner, isMarketAdmin, character, ownerCapInfo, charOwnerCapInfo, assembly, objectId, marketConfig]);

	// Loading state
	if (assemblyLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="flex flex-col items-center gap-3">
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-500" />
					<p className="text-sm text-zinc-500">Loading storage unit...</p>
				</div>
			</div>
		);
	}

	// Error state
	if (assemblyError) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="text-center">
					<p className="text-sm text-red-400">Failed to load storage unit</p>
					<p className="mt-1 text-xs text-zinc-600">{String(assemblyError)}</p>
				</div>
			</div>
		);
	}

	// Not found
	if (!assembly) {
		return (
			<div className="flex h-64 items-center justify-center">
				<div className="text-center">
					<p className="text-sm text-zinc-400">Storage unit not found</p>
					<p className="mt-1 font-mono text-xs text-zinc-600">{objectId}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-2xl space-y-4">
			{/* Assembly header */}
			<AssemblyHeader
				assembly={assembly}
				itemId={getItemId()}
				ownerCharacterName={ownerCharacterName}
				connectedWalletAddress={walletAddress}
				connectedCharacterName={character?.characterName}
			/>

			{/* Inventory tabs (always visible, no wallet required) */}
			{inventories && (
				<InventoryTabs
					inventories={inventories}
					isLoading={inventoryLoading}
					transferContext={transferContext}
				/>
			)}

			{/* Owner panels (shown only when wallet connected + is owner) */}
			{isOwner && character && ownerCapInfo && inventories && (
				<div className="space-y-4">
					<div className="border-t border-zinc-800 pt-4">
						<h2 className="mb-3 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
							Owner Controls
						</h2>
					</div>

					<AssemblyActions
						assembly={assembly}
						characterObjectId={character.characterObjectId}
						ownerCap={ownerCapInfo}
					/>

					<MetadataEditor
						ssuObjectId={objectId}
						characterObjectId={character.characterObjectId}
						ownerCap={ownerCapInfo}
						metadata={assembly.metadata}
					/>

					<ExtensionInfo
						ssuObjectId={objectId}
						characterObjectId={character.characterObjectId}
						ownerCap={ownerCapInfo}
						extensionType={assembly.extensionType}
						isOwner={true}
					/>
				</div>
			)}

			{/* Extension info for non-owners (read-only, shown only if extension is configured) */}
			{!isOwner && assembly.extensionType && (
				<ExtensionInfo
					ssuObjectId={objectId}
					characterObjectId=""
					ownerCap={{ objectId: "", version: 0, digest: "" }}
					extensionType={assembly.extensionType}
					isOwner={false}
				/>
			)}
		</div>
	);
}
