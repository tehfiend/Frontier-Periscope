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
		gateToll: {
			packageId: "0xcef451bbe80afd7e495d5de87ace2989097731534ac100d0785f91a427e1f6a8",
			configObjectId: "0xb1f7ddda99a315704350b4f0a3d82626a4a62da4102afb20222c8a423657efd5",
		},
		exchange: { packageId: "0x72928ee80a252eece16925c3e7d0cbf6280a8981ebf72c1a0f614f9d8a48315d" },
		ssuMarket: {
			packageId: "0xe4421093140ace1a828b49c4b5d570f9705ea94f968e16a59faf89b185acfd25",
			originalPackageId: "0x3339a266b12a7829dc873813608151caff50c46466e13fab020acd6dfe2397a2",
			previousOriginalPackageIds: [
				"0x40576ea9e07fa8516abc4820a24be12b0ad7678d181afba5710312d2a0ca6e48",
				"0x3339a266b12a7829dc873813608151caff50c46466e13fab020acd6dfe2397a2",
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
		market: {
			packageId: "0xf9c4151434bc6158c21b7ba7d2860c8ce168dcd8ed39815a4c4c71108a5a311a",
		},
		privateMap: {
			packageId: "0x2be1058fa8b002b81d4f91fd33065f17e2a3bbd9799ea0d934b74aaff8160a17",
		},
		// TODO: populate after contract publish
		standings: { packageId: "" },
		standingsRegistry: {
			packageId: "0x7d3864e7d1c1c0573cdbc044bffdb0711100f5461910c086777580d005c76341",
		},
		gateStandings: {
			packageId: "0xef2cd2bc3a93cbb7286ed4bf9ebf7c49c6459f50db0a1d0c94d19810f2a62eb4",
			configObjectId: "0x312a3ea9282b1b702da100c288c520aa452eced3dd325e718c06196b1b9db627",
		},
		ssuStandings: {
			packageId: "0x8668a4901482851d8c216a4440f9a03327fdd320d30643aa1f4efe5ec25c568d",
			configObjectId: "0x87dc574e707930ffeaf337617c16eb8ec8bfee3e7a00f02cc0789ee7f9555c5a",
		},
		marketStandings: {
			packageId: "0xbfaf85431b9f5dd9675b08dd483725d3c53b8433e6c7345c54e5023863a9c9f9",
		},
		tokenTemplateStandings: {
			packageId: "0x130c8e9a4c58425497e30a8f1a1511c2532a2b387ada7e92d834c06898d55796",
		},
		ssuMarketStandings: {
			packageId: "0xf0f602777ea2e90372e93fd9b1c534c123c974a5979e8cafcb2c111b80d4e3ca",
		},
		privateMapStandings: {
			packageId: "0xade891ec8e8eca5f7594a16fc57ab78b8b20d62a1706218c334be8d7b59214ed",
		},
		ssuUnified: {
			packageId: "0x8668a4901482851d8c216a4440f9a03327fdd320d30643aa1f4efe5ec25c568d",
		},
		treasury: { packageId: "" },
		gateTollCustom: { packageId: "", configObjectId: "" },
	},
	utopia: {
		gateUnified: {
			packageId: "0x364f68ad3272d9815f2fce74776a854af1e3cb8de58ad1a1d7a0e67ad436210f",
			configObjectId: "0x1b5bec5f6346ec165e66b5e5cb75665f4ff44ba9a1df5b318bbf755777daf01a",
		},
		gateToll: {
			packageId: "0xcef451bbe80afd7e495d5de87ace2989097731534ac100d0785f91a427e1f6a8",
			configObjectId: "0xb1f7ddda99a315704350b4f0a3d82626a4a62da4102afb20222c8a423657efd5",
		},
		exchange: { packageId: "0x72928ee80a252eece16925c3e7d0cbf6280a8981ebf72c1a0f614f9d8a48315d" },
		ssuMarket: {
			packageId: "0xcc4ea24f7be2f0456008e72dbf6bd787ad60fafa388383fbe913c3734dcfec84",
			originalPackageId: "0x2796505934119806d4b8b057a00a1c0672769e9a17dbcf7df28df276e4afb74c",
			previousOriginalPackageIds: [
				"0xf6e9699d86cd58580dd7d4ea73f8d42841c72b4f23d9de71d2988baabc5f25a0",
				"0x53c2bf5e90d12b8a92594ab959f3d883dc2afdaf6031e9640151f82582a17501",
				"0x2796505934119806d4b8b057a00a1c0672769e9a17dbcf7df28df276e4afb74c",
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
		market: {
			packageId: "0xf9c4151434bc6158c21b7ba7d2860c8ce168dcd8ed39815a4c4c71108a5a311a",
		},
		privateMap: {
			packageId: "0x2be1058fa8b002b81d4f91fd33065f17e2a3bbd9799ea0d934b74aaff8160a17",
		},
		standings: {
			packageId: "0xb1e222afffd559191bb909784e139d4ec7c044f57f2be2a376548c63c5d35abd",
		},
		standingsRegistry: {
			packageId: "0x7d3864e7d1c1c0573cdbc044bffdb0711100f5461910c086777580d005c76341",
		},
		gateStandings: {
			packageId: "0xef2cd2bc3a93cbb7286ed4bf9ebf7c49c6459f50db0a1d0c94d19810f2a62eb4",
			configObjectId: "0x312a3ea9282b1b702da100c288c520aa452eced3dd325e718c06196b1b9db627",
		},
		ssuStandings: {
			packageId: "0x8668a4901482851d8c216a4440f9a03327fdd320d30643aa1f4efe5ec25c568d",
			configObjectId: "0x87dc574e707930ffeaf337617c16eb8ec8bfee3e7a00f02cc0789ee7f9555c5a",
		},
		marketStandings: {
			packageId: "0xbfaf85431b9f5dd9675b08dd483725d3c53b8433e6c7345c54e5023863a9c9f9",
		},
		tokenTemplateStandings: {
			packageId: "0x130c8e9a4c58425497e30a8f1a1511c2532a2b387ada7e92d834c06898d55796",
		},
		ssuMarketStandings: {
			packageId: "0xd14b9cf232696fa471d0c6edd2fa8e3be6bdd64cffa26c57333f8bf6757ab917",
		},
		privateMapStandings: {
			packageId: "0xade891ec8e8eca5f7594a16fc57ab78b8b20d62a1706218c334be8d7b59214ed",
		},
		ssuUnified: {
			packageId: "0x8668a4901482851d8c216a4440f9a03327fdd320d30643aa1f4efe5ec25c568d",
		},
		treasury: { packageId: "" },
		gateTollCustom: { packageId: "", configObjectId: "" },
	},
};

export function getContractAddresses(tenant: TenantId): ContractAddresses {
	return CONTRACT_ADDRESSES[tenant];
}
