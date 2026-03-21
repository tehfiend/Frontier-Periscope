import type { ContractAddresses } from "./types";

export type TenantId = "stillness" | "utopia";

/**
 * Per-tenant contract addresses. Populated after publishing.
 * Stillness deployed 2026-03-13 from address 0xa4dee9...883d
 */
export const CONTRACT_ADDRESSES: Record<TenantId, ContractAddresses> = {
	stillness: {
		gateUnified: {
			packageId: "0x364f68ad3272d9815f2fce74776a854af1e3cb8de58ad1a1d7a0e67ad436210f",
			configObjectId: "0x1b5bec5f6346ec165e66b5e5cb75665f4ff44ba9a1df5b318bbf755777daf01a",
		},
		turretShootAll: {
			packageId: "0x4ad1a19064c1d44dbb6844862f5de4e28fd4a38c3a1bc7531581e39b4f3294b9",
		},
		turretPriority: {
			packageId: "0xbbca3a051fd616da4ebb34b4f67bf6d7111a32904e7fc4da29acd9a9b2bbb5ef",
		},
		gateAcl: {
			packageId: "0x7e0ad0eff0aef4ea2b068209948c7036f2dbfcf51600029a0d27cd5bbf9ad44c",
			configObjectId: "0xa543f9158e517955b90dc864fc4c1fb00cca8f6fe688495f4a609335800f9dd6",
		},
		gateTribe: {
			packageId: "0x7ce73cdc22d21410794818a31522bc85c25ef97c3685214796f7347d76fd3298",
			configObjectId: "0x322baeaa93dab9802fb55d7875551c1e40dad88b402fa36a9f8aa8f1f6399816",
		},
		gateToll: {
			packageId: "0xcef451bbe80afd7e495d5de87ace2989097731534ac100d0785f91a427e1f6a8",
			configObjectId: "0xb1f7ddda99a315704350b4f0a3d82626a4a62da4102afb20222c8a423657efd5",
		},
		exchange: { packageId: "0x72928ee80a252eece16925c3e7d0cbf6280a8981ebf72c1a0f614f9d8a48315d" },
		ssuMarket: {
			packageId: "0x3339a266b12a7829dc873813608151caff50c46466e13fab020acd6dfe2397a2",
			originalPackageId: "0x3339a266b12a7829dc873813608151caff50c46466e13fab020acd6dfe2397a2",
			previousOriginalPackageIds: [
				"0x40576ea9e07fa8516abc4820a24be12b0ad7678d181afba5710312d2a0ca6e48",
			],
		},
		bountyBoard: {
			packageId: "0xf55f7830828c66d6402add527e9e4ff9190aaae52bbb7ab723d24f455021b4bf",
			boardObjectId: "0x38725e050f5872d381407dd0d97117b66daae4202e21bf2a0bbd743fca3a3a86",
		},
		lease: {
			packageId: "0x9920aff314ff7dd22e86488fd44e9db7af55479a7f2240f06c97ded05c7bc7ce",
			registryObjectId: "0x074ba40c24c3bea181ef628ccf6e24273d1309d9a257c3e2ab69b6ccc7e13947",
		},
		tokenTemplate: {
			packageId: "0x38e749bfd487ca48633df45126820e23eddfbba8e0fc391f0f7a748dcb665ccf",
		},
		governance: {
			packageId: "0x8bef45b3006c3112cbc4aa930a6aa521fc586cc8609c89514c4e14f514a578cb",
			claimsRegistryObjectId: "0xa443242e14ddcdbfa0b6ad63305df464ac110fb6abc59b2ed59db8a37f42082f",
		},
		aclRegistry: {
			packageId: "0x3b1cdef2e8ddbd17618357a2ea8101073f881086442507e722cb02aa3ffc3b55",
		},
		market: {
			packageId: "0xf9c4151434bc6158c21b7ba7d2860c8ce168dcd8ed39815a4c4c71108a5a311a",
		},
		privateMap: {
			packageId: "0x2be1058fa8b002b81d4f91fd33065f17e2a3bbd9799ea0d934b74aaff8160a17",
		},
	},
	utopia: {
		gateUnified: {
			packageId: "0x364f68ad3272d9815f2fce74776a854af1e3cb8de58ad1a1d7a0e67ad436210f",
			configObjectId: "0x1b5bec5f6346ec165e66b5e5cb75665f4ff44ba9a1df5b318bbf755777daf01a",
		},
		turretShootAll: {
			packageId: "0x4ad1a19064c1d44dbb6844862f5de4e28fd4a38c3a1bc7531581e39b4f3294b9",
		},
		turretPriority: {
			packageId: "0xbbca3a051fd616da4ebb34b4f67bf6d7111a32904e7fc4da29acd9a9b2bbb5ef",
		},
		gateAcl: {
			packageId: "0x44ff830c866ba3be10d42526b4d65b1f8dd2ba88acba66e847f6004543af4583",
			configObjectId: "0x61abf5d57a9383640b772ec962dec3bac6b5c50e10f1b0e7fc2328cdb6aee8be",
		},
		gateTribe: {
			packageId: "0x7ce73cdc22d21410794818a31522bc85c25ef97c3685214796f7347d76fd3298",
			configObjectId: "0x322baeaa93dab9802fb55d7875551c1e40dad88b402fa36a9f8aa8f1f6399816",
		},
		gateToll: {
			packageId: "0xcef451bbe80afd7e495d5de87ace2989097731534ac100d0785f91a427e1f6a8",
			configObjectId: "0xb1f7ddda99a315704350b4f0a3d82626a4a62da4102afb20222c8a423657efd5",
		},
		exchange: { packageId: "0x72928ee80a252eece16925c3e7d0cbf6280a8981ebf72c1a0f614f9d8a48315d" },
		ssuMarket: {
			packageId: "0x2796505934119806d4b8b057a00a1c0672769e9a17dbcf7df28df276e4afb74c",
			originalPackageId: "0x2796505934119806d4b8b057a00a1c0672769e9a17dbcf7df28df276e4afb74c",
			previousOriginalPackageIds: [
				"0xf6e9699d86cd58580dd7d4ea73f8d42841c72b4f23d9de71d2988baabc5f25a0",
				"0x53c2bf5e90d12b8a92594ab959f3d883dc2afdaf6031e9640151f82582a17501",
			],
		},
		bountyBoard: {
			packageId: "0xf55f7830828c66d6402add527e9e4ff9190aaae52bbb7ab723d24f455021b4bf",
			boardObjectId: "0x38725e050f5872d381407dd0d97117b66daae4202e21bf2a0bbd743fca3a3a86",
		},
		lease: {
			packageId: "0x9920aff314ff7dd22e86488fd44e9db7af55479a7f2240f06c97ded05c7bc7ce",
			registryObjectId: "0x074ba40c24c3bea181ef628ccf6e24273d1309d9a257c3e2ab69b6ccc7e13947",
		},
		tokenTemplate: {
			packageId: "0x38e749bfd487ca48633df45126820e23eddfbba8e0fc391f0f7a748dcb665ccf",
		},
		governance: {
			packageId: "0x8bef45b3006c3112cbc4aa930a6aa521fc586cc8609c89514c4e14f514a578cb",
			claimsRegistryObjectId: "0xa443242e14ddcdbfa0b6ad63305df464ac110fb6abc59b2ed59db8a37f42082f",
		},
		aclRegistry: {
			packageId: "0x3b1cdef2e8ddbd17618357a2ea8101073f881086442507e722cb02aa3ffc3b55",
		},
		market: {
			packageId: "0xf9c4151434bc6158c21b7ba7d2860c8ce168dcd8ed39815a4c4c71108a5a311a",
		},
		privateMap: {
			packageId: "0x2be1058fa8b002b81d4f91fd33065f17e2a3bbd9799ea0d934b74aaff8160a17",
		},
	},
};

export function getContractAddresses(tenant: TenantId): ContractAddresses {
	return CONTRACT_ADDRESSES[tenant];
}
