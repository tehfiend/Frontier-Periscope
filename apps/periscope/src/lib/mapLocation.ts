/**
 * Shared utility for building add-location transactions for private maps.
 * Supports V1 maps, V2 encrypted (mode=0), and V2 standings (mode=1).
 */

import type { Transaction } from "@mysten/sui/transactions";
import {
	buildAddLocation,
	buildAddLocationEncrypted,
	buildAddLocationStandings,
	encodeLocationData,
	hexToBytes,
	sealForRecipient,
} from "@tehfrontier/chain-shared";

export interface LocationInput {
	solarSystemId: number;
	planet: number;
	lPoint: number;
	description?: string;
}

export interface BuildAddLocationTxParams {
	/** "v1" or "v2" */
	mapVersion: "v1" | "v2";
	/** 0 = encrypted, 1 = cleartext standings (V2 only; V1 always 0) */
	mapMode: number;
	/** Package ID for the map contract */
	packageId: string;
	/** Map object ID */
	mapId: string;
	/** Invite object ID (V1 and V2 mode=0) */
	inviteId?: string;
	/** Structure object ID (optional) */
	structureId?: string;
	/** Location data to encode */
	locationData: LocationInput;
	/** Sender Sui address */
	senderAddress: string;
	/** Hex-encoded map public key (V1 and V2 mode=0) */
	mapPublicKey?: string;
	/** StandingsRegistry object ID (V2 mode=1) */
	registryId?: string;
	/** Tribe ID for standings check (V2 mode=1) */
	tribeId?: number;
	/** Character ID for standings check (V2 mode=1) */
	charId?: number;
}

/**
 * Build the appropriate add-location TX based on map version and mode.
 * - V1: encrypted with buildAddLocation
 * - V2 mode=0: encrypted with buildAddLocationEncrypted
 * - V2 mode=1: plaintext with buildAddLocationStandings
 */
export function buildAddLocationTx(params: BuildAddLocationTxParams): Transaction {
	const plaintext = encodeLocationData({
		solarSystemId: params.locationData.solarSystemId,
		planet: params.locationData.planet,
		lPoint: params.locationData.lPoint,
		description: params.locationData.description,
	});

	if (params.mapVersion === "v1") {
		if (!params.mapPublicKey || !params.inviteId) {
			throw new Error("V1 maps require mapPublicKey and inviteId");
		}
		const mapPubKey = hexToBytes(params.mapPublicKey);
		const encryptedData = sealForRecipient(plaintext, mapPubKey);
		return buildAddLocation({
			packageId: params.packageId,
			mapId: params.mapId,
			inviteId: params.inviteId,
			structureId: params.structureId,
			encryptedData,
			senderAddress: params.senderAddress,
		});
	}

	if (params.mapMode === 1) {
		// V2 standings -- plaintext
		if (params.registryId == null || params.tribeId == null || params.charId == null) {
			throw new Error("V2 standings maps require registryId, tribeId, and charId");
		}
		return buildAddLocationStandings({
			packageId: params.packageId,
			mapId: params.mapId,
			registryId: params.registryId,
			tribeId: params.tribeId,
			charId: params.charId,
			structureId: params.structureId,
			data: plaintext,
			senderAddress: params.senderAddress,
		});
	}

	// V2 mode=0 -- encrypted
	if (!params.mapPublicKey || !params.inviteId) {
		throw new Error("V2 encrypted maps require mapPublicKey and inviteId");
	}
	const mapPubKey = hexToBytes(params.mapPublicKey);
	const encryptedData = sealForRecipient(plaintext, mapPubKey);
	return buildAddLocationEncrypted({
		packageId: params.packageId,
		mapId: params.mapId,
		inviteId: params.inviteId,
		structureId: params.structureId,
		encryptedData,
		senderAddress: params.senderAddress,
	});
}
