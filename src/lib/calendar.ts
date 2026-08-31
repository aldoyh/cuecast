/** Public iCal for Live Shows البرامج المباشرة (Asia/Qatar). */
export const LIVE_SHOWS_ICAL =
  "https://calendar.google.com/calendar/ical/a832752ef1b4a490b08f611e0cf4a6df43986af604e1bf7965c614735fa867a6%40group.calendar.google.com/public/basic.ics";

export const DISPLAY_TZ = "Asia/Qatar";

const COVERS: { pattern: RegExp; thumb: string }[] = [
  { pattern: /breakfast|djmojay|موجاي/i, thumb: "/thumbs/breakfast-show.jpg" },
  { pattern: /مستطيل|green rectangle/i, thumb: "/thumbs/kharj-mustatil.jpg" },
  { pattern: /fm\s*league/i, thumb: "/thumbs/fm-league.jpg" },
  { pattern: /drs|يونس/i, thumb: "/thumbs/drs-younis.jpg" },
];

export function coverForShow(title: string, summary = ""): string | null {
  const hay = `${title} ${summary}`;
  return COVERS.find((c) => c.pattern.test(hay))?.thumb ?? null;
}
