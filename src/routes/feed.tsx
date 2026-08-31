import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { redirectToLoginIfRequired } from "@/lib/app-data";
import { LIVE_SHOWS_ICAL } from "@/lib/calendar";
import { buildDemoIcs } from "@/lib/demo";
import { useBoard } from "@/lib/use-board";
import { useCuecast } from "@/lib/store";
import type { CalendarSource, PrivacyStatus } from "@/lib/types";
import { downloadText } from "@/lib/utils";

export const Route = createFileRoute("/feed")({ component: FeedPage });

function FeedPage() {
  const { loading, sync } = useBoard();
  const settings = useCuecast((s) => s.settings);
  const setSettings = useCuecast((s) => s.setSettings);
  const lastError = useCuecast((s) => s.lastError);
  const loginUrl = useCuecast((s) => s.loginUrl);
  const loginRequired = useCuecast((s) => s.loginRequired);
  const calendarName = useCuecast((s) => s.calendarName);
  const events = useCuecast((s) => s.events);

  async function apply(source: CalendarSource) {
    setSettings({ source });
    toast(source === "demo" ? "Studio demo loaded" : "Syncing calendar");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <p className="text-xs tracking-[0.2em] text-subtle uppercase">Source</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight">Calendar feed</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Cuecast watches the Live Shows calendar in Asia/Qatar. Weekly programmes expand to
          upcoming airings. Cover stills are matched to each show; an attached image still wins
          when the event has one.
        </p>
      </header>

      <div className="space-y-2">
        <Label htmlFor="privacy">Default privacy</Label>
        <Select
          value={settings.privacy}
          onValueChange={(value) => setSettings({ privacy: value as PrivacyStatus })}
        >
          <SelectTrigger id="privacy" className="max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unlisted">Unlisted</SelectItem>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="private">Private</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs
        value={settings.source}
        onValueChange={(value) => void apply(value as CalendarSource)}
      >
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="ical" className="flex-1 sm:flex-none">
            Live Shows
          </TabsTrigger>
          <TabsTrigger value="demo" className="flex-1 sm:flex-none">
            Demo
          </TabsTrigger>
          <TabsTrigger value="google" className="flex-1 sm:flex-none">
            Google
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ical" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ical">iCal address</Label>
            <Input
              id="ical"
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              value={settings.icalUrl}
              onChange={(e) => setSettings({ icalUrl: e.target.value })}
              autoComplete="off"
            />
            <p className="text-xs leading-relaxed text-subtle">
              Default is the public Live Shows feed (البرامج المباشرة), timezone Asia/Qatar. Swap in
              another secret .ics if you need a private calendar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setSettings({ source: "ical" });
                void sync();
              }}
              disabled={loading || !settings.icalUrl.trim()}
            >
              Read feed
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSettings({ icalUrl: LIVE_SHOWS_ICAL, source: "ical" });
                toast("Live Shows calendar restored");
                void sync();
              }}
            >
              Use Live Shows
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="demo" className="space-y-3">
          <p className="text-sm text-muted">
            Five studio events in the notes format, used when you want a dry run without the live
            calendar.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void sync()} disabled={loading}>
              Reload demo board
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                downloadText("cuecast-studio.ics", buildDemoIcs(), "text/calendar");
                toast("Sample iCal downloaded");
              }}
            >
              Download sample .ics
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="google" className="space-y-4">
          <p className="text-sm text-muted">
            Reads the primary Google Calendar through Grok. If Calendar is not connected, paste the
            secret iCal URL instead — the PHP command uses that same address.
          </p>
          {loginRequired && loginUrl && (
            <Button
              variant="secondary"
              onClick={() =>
                redirectToLoginIfRequired({
                  ok: false,
                  data: null,
                  loginRequired: true,
                  loginUrl,
                })
              }
            >
              Continue with Grok
            </Button>
          )}
          <Button
            onClick={() => {
              setSettings({ source: "google" });
              void sync();
            }}
            disabled={loading}
          >
            Sync Google Calendar
          </Button>
        </TabsContent>
      </Tabs>

      {lastError && <p className="text-sm text-muted">{lastError}</p>}

      {events.length > 0 && (
        <p className="text-sm text-muted">
          {calendarName}: {events.length} event{events.length === 1 ? "" : "s"} on the board.
        </p>
      )}
    </div>
  );
}
