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
		market: {
			packageId: "0xae423b77ed1252a90f3a47ff4d3d343a9414931335a235507e010c8875fb6114",
			previousOriginalPackageIds: [
				"0x1e5910d677d83f72f0e73b5815cd02abf6251d429f5ae2e13f27fb931e75e80d",
				"0xf9c4151434bc6158c21b7ba7d2860c8ce168dcd8ed39815a4c4c71108a5a311a",
			],
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
		marketStandings: {
			packageId: "0xbfaf85431b9f5dd9675b08dd483725d3c53b8433e6c7345c54e5023863a9c9f9",
		},
		privateMapStandings: {
			packageId: "0xade891ec8e8eca5f7594a16fc57ab78b8b20d62a1706218c334be8d7b59214ed",
		},
		ssuUnified: {
			packageId: "0xc22771b2828db1f8ba4eb1cd7d4024bb9c0ab4c8ddbf503bbe069544b6f51505",
			originalPackageId: "0x51c36d31b89cf1e7d3feb96ed6376f7c49b41d64419122428106ba9daed2a83f",
			previousOriginalPackageIds: [
				"0x5f8d1a1da12b0d9a6934a0db38af1200612971380730371ac75e6d1acdb88294",
				"0x0a6a70355f96e07417aa2e5b59c1e2ea8757c5ade5e8000bfc8daab93bfee2be",
				"0x51c36d31b89cf1e7d3feb96ed6376f7c49b41d64419122428106ba9daed2a83f",
			],
		},
		treasury: { packageId: "0xe0ca570a3a5da2d72254b3f6db62b46b8595e1e6ed4b8d455af343d208c357eb" },
		gateTollCustom: {
			packageId: "0x4def0d8117bc1921aa655f6d8f4af21db9d27f84e694c0d855051abde072a544",
			configObjectId: "0x3821916eab3892fae7ad4ad8811de60305e90fff88fc7fd71189bb77fb1c2f78",
			previousOriginalPackageIds: [
				"0x200200b3b2e381497a005c29f9abecc7a46bbd2b4d016bbb7f32bcf6d9e57c6a",
			],
		},
		decommission: {
			packageId: "0x611cd2c50af0dccfae35ac2c4a9f706a428cf9c32650c9d3b60fabb8ebda68d3",
			registryObjectId: "0xb4af01e89e6fc2e673f8145a5875b440d1da6b38926198f1e1694e16f37e406c",
		},
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
		market: {
			packageId: "0xae423b77ed1252a90f3a47ff4d3d343a9414931335a235507e010c8875fb6114",
			previousOriginalPackageIds: [
				"0x1e5910d677d83f72f0e73b5815cd02abf6251d429f5ae2e13f27fb931e75e80d",
				"0xf9c4151434bc6158c21b7ba7d2860c8ce168dcd8ed39815a4c4c71108a5a311a",
			],
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
		marketStandings: {
			packageId: "0xbfaf85431b9f5dd9675b08dd483725d3c53b8433e6c7345c54e5023863a9c9f9",
		},
		privateMapStandings: {
			packageId: "0xade891ec8e8eca5f7594a16fc57ab78b8b20d62a1706218c334be8d7b59214ed",
		},
		ssuUnified: {
			packageId: "0xb63defc104f49ff8fb5968987a366d327f2c810a6655b999a23e68112411979b",
			originalPackageId: "0xfffb9242bf2221cc0b9f89f8df7b452a90a20a79981aca0d57ac90b8de710fd7",
			previousOriginalPackageIds: [
				"0x5f8d1a1da12b0d9a6934a0db38af1200612971380730371ac75e6d1acdb88294",
				"0xd3168c9b6db1ff6671d45b056dccd62acc7fa05835eb3079bce10d70af8950ea",
				"0xfffb9242bf2221cc0b9f89f8df7b452a90a20a79981aca0d57ac90b8de710fd7",
			],
		},
		treasury: { packageId: "0xe0ca570a3a5da2d72254b3f6db62b46b8595e1e6ed4b8d455af343d208c357eb" },
		gateTollCustom: {
			packageId: "0x4def0d8117bc1921aa655f6d8f4af21db9d27f84e694c0d855051abde072a544",
			configObjectId: "0x3821916eab3892fae7ad4ad8811de60305e90fff88fc7fd71189bb77fb1c2f78",
			previousOriginalPackageIds: [
				"0x200200b3b2e381497a005c29f9abecc7a46bbd2b4d016bbb7f32bcf6d9e57c6a",
			],
		},
		decommission: {
			packageId: "0x611cd2c50af0dccfae35ac2c4a9f706a428cf9c32650c9d3b60fabb8ebda68d3",
			registryObjectId: "0xb4af01e89e6fc2e673f8145a5875b440d1da6b38926198f1e1694e16f37e406c",
		},
	},
};

export function getContractAddresses(tenant: TenantId): ContractAddresses {
	return CONTRACT_ADDRESSES[tenant];
}
