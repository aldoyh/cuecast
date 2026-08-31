import type {
  AirStatus,
  Attachment,
  CalendarSource,
  LiveEvent,
  PrivacyStatus,
  RawCalendarEvent,
  YouTubeBroadcastPayload,
} from "./types.ts";
import {
  durationToMinutes,
  formatDuration,
  icalDurationToMinutes,
  parseNotes,
} from "./notes.ts";
import { coverForShow } from "./calendar.ts";
import { eventFingerprint } from "./ops.ts";

const IMAGE_EXT = /\.(avif|gif|jpe?g|png|webp|bmp|svg)(\?|#|$)/i;

export function extractImageUrls(html: string): string[] {
  const urls: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) urls.push(m[1]);
  }
  return urls;
}

export function isImageAttachment(att: Attachment): boolean {
  if (att.mime && att.mime.toLowerCase().startsWith("image/")) return true;
  const name = att.filename ?? att.url;
  return IMAGE_EXT.test(name);
}

export function firstThumbnail(attachments: Attachment[]): string | null {
  const image = attachments.find(isImageAttachment) ?? attachments.find((a) => Boolean(a.url));
  if (!image?.url) return null;
  return normalizeDriveUrl(image.url);
}

export function normalizeDriveUrl(url: string): string {
  const idMatch =
    url.match(/drive\.google\.com\/file\/d\/([^/]+)/) ??
    url.match(/[?&]id=([^&]+)/);
  if (idMatch?.[1] && url.includes("drive.google.com")) {
    return `https://drive.google.com/uc?export=view&id=${idMatch[1]}`;
  }
  return url;
}

function mergeAttachments(raw: RawCalendarEvent): Attachment[] {
  const seen = new Set(raw.attachments.map((a) => a.url));
  const extra: Attachment[] = [];
  for (const url of extractImageUrls(raw.description)) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    extra.push({ url, mime: "image/*" });
  }
  return extra.length ? [...raw.attachments, ...extra] : raw.attachments;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

export function airStatus(
  event: Pick<LiveEvent, "startAt" | "endAt"> & { allDay?: boolean },
  now = Date.now(),
): AirStatus {
  const start = new Date(event.startAt).getTime();
  const end = new Date(event.endAt).getTime();
  const allDay = event.allDay || end - start >= 12 * 60 * 60 * 1000;
  if (allDay) {
    if (now >= end) return "aired";
    if (now >= start) return "all_day";
    return "upcoming";
  }
  if (now >= start && now < end) return "live";
  if (now >= end) return "aired";
  return "upcoming";
}

export function buildPayload(
  event: Pick<LiveEvent, "title" | "description" | "startAt" | "endAt">,
  privacy: PrivacyStatus,
): YouTubeBroadcastPayload {
  const payload: YouTubeBroadcastPayload = {
    snippet: {
      title: truncate(event.title, 100),
      description: truncate(event.description, 5000),
      scheduledStartTime: new Date(event.startAt).toISOString(),
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: false,
    },
    contentDetails: {
      enableAutoStart: false,
      enableAutoStop: true,
      enableDvr: true,
      recordFromStart: true,
      latencyPreference: "normal",
    },
  };
  if (event.endAt) payload.snippet.scheduledEndTime = new Date(event.endAt).toISOString();
  return payload;
}

export function compileLiveEvent(
  raw: RawCalendarEvent,
  source: CalendarSource,
  privacy: PrivacyStatus,
): LiveEvent {
  let attachments = mergeAttachments(raw);
  const notes = parseNotes(raw.description);
  const warnings = [...notes.warnings];

  const title = (notes.title || raw.summary || "Untitled live").trim();
  const description =
    notes.description ||
    (raw.summary && raw.summary !== title ? raw.summary : "") ||
    "";

  const startAt = notes.dateTime || raw.start;
  let durationMinutes: number | null = notes.duration ? durationToMinutes(notes.duration) : null;
  if (durationMinutes == null || durationMinutes <= 0) {
    if (raw.end) {
      const ms = new Date(raw.end).getTime() - new Date(startAt).getTime();
      if (ms > 0) durationMinutes = Math.round(ms / 60000);
    } else if (raw.durationIcal) {
      durationMinutes = icalDurationToMinutes(raw.durationIcal);
    }
  }
  if (durationMinutes == null || durationMinutes <= 0) {
    durationMinutes = 60;
    warnings.push("Duration defaulted to 01:00.");
  }

  const endAt =
    raw.end && !notes.duration
      ? raw.end
      : new Date(new Date(startAt).getTime() + durationMinutes * 60000).toISOString();

  const cover = coverForShow(title, raw.summary);
  if (cover && !attachments.some((a) => a.url === cover)) {
    attachments = [...attachments, { url: cover, mime: "image/jpeg", filename: "cover.jpg" }];
  }
  const thumbnailUrl = firstThumbnail(attachments);
  if (!thumbnailUrl) warnings.push("No attached image — thumbnail will be skipped.");

  let parseStatus: LiveEvent["parseStatus"] = "ok";
  if (!notes.title && !notes.duration && !notes.dateTime) {
    parseStatus = raw.summary ? "ok" : "missing_notes";
  } else if (warnings.length) parseStatus = "partial";

  const startIso = new Date(startAt).toISOString();
  const endIso = new Date(endAt).toISOString();
  const allDay =
    Boolean(raw.allDay) ||
    durationMinutes >= 12 * 60 ||
    (!notes.dateTime && !notes.duration && durationMinutes >= 12 * 60);
  if (allDay) warnings.push("All-day calendar mark — not a timed live.");
  const youtube = buildPayload({ title, description, startAt: startIso, endAt: endIso }, privacy);

  return {
    uid: raw.uid,
    title,
    description,
    startAt: startIso,
    endAt: endIso,
    duration: formatDuration(durationMinutes),
    durationMinutes,
    thumbnailUrl,
    calendarSummary: raw.summary,
    location: raw.location,
    notesRaw: raw.description,
    attachments,
    parseStatus,
    parseWarnings: warnings,
    source,
    calendarName: raw.calendarName,
    fingerprint: eventFingerprint({
      title,
      description,
      startAt: startIso,
      endAt: endIso,
      duration: formatDuration(durationMinutes),
      thumbnailUrl,
      privacy,
    }),
    youtube,
    allDay,
  };
}

export function liveEventToRaw(event: LiveEvent): RawCalendarEvent {
  return {
    uid: event.uid,
    summary: event.calendarSummary,
    description: event.notesRaw,
    start: event.startAt,
    end: event.endAt,
    durationIcal: null,
    location: event.location,
    attachments: event.attachments,
    calendarName: event.calendarName,
    rrule: null,
    allDay: event.allDay,
  };
}

export function withPrivacy(events: LiveEvent[], privacy: PrivacyStatus): LiveEvent[] {
  return events.map((event) => ({
    ...event,
    fingerprint: eventFingerprint({
      title: event.title,
      description: event.description,
      startAt: event.startAt,
      endAt: event.endAt,
      duration: event.duration,
      thumbnailUrl: event.thumbnailUrl,
      privacy,
    }),
    youtube: buildPayload(event, privacy),
  }));
}
