import type { Attachment, RawCalendarEvent } from "./types.ts";
import { unescapeIcalText } from "./notes.ts";

type IcalProp = {
  name: string;
  params: Record<string, string>;
  value: string;
};

const DAY_INDEX: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines.filter((l) => l.length > 0);
}

function parseProp(line: string): IcalProp | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const meta = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = meta.split(";");
  const name = (parts[0] ?? "").toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name, params, value };
}

function zonedLocalToUtc(localIso: string, tz: string): string {
  const guess = new Date(`${localIso}Z`);
  if (Number.isNaN(guess.getTime())) return new Date(localIso).toISOString();
  try {
    const locale = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(guess);
    const pick = (type: string) => locale.find((p) => p.type === type)?.value ?? "00";
    const shifted = Date.UTC(
      Number(pick("year")),
      Number(pick("month")) - 1,
      Number(pick("day")),
      Number(pick("hour")),
      Number(pick("minute")),
      Number(pick("second")),
    );
    return new Date(guess.getTime() - (shifted - guess.getTime())).toISOString();
  } catch {
    return guess.toISOString();
  }
}

function parseIcalDate(prop: IcalProp | undefined, tz: string): string | null {
  if (!prop) return null;
  const raw = prop.value.trim();
  const tzid = prop.params.TZID || tz;
  const isDate = (prop.params.VALUE ?? "").toUpperCase() === "DATE" || /^\d{8}$/.test(raw);

  if (isDate && /^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4);
    const mo = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return zonedLocalToUtc(`${y}-${mo}-${d}T00:00:00`, tzid);
  }

  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7] === "Z") return new Date(`${iso}Z`).toISOString();
  return zonedLocalToUtc(iso, tzid);
}

function isDateOnly(prop: IcalProp | undefined): boolean {
  if (!prop) return false;
  const raw = prop.value.trim();
  return (prop.params.VALUE ?? "").toUpperCase() === "DATE" || /^\d{8}$/.test(raw);
}

function weekdayInTz(ms: number, tz: string): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(ms));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

