import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeNotes, parseNotes, stripHtml } from "./notes.ts";
import { parseIcs, toIcs } from "./ical.ts";
import { airStatus, compileLiveEvent, firstThumbnail, liveEventToRaw } from "./youtube.ts";
import { formatCuecastCli } from "./cli.ts";
import {
  applyScheduler,
  isDirty,
  opsToCsv,
  planScheduler,
  snapshotQueued,
  withRevisedNotes,
} from "./ops.ts";

describe("notes format", () => {
  it("reads # TITLE, description, date time, duration HH:MM", () => {
    const raw = composeNotes({
      title: "Night Shift: Shipping in Public",
      description: "A late desk session.",
      dateTime: "2026-09-04 21:00",
      duration: "02:00",
    });
    const parsed = parseNotes(raw);
    assert.equal(parsed.title, "Night Shift: Shipping in Public");
    assert.equal(parsed.description, "A late desk session.");
    assert.equal(parsed.duration, "02:00");
    assert.ok(parsed.dateTime);
    assert.equal(parsed.warnings.length, 0);
  });

  it("warns when the hash title is missing", () => {
    const parsed = parseNotes("Just a paragraph\n\n2026-09-04 21:00\n\n01:00");
    assert.equal(parsed.title, null);
    assert.ok(parsed.warnings.some((w) => /TITLE/i.test(w)));
  });

  it("strips Google Calendar HTML and decodes entities", () => {
    const html = "<b># Founder AMA</b><br>Questions " + "&" + " answers.<br>2026-09-05 19:00<br>01:15";
    const parsed = parseNotes(html);
    assert.equal(parsed.title, "Founder AMA");
    assert.equal(parsed.description, "Questions & answers.");
    assert.equal(parsed.duration, "01:15");
    const encoded = "A " + "&" + "lt;" + "live" + "&" + "gt;" + " night";
    assert.equal(stripHtml(encoded), "A <live> night");
  });
});

describe("iCal → live event", () => {
  it("uses the first attached image as the thumbnail", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "X-WR-CALNAME:Studio",
      "BEGIN:VEVENT",
      "UID:thumb-1@cuecast.app",
      "DTSTART:20260904T180000Z",
      "DTEND:20260904T193000Z",
      "SUMMARY:Night Shift",
      "DESCRIPTION:# Night Shift\\n\\nA late desk session.\\n\\n2026-09-04 21:00\\n\\n01:30",
      "ATTACH;FMTTYPE=image/jpeg;FILENAME=night.jpg:https://cdn.example/night.jpg",
      "ATTACH;FMTTYPE=application/pdf:https://cdn.example/notes.pdf",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const { events } = parseIcs(ics);
    assert.equal(events.length, 1);
    const live = compileLiveEvent(events[0]!, "ical", "unlisted");
    assert.equal(live.title, "Night Shift");
    assert.equal(live.duration, "01:30");
    assert.equal(live.thumbnailUrl, "https://cdn.example/night.jpg");
    assert.equal(live.youtube.snippet.title, "Night Shift");
    assert.equal(live.youtube.status.privacyStatus, "unlisted");
    assert.equal(firstThumbnail(live.attachments), "https://cdn.example/night.jpg");
  });

  it("picks an <img> from the notes HTML when ATTACH is missing", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:html-img@cuecast.app",
      "DTSTART:20260905T160000Z",
      "SUMMARY:AMA",
      'DESCRIPTION:<img src="https://cdn.example/ama.png">\\n# Founder AMA\\n\\nQuestions.\\n\\n2026-09-05 19:00\\n\\n01:15',
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const { events } = parseIcs(ics);
    const live = compileLiveEvent(events[0]!, "ical", "public");
    assert.equal(live.title, "Founder AMA");
    assert.equal(live.thumbnailUrl, "https://cdn.example/ama.png");
  });

  it("skips a non-image attach in favor of the first image", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:pdf-first@cuecast.app",
      "DTSTART:20260906T160000Z",
      "SUMMARY:Desk",
      "DESCRIPTION:# Design Desk\\n\\nCritique.\\n\\n2026-09-06 19:00\\n\\n00:45",
      "ATTACH;FMTTYPE=application/pdf:https://cdn.example/notes.pdf",
      "ATTACH;FMTTYPE=image/png;FILENAME=desk.png:https://cdn.example/desk.png",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const { events } = parseIcs(ics);
    const live = compileLiveEvent(events[0]!, "ical", "unlisted");
    assert.equal(live.thumbnailUrl, "https://cdn.example/desk.png");
  });

  it("round-trips a compiled event back into iCal", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "X-WR-CALNAME:Studio",
      "BEGIN:VEVENT",
      "UID:round@cuecast.app",
      "DTSTART:20260904T180000Z",
      "SUMMARY:Night Shift",
      "DESCRIPTION:# Night Shift\\n\\nA late desk session.\\n\\n2026-09-04 21:00\\n\\n01:30",
      "ATTACH;FMTTYPE=image/jpeg:https://cdn.example/night.jpg",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseIcs(ics);
    const live = compileLiveEvent(parsed.events[0]!, "ical", "unlisted");
    const again = parseIcs(toIcs([liveEventToRaw(live)], "Studio"));
    assert.equal(again.events[0]?.uid, "round@cuecast.app");
    assert.match(again.events[0]?.description ?? "", /# Night Shift/);
  });

  it("expands weekly Live Shows into upcoming Asia/Qatar airings", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "X-WR-CALNAME:Live Shows البرامج المباشرة",
      "X-WR-TIMEZONE:Asia/Qatar",
      "BEGIN:VEVENT",
      "DTSTART;TZID=Asia/Qatar:20260105T180000",
      "DTEND;TZID=Asia/Qatar:20260105T190000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "UID:green@google.com",
      "SUMMARY:خارج المستطيل الأخضر",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART:20260901T040000Z",
      "DTEND:20260901T050000Z",
      "UID:breakfast@google.com",
      "SUMMARY:The Breakfast Show مع DJMojay",
      "DESCRIPTION:برنامج صباحي يومي من الأحد للخميس",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const now = Date.parse("2026-08-31T20:00:00Z");
    const { calendarName, events } = parseIcs(ics, now);
    assert.equal(calendarName, "Live Shows البرامج المباشرة");
    const breakfast = events.find((e) => /Breakfast/.test(e.summary));
    assert.ok(breakfast);
    const green = events.filter((e) => /مستطيل/.test(e.summary));
    assert.ok(green.length >= 4);
    const live = compileLiveEvent(green[0]!, "ical", "unlisted");
    assert.equal(live.thumbnailUrl, "/thumbs/kharj-mustatil.jpg");
    const morning = compileLiveEvent(breakfast!, "ical", "unlisted");
    assert.equal(morning.thumbnailUrl, "/thumbs/breakfast-show.jpg");
  });

  it("does not treat an all-day DATE event as on-air", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "X-WR-TIMEZONE:Asia/Qatar",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260831",
      "DTEND;VALUE=DATE:20260901",
      "UID:drs@google.com",
      "SUMMARY:DRS مع يونس العيد",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const now = Date.parse("2026-08-31T20:27:00Z");
    const { events } = parseIcs(ics, now);
    const live = compileLiveEvent(events[0]!, "ical", "unlisted");
    assert.equal(live.allDay, true);
    assert.equal(airStatus(live, now), "all_day");
  });
});

