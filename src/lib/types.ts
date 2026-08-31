export type CalendarSource = "demo" | "ical" | "google";

export type PrivacyStatus = "public" | "unlisted" | "private";

export type Attachment = {
  url: string;
  mime?: string;
  filename?: string;
};

export type RawCalendarEvent = {
  uid: string;
  summary: string;
  description: string;
  start: string;
  end: string | null;
  durationIcal: string | null;
  location: string | null;
  attachments: Attachment[];
  calendarName: string;
  rrule?: string | null;
  allDay?: boolean;
};

export type NotesParse = {
  title: string | null;
  description: string;
  dateTime: string | null;
  duration: string | null;
  warnings: string[];
};

export type AirStatus = "live" | "upcoming" | "aired" | "all_day";

export type QueueStatus = "idle" | "queued" | "published";

export type YouTubeBroadcastPayload = {
  snippet: {
    title: string;
    description: string;
    scheduledStartTime: string;
    scheduledEndTime?: string;
  };
  status: {
    privacyStatus: PrivacyStatus;
    selfDeclaredMadeForKids: false;
  };
  contentDetails: {
    enableAutoStart: boolean;
    enableAutoStop: boolean;
    enableDvr: boolean;
    recordFromStart: boolean;
    latencyPreference: "normal";
  };
};

export type LiveEvent = {
  uid: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  duration: string;
  durationMinutes: number;
  thumbnailUrl: string | null;
  calendarSummary: string;
  location: string | null;
  notesRaw: string;
  attachments: Attachment[];
  parseStatus: "ok" | "partial" | "missing_notes";
  parseWarnings: string[];
  source: CalendarSource;
  calendarName: string;
  fingerprint: string;
  youtube: YouTubeBroadcastPayload;
  allDay?: boolean;
};

export type SyncResult = {
  ok: boolean;
  calendarName: string;
  events: LiveEvent[];
  fetchedAt: string;
  loginRequired?: boolean;
  loginUrl?: string | null;
  error?: string;
  errorKind?: "login" | "not_connected" | "error";
};

export type QueuedBroadcast = {
  uid: string;
  queuedAt: string;
  videoId?: string;
  fingerprint?: string;
  title?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  duration?: string;
  thumbnailUrl?: string | null;
  privacy?: PrivacyStatus;
};

export type OpKind =
  | "fetch"
  | "insert"
  | "update"
  | "thumbnail"
  | "skip"
  | "past"
  | "dry"
  | "edit"
  | "error"
  | "quota";

export type OpRow = {
  at: string;
  op: OpKind;
  uid: string;
  videoId: string;
  title: string;
  http: string;
  units: number;
  quotaUsed: number;
  quotaLimit: number;
  quotaRemaining: number;
  note: string;
};

export type ChangeField = "title" | "description" | "startAt" | "endAt" | "duration" | "thumbnail" | "privacy";
