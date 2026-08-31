#!/usr/bin/env php
<?php
/**
 * Cuecast — YouTube Live Event Scheduler
 *
 * Single-file command. Reads Google Calendar (secret iCal URL) or any .ics
 * feed, takes title / description / date-time / duration from the event NOTES
 * block, and uses the first attached image as the YouTube thumbnail.
 *
 * New events are inserted. When a previously published event changes in iCal,
 * the existing YouTube Live is updated. Every operation is appended to a CSV
 * with YouTube Data API quota units (default 10,000 / day).
 *
 * Notes format (calendar description):
 *
 *   # TITLE
 *
 *   DESCRIPTION
 *
 *   DATE TIME
 *
 *   DURATION AS HH:MM
 *
 * Usage:
 *   php youtube-live-scheduler.php --ical=URL --dry-run
 *   php youtube-live-scheduler.php --file=board.ics --log=cuecast-ops.csv --dry-run
 *   php youtube-live-scheduler.php --ical=URL --refresh-token=... --client-id=... --client-secret=...
 */

declare(strict_types=1);

const CUECAST_UA = 'Cuecast/1.0 (YouTube Live Scheduler)';
const CUECAST_COST_INSERT = 50;
const CUECAST_COST_UPDATE = 50;
const CUECAST_COST_THUMB = 50;
const CUECAST_DEFAULT_ICAL = 'https://calendar.google.com/calendar/ical/a832752ef1b4a490b08f611e0cf4a6df43986af604e1bf7965c614735fa867a6%40group.calendar.google.com/public/basic.ics';