function parseUntil(value: string, tz: string): number | null {
  if (/^\d{8}$/.test(value)) {
    const iso = zonedLocalToUtc(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T23:59:59`,
      tz,
    );
    return new Date(iso).getTime();
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return Date.parse(value) || null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  return new Date(m[7] === "Z" ? `${iso}Z` : zonedLocalToUtc(iso, tz)).getTime();
}

function parseRRule(raw: string): {
  freq: string;
  interval: number;
  byday: number[];
  until: string | null;
  count: number | null;
} {
  const parts: Record<string, string> = {};
  for (const bit of raw.split(";")) {
    const [k, v] = bit.split("=");
    if (k && v) parts[k.toUpperCase()] = v;
  }
  const byday = (parts.BYDAY ?? "")
    .split(",")
    .map((d) => DAY_INDEX[d.replace(/^-?\d+/, "").toUpperCase()] )
    .filter((n): n is number => n != null);
  return {
    freq: (parts.FREQ ?? "WEEKLY").toUpperCase(),
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    byday,
    until: parts.UNTIL ?? null,
    count: parts.COUNT ? Number(parts.COUNT) : null,
  };
}

export function expandRecurring(
  events: RawCalendarEvent[],
  now = Date.now(),
  tz = "Asia/Qatar",
  horizonDays = 42,
): RawCalendarEvent[] {
  const from = now - 2 * 24 * 60 * 60 * 1000;
  const to = now + horizonDays * 24 * 60 * 60 * 1000;
  const out: RawCalendarEvent[] = [];

  for (const ev of events) {
    if (!ev.rrule) {
      const start = new Date(ev.start).getTime();
      if (start >= from && start <= to) out.push(ev);
      continue;
    }
    const rule = parseRRule(ev.rrule);
    if (rule.freq !== "WEEKLY") {
      const start = new Date(ev.start).getTime();
      if (start >= from && start <= to) out.push(ev);
      continue;
    }
    const startMs = new Date(ev.start).getTime();
    const duration = ev.end ? Math.max(60_000, new Date(ev.end).getTime() - startMs) : 60 * 60 * 1000;
    const until = rule.until ? (parseUntil(rule.until, tz) ?? to) : to;
    const bydays = rule.byday.length ? rule.byday : [weekdayInTz(startMs, tz)];
    const dayMs = 24 * 60 * 60 * 1000;
    let emitted = 0;
    const max = rule.count ?? 80;

    for (let t = startMs; t <= Math.min(until, to) && emitted < max; t += dayMs) {
      if (!bydays.includes(weekdayInTz(t, tz))) continue;
      const weekIndex = Math.round((t - startMs) / (7 * dayMs));
      if (weekIndex % rule.interval !== 0) continue;
      if (t + duration < from) continue;
      if (t > to || t > until) continue;
      const day = new Date(t).toISOString().slice(0, 10);
      out.push({
        ...ev,
        uid: `${ev.uid}::${day}`,
        start: new Date(t).toISOString(),
        end: new Date(t + duration).toISOString(),
        rrule: null,
      });
      emitted += 1;
    }
  }

  return out.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

function collectEvent(props: IcalProp[], calendarName: string, tz: string): RawCalendarEvent | null {
  const getAll = (name: string) => props.filter((p) => p.name === name);
  const get = (name: string) => getAll(name)[0];
  const uid = get("UID")?.value?.trim();
  if (!uid) return null;
  const summary = unescapeIcalText(get("SUMMARY")?.value ?? "").trim();
  const description = unescapeIcalText(get("DESCRIPTION")?.value ?? "");
  const startProp = get("DTSTART");
  const start = parseIcalDate(startProp, tz);
  if (!start) return null;
  const end = parseIcalDate(get("DTEND"), tz);
  const durationIcal = get("DURATION")?.value ?? null;
  const location = unescapeIcalText(get("LOCATION")?.value ?? "").trim() || null;
  const rrule = get("RRULE")?.value ?? null;
  const allDay = isDateOnly(startProp);

  const attachments: Attachment[] = getAll("ATTACH").map((p) => ({
    url: p.value.trim(),
    mime: p.params.FMTTYPE,
    filename: p.params.FILENAME,
  }));

  return {
    uid,
    summary,
    description,
    start,
    end,
    durationIcal,
    location,
    attachments,
    calendarName,
    rrule,
    allDay,
  };
}

export function parseIcs(
  ics: string,
  now = Date.now(),
): { calendarName: string; events: RawCalendarEvent[]; timezone: string } {
  const lines = unfold(ics);
  const masters: RawCalendarEvent[] = [];
  let calendarName = "Calendar";
  let timezone = "Asia/Qatar";
  let inEvent = false;
  let bucket: IcalProp[] = [];

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      bucket = [];
      continue;
    }
    if (line === "END:VEVENT") {
      const ev = collectEvent(bucket, calendarName, timezone);
      if (ev) masters.push(ev);
      inEvent = false;
      bucket = [];
      continue;
    }
    const prop = parseProp(line);
    if (!prop) continue;
    if (!inEvent && prop.name === "X-WR-CALNAME") {
      calendarName = unescapeIcalText(prop.value).trim() || calendarName;
    }
    if (!inEvent && prop.name === "X-WR-TIMEZONE") {
      timezone = unescapeIcalText(prop.value).trim() || timezone;
    }
    if (inEvent) bucket.push(prop);
  }

  return { calendarName, timezone, events: expandRecurring(masters, now, timezone) };
}

export function toIcs(events: RawCalendarEvent[], calendarName: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cuecast//YouTube Live Scheduler//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcal(calendarName)}`,
  ];
  for (const ev of events) {
    const dtStart = toIcalUtc(ev.start);
    const dtEnd = ev.end ? toIcalUtc(ev.end) : null;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcal(ev.uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${dtStart}`);
    if (dtEnd) lines.push(`DTEND:${dtEnd}`);
    if (ev.durationIcal) lines.push(`DURATION:${ev.durationIcal}`);
    lines.push(`SUMMARY:${escapeIcal(ev.summary)}`);
    lines.push(`DESCRIPTION:${escapeIcal(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeIcal(ev.location)}`);
    for (const att of ev.attachments) {
      const params = att.mime ? `;FMTTYPE=${att.mime}` : "";
      const fn = att.filename ? `;FILENAME=${att.filename}` : "";
      lines.push(`ATTACH${params}${fn}:${att.url}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return foldIcs(lines.join("\r\n") + "\r\n");
}

function escapeIcal(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function toIcalUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldIcs(text: string): string {
  return text
    .split("\r\n")
    .map((line) => {
      if (line.length <= 75) return line;
      const chunks: string[] = [];
      let rest = line;
      chunks.push(rest.slice(0, 75));
      rest = rest.slice(75);
      while (rest.length > 74) {
        chunks.push(` ${rest.slice(0, 74)}`);
        rest = rest.slice(74);
      }
      if (rest.length) chunks.push(` ${rest}`);
      return chunks.join("\r\n");
    })
    .join("\r\n");
}
