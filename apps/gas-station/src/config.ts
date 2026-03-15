import { CONTRACT_ADDRESSES } from "@tehfrontier/chain-shared";

// ── Gas Station Configuration ────────────────────────────────────────────────

export const PORT = Number(process.env.GAS_STATION_PORT ?? 3100);
export const SUI_RPC_URL = process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";

/**
 * Private key for the gas station wallet (base64 or hex encoded Sui keypair).
 * This wallet pays for build/publish gas and co-signs sponsored transactions.
 */
export function getPrivateKey(): string {
	const key = process.env.GAS_STATION_PRIVATE_KEY;
	if (!key) {
		throw new Error("GAS_STATION_PRIVATE_KEY environment variable is required");
	}
	return key;
}

/**
 * Allowed package IDs for sponsored transactions.
 * Only MoveCall transactions targeting these packages will be co-signed.
 */
export function getAllowedPackageIds(): Set<string> {
	const allowed = new Set<string>();

	// Collect all deployed contract package IDs across tenants
	for (const tenant of Object.values(CONTRACT_ADDRESSES)) {
		for (const contract of Object.values(tenant)) {
			if (contract && "packageId" in contract) {
				allowed.add(contract.packageId);
			}
		}
	}

	// Also allow world package IDs (for character::borrow_owner_cap etc.)
	const worldPackages = [
		"0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c", // stillness
		"0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75", // utopia
		"0x353988e063b4683580e3603dbe9e91fefd8f6a06263a646d43fd3a2f3ef6b8c1", // nebula
	];
	for (const pkg of worldPackages) {
		allowed.add(pkg);
	}

	return allowed;
}
