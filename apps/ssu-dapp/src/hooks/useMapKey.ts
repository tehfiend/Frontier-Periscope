import { useDAppKit } from "@mysten/dapp-kit-react";
import { deriveMapKeyFromSignature } from "@tehfrontier/chain-shared";
import { useCallback, useState } from "react";

/** The message signed by the wallet to derive the map key. */
const MAP_KEY_MESSAGE = "TehFrontier Map Key v1";

/**
 * Hook to derive an X25519 keypair from the connected wallet.
 * Uses signPersonalMessage with a deterministic message so the
 * same wallet always produces the same key (no local storage needed).
 */
export function useMapKey(): {
	keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null;
	deriveKey: () => Promise<void>;
	isDerivingKey: boolean;
} {
	const dAppKit = useDAppKit();
	const [keyPair, setKeyPair] = useState<{
		publicKey: Uint8Array;
		secretKey: Uint8Array;
	} | null>(null);
	const [isDerivingKey, setIsDerivingKey] = useState(false);

	const deriveKey = useCallback(async () => {
		setIsDerivingKey(true);
		try {
			const { signature } = await dAppKit.signPersonalMessage({
				message: new TextEncoder().encode(MAP_KEY_MESSAGE),
			});
			const derived = deriveMapKeyFromSignature(signature);
			setKeyPair(derived);
		} catch {
			// User rejected or signing failed
		} finally {
			setIsDerivingKey(false);
		}
	}, [dAppKit]);

	return { keyPair, deriveKey, isDerivingKey };
}
