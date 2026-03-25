import { db } from "@/db";
import type { SonarChannelStatus, SonarEventType } from "@/db/types";
import { create } from "zustand";

type SonarTab = "pings" | "logFeed" | "chainFeed" | "watchlist";

interface SonarState {
	localEnabled: boolean;
	chainEnabled: boolean;
	localStatus: SonarChannelStatus;
	chainStatus: SonarChannelStatus;
	/** Incremented on each poll cycle to trigger ping animation */
	localPingCount: number;
	chainPingCount: number;

	// Sonar tab state
	activeTab: SonarTab;

	// Ping settings
	pingEventTypes: Set<SonarEventType>;
	pingAudioEnabled: boolean;
	pingNotifyEnabled: boolean;

	// Actions
	setLocalEnabled: (v: boolean) => void;
	setChainEnabled: (v: boolean) => void;
	setLocalStatus: (s: SonarChannelStatus) => void;
	setChainStatus: (s: SonarChannelStatus) => void;
	pingLocal: () => void;
	pingChain: () => void;
	setActiveTab: (tab: SonarTab) => void;
	setPingEventTypes: (types: Set<SonarEventType>) => void;
	togglePingEventType: (type: SonarEventType) => void;
	setPingAudioEnabled: (v: boolean) => void;
	setPingNotifyEnabled: (v: boolean) => void;
}

const DEFAULT_PING_TYPES: SonarEventType[] = ["system_change", "item_deposited", "item_withdrawn"];

export const useSonarStore = create<SonarState>((set) => ({
	localEnabled: true,
	chainEnabled: true,
	localStatus: "off",
	chainStatus: "off",
	localPingCount: 0,
	chainPingCount: 0,
	activeTab: "pings",
	pingEventTypes: new Set(DEFAULT_PING_TYPES),
	pingAudioEnabled: false,
	pingNotifyEnabled: false,

	setLocalEnabled: (v) => {
		set({ localEnabled: v });
		db.sonarState
			.update("local", { enabled: v })
			.catch((e) => console.error("[sonarStore] DB persist failed:", e));
	},
	setChainEnabled: (v) => {
		set({ chainEnabled: v });
		db.sonarState
			.update("chain", { enabled: v })
			.catch((e) => console.error("[sonarStore] DB persist failed:", e));
	},
	setLocalStatus: (s) => {
		set({ localStatus: s });
		db.sonarState
			.update("local", { status: s })
			.catch((e) => console.error("[sonarStore] DB persist failed:", e));
	},
	setChainStatus: (s) => {
		set({ chainStatus: s });
		db.sonarState
			.update("chain", { status: s })
			.catch((e) => console.error("[sonarStore] DB persist failed:", e));
	},
	pingLocal: () => set((s) => ({ localPingCount: s.localPingCount + 1 })),
	pingChain: () => set((s) => ({ chainPingCount: s.chainPingCount + 1 })),
	setActiveTab: (tab) => set({ activeTab: tab }),
	setPingEventTypes: (types) => {
		set({ pingEventTypes: types });
		persistPingSettings(types);
	},
	togglePingEventType: (type) =>
		set((s) => {
			const next = new Set(s.pingEventTypes);
			if (next.has(type)) next.delete(type);
			else next.add(type);
			persistPingSettings(next);
			return { pingEventTypes: next };
		}),
	setPingAudioEnabled: (v) => set({ pingAudioEnabled: v }),
	setPingNotifyEnabled: (v) => set({ pingNotifyEnabled: v }),
}));

function persistPingSettings(types: Set<SonarEventType>) {
	db.settings
		.put({ key: "sonarPingTypes", value: JSON.stringify([...types]) })
		.catch((e) => console.error("[sonarStore] DB persist failed:", e));
}

// Restore persisted state from DB on load
db.sonarState
	.toArray()
	.then((states) => {
		const store = useSonarStore.getState();
		for (const s of states) {
			if (s.channel === "local") {
				store.setLocalEnabled(s.enabled);
				store.setLocalStatus(s.status);
			} else if (s.channel === "chain") {
				store.setChainEnabled(s.enabled);
				store.setChainStatus(s.status);
			}
		}
	})
	.catch((err) => {
		console.error("[sonarStore] Failed to restore persisted state:", err);
	});
