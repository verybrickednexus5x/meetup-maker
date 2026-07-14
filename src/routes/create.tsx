import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, CalendarClock, Loader2, MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ALL_DAY_DURATION,
  durationToLabel,
  formatDate,
  generateCode,
  generateToken,
  minutesToLabel,
} from "@/lib/hangout";

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
  const [durationOptions, setDurationOptions] = useState<number[]>([60]);
  const [dayStart, setDayStart] = useState(9 * 60);
  const [dayEnd, setDayEnd] = useState(21 * 60);
  const [dates, setDates] = useState<string[]>([todayIso(1), todayIso(2), todayIso(3)]);
  const [customDate, setCustomDate] = useState(todayIso(7));
  const [allowSleepover, setAllowSleepover] = useState(false);
  const [locationInput, setLocationInput] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggleDate = (iso: string) => {
    setDates((d) => (d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso].sort()));
  };

  const toggleDuration = (minutes: number) => {
    setDurationOptions((current) => {
      if (current.includes(minutes)) {
        if (current.length === 1) return current;
        return current.filter((x) => x !== minutes);
      }
      return [...current, minutes].sort((a, b) => a - b);
    });
  };

  const addCustomDate = () => {
    if (!customDate) return;
    setDates((d) => (d.includes(customDate) ? d : [...d, customDate].sort()));
  };

  const addLocationSuggestion = () => {
    const cleaned = locationInput.trim().slice(0, 120);
    if (!cleaned) return;
    setLocationSuggestions((current) =>
      current.some((x) => x.toLowerCase() === cleaned.toLowerCase())
        ? current
        : [...current, cleaned],
    );
    setLocationInput("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !name.trim() || dates.length === 0 || durationOptions.length === 0) {
      toast.error("Add a title, your name, at least one date, and one duration suggestion.");
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
        duration_minutes:
          durationOptions.find((d) => d !== ALL_DAY_DURATION) ?? Math.max(dayEnd - dayStart, 30),
        duration_options: durationOptions,
        date_options: dates,
        day_start_minute: dayStart,
        day_end_minute: dayEnd,
        allow_sleepover: allowSleepover,
        location_suggestions: locationSuggestions,
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
    } catch {
      void 0;
    }
    toast.success("Event created!");
    navigate({ to: "/event/$code", params: { code } });
  }

  const nextDays = Array.from({ length: 14 }, (_, i) => todayIso(i));
  const mapPreview = locationSuggestions.at(-1);
  const requiredWindow = Math.max(
    15,
    ...durationOptions.filter((option) => option !== ALL_DAY_DURATION),
  );

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
            <Label>Duration suggestions</Label>
            <div className="flex flex-wrap gap-2">
              {[30, 60, 90, 120, 180, 240, ALL_DAY_DURATION].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleDuration(m)}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${
                    durationOptions.includes(m)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {durationToLabel(m)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              People can pick what works best for them, including an all-day option.
            </p>
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
                onChange={(e) =>
                  setDayStart(Math.min(Number(e.target.value), dayEnd - requiredWindow))
                }
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
                onChange={(e) =>
                  setDayEnd(Math.max(Number(e.target.value), dayStart + requiredWindow))
                }
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
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="custom-date">Add any date</Label>
                <Input
                  id="custom-date"
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              </div>
              <Button type="button" variant="secondary" onClick={addCustomDate}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add date
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Sleepover planning</Label>
            <button
              type="button"
              onClick={() => setAllowSleepover((v) => !v)}
              className={`rounded-xl border px-4 py-2 text-sm transition ${
                allowSleepover
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:border-primary/40 hover:bg-muted"
              }`}
            >
              {allowSleepover ? "Sleepover suggestions enabled" : "Enable sleepover suggestions"}
            </button>
            <p className="text-xs text-muted-foreground">
              If enabled, everyone can choose if they can sleep over and add their leave time.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Location suggestions</Label>
            <div className="flex gap-2">
              <Input
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                placeholder="Add a place or area"
                maxLength={120}
              />
              <Button type="button" variant="secondary" onClick={addLocationSuggestion}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add
              </Button>
            </div>
            {locationSuggestions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {locationSuggestions.map((location) => (
                  <button
                    key={location}
                    type="button"
                    onClick={() =>
                      setLocationSuggestions((current) => current.filter((x) => x !== location))
                    }
                    className="inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-xs"
                  >
                    <MapPin className="h-3 w-3" />
                    {location}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Add one or more places so everyone can vote on them.
              </p>
            )}
            {mapPreview ? (
              <div className="overflow-hidden rounded-xl border">
                <iframe
                  title={`Map preview for ${mapPreview}`}
                  src={`https://www.google.com/maps?q=${encodeURIComponent(mapPreview)}&output=embed`}
                  className="h-56 w-full"
                  loading="lazy"
                />
              </div>
            ) : null}
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
