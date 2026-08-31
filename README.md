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

## GitHub Secrets → YouTube

Credentials never live in this repo. Add them at
[Settings → Secrets and variables → Actions](https://github.com/aldoyh/cuecast/settings/secrets/actions):

| Secret | Required | Used for |
| --- | --- | --- |
| `YOUTUBE_CLIENT_ID` | yes | OAuth client |
| `YOUTUBE_CLIENT_SECRET` | yes | OAuth client |
| `YOUTUBE_REFRESH_TOKEN` | yes | Offline `youtube` scope. Exchanged for a short-lived access token at run time |
| `CUECAST_ICAL` | no | Private iCal URL. Empty = public Live Shows feed |

`.github/workflows/cuecast.yml` maps those secrets into environment variables:

```yaml
env:
  YOUTUBE_CLIENT_ID: ${{ secrets.YOUTUBE_CLIENT_ID }}
  YOUTUBE_CLIENT_SECRET: ${{ secrets.YOUTUBE_CLIENT_SECRET }}
  YOUTUBE_REFRESH_TOKEN: ${{ secrets.YOUTUBE_REFRESH_TOKEN }}
  CUECAST_ICAL: ${{ secrets.CUECAST_ICAL }}
```

PHP reads the env vars (never CLI flags in CI), POSTs the refresh token to
`https://oauth2.googleapis.com/token`, then calls YouTube Data API v3 with
`Authorization: Bearer <access_token>`. The access token is discarded when the
job ends. GitHub redacts secret values if they ever hit the log.

The workflow runs every 30 minutes and on **Run workflow**. State (`.cuecast.json`)
is cached so a later calendar edit issues `liveBroadcasts.update` instead of a
second insert.

## PHP command

```
php youtube-live-scheduler.php --dry-run
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