function main(array $argv): int
{
    $opt = parse_args($argv);
    if ($opt['help']) {
        fwrite(STDOUT, help_text());
        return 0;
    }
    if ($opt['ical'] === '' && $opt['file'] === '') {
        fwrite(STDERR, "Missing --ical=URL or --file=PATH (or CUECAST_ICAL).\n\n" . help_text());
        return 2;
    }

    $ics = $opt['file'] !== '' ? read_local_ics($opt['file']) : fetch_url($opt['ical']);
    if ($ics === null) {
        fwrite(STDERR, $opt['file'] !== '' ? "Could not read iCal file.\n" : "Could not fetch iCal feed.\n");
        return 1;
    }
    $parsed = parse_ics($ics);
    $state = ensure_quota(load_state($opt['state']), (int) $opt['quota_limit']);
    $token = $opt['dry_run'] ? null : resolve_token($opt);
    if (!$opt['dry_run'] && $token === null && getenv('CUECAST_REQUIRE_YOUTUBE') === '1') {
        fwrite(STDERR, "No YouTube credentials. Set GitHub Secrets YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN.\n");
        return 3;
    }

    $now = time();
    $inserted = 0;
    $updated = 0;
    $skipped = 0;

    fwrite(STDOUT, "Cuecast  ·  {$parsed['calendar']}\n");
    fwrite(STDOUT, str_repeat('─', 56) . "\n");

    csv_append($opt['log'], log_row($state, 'fetch', '', '', $parsed['calendar'], '200', 0, 'ical ' . count($parsed['events']) . ' events'));

    foreach ($parsed['events'] as $raw) {
        $live = compile_event($raw);
        $uid = $live['uid'];
        $fp = event_fingerprint($live, $opt['privacy']);
        $start = strtotime($live['startAt']);
        $prev = $state['processed'][$uid] ?? null;
        $dirty = is_array($prev) && (($prev['fingerprint'] ?? '') !== $fp);

        if (is_array($prev) && !$dirty && !$opt['force']) {
            line($start <= $now ? 'PAST' : 'SKIP', $live, $start <= $now ? 'already processed' : 'unchanged');
            $skipped++;
            continue;
        }

        if (is_array($prev) && ($dirty || $opt['force']) && !empty($prev['videoId'])) {
            $fields = changed_fields($prev, $live, $opt['privacy']);
            $note = $fields ? implode(', ', $fields) . ' changed' : 'notes changed';
            $thumbChanged = ($prev['thumbnail'] ?? '') !== (string) ($live['thumbnail'] ?? '');
            $need = CUECAST_COST_UPDATE + ($thumbChanged && $live['thumbnail'] ? CUECAST_COST_THUMB : 0);
            if (!$opt['dry_run'] && $token !== null && !quota_ok($state, $need)) {
                line('QUOTA', $live, 'not enough quota to update');
                csv_append($opt['log'], log_row($state, 'quota', $uid, (string) $prev['videoId'], $live['title'], '403', 0, 'not enough quota to update'));
                $skipped++;
                continue;
            }
            if ($opt['dry_run'] || $token === null) {
                line('EDIT', $live, $note);
                csv_append($opt['log'], log_row($state, 'edit', $uid, (string) $prev['videoId'], $live['title'], '', $need, 'dry-run · ' . $note));
                $updated++;
                continue;
            }
            $videoId = (string) $prev['videoId'];
            $upd = youtube_update($token, $videoId, $live, $opt['privacy'], $start > $now);
            apply_quota_headers($state, $upd['headers']);
            if (!$upd['ok']) {
                line('ERR', $live, $upd['error']);
                csv_append($opt['log'], log_row($state, 'error', $uid, $videoId, $live['title'], (string) $upd['code'], 0, $upd['error']));
                continue;
            }
            bump_quota($state, CUECAST_COST_UPDATE);
            csv_append($opt['log'], log_row($state, 'update', $uid, $videoId, $live['title'], (string) $upd['code'], CUECAST_COST_UPDATE, $note));
            if ($thumbChanged && $live['thumbnail'] && quota_ok($state, CUECAST_COST_THUMB)) {
                $thumb = youtube_thumbnail($token, $videoId, $live['thumbnail']);
                apply_quota_headers($state, $thumb['headers']);
                if ($thumb['ok']) {
                    bump_quota($state, CUECAST_COST_THUMB);
                    csv_append($opt['log'], log_row($state, 'thumbnail', $uid, $videoId, $live['title'], (string) $thumb['code'], CUECAST_COST_THUMB, 'thumbnail updated'));
                } elseif ($opt['verbose']) {
                    fwrite(STDERR, "  thumbnail: {$thumb['error']}\n");
                }
            }
            $state['processed'][$uid] = processed_record($live, $videoId, $fp, $opt['privacy']);
            line('UPD', $live, "https://youtu.be/{$videoId}");
            $updated++;
            continue;
        }

        if ($start <= $now) {
            line('PAST', $live, 'start is not in the future');
            $skipped++;
            continue;
        }

        $need = CUECAST_COST_INSERT + ($live['thumbnail'] ? CUECAST_COST_THUMB : 0);
        if (!$opt['dry_run'] && $token !== null && !quota_ok($state, $need)) {
            line('QUOTA', $live, 'not enough quota to insert');
            csv_append($opt['log'], log_row($state, 'quota', $uid, '', $live['title'], '403', 0, 'not enough quota to insert'));
            $skipped++;
            continue;
        }

        if ($opt['dry_run'] || $token === null) {
            line('DRY', $live, $live['thumbnail'] ? 'thumb attached' : 'no thumbnail');
            csv_append($opt['log'], log_row($state, 'dry', $uid, '', $live['title'], '', $need, $live['thumbnail'] ? 'dry-run · thumb attached' : 'dry-run · no thumbnail'));
            $inserted++;
            continue;
        }

        $insert = youtube_insert($token, $live, $opt['privacy']);
        apply_quota_headers($state, $insert['headers']);
        if (!$insert['ok']) {
            line('ERR', $live, $insert['error']);
            csv_append($opt['log'], log_row($state, 'error', $uid, '', $live['title'], (string) $insert['code'], 0, $insert['error']));
            continue;
        }
        bump_quota($state, CUECAST_COST_INSERT);
        $videoId = $insert['id'];
        csv_append($opt['log'], log_row($state, 'insert', $uid, $videoId, $live['title'], (string) $insert['code'], CUECAST_COST_INSERT, 'created'));
        if ($live['thumbnail']) {
            $thumb = youtube_thumbnail($token, $videoId, $live['thumbnail']);
            apply_quota_headers($state, $thumb['headers']);
            if ($thumb['ok']) {
                bump_quota($state, CUECAST_COST_THUMB);
                csv_append($opt['log'], log_row($state, 'thumbnail', $uid, $videoId, $live['title'], (string) $thumb['code'], CUECAST_COST_THUMB, 'thumb attached'));
            } elseif ($opt['verbose']) {
                fwrite(STDERR, "  thumbnail: {$thumb['error']}\n");
            }
        }
        $state['processed'][$uid] = processed_record($live, $videoId, $fp, $opt['privacy']);
        line('LIVE', $live, "https://youtu.be/{$videoId}");
        $inserted++;
    }

    if (!$opt['dry_run']) {
        save_state($opt['state'], $state);
    }
    fwrite(STDOUT, str_repeat('─', 56) . "\n");
    fwrite(STDOUT, "queued {$inserted}  updated {$updated}  skipped {$skipped}\n");
    fwrite(STDOUT, sprintf(
        "quota %d/%d  remaining %d  csv %s\n",
        (int) $state['quota']['used'],
        (int) $state['quota']['limit'],
        quota_remaining($state),
        $opt['log']
    ));
    if ($opt['dry_run']) {
        fwrite(STDOUT, "dry-run — no YouTube calls were made\n");
    } elseif ($token === null) {
        fwrite(STDOUT, "no YouTube token — parsed only. Pass --refresh-token or --access-token.\n");
    }
    return 0;
}

