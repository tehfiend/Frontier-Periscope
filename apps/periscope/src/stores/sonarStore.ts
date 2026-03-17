import { create } from "zustand";
import { db } from "@/db";
import type { SonarChannelStatus } from "@/db/types";

interface SonarState {
	localEnabled: boolean;
	chainEnabled: boolean;
	localStatus: SonarChannelStatus;
	chainStatus: SonarChannelStatus;

	// Actions
	setLocalEnabled: (v: boolean) => void;
	setChainEnabled: (v: boolean) => void;
	setLocalStatus: (s: SonarChannelStatus) => void;
	setChainStatus: (s: SonarChannelStatus) => void;
}

export const useSonarStore = create<SonarState>((set) => ({
	localEnabled: true,
	chainEnabled: true,
	localStatus: "off",
	chainStatus: "off",

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
