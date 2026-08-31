import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ConnectorType, classifyCallToolError, isLoginRequired } from "@/lib/app-data";
import { mapGoogleEvents, unwrapGoogleItems } from "./google";
import { parseIcs } from "./ical";
import { normalizeFeedUrl } from "./ssrf";
import type { LiveEvent, PrivacyStatus, SyncResult } from "./types";
import { compileLiveEvent } from "./youtube";

const privacySchema = z.enum(["public", "unlisted", "private"]);

function ok(events: LiveEvent[], calendarName: string): SyncResult {
  return {
    ok: true,
    calendarName,
    events: events.sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    ),
    fetchedAt: new Date().toISOString(),
  };
}

export const fetchIcalBoard = createServerFn({ method: "POST" })
  .validator((data: { url: string; privacy: PrivacyStatus }) => ({
    url: z.string().min(8).parse(data.url),
    privacy: privacySchema.parse(data.privacy),
  }))
  .handler(async ({ data }): Promise<SyncResult> => {
    let url: URL;
    try {
      url = normalizeFeedUrl(data.url);
    } catch (e) {
      return {
        ok: false,
        calendarName: "",
        events: [],
        fetchedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : "Invalid feed URL.",
        errorKind: "error",
      };
    }

    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "text/calendar, text/plain, application/ics, */*",
          "User-Agent": "Cuecast/1.0 (YouTube Live Scheduler; iCal)",
        },
      });
      if (!res.ok) {
        return {
          ok: false,
          calendarName: "",
          events: [],
          fetchedAt: new Date().toISOString(),
          error: `Calendar responded ${res.status}. Check the secret iCal address is public.`,
          errorKind: "error",
        };
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 2_000_000) {
        return {
          ok: false,
          calendarName: "",
          events: [],
          fetchedAt: new Date().toISOString(),
          error: "Feed is larger than 2 MB.",
          errorKind: "error",
        };
      }
      const text = new TextDecoder("utf-8").decode(buf);
      if (!/BEGIN:VCALENDAR/i.test(text)) {
        return {
          ok: false,
          calendarName: "",
          events: [],
          fetchedAt: new Date().toISOString(),
          error: "That URL did not return an iCalendar feed.",
          errorKind: "error",
        };
      }
      const parsed = parseIcs(text);
      const events = parsed.events.map((raw) => compileLiveEvent(raw, "ical", data.privacy));
      return ok(events, parsed.calendarName);
    } catch (e) {
      return {
        ok: false,
        calendarName: "",
        events: [],
        fetchedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : "Could not fetch the feed.",
        errorKind: "error",
      };
    }
  });

export const fetchGoogleBoard = createServerFn({ method: "POST" })
  .validator((data: { privacy: PrivacyStatus }) => ({
    privacy: privacySchema.parse(data.privacy),
  }))
  .handler(async ({ data }): Promise<SyncResult> => {
    const { callTool } = await import("@/lib/app-data/client.server");
    const timeMin = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    const argSets: Array<Record<string, unknown>> = [
      {
        calendar_id: "primary",
        time_min: timeMin,
        time_max: timeMax,
        max_results: 50,
        single_events: true,
        order_by: "startTime",
      },
      {
        calendarId: "primary",
        timeMin,
        timeMax,
        maxResults: 50,
        singleEvents: true,
        orderBy: "startTime",
      },
    ];

    const attempts = [
      "google_calendar_list_events",
      "google_calendar_events_list",
      "list_events",
    ];

    let last = await callTool(attempts[0]!, argSets[0]!, {
      connectorType: ConnectorType.GoogleCalendar,
    });

    if (!last.ok) {
      outer: for (const name of attempts) {
        for (const args of argSets) {
          if (name === attempts[0] && args === argSets[0]) continue;
          const next = await callTool(name, args, {
            connectorType: ConnectorType.GoogleCalendar,
          });
          last = next;
          if (next.ok) break outer;
        }
      }
    }

    if (!last.ok) {
      const classified = classifyCallToolError(last);
      return {
        ok: false,
        calendarName: "",
        events: [],
        fetchedAt: new Date().toISOString(),
        loginRequired: isLoginRequired(last),
        loginUrl: last.loginUrl ?? null,
        error: classified?.message ?? last.errorMessage ?? "Google Calendar could not be read.",
        errorKind: classified?.kind === "login" || classified?.kind === "not_connected" ? classified.kind : "error",
      };
    }

    const { calendarName, items } = unwrapGoogleItems(last.data);
    const raw = mapGoogleEvents(items, calendarName);
    const events = raw.map((ev) => compileLiveEvent(ev, "google", data.privacy));
    return ok(events, calendarName);
  });