function parse_args(array $argv): array
{
    $opt = [
        'ical' => '',
        'file' => '',
        'privacy' => 'unlisted',
        'state' => '.cuecast.json',
        'log' => 'cuecast-ops.csv',
        'quota_limit' => '10000',
        'access_token' => '',
        'refresh_token' => '',
        'client_id' => '',
        'client_secret' => '',
        'config' => 'cuecast.config.json',
        'dry_run' => false,
        'force' => false,
        'verbose' => false,
        'help' => false,
    ];
    foreach (array_slice($argv, 1) as $arg) {
        if ($arg === '--help' || $arg === '-h') {
            $opt['help'] = true;
            continue;
        }
        if ($arg === '--dry-run') {
            $opt['dry_run'] = true;
            continue;
        }
        if ($arg === '--force') {
            $opt['force'] = true;
            continue;
        }
        if ($arg === '--verbose' || $arg === '-v') {
            $opt['verbose'] = true;
            continue;
        }
        foreach ([
            'ical' => '--ical=',
            'file' => '--file=',
            'privacy' => '--privacy=',
            'state' => '--state=',
            'log' => '--log=',
            'quota_limit' => '--quota-limit=',
            'access_token' => '--access-token=',
            'refresh_token' => '--refresh-token=',
            'client_id' => '--client-id=',
            'client_secret' => '--client-secret=',
            'config' => '--config=',
        ] as $key => $prefix) {
            if (str_starts_with($arg, $prefix)) {
                $opt[$key] = substr($arg, strlen($prefix));
            }
        }
    }
    $cfg = load_cuecast_config($opt['config']);
    if ($opt['ical'] === '' && $opt['file'] === '' && ($cfg['icalUrl'] ?? '') !== '') {
        $opt['ical'] = (string) $cfg['icalUrl'];
    }
    foreach (['file', 'privacy', 'state', 'log', 'quota_limit', 'access_token', 'refresh_token', 'client_id', 'client_secret'] as $k) {
        $env = getenv('CUECAST_' . strtoupper($k));
        if ($opt[$k] === '' && is_string($env) && $env !== '') {
            $opt[$k] = $env;
        }
    }
    $aliases = [
        'client_id' => ['YOUTUBE_CLIENT_ID'],
        'client_secret' => ['YOUTUBE_CLIENT_SECRET'],
        'refresh_token' => ['YOUTUBE_REFRESH_TOKEN'],
        'access_token' => ['YOUTUBE_ACCESS_TOKEN'],
    ];
    foreach ($aliases as $k => $keys) {
        if ($opt[$k] !== '') {
            continue;
        }
        foreach ($keys as $name) {
            $env = getenv($name);
            if (is_string($env) && $env !== '') {
                $opt[$k] = $env;
                break;
            }
        }
    }
    if ($opt['ical'] === '' && $opt['file'] === '') {
        $opt['ical'] = CUECAST_DEFAULT_ICAL;
    }
    if (getenv('CUECAST_DRY_RUN') === '1') {
        $opt['dry_run'] = true;
    }
    return $opt;
}

function load_cuecast_config(string $path): array
{
    if ($path === '' || !is_readable($path)) {
        return [];
    }
    $raw = file_get_contents($path);
    if (!is_string($raw) || $raw === '') {
        return [];
    }
    $json = json_decode($raw, true);
    return is_array($json) ? $json : [];
}

function help_text(): string
{
    return <<<TXT
Cuecast — schedule YouTube Live from an iCal feed

  php youtube-live-scheduler.php --dry-run
  php youtube-live-scheduler.php --log=cuecast-ops.csv

Credentials are read from the environment (GitHub Actions secrets), never
from the repo:

  YOUTUBE_CLIENT_ID
  YOUTUBE_CLIENT_SECRET
  YOUTUBE_REFRESH_TOKEN

The calendar URL is NOT a secret. It comes from --ical, then cuecast.config.json
(the Feed page address), then the public Live Shows feed. GitHub Secrets never
override the feed.

The refresh token is exchanged at oauth2.googleapis.com/token for a short-lived
access token, then used as Authorization: Bearer against YouTube Data API v3.

New events are inserted. Changed events UPDATE the existing YouTube Live.
Operations and quota units are appended to cuecast-ops.csv.

TXT;
}

function line(string $tag, array $live, string $note): void
{
    $when = substr($live['startAt'], 0, 16);
    $title = function_exists('mb_strimwidth')
        ? mb_strimwidth($live['title'], 0, 32, '…', 'UTF-8')
        : substr($live['title'], 0, 32);
    fwrite(STDOUT, sprintf("%-5s  %-16s  %-32s  %s  %s\n", $tag, $when, $title, $live['duration'], $note));
}

