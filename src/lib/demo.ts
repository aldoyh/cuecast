import { toIcs } from "./ical";
import { composeNotes } from "./notes";
import { compileLiveEvent } from "./youtube";
import type { LiveEvent, PrivacyStatus, RawCalendarEvent } from "./types";

type DemoSpec = {
  id: string;
  title: string;
  summary: string;
  description: string;
  duration: string;
  offsetMs: number;
  thumb: string;
  location: string;
};

const SPECS: DemoSpec[] = [
  {
    id: "night-shift",
    title: "Night Shift: Shipping in Public",
    summary: "Night Shift",
    description:
      "A late desk session. We ship the calendar parser, take questions from chat, and leave with a working Cuecast command.",
    duration: "02:00",
    offsetMs: -35 * 60 * 1000,
    thumb: "/thumbs/night-shift.jpg",
    location: "Studio A — Desk 1",
  },
  {
    id: "founder-ama",
    title: "Founder AMA: From Calendar to Air",
    summary: "Founder AMA",
    description:
      "How Cuecast reads Google Calendar notes, maps them onto a YouTube Live broadcast, and why the first attached image becomes the thumbnail.",
    duration: "01:15",
    offsetMs: 3 * 60 * 60 * 1000,
    thumb: "/thumbs/founder-ama.jpg",
    location: "Studio B — Table",
  },
  {
    id: "design-desk",
    title: "Design Desk: Thumbnail Critique",
    summary: "Design Desk",
    description:
      "Live critique of stream thumbnails. Bring one still. We talk crop, type, and the red tally.",
    duration: "00:45",
    offsetMs: 26 * 60 * 60 * 1000,
    thumb: "/thumbs/design-desk.jpg",
    location: "Edit bay",
  },
  {
    id: "launch-window",
    title: "Launch Window: Cuecast 1.0",
    summary: "Launch Window",
    description:
      "The public launch stream. Demo the PHP command, walk a real iCal feed, and schedule the first live on air.",
    duration: "01:30",
    offsetMs: 3 * 24 * 60 * 60 * 1000,
    thumb: "/thumbs/launch-window.jpg",
    location: "Main stage",
  },
  {
    id: "studio-recap",
    title: "Studio Recap: Week in Review",
    summary: "Studio Recap",
    description:
      "What shipped, what broke, and the cuts we left on the floor. A quiet recap from the control room.",
    duration: "00:50",
    offsetMs: -20 * 60 * 60 * 1000,
    thumb: "/thumbs/studio-recap.jpg",
    location: "Control room",
  },
];

function formatLocalStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildDemoRaw(now = Date.now()): RawCalendarEvent[] {
  return SPECS.map((spec) => {
    const start = new Date(now + spec.offsetMs);
    const startIso = start.toISOString();
    const [hh, mm] = spec.duration.split(":").map(Number) as [number, number];
    const endIso = new Date(start.getTime() + (hh * 60 + mm) * 60000).toISOString();
    const notes = composeNotes({
      title: spec.title,
      description: spec.description,
      dateTime: formatLocalStamp(startIso),
      duration: spec.duration,
    });
    return {
      uid: `cuecast-demo-${spec.id}@cuecast.app`,
      summary: spec.summary,
      description: notes,
      start: startIso,
      end: endIso,
      durationIcal: null,
      location: spec.location,
      attachments: [
        {
          url: spec.thumb,
          mime: "image/jpeg",
          filename: `${spec.id}.jpg`,
        },
      ],
      calendarName: "Cuecast Studio",
    };
  });
}

export function buildDemoEvents(privacy: PrivacyStatus, now = Date.now()): LiveEvent[] {
  return buildDemoRaw(now)
    .map((raw) => compileLiveEvent(raw, "demo", privacy))
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

export function buildDemoIcs(now = Date.now()): string {
  return toIcs(buildDemoRaw(now), "Cuecast Studio");
}
