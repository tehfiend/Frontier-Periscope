import type { ContractAddresses } from "./types";

export type TenantId = "stillness" | "utopia" | "nebula";

/**
 * Per-tenant contract addresses. Populated after publishing.
 * Stillness deployed 2026-03-13 from address 0xa4dee9...883d
 */
export const CONTRACT_ADDRESSES: Record<TenantId, ContractAddresses> = {
	stillness: {
		gateUnified: { packageId: "0x364f68ad3272d9815f2fce74776a854af1e3cb8de58ad1a1d7a0e67ad436210f", configObjectId: "0x1b5bec5f6346ec165e66b5e5cb75665f4ff44ba9a1df5b318bbf755777daf01a" },
		turretShootAll: { packageId: "0x4ad1a19064c1d44dbb6844862f5de4e28fd4a38c3a1bc7531581e39b4f3294b9" },
		turretPriority: { packageId: "0xbbca3a051fd616da4ebb34b4f67bf6d7111a32904e7fc4da29acd9a9b2bbb5ef" },
		gateAcl: { packageId: "0x7e0ad0eff0aef4ea2b068209948c7036f2dbfcf51600029a0d27cd5bbf9ad44c", configObjectId: "0xa543f9158e517955b90dc864fc4c1fb00cca8f6fe688495f4a609335800f9dd6" },
		gateTribe: { packageId: "0x7ce73cdc22d21410794818a31522bc85c25ef97c3685214796f7347d76fd3298", configObjectId: "0x322baeaa93dab9802fb55d7875551c1e40dad88b402fa36a9f8aa8f1f6399816" },
		gateToll: { packageId: "0xcef451bbe80afd7e495d5de87ace2989097731534ac100d0785f91a427e1f6a8", configObjectId: "0xb1f7ddda99a315704350b4f0a3d82626a4a62da4102afb20222c8a423657efd5" },
		exchange: { packageId: "0x72928ee80a252eece16925c3e7d0cbf6280a8981ebf72c1a0f614f9d8a48315d" },
		ssuMarket: { packageId: "0xdb9df166063dc60ab0a450a768d4010f3e5939e554910d6aa1dc1b72e5dc8885" },
		bountyBoard: { packageId: "0xf55f7830828c66d6402add527e9e4ff9190aaae52bbb7ab723d24f455021b4bf", boardObjectId: "0x38725e050f5872d381407dd0d97117b66daae4202e21bf2a0bbd743fca3a3a86" },
		lease: { packageId: "0x9920aff314ff7dd22e86488fd44e9db7af55479a7f2240f06c97ded05c7bc7ce", registryObjectId: "0x074ba40c24c3bea181ef628ccf6e24273d1309d9a257c3e2ab69b6ccc7e13947" },
		tokenTemplate: { packageId: "0x38e749bfd487ca48633df45126820e23eddfbba8e0fc391f0f7a748dcb665ccf" },
		governance: { packageId: "0x8bef45b3006c3112cbc4aa930a6aa521fc586cc8609c89514c4e14f514a578cb", claimsRegistryObjectId: "0xa443242e14ddcdbfa0b6ad63305df464ac110fb6abc59b2ed59db8a37f42082f" },
		governanceExt: { packageId: "" },
	},
	utopia: {
		gateUnified: { packageId: "0x364f68ad3272d9815f2fce74776a854af1e3cb8de58ad1a1d7a0e67ad436210f", configObjectId: "0x1b5bec5f6346ec165e66b5e5cb75665f4ff44ba9a1df5b318bbf755777daf01a" },
		turretShootAll: { packageId: "0x4ad1a19064c1d44dbb6844862f5de4e28fd4a38c3a1bc7531581e39b4f3294b9" },
		turretPriority: { packageId: "0xbbca3a051fd616da4ebb34b4f67bf6d7111a32904e7fc4da29acd9a9b2bbb5ef" },
		gateAcl: { packageId: "0x7e0ad0eff0aef4ea2b068209948c7036f2dbfcf51600029a0d27cd5bbf9ad44c", configObjectId: "0xa543f9158e517955b90dc864fc4c1fb00cca8f6fe688495f4a609335800f9dd6" },
		gateTribe: { packageId: "0x7ce73cdc22d21410794818a31522bc85c25ef97c3685214796f7347d76fd3298", configObjectId: "0x322baeaa93dab9802fb55d7875551c1e40dad88b402fa36a9f8aa8f1f6399816" },
		gateToll: { packageId: "0xcef451bbe80afd7e495d5de87ace2989097731534ac100d0785f91a427e1f6a8", configObjectId: "0xb1f7ddda99a315704350b4f0a3d82626a4a62da4102afb20222c8a423657efd5" },
		exchange: { packageId: "0x72928ee80a252eece16925c3e7d0cbf6280a8981ebf72c1a0f614f9d8a48315d" },
		ssuMarket: { packageId: "0xdb9df166063dc60ab0a450a768d4010f3e5939e554910d6aa1dc1b72e5dc8885" },
		bountyBoard: { packageId: "0xf55f7830828c66d6402add527e9e4ff9190aaae52bbb7ab723d24f455021b4bf", boardObjectId: "0x38725e050f5872d381407dd0d97117b66daae4202e21bf2a0bbd743fca3a3a86" },
		lease: { packageId: "0x9920aff314ff7dd22e86488fd44e9db7af55479a7f2240f06c97ded05c7bc7ce", registryObjectId: "0x074ba40c24c3bea181ef628ccf6e24273d1309d9a257c3e2ab69b6ccc7e13947" },
		tokenTemplate: { packageId: "0x38e749bfd487ca48633df45126820e23eddfbba8e0fc391f0f7a748dcb665ccf" },
		governance: { packageId: "0x8bef45b3006c3112cbc4aa930a6aa521fc586cc8609c89514c4e14f514a578cb", claimsRegistryObjectId: "0xa443242e14ddcdbfa0b6ad63305df464ac110fb6abc59b2ed59db8a37f42082f" },
		governanceExt: { packageId: "" },
	},
	nebula: {},
};

export function getContractAddresses(tenant: TenantId): ContractAddresses {
	return CONTRACT_ADDRESSES[tenant];
}