function read_local_ics(string $path): ?string
{
    if (!is_file($path) || !is_readable($path)) {
        return null;
    }
    $data = file_get_contents($path);
    return is_string($data) ? $data : null;
}

function fetch_url(string $url): ?string
{
    $url = preg_replace('#^webcal://#i', 'https://', $url) ?? $url;
    $ch = curl_init($url);
    if ($ch === false) {
        return null;
    }
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => CUECAST_UA,
        CURLOPT_HTTPHEADER => ['Accept: text/calendar, text/plain, */*'],
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (!is_string($body) || $code >= 400) {
        return null;
    }
    return $body;
}

function unfold_ics(string $text): array
{
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    $raw = explode("\n", $text);
    $lines = [];
    foreach ($raw as $line) {
        if ($line === '') {
            continue;
        }
        if (($line[0] === ' ' || $line[0] === "\t") && $lines) {
            $lines[count($lines) - 1] .= substr($line, 1);
        } else {
            $lines[] = $line;
        }
    }
    return $lines;
}

function unescape_ical(string $value): string
{
    return str_replace(['\\n', '\\N', '\\,', '\\;', '\\\\'], ["\n", "\n", ',', ';', '\\'], $value);
}

function parse_ics(string $ics): array
{
    $lines = unfold_ics($ics);
    $calendar = 'Calendar';
    $timezone = 'Asia/Qatar';
    $masters = [];
    $in = false;
    $bucket = [];
    foreach ($lines as $line) {
        if ($line === 'BEGIN:VEVENT') {
            $in = true;
            $bucket = [];
            continue;
        }
        if ($line === 'END:VEVENT') {
            $ev = collect_event($bucket, $calendar, $timezone);
            if ($ev) {
                $masters[] = $ev;
            }
            $in = false;
            continue;
        }
        $colon = strpos($line, ':');
        if ($colon === false) {
            continue;
        }
        $meta = substr($line, 0, $colon);
        $value = substr($line, $colon + 1);
        $parts = explode(';', $meta);
        $name = strtoupper($parts[0]);
        $params = [];
        foreach (array_slice($parts, 1) as $part) {
            $eq = strpos($part, '=');
            if ($eq === false) {
                continue;
            }
            $params[strtoupper(substr($part, 0, $eq))] = substr($part, $eq + 1);
        }
        if (!$in && $name === 'X-WR-CALNAME') {
            $calendar = unescape_ical($value);
        }
        if (!$in && $name === 'X-WR-TIMEZONE') {
            $timezone = unescape_ical($value) ?: $timezone;
        }
        if ($in) {
            $bucket[] = ['name' => $name, 'params' => $params, 'value' => $value];
        }
    }
    return ['calendar' => $calendar, 'events' => expand_recurring($masters, $timezone)];
}

function prop(array $bucket, string $name): ?array
{
    foreach ($bucket as $p) {
        if ($p['name'] === $name) {
            return $p;
        }
    }
    return null;
}

function props(array $bucket, string $name): array
{
    return array_values(array_filter($bucket, fn($p) => $p['name'] === $name));
}

function ical_date(?array $prop, string $fallbackTz = 'Asia/Qatar'): ?string
{
    if (!$prop) {
        return null;
    }
    $raw = trim($prop['value']);
    $tzName = $prop['params']['TZID'] ?? $fallbackTz;
    try {
        $tz = new DateTimeZone($tzName);
    } catch (Exception $e) {
        $tz = new DateTimeZone('Asia/Qatar');
    }
    if (preg_match('/^(\d{8})$/', $raw, $m)) {
        $dt = DateTimeImmutable::createFromFormat('Ymd His', $m[1] . ' 000000', $tz);
        return $dt ? $dt->setTimezone(new DateTimeZone('UTC'))->format('c') : null;
    }
    if (preg_match('/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/', $raw, $m)) {
        $iso = "{$m[1]}-{$m[2]}-{$m[3]}T{$m[4]}:{$m[5]}:{$m[6]}";
        try {
            if (($m[7] ?? '') === 'Z') {
                return (new DateTimeImmutable($iso, new DateTimeZone('UTC')))->format('c');
            }
            return (new DateTimeImmutable($iso, $tz))->setTimezone(new DateTimeZone('UTC'))->format('c');
        } catch (Exception $e) {
            return null;
        }
    }
    try {
        return (new DateTimeImmutable($raw))->format('c');
    } catch (Exception $e) {
        return null;
    }
}

