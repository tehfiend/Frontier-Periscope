import { create } from "zustand";

interface LogState {
	// Directory access
	hasAccess: boolean;
	isWatching: boolean;

	// Active session
	activeSessionId: string | null;

	// Live stats (rolling window)
	miningRate: number;
	miningOre: string | null;
	dpsDealt: number;
	dpsReceived: number;

	// UI
	activeTab: "live" | "sessions" | "mining" | "combat" | "travel" | "structures" | "chat";
	selectedSessionId: string | null;

	// Actions
	setHasAccess: (v: boolean) => void;
	setIsWatching: (v: boolean) => void;
	setActiveSessionId: (id: string | null) => void;
	setLiveStats: (stats: {
		miningRate?: number;
		miningOre?: string | null;
		dpsDealt?: number;
		dpsReceived?: number;
	}) => void;
	setActiveTab: (tab: LogState["activeTab"]) => void;
	setSelectedSessionId: (id: string | null) => void;
}

export const useLogStore = create<LogState>((set) => ({
	hasAccess: false,
	isWatching: false,
	activeSessionId: null,
	miningRate: 0,
	miningOre: null,
	dpsDealt: 0,
	dpsReceived: 0,
	activeTab: "live",
	selectedSessionId: null,

	setHasAccess: (v) => set({ hasAccess: v }),
	setIsWatching: (v) => set({ isWatching: v }),
	setActiveSessionId: (id) => set({ activeSessionId: id }),
	setLiveStats: (stats) =>
		set((s) => ({
			miningRate: stats.miningRate ?? s.miningRate,
			miningOre: stats.miningOre !== undefined ? stats.miningOre : s.miningOre,
			dpsDealt: stats.dpsDealt ?? s.dpsDealt,
			dpsReceived: stats.dpsReceived ?? s.dpsReceived,
		})),
	setActiveTab: (tab) => set({ activeTab: tab }),
	setSelectedSessionId: (id) => set({ selectedSessionId: id }),
}));
