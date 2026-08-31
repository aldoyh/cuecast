import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { composeNotes, parseNotes } from "@/lib/notes";
import { toast } from "sonner";

export const Route = createFileRoute("/notes")({ component: NotesPage });

const SAMPLE = composeNotes({
  title: "Night Shift: Shipping in Public",
  description:
    "A late desk session. We ship the calendar parser, take questions from chat, and leave with a working Cuecast command.",
  dateTime: "2026-09-04 21:00",
  duration: "02:00",
});

function NotesPage() {
  const [title, setTitle] = useState("Night Shift: Shipping in Public");
  const [description, setDescription] = useState(
    "A late desk session. We ship the calendar parser, take questions from chat, and leave with a working Cuecast command.",
  );
  const [dateTime, setDateTime] = useState("2026-09-04 21:00");
  const [duration, setDuration] = useState("02:00");

  const block = useMemo(
    () => composeNotes({ title, description, dateTime, duration }),
    [title, description, dateTime, duration],
  );
  const parsed = useMemo(() => parseNotes(block), [block]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <p className="text-xs tracking-[0.2em] text-subtle uppercase">Format</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight">Event notes</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Paste this block into the Google Calendar description (notes). Cuecast — and the PHP command — read it exactly.
        </p>
      </header>

      <ol className="grid gap-3 sm:grid-cols-2">
        <Rule n="01" title="Title" body="First line, prefixed with a hash. Becomes the YouTube Live title." />
        <Rule n="02" title="Description" body="The paragraphs after the title. Becomes the YouTube description." />
        <Rule n="03" title="Date time" body="A single line. Used as scheduledStartTime. Calendar start is the fallback." />
        <Rule n="04" title="Duration" body="HH:MM. Sets scheduledEndTime. Calendar DTEND is the fallback." />
        <Rule n="05" title="Thumbnail" body="Not in the notes. The first image attached to the event is the thumbnail." />
      </ol>

      <div className="grid gap-6 lg:grid-cols-2">
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Field label="Title" id="title">
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description" id="desc">
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date time" id="dt">
              <Input id="dt" value={dateTime} onChange={(e) => setDateTime(e.target.value)} className="font-mono" />
            </Field>
            <Field label="Duration" id="dur">
              <Input id="dur" value={duration} onChange={(e) => setDuration(e.target.value)} className="font-mono" />
            </Field>
          </div>
        </form>

        <div className="space-y-3">
          <p className="text-xs tracking-[0.16em] text-subtle uppercase">Notes block</p>
          <pre className="min-h-48 overflow-auto rounded-lg bg-elevated p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg shadow-[var(--shadow-border)]">
            {block}
          </pre>
          <Button
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(block);
              toast("Notes copied — paste into the calendar event");
            }}
          >
            Copy notes
          </Button>
          <div className="rounded-lg bg-surface p-4 text-sm shadow-[var(--shadow-border)]">
            <p className="text-xs tracking-[0.16em] text-subtle uppercase">Parser</p>
            <dl className="mt-3 space-y-2">
              <Row k="Title" v={parsed.title ?? "—"} />
              <Row k="When" v={parsed.dateTime ?? "—"} />
              <Row k="Duration" v={parsed.duration ?? "—"} />
            </dl>
            {parsed.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {parsed.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-subtle">
        Sample that ships with the demo board uses this exact shape:
        <span className="mt-2 block font-mono whitespace-pre-wrap text-muted">{SAMPLE}</span>
      </p>
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Rule({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="rounded-lg bg-surface p-4 shadow-[var(--shadow-border)]">
      <p className="font-mono text-xs text-subtle">{n}</p>
      <p className="mt-1 font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </li>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-subtle">{k}</dt>
      <dd className="truncate font-mono text-xs">{v}</dd>
    </div>
  );
}
