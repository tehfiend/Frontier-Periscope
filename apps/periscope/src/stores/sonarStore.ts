import { create } from "zustand";
import { db } from "@/db";
import type { SonarChannelStatus, SonarEventType } from "@/db/types";

const ALL_PING_TYPES: SonarEventType[] = [
	"system_change",
	"item_deposited",
	"item_withdrawn",
	"item_minted",
	"item_burned",
];

interface SonarState {
	localEnabled: boolean;
	chainEnabled: boolean;
	localStatus: SonarChannelStatus;
	chainStatus: SonarChannelStatus;

	// Tab state
	activeTab: "pings" | "logFeed" | "chainFeed";

	// Ping settings
	pingEventTypes: SonarEventType[];
	pingAudioEnabled: boolean;
	pingNotifyEnabled: boolean;

	// Actions
	setLocalEnabled: (v: boolean) => void;
	setChainEnabled: (v: boolean) => void;
	setLocalStatus: (s: SonarChannelStatus) => void;
	setChainStatus: (s: SonarChannelStatus) => void;
	setActiveTab: (tab: SonarState["activeTab"]) => void;
	setPingEventTypes: (types: SonarEventType[]) => void;
	setPingAudioEnabled: (v: boolean) => void;
	setPingNotifyEnabled: (v: boolean) => void;
}

function persistPingSettings(state: {
	pingEventTypes: SonarEventType[];
	pingAudioEnabled: boolean;
	pingNotifyEnabled: boolean;
}) {
	db.settings
		.put({
			key: "sonarPingSettings",
			value: {
				pingEventTypes: state.pingEventTypes,
				pingAudioEnabled: state.pingAudioEnabled,
				pingNotifyEnabled: state.pingNotifyEnabled,
			},
		})
		.catch(() => {});
}

export const useSonarStore = create<SonarState>((set, get) => ({
	localEnabled: true,
	chainEnabled: true,
	localStatus: "off",
	chainStatus: "off",

	activeTab: "pings",

	pingEventTypes: [...ALL_PING_TYPES],
	pingAudioEnabled: false,
	pingNotifyEnabled: false,

	setLocalEnabled: (v) => {
		set({ localEnabled: v });
		db.sonarState.update("local", { enabled: v }).catch(() => {});
	},
	setChainEnabled: (v) => {
		set({ chainEnabled: v });
		db.sonarState.update("chain", { enabled: v }).catch(() => {});
	},
	setLocalStatus: (s) => {
		set({ localStatus: s });
		db.sonarState.update("local", { status: s }).catch(() => {});
	},
	setChainStatus: (s) => {
		set({ chainStatus: s });
		db.sonarState.update("chain", { status: s }).catch(() => {});
	},
	setActiveTab: (tab) => set({ activeTab: tab }),
	setPingEventTypes: (types) => {
		set({ pingEventTypes: types });
		const s = get();
		persistPingSettings({ ...s, pingEventTypes: types });
	},
	setPingAudioEnabled: (v) => {
		set({ pingAudioEnabled: v });
		const s = get();
		persistPingSettings({ ...s, pingAudioEnabled: v });
	},
	setPingNotifyEnabled: (v) => {
		set({ pingNotifyEnabled: v });
		const s = get();
		persistPingSettings({ ...s, pingNotifyEnabled: v });
	},
}));

// Restore persisted state from DB on load
db.sonarState.toArray().then((states) => {
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
});

// Restore ping settings from DB on load
db.settings.get("sonarPingSettings").then((entry) => {
	if (!entry?.value) return;
	const v = entry.value as {
		pingEventTypes?: SonarEventType[];
		pingAudioEnabled?: boolean;
		pingNotifyEnabled?: boolean;
	};
	useSonarStore.setState({
		...(v.pingEventTypes != null ? { pingEventTypes: v.pingEventTypes } : {}),
		...(v.pingAudioEnabled != null ? { pingAudioEnabled: v.pingAudioEnabled } : {}),
		...(v.pingNotifyEnabled != null ? { pingNotifyEnabled: v.pingNotifyEnabled } : {}),
	});
});