function collect_event(array $bucket, string $calendar, string $timezone): ?array
{
    $uid = prop($bucket, 'UID')['value'] ?? '';
    $start = ical_date(prop($bucket, 'DTSTART'), $timezone);
    if ($uid === '' || $start === null) {
        return null;
    }
    $attachments = [];
    foreach (props($bucket, 'ATTACH') as $p) {
        $attachments[] = [
            'url' => trim($p['value']),
            'mime' => $p['params']['FMTTYPE'] ?? '',
            'filename' => $p['params']['FILENAME'] ?? '',
        ];
    }
    $description = unescape_ical(prop($bucket, 'DESCRIPTION')['value'] ?? '');
    foreach (extract_img_src($description) as $src) {
        $attachments[] = ['url' => $src, 'mime' => 'image/*', 'filename' => ''];
    }
    return [
        'uid' => trim($uid),
        'summary' => unescape_ical(prop($bucket, 'SUMMARY')['value'] ?? ''),
        'description' => $description,
        'start' => $start,
        'end' => ical_date(prop($bucket, 'DTEND'), $timezone),
        'durationIcal' => prop($bucket, 'DURATION')['value'] ?? null,
        'rrule' => prop($bucket, 'RRULE')['value'] ?? null,
        'attachments' => $attachments,
        'calendar' => $calendar,
    ];
}

function expand_recurring(array $events, string $timezone): array
{
    $now = time();
    $from = $now - 2 * 86400;
    $to = $now + 42 * 86400;
    $out = [];
    $dayNames = ['SU' => 0, 'MO' => 1, 'TU' => 2, 'WE' => 3, 'TH' => 4, 'FR' => 5, 'SA' => 6];
    foreach ($events as $ev) {
        $rrule = $ev['rrule'] ?? null;
        if (!$rrule) {
            $start = strtotime($ev['start']);
            if ($start >= $from && $start <= $to) {
                $out[] = $ev;
            }
            continue;
        }
        $parts = [];
        foreach (explode(';', $rrule) as $bit) {
            [$k, $v] = array_pad(explode('=', $bit, 2), 2, '');
            $parts[strtoupper($k)] = $v;
        }
        if (strtoupper($parts['FREQ'] ?? '') !== 'WEEKLY') {
            $start = strtotime($ev['start']);
            if ($start >= $from && $start <= $to) {
                $out[] = $ev;
            }
            continue;
        }
        $interval = max(1, (int) ($parts['INTERVAL'] ?? 1));
        $byday = [];
        if (!empty($parts['BYDAY'])) {
            foreach (explode(',', $parts['BYDAY']) as $d) {
                $key = preg_replace('/^-?\d+/', '', strtoupper($d));
                if (isset($dayNames[$key])) {
                    $byday[] = $dayNames[$key];
                }
            }
        }
        $startDt = new DateTimeImmutable($ev['start']);
        $endDt = !empty($ev['end']) ? new DateTimeImmutable($ev['end']) : $startDt->modify('+1 hour');
        $duration = max(60, $endDt->getTimestamp() - $startDt->getTimestamp());
        $until = $to;
        if (!empty($parts['UNTIL'])) {
            $u = $parts['UNTIL'];
            if (preg_match('/^(\d{8})$/', $u, $m)) {
                $untilDt = DateTimeImmutable::createFromFormat('Ymd His', $m[1] . ' 235959', new DateTimeZone($timezone));
                if ($untilDt) {
                    $until = $untilDt->getTimestamp();
                }
            } else {
                $parsedUntil = strtotime($u);
                if ($parsedUntil) {
                    $until = $parsedUntil;
                }
            }
        }
        if (!$byday) {
            $byday[] = (int) $startDt->setTimezone(new DateTimeZone($timezone))->format('w');
        }
        $cursor = $startDt;
        $emitted = 0;
        $origin = $startDt->getTimestamp();
        while ($cursor->getTimestamp() <= min($until, $to) && $emitted < 80) {
            $dow = (int) $cursor->setTimezone(new DateTimeZone($timezone))->format('w');
            $weekIndex = (int) round(($cursor->getTimestamp() - $origin) / 604800);
            if (in_array($dow, $byday, true) && $weekIndex % $interval === 0) {
                $ts = $cursor->getTimestamp();
                if ($ts + $duration >= $from && $ts <= $until && $ts <= $to) {
                    $copy = $ev;
                    $copy['uid'] = $ev['uid'] . '::' . gmdate('Y-m-d', $ts);
                    $copy['start'] = gmdate('c', $ts);
                    $copy['end'] = gmdate('c', $ts + $duration);
                    $copy['rrule'] = null;
                    $out[] = $copy;
                    $emitted++;
                }
            }
            $cursor = $cursor->modify('+1 day');
        }
    }
    usort($out, fn($a, $b) => strtotime($a['start']) <=> strtotime($b['start']));
    return $out;
}

function extract_img_src(string $html): array
{
    if (!preg_match_all('/<img[^>]+src=["\']([^"\']+)["\']/i', $html, $m)) {
        return [];
    }
    return $m[1];
}

