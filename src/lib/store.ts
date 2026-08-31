import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LIVE_SHOWS_ICAL } from "./calendar";
import { QUOTA_LIMIT_DEFAULT, snapshotQueued, utcDay } from "./ops";
import type {
  CalendarSource,
  LiveEvent,
  OpRow,
  PrivacyStatus,
  QueuedBroadcast,
} from "./types";

export type CueSettings = {
  source: CalendarSource;
  icalUrl: string;
  privacy: PrivacyStatus;
  quotaLimit: number;
};

type CueState = {
  settings: CueSettings;
  events: LiveEvent[];
  calendarName: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  loginUrl: string | null;
  loginRequired: boolean;
  queued: Record<string, QueuedBroadcast>;
  ops: OpRow[];
  quotaUsed: number;
  quotaDay: string;
  selectedUid: string | null;
  demoEpoch: number | null;
  setSettings: (patch: Partial<CueSettings>) => void;
  setBoard: (input: {
    events: LiveEvent[];
    calendarName: string;
    fetchedAt: string;
    demoEpoch?: number | null;
  }) => void;
  setError: (error: string | null, extra?: { loginUrl?: string | null; loginRequired?: boolean }) => void;
  queueEvent: (uid: string, videoId?: string) => void;
  unqueueEvent: (uid: string) => void;
  applyRun: (input: {
    queued: Record<string, QueuedBroadcast>;
    ops: OpRow[];
    quotaUsed: number;
    quotaDay: string;
  }) => void;
  reviseEvent: (uid: string, patch: Partial<Pick<LiveEvent, "title" | "description" | "startAt" | "endAt" | "duration" | "thumbnailUrl" | "fingerprint" | "youtube" | "notesRaw">>) => void;
  clearLog: () => void;
  select: (uid: string | null) => void;
};

const initialSettings: CueSettings = {
  source: "ical",
  icalUrl: LIVE_SHOWS_ICAL,
  privacy: "unlisted",
  quotaLimit: QUOTA_LIMIT_DEFAULT,
};

export const useCuecast = create<CueState>()(
  persist(
    (set, get) => ({
      settings: initialSettings,
      events: [],
      calendarName: "Live Shows البرامج المباشرة",
      lastSyncedAt: null,
      lastError: null,
      loginUrl: null,
      loginRequired: false,
      queued: {},
      ops: [],
      quotaUsed: 0,
      quotaDay: utcDay(),
      selectedUid: null,
      demoEpoch: null,
      setSettings: (patch) =>
        set({ settings: { ...get().settings, ...patch } }),
      setBoard: ({ events, calendarName, fetchedAt, demoEpoch }) =>
        set({
          events,
          calendarName,
          lastSyncedAt: fetchedAt,
          lastError: null,
          loginRequired: false,
          loginUrl: null,
          ...(demoEpoch !== undefined ? { demoEpoch } : {}),
        }),
      setError: (error, extra) =>
        set({
          lastError: error,
          loginUrl: extra?.loginUrl ?? null,
          loginRequired: extra?.loginRequired ?? false,
        }),
      queueEvent: (uid, videoId) => {
        const event = get().events.find((e) => e.uid === uid);
        if (!event) return;
        set({
          queued: {
            ...get().queued,
            [uid]: snapshotQueued(event, videoId),
          },
        });
      },
      unqueueEvent: (uid) => {
        const next = { ...get().queued };
        delete next[uid];
        set({ queued: next });
      },
      applyRun: ({ queued, ops, quotaUsed, quotaDay }) =>
        set({ queued, ops, quotaUsed, quotaDay }),
      reviseEvent: (uid, patch) =>
        set({
          events: get().events.map((event) => (event.uid === uid ? { ...event, ...patch } : event)),
        }),
      clearLog: () => set({ ops: [], quotaUsed: 0, quotaDay: utcDay() }),
      select: (uid) => set({ selectedUid: uid }),
    }),
    {
      name: "cuecast-v3",
      skipHydration: true,
      partialize: (state) => ({
        settings: state.settings,
        queued: state.queued,
        ops: state.ops,
        quotaUsed: state.quotaUsed,
        quotaDay: state.quotaDay,
        demoEpoch: state.demoEpoch,
      }),
    },
  ),
);
