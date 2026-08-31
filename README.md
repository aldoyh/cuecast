# Cuecast

YouTube Live scheduler for **Live Shows البرامج المباشرة**.

Cuecast reads the public Google Calendar iCal feed, expands weekly airings in **Asia/Qatar**, and lines each programme up as a YouTube Live. When an event later changes in the calendar, the existing broadcast is updated. Every YouTube call is appended to `cuecast-ops.csv` with quota units (10,000/day).

## Calendar

Public iCal:

```
https://calendar.google.com/calendar/ical/a832752ef1b4a490b08f611e0cf4a6df43986af604e1bf7965c614735fa867a6%40group.calendar.google.com/public/basic.ics
```

Programmes on the board:

| Show | Cadence |
| --- | --- |
| خارج المستطيل الأخضر | Weekly Monday 18:00 |
| The Breakfast Show مع DJMojay | Morning airing |
| DRS مع يونس العيد | Weekly Monday |
| FM League | Weekly Friday 19:00 |

Cover stills are matched to each show when the calendar event has no attached image.

## PHP command

```
php youtube-live-scheduler.php \
  --ical='https://calendar.google.com/calendar/ical/…/public/basic.ics' \
  --privacy=unlisted \
  --log=cuecast-ops.csv \
  --dry-run
```

New events insert a live broadcast. Changed events call `liveBroadcasts.update`. Thumbnails are the first attached image, or the show cover.

## Notes format (optional)

If you add a description block, it overrides the calendar summary:

```
# TITLE

DESCRIPTION

DATE TIME

DURATION AS HH:MM
```
