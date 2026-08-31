import type { NotesParse } from "./types";

const DURATION_RE =
  /^(?:duration\s*[:\-]\s*)?(\d{1,2}):([0-5]\d)(?:\s*(?:h|hr|hrs|hours)?)?$/i;
const DURATION_ALT_RE =
  /^(?:duration\s*[:\-]\s*)?(\d+)\s*h(?:ours?)?(?:\s*(\d{1,2})\s*m(?:in(?:utes?)?)?)?$/i;

const ISO_DT_RE =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(Z|[+-]\d{2}:?\d{2}|UTC))?$/i;
const HUMAN_DT_RE =
  /^(?:date(?:\s*time)?\s*[:\-]\s*)?(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)$/i;

export function stripHtml(input: string): string {
  const entity = (name: string) => new RegExp(`&${name};`, "gi");
  return input
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*\/div\s*>/gi, "\n")
    .replace(/<\s*li\s*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(entity("nbsp"), " ")
    .replace(entity("amp"), "&")
    .replace(entity("lt"), "<")
    .replace(entity("gt"), ">")
    .replace(entity("quot"), '"')
    .replace(/&#39;/g, "'")
    .replace(entity("apos"), "'");
}

export function unescapeIcalText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function isDurationLine(line: string): string | null {
  const trimmed = line.trim();
  const m = trimmed.match(DURATION_RE);
  if (m) return `${m[1]!.padStart(2, "0")}:${m[2]}`;
  const alt = trimmed.match(DURATION_ALT_RE);
  if (alt) {
    const h = alt[1]!.padStart(2, "0");
    const min = (alt[2] ?? "0").padStart(2, "0");
    return `${h}:${min}`;
  }
  return null;
}

function isDateTimeLine(line: string): string | null {
  const trimmed = line.trim();
  const labeled = trimmed.replace(/^(?:date(?:\s*time)?|when|starts?)\s*[:\-]\s*/i, "");
  if (ISO_DT_RE.test(labeled) || HUMAN_DT_RE.test(labeled)) return labeled;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(labeled)) return labeled;
  return null;
}

function parseLooseDateTime(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+UTC$/i, "Z");
  const iso = cleaned.match(ISO_DT_RE);
  if (iso) {
    const date = iso[1]!;
    let time = iso[2]!;
    if (time.length === 5) time = `${time}:00`;
    const tz = iso[3] ? (iso[3].toUpperCase() === "UTC" ? "Z" : iso[3]) : "";
    const candidate = `${date}T${time}${tz}`;
    const d = new Date(candidate);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

/**
 * Notes block, as written in the iCal DESCRIPTION / Google Calendar notes:
 *
 *   # TITLE
 *
 *   DESCRIPTION
 *
 *   DATE TIME
 *
 *   DURATION AS HH:MM
 *
 * Thumbnail is not in the notes — it is the first image attached to the event.
 */
export function parseNotes(raw: string): NotesParse {
  const warnings: string[] = [];
  const text = stripHtml(unescapeIcalText(raw ?? "")).replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i += 1;

  let title: string | null = null;
  if (i < lines.length) {
    const head = lines[i]!.trim();
    const hash = head.match(/^#\s+(.+)$/);
    const labeled = head.match(/^title\s*[:\-]\s*(.+)$/i);
    if (hash) {
      title = hash[1]!.trim();
      i += 1;
    } else if (labeled) {
      title = labeled[1]!.trim();
      i += 1;
    }
  }

  const body: string[] = [];
  let dateTime: string | null = null;
  let duration: string | null = null;

  const rest = lines.slice(i);
  // Walk remaining lines. Date-time and duration are typically the last
  // two non-empty lines; also accept them anywhere so messy notes still work.
  for (const line of rest) {
    const dur = isDurationLine(line);
    if (dur && !duration) {
      duration = dur;
      continue;
    }
    const dt = isDateTimeLine(line);
    if (dt && !dateTime) {
      dateTime = parseLooseDateTime(dt);
      if (!dateTime) warnings.push("Date-time line could not be parsed; using calendar start.");
      continue;
    }
    body.push(line);
  }

  const description = body.join("\n").replace(/^\n+/, "").replace(/\n+$/, "").trim();

  if (!title) warnings.push("Missing `# TITLE` in notes.");
  if (!description) warnings.push("Missing description in notes.");
  if (!dateTime) warnings.push("Missing date-time line in notes.");
  if (!duration) warnings.push("Missing duration `HH:MM` in notes.");

  return { title, description, dateTime, duration, warnings };
}

export function formatDuration(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function durationToMinutes(hhmm: string): number {
  const m = hhmm.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function icalDurationToMinutes(value: string): number | null {
  const m = value.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  const seconds = Number(m[4] ?? 0);
  return days * 24 * 60 + hours * 60 + minutes + Math.round(seconds / 60);
}

export function composeNotes(input: {
  title: string;
  description: string;
  dateTime: string;
  duration: string;
}): string {
  const title = input.title.trim().replace(/^#\s*/, "");
  const description = input.description.trim();
  const dateTime = input.dateTime.trim();
  const duration = input.duration.trim();
  return `# ${title}\n\n${description}\n\n${dateTime}\n\n${duration}`;
}
