import type { AssemblyData } from "@/hooks/useAssembly";
import type { OwnerCapInfo } from "@/hooks/useOwnerCap";
import { useState } from "react";
import { AssemblyHeader } from "./AssemblyHeader";
import { MetadataEditor } from "./MetadataEditor";

interface SsuInfoCardProps {
	assembly: AssemblyData;
	itemId?: string | null;
	ownerCharacterName?: string | null;
	connectedWalletAddress?: string | null;
	connectedCharacterName?: string | null;
	isOwner: boolean;
	characterObjectId?: string;
	ownerCap?: OwnerCapInfo;
	ssuObjectId: string;
}

export function SsuInfoCard({
	assembly,
	itemId,
	ownerCharacterName,
	connectedWalletAddress,
	connectedCharacterName,
	isOwner,
	characterObjectId,
	ownerCap,
	ssuObjectId,
}: SsuInfoCardProps) {
	const [isEditing, setIsEditing] = useState(false);

	return (
		<div>
			<AssemblyHeader
				assembly={assembly}
				itemId={itemId}
				ownerCharacterName={ownerCharacterName}
				connectedWalletAddress={connectedWalletAddress}
				connectedCharacterName={connectedCharacterName}
				onEdit={isOwner ? () => setIsEditing((prev) => !prev) : undefined}
			/>

			{isEditing && isOwner && characterObjectId && ownerCap && (
				<div className="mt-2">
					<MetadataEditor
						ssuObjectId={ssuObjectId}
						characterObjectId={characterObjectId}
						ownerCap={ownerCap}
						metadata={assembly.metadata}
					/>
				</div>
			)}
		</div>
	);
}
