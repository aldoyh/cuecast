import { useCallback, useEffect, useMemo, useState } from "react";
import { buildDemoEvents } from "./demo";
import { useCuecast } from "./store";
import { fetchGoogleBoard, fetchIcalBoard } from "./sync";
import { withPrivacy } from "./youtube";

export function useBoard() {
  const settings = useCuecast((s) => s.settings);
  const setBoard = useCuecast((s) => s.setBoard);
  const setError = useCuecast((s) => s.setError);
  const demoEpoch = useCuecast((s) => s.demoEpoch);
  const rawEvents = useCuecast((s) => s.events);
  const [loading, setLoading] = useState(true);

  const sync = useCallback(async () => {
    setLoading(true);
    try {
      if (settings.source === "demo") {
        const epoch = demoEpoch ?? Date.now();
        const events = buildDemoEvents(settings.privacy, epoch);
        setBoard({
          events,
          calendarName: "Cuecast Studio",
          fetchedAt: new Date().toISOString(),
          demoEpoch: epoch,
        });
        return;
      }
      if (settings.source === "ical") {
        if (!settings.icalUrl.trim()) {
          setError("Paste a Google Calendar secret iCal URL, or any .ics feed.");
          setBoard({ events: [], calendarName: "", fetchedAt: new Date().toISOString() });
          return;
        }
        const result = await fetchIcalBoard({
          data: { url: settings.icalUrl, privacy: settings.privacy },
        });
        if (!result.ok) {
          setError(result.error ?? "Could not read the feed.");
          return;
        }
        setBoard(result);
        return;
      }
      const result = await fetchGoogleBoard({ data: { privacy: settings.privacy } });
      if (!result.ok) {
        setError(result.error ?? "Google Calendar is not connected.", {
          loginUrl: result.loginUrl,
          loginRequired: result.loginRequired,
        });
        return;
      }
      setBoard(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setLoading(false);
    }
  }, [demoEpoch, settings.icalUrl, settings.privacy, settings.source, setBoard, setError]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!useCuecast.persist.hasHydrated()) {
        await useCuecast.persist.rehydrate();
      }
      if (!cancelled) await sync();
    })();
    return () => {
      cancelled = true;
    };
  }, [sync]);

  const events = useMemo(
    () => withPrivacy(rawEvents, settings.privacy),
    [rawEvents, settings.privacy],
  );

  return { loading, sync, events };
}
