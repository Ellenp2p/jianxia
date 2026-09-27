import { create } from "zustand";
import { applyIncoming, applyTalk, DEFAULT_SETTINGS, emptyFold, type FoldState } from "./logic";
import type { Incoming, LogEntry, Settings, Source, Speaker } from "./types";

export type DeskView = "archive" | "people" | "ledger" | "rules";
export type ArchiveFilter = "kept" | "duplicate" | "photo" | "video" | "all";

type SecretaryState = FoldState & {
  settings: Settings;
  updateOffset: number;
  listening: boolean;
  drillRunning: boolean;
  view: DeskView;
  filter: ArchiveFilter;
  query: string;
  selectedId: string | null;
  botName: string;
  botUsername: string;
  lastError: string | null;
  lastPullAt: number | null;
  revision: number;
  tokenOnFile: boolean;
  serverListening: boolean;
  ready: boolean;
  ingest: (incoming: Incoming, savedAt?: number) => void;
  addLog: (entry: LogEntry) => void;
  patchSettings: (patch: Partial<Settings>) => void;
  updateSource: (id: string, patch: Partial<Source>) => void;
  removeSource: (id: string) => void;
  addSource: (query: string) => void;
  prepareDrill: () => void;
  clearRecords: () => void;
  setOffset: (offset: number) => void;
  select: (id: string | null) => void;
  noteTalk: (speaker: Speaker) => void;
};

function foldSlice(state: FoldState): FoldState {
  return {
    items: state.items,
    logs: state.logs,
    enrolledPrivate: state.enrolledPrivate,
    enrolledGroup: state.enrolledGroup,
    people: state.people,
    history: state.history,
  };
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const blank = emptyFold();

export const useSecretary = create<SecretaryState>()((set) => ({
  settings: DEFAULT_SETTINGS,
  items: blank.items,
  logs: blank.logs,
  enrolledPrivate: blank.enrolledPrivate,
  enrolledGroup: blank.enrolledGroup,
  people: blank.people,
  history: blank.history,
  updateOffset: 0,
  listening: false,
  drillRunning: false,
  view: "archive",
  filter: "all",
  query: "",
  selectedId: null,
  botName: "",
  botUsername: "",
  lastError: null,
  lastPullAt: null,
  revision: 0,
  tokenOnFile: false,
  serverListening: false,
  ready: false,
  ingest: (incoming, savedAt) =>
    set((state) => applyIncoming(incoming, foldSlice(state), state.settings, () => uid("rec"), savedAt)),
  noteTalk: (speaker) => set((state) => applyTalk(speaker, foldSlice(state))),
  addLog: (entry) => set((state) => ({ logs: [entry, ...state.logs].slice(0, 300) })),
  patchSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
  updateSource: (id, patch) =>
    set((state) => ({
      settings: {
        ...state.settings,
        sources: state.settings.sources.map((src) => (src.id === id ? { ...src, ...patch } : src)),
      },
    })),
  removeSource: (id) =>
    set((state) => ({
      settings: {
        ...state.settings,
        sources: state.settings.sources.filter((src) => src.id !== id),
      },
    })),
  addSource: (query) =>
    set((state) => {
      const q = query.trim();
      if (!q) return {};
      const source: Source = {
        id: uid("src"),
        query: q,
        resolvedId: null,
        resolvedTitle: null,
        resolvedUsername: null,
        status: "idle",
        error: null,
      };
      return { settings: { ...state.settings, sources: [...state.settings.sources, source] } };
    }),
  prepareDrill: () =>
    set({
      ...emptyFold(),
      drillRunning: true,
      selectedId: null,
      view: "archive",
      filter: "all",
    }),
  clearRecords: () => set({ ...emptyFold(), selectedId: null }),
  setOffset: (offset) => set({ updateOffset: offset }),
  select: (id) => set({ selectedId: id }),
}));
