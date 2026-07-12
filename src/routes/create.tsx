import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateCode, generateToken, formatDate, minutesToLabel } from "@/lib/hangout";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create event — Meetly" },
      { name: "description", content: "Start a new hangout and get a share code." },
    ],
  }),
  component: Create,
});

function todayIso(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function Create() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(60);
  const [dayStart, setDayStart] = useState(9 * 60);
  const [dayEnd, setDayEnd] = useState(21 * 60);
  const [dates, setDates] = useState<string[]>([todayIso(1), todayIso(2), todayIso(3)]);
  const [submitting, setSubmitting] = useState(false);

  const toggleDate = (iso: string) => {
    setDates((d) => (d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso].sort()));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !name.trim() || dates.length === 0) {
      toast.error("Add a title, your name, and at least one date.");
      return;
    }
    setSubmitting(true);
    const code = generateCode();
    const token = generateToken();
    const { data, error } = await supabase
      .from("events")
      .insert({
        code,
        title: title.trim().slice(0, 100),
        creator_name: name.trim().slice(0, 50),
        creator_token: token,
        duration_minutes: duration,
        date_options: dates,
        day_start_minute: dayStart,
        day_end_minute: dayEnd,
      })
      .select()
      .single();
    setSubmitting(false);
    if (error || !data) {
      toast.error("Could not create event. Try again.");
      return;
    }
    // remember creator locally so this browser can identify as creator
    try {
      localStorage.setItem(`meetly:creator:${code}`, token);
      localStorage.setItem(`meetly:name:${code}`, name.trim());
    } catch {}
    toast.success("Event created!");
    navigate({ to: "/event/$code", params: { code } });
  }

  const nextDays = Array.from({ length: 14 }, (_, i) => todayIso(i));

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <CalendarClock className="h-5 w-5" />
          </div>
          <span className="font-display text-xl font-bold">Meetly</span>
        </Link>
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Link>
        </Button>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-20">
        <h1 className="font-display text-4xl font-bold">Create your event</h1>
        <p className="mt-2 text-muted-foreground">Fill this in — you'll get a share code next.</p>

        <form onSubmit={submit} className="mt-8 space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="title">Event title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sunday brunch"
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex"
              maxLength={50}
            />
          </div>

          <div className="space-y-2">
            <Label>Duration</Label>
            <div className="flex flex-wrap gap-2">
              {[30, 60, 90, 120, 180, 240].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDuration(m)}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${
                    duration === m
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {m < 60 ? `${m}m` : `${m / 60}h`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Earliest start ({minutesToLabel(dayStart)})</Label>
              <input
                type="range"
                min={0}
                max={1425}
                step={15}
                value={dayStart}
                onChange={(e) => setDayStart(Math.min(Number(e.target.value), dayEnd - duration))}
                className="w-full accent-[var(--color-primary)]"
              />
            </div>
            <div className="space-y-2">
              <Label>Latest end ({minutesToLabel(dayEnd)})</Label>
              <input
                type="range"
                min={15}
                max={1440}
                step={15}
                value={dayEnd}
                onChange={(e) => setDayEnd(Math.max(Number(e.target.value), dayStart + duration))}
                className="w-full accent-[var(--color-primary)]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Possible dates ({dates.length} selected)</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {nextDays.map((iso) => {
                const selected = dates.includes(iso);
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => toggleDate(iso)}
                    className={`rounded-xl border p-3 text-left text-sm transition ${
                      selected
                        ? "border-primary bg-primary/10"
                        : "hover:border-primary/40 hover:bg-muted"
                    }`}
                  >
                    <div className="font-medium">{formatDate(iso)}</div>
                    <div className="text-xs text-muted-foreground">
                      {selected ? "Included" : "Tap to add"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create event & get code
          </Button>
        </form>
      </main>
    </div>
  );
}
