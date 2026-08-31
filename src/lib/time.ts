import { DISPLAY_TZ } from "./calendar.ts";

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatClock(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(totalSeconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${sign}${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function secondsUntil(iso: string, now = Date.now()): number {
  return Math.round((new Date(iso).getTime() - now) / 1000);
}

export function formatWhen(iso: string, timeZone = DISPLAY_TZ): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(d);
}

export function formatWhenLong(iso: string, timeZone = DISPLAY_TZ): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "short",
  }).format(d);
}

export function formatDurationHuman(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hours = h ?? 0;
  const minutes = m ?? 0;
  if (hours >= 12) return "All day";
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

export function remainingLabel(endAt: string, now = Date.now()): string {
  const end = new Date(endAt).getTime();
  if (end <= now) return "00:00:00";
  return formatClock(Math.round((end - now) / 1000));
}