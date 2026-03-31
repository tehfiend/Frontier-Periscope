import { AssemblyActions } from "@/components/AssemblyActions";
import { ContentTabs } from "@/components/ContentTabs";
import { ExtensionInfo } from "@/components/ExtensionInfo";
import { PublishToMapDialog } from "@/components/PublishToMapDialog";
import { SsuInfoCard } from "@/components/SsuInfoCard";
import type { CapRef, TransferContext } from "@/components/TransferDialog";
import { useAssembly } from "@/hooks/useAssembly";
import { useBuyOrders } from "@/hooks/useBuyOrders";
import { useCharacter } from "@/hooks/useCharacter";
import { normalizeId, useInventory } from "@/hooks/useInventory";
import { useMarketListings } from "@/hooks/useMarketListings";
import { useOwnerCap } from "@/hooks/useOwnerCap";
import { useOwnerCharacter } from "@/hooks/useOwnerCharacter";
import { useSsuConfig } from "@/hooks/useSsuConfig";
import { getItemId, getTenant, getWorldPackageId } from "@/lib/constants";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { type TenantId, getContractAddresses } from "@tehfrontier/chain-shared";
import { useMemo, useState } from "react";

/** Coin type is resolved dynamically from the linked Market<T> via SsuConfig. */

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

	const {
		data: inventories,
		isLoading: inventoryLoading,
		refetch: refetchInventory,
	} = useInventory(assembly ? objectId : null, assembly?.rawJson ?? null);

	// Phase 2: Owner context (only when wallet is connected)
	const { data: character } = useCharacter(walletAddress);
	const { data: ownerCapInfo } = useOwnerCap(character?.characterObjectId, assembly?.ownerCapId);
	const { data: charOwnerCapInfo } = useOwnerCap(
		character?.characterObjectId,
		character?.characterOwnerCapId ?? undefined,
	);

	// SSU owner character info (name + object ID, from ownerCapId)
	const { data: ownerCharacterInfo } = useOwnerCharacter(assembly?.ownerCapId);

	// SsuConfig detection -- only when SSU has a ssu_market extension
	const { data: ssuConfig } = useSsuConfig(objectId, assembly?.extensionType);

	// Market data -- only when SsuConfig has a linked market
	const { data: listings, isLoading: listingsLoading } = useMarketListings(ssuConfig?.marketId);
	const { data: buyOrders, isLoading: buyOrdersLoading } = useBuyOrders(ssuConfig?.marketId);

	// State for Publish to Map dialog
	const [showMapDialog, setShowMapDialog] = useState(false);
	const tenant = getTenant();
	const hasPrivateMapContract = !!getContractAddresses(tenant as TenantId).privateMap?.packageId;

	// Determine if connected wallet is the SSU owner
	// The owner_cap_id on the SSU matches an OwnerCap held by the player's Character
	const isOwner = !!ownerCapInfo && !!character;

	// Determine if connected wallet is the SsuConfig owner
	const isSsuOwner = !!ssuConfig && !!walletAddress && ssuConfig.owner === walletAddress;

	// Determine if connected wallet is authorized (owner or delegate)
	const isAuthorized =
		isSsuOwner || (!!ssuConfig && !!walletAddress && ssuConfig.delegates.includes(walletAddress));

	// Build transfer context for inter-slot item transfers
	const transferContext = useMemo<TransferContext | null>(() => {
		// Need at least a character to transfer (either as owner or as market participant)
		if (!character || !assembly) return null;

		// Without an extension, require SSU ownership for transfers
		if (!ssuConfig && !isOwner) return null;
		if (!ssuConfig && !ownerCapInfo) return null;

		// Extension-based inventory functions
		const hasExtension = assembly.extensionType?.includes("::ssu_unified::");
		const extensionPkg = hasExtension
			? getContractAddresses(getTenant() as TenantId).ssuUnified?.packageId
			: undefined;

		const worldPkg = getWorldPackageId(getTenant());
		const slotCaps = new Map<string, CapRef>();

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

		// Determine the module name for moveCall targets
		const extensionModule = "ssu_unified";

		return {
			ssuObjectId: objectId,
			characterObjectId: character.characterObjectId,
			characterName: character.characterName,
			slotCaps,
			ssuConfigId: hasExtension ? ssuConfig?.ssuConfigId : undefined,
			marketPackageId: extensionPkg,
			marketId: ssuConfig?.marketId,
			isAuthorized,
			extensionModule,
		};
	}, [
		isOwner,
		isAuthorized,
		character,
		ownerCapInfo,
		charOwnerCapInfo,
		assembly,
		objectId,
		ssuConfig,
	]);

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
		<div className="mx-auto max-w-3xl space-y-4">
			{/* Card 1: SSU Info + Edit */}
			<SsuInfoCard
				assembly={assembly}
				itemId={getItemId()}
				isOwner={isOwner}
				characterObjectId={character?.characterObjectId}
				ownerCap={ownerCapInfo ?? undefined}
				ssuObjectId={objectId}
			/>

			{/* Card 2: Content Tabs (Inventory + Market + Settings) */}
			{inventories && (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
					<ContentTabs
						inventories={inventories}
						inventoryLoading={inventoryLoading}
						onRefreshInventory={refetchInventory}
						transferContext={transferContext}
						ssuConfig={ssuConfig ?? null}
						ssuObjectId={objectId}
						isConnected={!!account}
						coinType={ssuConfig?.coinType ?? ""}
						listings={listings ?? []}
						buyOrders={buyOrders ?? []}
						listingsLoading={listingsLoading}
						buyOrdersLoading={buyOrdersLoading}
						walletAddress={walletAddress}
						ownerCharacterObjectId={ownerCharacterInfo?.characterObjectId ?? null}
						isSsuOwner={isSsuOwner}
						ownerCharacterName={ownerCharacterInfo?.characterName ?? null}
						connectedCharacterName={character?.characterName ?? null}
						extensionType={assembly.extensionType}
						dappUrl={assembly.metadata?.url ?? null}
						ownerCharacterForMetadata={character?.characterObjectId ?? null}
						ownerCap={ownerCapInfo ?? null}
						metadata={assembly.metadata}
						connectedCharacterObjectId={character?.characterObjectId ?? null}
						charOwnerCap={charOwnerCapInfo ?? null}
						charOwnerCapId={character?.characterOwnerCapId ?? null}
					/>
				</div>
			)}

			{/* Assembly status + Extension info (kept at bottom for now) */}
			{isOwner && character && ownerCapInfo && (
				<AssemblyActions
					assembly={assembly}
					characterObjectId={character.characterObjectId}
					ownerCap={ownerCapInfo}
					ssuObjectId={objectId}
				/>
			)}

			<ExtensionInfo
				extensionType={assembly.extensionType}
				isOwner={isOwner}
				characterObjectId={character?.characterObjectId}
				ownerCap={ownerCapInfo ?? undefined}
				ssuObjectId={objectId}
				ssuConfig={ssuConfig ?? undefined}
				metadata={assembly.metadata}
				itemId={assembly.itemId}
			/>

			{/* Publish to Map button (visible when wallet connected and contract deployed) */}
			{walletAddress && hasPrivateMapContract && (
				<div className="flex justify-end">
					<button
						type="button"
						onClick={() => setShowMapDialog(true)}
						className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
					>
						Publish to Map
					</button>
				</div>
			)}

			{/* Publish to Map dialog */}
			{showMapDialog && walletAddress && (
				<PublishToMapDialog
					ssuObjectId={objectId}
					walletAddress={walletAddress}
					onClose={() => setShowMapDialog(false)}
				/>
			)}
		</div>
	);
}
