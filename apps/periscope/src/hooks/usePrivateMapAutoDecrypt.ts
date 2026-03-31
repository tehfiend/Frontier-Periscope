import { TENANTS, type TenantId } from "@/chain/config";
import {
	decryptMapKeys,
	decryptMapKeysV2,
	decryptStoredLocations,
} from "@/chain/manifest";
import { db } from "@/db";
import { useStoredEncryptionKey } from "@/hooks/useStoredEncryptionKey";
import { useEffect, useRef } from "react";

/**
 * Auto-decrypt private map locations when the wallet connects.
 *
 * The manifest auto-sync fetches and stores location records (encrypted)
 * on app startup, but decryption requires the wallet's X25519 keypair
 * which is only available after wallet connect. This hook bridges that
 * gap so locations are decrypted at the app level -- not just when the
 * user navigates to the Private Maps page.
 */
export function usePrivateMapAutoDecrypt() {
	const { keyPair } = useStoredEncryptionKey();
	const ranRef = useRef(false);

	useEffect(() => {
		if (!keyPair || ranRef.current) return;
		ranRef.current = true;

		(async () => {
			for (const tenantId of Object.keys(TENANTS) as TenantId[]) {
				try {
					// Decrypt V1 map keys
					await decryptMapKeys(keyPair, tenantId);

					// Decrypt V1 stored locations
					const mapsV1 = await db.manifestPrivateMaps
						.where("tenant")
						.equals(tenantId)
						.toArray();
					for (const m of mapsV1) {
						if (m.decryptedMapKey) {
							await decryptStoredLocations(m.id, m.decryptedMapKey, m.publicKey);
						}
					}

					// Decrypt V2 map keys (mode=0 only)
					await decryptMapKeysV2(keyPair, tenantId);

					// Decrypt V2 stored locations
					const mapsV2 = await db.manifestPrivateMapsV2
						.where("tenant")
						.equals(tenantId)
						.toArray();
					for (const m of mapsV2) {
						if (m.mode === 0 && m.decryptedMapKey && m.publicKey) {
							await decryptStoredLocations(m.id, m.decryptedMapKey, m.publicKey);
						}
					}
				} catch (err) {
					console.warn(`[auto-decrypt] ${tenantId}:`, err);
				}
			}
		})();
	}, [keyPair]);
}
