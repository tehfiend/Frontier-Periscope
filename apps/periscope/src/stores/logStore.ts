import { create } from "zustand";

export type LogActiveTab =
	| "activity"
	| "sessions"
	| "mining"
	| "combat"
	| "travel"
	| "structures"
	| "chat";

export type DamageTarget = [name: string, total: number];

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

	// Session stats (computed periodically, avoids useLiveQuery)
	miningRunTotal: number;
	dealtTargets: DamageTarget[];
	recvTargets: DamageTarget[];

	// UI
	activeTab: LogActiveTab;
	selectedSessionId: string | null;

	// True while clearAndReimport is reprocessing log files (suppresses alerts)
	reimporting: boolean;

	// Callbacks registered by useLogWatcher (running at Layout level)
	grantAccess: ((h: FileSystemDirectoryHandle) => void) | null;
	clearAndReimport: (() => void) | null;

	// Actions
	setHasAccess: (v: boolean) => void;
	setIsWatching: (v: boolean) => void;
	setActiveSessionId: (id: string | null) => void;
	setReimporting: (v: boolean) => void;
	setLiveStats: (stats: {
		miningRate?: number;
		miningOre?: string | null;
		dpsDealt?: number;
		dpsReceived?: number;
		miningRunTotal?: number;
		dealtTargets?: DamageTarget[];
		recvTargets?: DamageTarget[];
	}) => void;
	setActiveTab: (tab: LogState["activeTab"]) => void;
	setSelectedSessionId: (id: string | null) => void;
	setGrantAccess: (fn: ((h: FileSystemDirectoryHandle) => void) | null) => void;
	setClearAndReimport: (fn: (() => void) | null) => void;
}

export const useLogStore = create<LogState>((set) => ({
	hasAccess: false,
	isWatching: false,
	activeSessionId: null,
	miningRate: 0,
	miningOre: null,
	dpsDealt: 0,
	dpsReceived: 0,
	miningRunTotal: 0,
	dealtTargets: [],
	recvTargets: [],
	reimporting: false,
	activeTab: "activity",
	selectedSessionId: null,
	grantAccess: null,
	clearAndReimport: null,

	setHasAccess: (v) => set({ hasAccess: v }),
	setIsWatching: (v) => set({ isWatching: v }),
	setActiveSessionId: (id) => set({ activeSessionId: id }),
	setReimporting: (v) => set({ reimporting: v }),
	setLiveStats: (stats) =>
		set((s) => ({
			miningRate: stats.miningRate ?? s.miningRate,
			miningOre: stats.miningOre !== undefined ? stats.miningOre : s.miningOre,
			dpsDealt: stats.dpsDealt ?? s.dpsDealt,
			dpsReceived: stats.dpsReceived ?? s.dpsReceived,
			miningRunTotal: stats.miningRunTotal ?? s.miningRunTotal,
			dealtTargets: stats.dealtTargets ?? s.dealtTargets,
			recvTargets: stats.recvTargets ?? s.recvTargets,
		})),
	setActiveTab: (tab) => set({ activeTab: tab }),
	setSelectedSessionId: (id) => set({ selectedSessionId: id }),
	setGrantAccess: (fn) => set({ grantAccess: fn }),
	setClearAndReimport: (fn) => set({ clearAndReimport: fn }),
}));