function strip_html(string $html): string
{
    $html = preg_replace('/<\s*br\s*\/?>/i', "\n", $html) ?? $html;
    $html = preg_replace('/<\s*\/p\s*>/i', "\n\n", $html) ?? $html;
    return html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

function parse_notes(string $raw): array
{
    $text = strip_html($raw);
    $lines = preg_split("/\n/", $text) ?: [];
    $i = 0;
    while ($i < count($lines) && trim($lines[$i]) === '') {
        $i++;
    }
    $title = null;
    if ($i < count($lines) && preg_match('/^#\s+(.+)$/', trim($lines[$i]), $m)) {
        $title = trim($m[1]);
        $i++;
    } elseif ($i < count($lines) && preg_match('/^title\s*[:\-]\s*(.+)$/i', trim($lines[$i]), $m)) {
        $title = trim($m[1]);
        $i++;
    }
    $body = [];
    $dateTime = null;
    $duration = null;
    for (; $i < count($lines); $i++) {
        $line = $lines[$i];
        $trim = trim($line);
        if (preg_match('/^(?:duration\s*[:\-]\s*)?(\d{1,2}):([0-5]\d)$/i', $trim, $m)) {
            $duration = str_pad($m[1], 2, '0', STR_PAD_LEFT) . ':' . $m[2];
            continue;
        }
        if (preg_match('/^(?:date(?:\s*time)?\s*[:\-]\s*)?(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)/i', $trim, $m)) {
            try {
                $dt = new DateTimeImmutable($m[1] . 'T' . $m[2]);
                $dateTime = $dt->format('c');
            } catch (Exception $e) {
                $dateTime = $m[1] . 'T' . $m[2];
            }
            continue;
        }
        $body[] = $line;
    }
    return [
        'title' => $title,
        'description' => trim(implode("\n", $body)),
        'dateTime' => $dateTime,
        'duration' => $duration,
    ];
}

function duration_minutes(string $hhmm): int
{
    if (!preg_match('/^(\d{1,2}):([0-5]\d)$/', $hhmm, $m)) {
        return 0;
    }
    return ((int) $m[1]) * 60 + (int) $m[2];
}

function first_thumbnail(array $attachments): ?string
{
    foreach ($attachments as $a) {
        $url = $a['url'] ?? '';
        if ($url === '') {
            continue;
        }
        $mime = strtolower($a['mime'] ?? '');
        $name = $a['filename'] ?: $url;
        $isImage = str_starts_with($mime, 'image/') || preg_match('/\.(avif|gif|jpe?g|png|webp)(\?|#|$)/i', $name);
        if (!$isImage) {
            continue;
        }
        if (preg_match('#drive\.google\.com/file/d/([^/]+)#', $url, $m)) {
            return 'https://drive.google.com/uc?export=view&id=' . $m[1];
        }
        return $url;
    }
    foreach ($attachments as $a) {
        if (!empty($a['url'])) {
            $url = $a['url'];
            if (preg_match('#drive\.google\.com/file/d/([^/]+)#', $url, $m)) {
                return 'https://drive.google.com/uc?export=view&id=' . $m[1];
            }
            return $url;
        }
    }
    return null;
}

function compile_event(array $raw): array
{
    $notes = parse_notes($raw['description'] ?? '');
    $title = $notes['title'] ?: ($raw['summary'] ?: 'Untitled live');
    $description = $notes['description'] ?: '';
    $startAt = $notes['dateTime'] ?: $raw['start'];
    $minutes = $notes['duration'] ? duration_minutes($notes['duration']) : 0;
    if ($minutes <= 0 && !empty($raw['end'])) {
        $minutes = (int) round((strtotime($raw['end']) - strtotime($startAt)) / 60);
    }
    if ($minutes <= 0) {
        $minutes = 60;
    }
    $endAt = date('c', strtotime($startAt) + $minutes * 60);
    $h = intdiv($minutes, 60);
    $m = $minutes % 60;
    return [
        'uid' => $raw['uid'],
        'title' => $title,
        'description' => $description,
        'startAt' => date('c', strtotime($startAt)),
        'endAt' => $endAt,
        'duration' => sprintf('%02d:%02d', $h, $m),
        'thumbnail' => first_thumbnail($raw['attachments'] ?? []),
    ];
}

function event_fingerprint(array $live, string $privacy): string
{
    return hash('sha1', implode("\n", [
        trim($live['title']),
        trim($live['description']),
        gmdate('c', strtotime($live['startAt'])),
        gmdate('c', strtotime($live['endAt'])),
        $live['duration'],
        (string) ($live['thumbnail'] ?? ''),
        $privacy,
    ]));
}

function changed_fields(array $prev, array $live, string $privacy): array
{
    $fields = [];
    if (($prev['title'] ?? '') !== $live['title']) {
        $fields[] = 'title';
    }
    if (($prev['description'] ?? '') !== $live['description']) {
        $fields[] = 'description';
    }
    if (!empty($prev['startAt']) && strtotime((string) $prev['startAt']) !== strtotime($live['startAt'])) {
        $fields[] = 'startAt';
    }
    if (!empty($prev['endAt']) && strtotime((string) $prev['endAt']) !== strtotime($live['endAt'])) {
        $fields[] = 'endAt';
    }
    if (($prev['duration'] ?? '') !== $live['duration']) {
        $fields[] = 'duration';
    }
    if (($prev['thumbnail'] ?? '') !== (string) ($live['thumbnail'] ?? '')) {
        $fields[] = 'thumbnail';
    }
    if (($prev['privacy'] ?? '') !== $privacy) {
        $fields[] = 'privacy';
    }
    return $fields;
}

function processed_record(array $live, string $videoId, string $fp, string $privacy): array
{
    return [
        'videoId' => $videoId,
        'at' => gmdate('c'),
        'title' => $live['title'],
        'description' => $live['description'],
        'startAt' => $live['startAt'],
        'endAt' => $live['endAt'],
        'duration' => $live['duration'],
        'thumbnail' => $live['thumbnail'] ?? '',
        'privacy' => $privacy,
        'fingerprint' => $fp,
    ];
}

function load_state(string $path): array
{
    if (!is_file($path)) {
        return ['processed' => [], 'quota' => ['day' => gmdate('Y-m-d'), 'used' => 0, 'limit' => 10000]];
    }
    $json = json_decode((string) file_get_contents($path), true);
    if (!is_array($json)) {
        return ['processed' => [], 'quota' => ['day' => gmdate('Y-m-d'), 'used' => 0, 'limit' => 10000]];
    }
    $json['processed'] = $json['processed'] ?? [];
    return $json;
}

function save_state(string $path, array $state): void
{
    file_put_contents($path, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
}

function ensure_quota(array $state, int $limit): array
{
    $day = gmdate('Y-m-d');
    $q = is_array($state['quota'] ?? null) ? $state['quota'] : [];
    if (($q['day'] ?? '') !== $day) {
        $q = ['day' => $day, 'used' => 0, 'limit' => $limit > 0 ? $limit : 10000];
    } else {
        $q['limit'] = $limit > 0 ? $limit : (int) ($q['limit'] ?? 10000);
        $q['used'] = (int) ($q['used'] ?? 0);
    }
    $state['quota'] = $q;
    return $state;
}

function quota_remaining(array $state): int
{
    return max(0, (int) $state['quota']['limit'] - (int) $state['quota']['used']);
}

function quota_ok(array $state, int $need): bool
{
    return quota_remaining($state) >= $need;
}

function bump_quota(array &$state, int $units): void
{
    $state['quota']['used'] = (int) $state['quota']['used'] + $units;
}

function apply_quota_headers(array &$state, array $headers): void
{
    $remaining = $headers['x-ratelimit-remaining'] ?? $headers['x-quota-remaining'] ?? null;
    $limit = $headers['x-ratelimit-limit'] ?? $headers['x-quota-limit'] ?? null;
    if (is_numeric($limit)) {
        $state['quota']['limit'] = (int) $limit;
    }
    if (is_numeric($remaining)) {
        $state['quota']['used'] = max(0, (int) $state['quota']['limit'] - (int) $remaining);
    }
}

function csv_append(string $path, array $row): void
{
    $header = ['at', 'op', 'uid', 'video_id', 'title', 'http', 'units', 'quota_used', 'quota_limit', 'quota_remaining', 'note'];
    $new = !is_file($path) || filesize($path) === 0;
    $fh = fopen($path, 'ab');
    if ($fh === false) {
        return;
    }
    if ($new) {
        fputcsv($fh, $header);
    }
    $cells = [];
    foreach ($header as $key) {
        $cells[] = $row[$key] ?? '';
    }
    fputcsv($fh, $cells);
    fclose($fh);
}

function log_row(array $state, string $op, string $uid, string $videoId, string $title, string $http, int $units, string $note): array
{
    return [
        'at' => gmdate('c'),
        'op' => $op,
        'uid' => $uid,
        'video_id' => $videoId,
        'title' => $title,
        'http' => $http,
        'units' => $units,
        'quota_used' => (int) $state['quota']['used'],
        'quota_limit' => (int) $state['quota']['limit'],
        'quota_remaining' => quota_remaining($state),
        'note' => $note,
    ];
}

function resolve_token(array $opt): ?string
{
    if ($opt['access_token'] !== '') {
        return $opt['access_token'];
    }
    if ($opt['refresh_token'] === '' || $opt['client_id'] === '' || $opt['client_secret'] === '') {
        return null;
    }
    $res = http_request('POST', 'https://oauth2.googleapis.com/token', null, http_build_query([
        'client_id' => $opt['client_id'],
        'client_secret' => $opt['client_secret'],
        'refresh_token' => $opt['refresh_token'],
        'grant_type' => 'refresh_token',
    ]), 'application/x-www-form-urlencoded');
    $json = $res['json'];
    return is_array($json) && !empty($json['access_token']) ? (string) $json['access_token'] : null;
}

function broadcast_payload(array $live, string $privacy, bool $includeTimes): array
{
    $snippet = [
        'title' => function_exists('mb_substr') ? mb_substr($live['title'], 0, 100) : substr($live['title'], 0, 100),
        'description' => function_exists('mb_substr') ? mb_substr($live['description'], 0, 5000) : substr($live['description'], 0, 5000),
    ];
    if ($includeTimes) {
        $snippet['scheduledStartTime'] = gmdate('c', strtotime($live['startAt']));
        $snippet['scheduledEndTime'] = gmdate('c', strtotime($live['endAt']));
    }
    return [
        'snippet' => $snippet,
        'status' => [
            'privacyStatus' => $privacy,
            'selfDeclaredMadeForKids' => false,
        ],
        'contentDetails' => [
            'enableAutoStart' => false,
            'enableAutoStop' => true,
            'enableDvr' => true,
            'recordFromStart' => true,
            'latencyPreference' => 'normal',
        ],
    ];
}

function youtube_insert(string $token, array $live, string $privacy): array
{
    $payload = broadcast_payload($live, $privacy, true);
    $res = http_request(
        'POST',
        'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails',
        $token,
        json_encode($payload)
    );
    $json = $res['json'];
    if ($res['code'] >= 400 || !is_array($json) || empty($json['id'])) {
        $err = is_array($json) ? ($json['error']['message'] ?? ('HTTP ' . $res['code'])) : ('HTTP ' . $res['code']);
        return ['ok' => false, 'error' => (string) $err, 'code' => $res['code'], 'headers' => $res['headers']];
    }
    return ['ok' => true, 'id' => (string) $json['id'], 'code' => $res['code'], 'headers' => $res['headers']];
}

function youtube_update(string $token, string $videoId, array $live, string $privacy, bool $includeTimes): array
{
    $payload = broadcast_payload($live, $privacy, $includeTimes);
    $payload['id'] = $videoId;
    $res = http_request(
        'PUT',
        'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=id,snippet,status',
        $token,
        json_encode($payload)
    );
    $json = $res['json'];
    if ($res['code'] >= 400 || !is_array($json) || empty($json['id'])) {
        $err = is_array($json) ? ($json['error']['message'] ?? ('HTTP ' . $res['code'])) : ('HTTP ' . $res['code']);
        return ['ok' => false, 'error' => (string) $err, 'code' => $res['code'], 'headers' => $res['headers']];
    }
    return ['ok' => true, 'id' => (string) $json['id'], 'code' => $res['code'], 'headers' => $res['headers']];
}

function youtube_thumbnail(string $token, string $videoId, string $imageUrl): array
{
    $bin = fetch_url($imageUrl);
    if ($bin === null) {
        return ['ok' => false, 'error' => 'could not download thumbnail', 'code' => 0, 'headers' => []];
    }
    $url = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=' . urlencode($videoId);
    $res = http_request('POST', $url, $token, $bin, 'image/jpeg');
    if ($res['code'] >= 400) {
        return ['ok' => false, 'error' => 'HTTP ' . $res['code'], 'code' => $res['code'], 'headers' => $res['headers']];
    }
    return ['ok' => true, 'code' => $res['code'], 'headers' => $res['headers']];
}

function http_request(string $method, string $url, ?string $token, ?string $body, string $contentType = 'application/json'): array
{
    $headersOut = [];
    $ch = curl_init($url);
    if ($ch === false) {
        return ['code' => 0, 'json' => null, 'headers' => [], 'raw' => ''];
    }
    $http = ['Content-Type: ' . $contentType];
    if ($token) {
        $http[] = 'Authorization: Bearer ' . $token;
    }
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => $http,
        CURLOPT_HEADERFUNCTION => function ($ch, $header) use (&$headersOut) {
            $parts = explode(':', $header, 2);
            if (count($parts) === 2) {
                $headersOut[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
            return strlen($header);
        },
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $json = is_string($raw) ? json_decode($raw, true) : null;
    return ['code' => $code, 'json' => is_array($json) ? $json : null, 'headers' => $headersOut, 'raw' => is_string($raw) ? $raw : ''];
}

if (PHP_SAPI !== 'cli') {
    header('Content-Type: text/plain; charset=utf-8');
    header('Content-Disposition: attachment; filename="youtube-live-scheduler.php"');
    readfile(__FILE__);
    exit;
}

exit(main($argv));