describe("PHP dry-run stdout", () => {
  it("marks future events DRY and past events PAST", () => {
    const start = new Date("2026-09-10T18:00:00Z").toISOString();
    const end = new Date("2026-09-10T19:30:00Z").toISOString();
    const live = compileLiveEvent(
      {
        uid: "future@cuecast.app",
        summary: "Night Shift",
        description: composeNotes({
          title: "Night Shift",
          description: "Desk session.",
          dateTime: "2026-09-10 21:00",
          duration: "01:30",
        }),
        start,
        end,
        durationIcal: null,
        location: null,
        attachments: [{ url: "https://cdn.example/night.jpg", mime: "image/jpeg" }],
        calendarName: "Studio",
      },
      "ical",
      "unlisted",
    );
    const out = formatCuecastCli([live], "Studio", Date.parse("2026-09-01T00:00:00Z"));
    assert.match(out, /^Cuecast {2}· {2}Studio/m);
    assert.match(out, /^DRY\s+/m);
    assert.match(out, /thumb attached/);
    const past = formatCuecastCli([live], "Studio", Date.parse("2026-09-11T00:00:00Z"));
    assert.match(past, /^PAST\s+/m);
  });

  it("prints EDIT when a queued event's notes changed", () => {
    const live = compileLiveEvent(
      {
        uid: "edit@cuecast.app",
        summary: "Night Shift",
        description: composeNotes({
          title: "Night Shift",
          description: "Desk session.",
          dateTime: "2026-09-10 21:00",
          duration: "01:30",
        }),
        start: "2026-09-10T18:00:00.000Z",
        end: "2026-09-10T19:30:00.000Z",
        durationIcal: null,
        location: null,
        attachments: [{ url: "https://cdn.example/night.jpg", mime: "image/jpeg" }],
        calendarName: "Studio",
      },
      "ical",
      "unlisted",
    );
    const queued = { [live.uid]: snapshotQueued(live, "abc123xyz01") };
    const revised = withRevisedNotes(live);
    assert.equal(isDirty(live, queued[live.uid]), false);
    assert.equal(isDirty(revised, queued[live.uid]), true);
    const out = formatCuecastCli([revised], "Studio", Date.parse("2026-09-01T00:00:00Z"), queued);
    assert.match(out, /^EDIT\s+/m);
    assert.match(out, /will update YouTube/);
  });
});

describe("scheduler plan and CSV", () => {
  it("updates an existing broadcast when the fingerprint changes", () => {
    const live = compileLiveEvent(
      {
        uid: "plan@cuecast.app",
        summary: "AMA",
        description: composeNotes({
          title: "AMA",
          description: "Questions.",
          dateTime: "2026-09-20 19:00",
          duration: "01:00",
        }),
        start: "2026-09-20T16:00:00.000Z",
        end: "2026-09-20T17:00:00.000Z",
        durationIcal: null,
        location: null,
        attachments: [{ url: "https://cdn.example/ama.png", mime: "image/png" }],
        calendarName: "Studio",
      },
      "ical",
      "unlisted",
    );
    const queued = { [live.uid]: snapshotQueued(live, "vidAMA00001") };
    const revised = withRevisedNotes(live);
    const steps = planScheduler([revised], queued, Date.parse("2026-09-01T00:00:00Z"));
    assert.equal(steps[0]?.tag, "UPDATE");
    assert.ok(steps[0]?.fields.includes("title"));

    const applied = applyScheduler({
      events: [revised],
      queued,
      ops: [],
      quotaUsed: 0,
      quotaLimit: 10000,
      quotaDay: "2026-09-01",
      calendarName: "Studio",
      now: Date.parse("2026-09-01T00:00:00Z"),
      dryRun: false,
    });
    assert.equal(applied.updated, 1);
    assert.equal(applied.queued[live.uid]?.title, revised.title);
    const csv = opsToCsv(applied.ops);
    assert.match(csv, /^at,op,uid,video_id,title,http,units,quota_used,quota_limit,quota_remaining,note/m);
    assert.match(csv, /,update,/);
    assert.equal(applied.quotaUsed, 50);
  });
});
