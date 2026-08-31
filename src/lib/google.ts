import type { Attachment, RawCalendarEvent } from "./types";
import { extractImageUrls } from "./youtube";

type GoogleDate = { dateTime?: string; date?: string; timeZone?: string };

export type GoogleCalendarEvent = {
  id?: string;
  iCalUID?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  attachments?: Array<{
    fileUrl?: string;
    mimeType?: string;
    title?: string;
    iconLink?: string;
  }>;
};

function googleDateToIso(value?: GoogleDate): string | null {
  if (!value) return null;
  if (value.dateTime) {
    const d = new Date(value.dateTime);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (value.date) {
    const d = new Date(`${value.date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function mapGoogleEvent(
  event: GoogleCalendarEvent,
  calendarName: string,
): RawCalendarEvent | null {
  const uid = event.iCalUID || event.id;
  if (!uid) return null;
  const start = googleDateToIso(event.start);
  if (!start) return null;
  const end = googleDateToIso(event.end);
  const attachments: Attachment[] = (event.attachments ?? [])
    .filter((a) => a.fileUrl)
    .map((a) => ({
      url: a.fileUrl!,
      mime: a.mimeType,
      filename: a.title,
    }));
  for (const src of extractImageUrls(event.description ?? "")) {
    if (!attachments.some((a) => a.url === src)) {
      attachments.push({ url: src, mime: "image/*" });
    }
  }
  return {
    uid,
    summary: event.summary ?? "",
    description: event.description ?? "",
    start,
    end,
    durationIcal: null,
    location: event.location ?? null,
    attachments,
    calendarName,
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
  };
}

export function mapGoogleEvents(
  items: GoogleCalendarEvent[],
  calendarName: string,
): RawCalendarEvent[] {
  const out: RawCalendarEvent[] = [];
  for (const item of items) {
    const mapped = mapGoogleEvent(item, calendarName);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function unwrapGoogleItems(data: unknown): {
  calendarName: string;
  items: GoogleCalendarEvent[];
} {
  if (!data || typeof data !== "object") return { calendarName: "Google Calendar", items: [] };
  const rec = data as Record<string, unknown>;
  const nested = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : rec;
  const itemsUnknown = nested.items ?? nested.events ?? rec.items ?? rec.events;
  const items = Array.isArray(itemsUnknown) ? (itemsUnknown as GoogleCalendarEvent[]) : [];
  const calendarName =
    (typeof nested.summary === "string" && nested.summary) ||
    (typeof rec.summary === "string" && rec.summary) ||
    (typeof rec.calendar === "string" && rec.calendar) ||
    "Google Calendar";
  return { calendarName, items };
}
