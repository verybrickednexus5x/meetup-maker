import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, Loader2, MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AvailabilityBuilder } from "@/components/availability-builder";
import {
  ALL_DAY_DURATION,
  DURATION_PRESETS,
  durationToLabel,
  generateCode,
  generateToken,
  timeStringToMinutes,
  type Slot,
} from "@/lib/hangout";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create event - Meetly" },
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

function dateToIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoToDate(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

function openStreetMapEmbedUrl(lat: number, lon: number) {
  const delta = 0.01;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta]
    .map((value) => value.toFixed(6))
    .join("%2C");
  const marker = encodeURIComponent(`${lat.toFixed(6)},${lon.toFixed(6)}`);
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
}

type LocationSearchResult = {
  displayName: string;
  lat: number;
  lon: number;
};

type EventType = "flexible" | "fixed";

function Create() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState<EventType>("flexible");

  // Flexible mode: the creator picks their own dates + time windows, exactly
  // like guests will later. Duration suggestions are just voting chips.
  const [myWindows, setMyWindows] = useState<Slot[]>([]);
  const [durationOptions, setDurationOptions] = useState<number[]>([60]);
  const [customDurationMinutes, setCustomDurationMinutes] = useState("");
  const [category, setCategory] = useState<string>("");

  // Fixed mode: one specific date and exact start/end time (e.g. a birthday).
  const [fixedDate, setFixedDate] = useState<string>(todayIso(7));
  const [fixedStart, setFixedStart] = useState("18:00");
  const [fixedEnd, setFixedEnd] = useState("20:00");

  const [locationInput, setLocationInput] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [locationSearchResults, setLocationSearchResults] = useState<LocationSearchResult[]>([]);
  const [searchingLocations, setSearchingLocations] = useState(false);
  const [locationCoordinates, setLocationCoordinates] = useState<
    Record<string, { lat: number; lon: number }>
  >({});
  const [submitting, setSubmitting] = useState(false);

  const toggleDuration = (minutes: number) => {
    setDurationOptions((current) => {
      if (current.includes(minutes)) {
        if (current.length === 1) return current;
        return current.filter((x) => x !== minutes);
      }
      return [...current, minutes].sort((a, b) => a - b);
    });
  };

  useEffect(() => {
    const query = locationInput.trim();
    if (query.length < 3) {
      setLocationSearchResults([]);
      setSearchingLocations(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchingLocations(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`,
          {
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );
        if (!res.ok) throw new Error("Location lookup failed");
        const payload = (await res.json()) as Array<{
          display_name?: string;
          lat?: string;
          lon?: string;
        }>;
        const parsed = payload
          .map((item) => ({
            displayName: String(item.display_name ?? "").trim(),
            lat: Number(item.lat),
            lon: Number(item.lon),
          }))
          .filter(
            (item) => item.displayName && Number.isFinite(item.lat) && Number.isFinite(item.lon),
          );
        setLocationSearchResults(parsed);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLocationSearchResults([]);
        }
      } finally {
        setSearchingLocations(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [locationInput]);

  const addLocationSuggestion = (picked?: LocationSearchResult) => {
    const matched =
      picked ??
      locationSearchResults.find(
        (item) => item.displayName.toLowerCase() === locationInput.trim().toLowerCase(),
      ) ??
      locationSearchResults[0];
    const cleaned = (matched?.displayName ?? locationInput.trim()).slice(0, 200);
    if (!cleaned) return;
    setLocationSuggestions((current) =>
      current.some((x) => x.toLowerCase() === cleaned.toLowerCase())
        ? current
        : [...current, cleaned],
    );
    if (matched) {
      setLocationCoordinates((current) => ({
        ...current,
        [cleaned]: { lat: matched.lat, lon: matched.lon },
      }));
    }
    setLocationInput("");
    setLocationSearchResults([]);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !name.trim()) {
      toast.error("Add a title and your name.");
      return;
    }
    if (eventType === "flexible" && myWindows.length === 0) {
      toast.error("Add at least one date and time window you're available.");
      return;
    }

    let fixedStartMin: number | null = null;
    let fixedEndMin: number | null = null;
    if (eventType === "fixed") {
      fixedStartMin = timeStringToMinutes(fixedStart);
      fixedEndMin = timeStringToMinutes(fixedEnd);
      if (fixedStartMin === null || fixedEndMin === null || fixedEndMin <= fixedStartMin) {
        toast.error("Set a valid start and end time for the fixed date.");
        return;
      }
    }

    setSubmitting(true);
    const code = generateCode();
    const token = generateToken();

    const dateOptions =
      eventType === "fixed"
        ? [fixedDate]
        : Array.from(new Set(myWindows.map((w) => w.date))).sort((a, b) => a.localeCompare(b));
    const dayStart =
      eventType === "fixed"
        ? (fixedStartMin as number)
        : Math.min(...myWindows.map((w) => w.start));
    const dayEnd =
      eventType === "fixed" ? (fixedEndMin as number) : Math.max(...myWindows.map((w) => w.end));
    const durationMinutes =
      eventType === "fixed"
        ? (fixedEndMin as number) - (fixedStartMin as number)
        : (durationOptions.find((d) => d !== ALL_DAY_DURATION) ?? 60);

    try {
      const { data: eventRow, error } = await supabase
        .from("events")
        .insert({
          code,
          title: title.trim().slice(0, 100),
          description: description.trim().slice(0, 500) || null,
          category: category || null,
          creator_name: name.trim().slice(0, 50),
          creator_token: token,
          event_type: eventType,
          duration_minutes: durationMinutes,
          duration_options: eventType === "fixed" ? [durationMinutes] : durationOptions,
          date_options: dateOptions,
          day_start_minute: dayStart,
          day_end_minute: dayEnd,
          location_suggestions: locationSuggestions,
        })
        .select("id")
        .single();
      if (error || !eventRow) {
        toast.error(error?.message || "Could not create event. Try again.");
        return;
      }

      const creatorAvailability: Slot[] =
        eventType === "fixed"
          ? [{ date: fixedDate, start: fixedStartMin as number, end: fixedEndMin as number }]
          : myWindows;

      const { error: responseError } = await supabase.from("responses").insert({
        event_id: eventRow.id,
        name: name.trim().slice(0, 50),
        availability: creatorAvailability as unknown as never,
        preferred_duration: eventType === "fixed" ? durationMinutes : null,
      });
      if (responseError) {
        toast.error(
          "Event created, but your own availability couldn't be saved. Add it from the event page.",
        );
      }
    } catch {
      toast.error("Could not create event. Try again.");
      return;
    } finally {
      setSubmitting(false);
    }

    try {
      localStorage.setItem(`meetly:creator:${code}`, token);
      localStorage.setItem(`meetly:name:${code}`, name.trim());
    } catch {
      void 0;
    }
    toast.success("Event created!");
    navigate({ to: "/event/$code", params: { code } });
  }

  const mapPreview = locationSuggestions.at(-1);
  const mapPreviewCoordinates = mapPreview ? locationCoordinates[mapPreview] : undefined;

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
        <p className="mt-2 text-muted-foreground">Fill this in - you'll get a share code next.</p>

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
            <Label>Type (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {["Sports", "Food", "Gaming", "Study", "Other"].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory((current) => (current === c ? "" : c))}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${
                    category === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything guests should know - what to bring, dress code, parking..."
              maxLength={500}
              rows={3}
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
            <Label>Dates</Label>
            <Tabs value={eventType} onValueChange={(v) => setEventType(v as EventType)}>
              <TabsList className="grid w-full grid-cols-2 sm:w-auto">
                <TabsTrigger value="flexible">Flexible dates</TabsTrigger>
                <TabsTrigger value="fixed">Fixed date</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {eventType === "flexible"
                ? "Everyone adds the dates and times that work for them, and we'll find the best overlap."
                : "Lock in one specific date and time - good for birthdays or anything that can't move."}
            </p>
          </div>

          {eventType === "flexible" ? (
            <>
              <div className="space-y-2">
                <Label>How long should it be?</Label>
                <div className="flex flex-wrap gap-2">
                  {[...DURATION_PRESETS, ALL_DAY_DURATION].map((m) => (
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
                      {m === DURATION_PRESETS[DURATION_PRESETS.length - 1]
                        ? "4+ hours"
                        : durationToLabel(m)}
                    </button>
                  ))}
                  {durationOptions
                    .filter((m) => !DURATION_PRESETS.includes(m) && m !== ALL_DAY_DURATION)
                    .map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggleDuration(m)}
                        className="rounded-full border border-primary bg-primary px-4 py-1.5 text-sm text-primary-foreground"
                      >
                        {durationToLabel(m)}
                      </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={customDurationMinutes}
                    onChange={(e) => setCustomDurationMinutes(e.target.value)}
                    placeholder="Custom (minutes)"
                    className="w-40 rounded-md border bg-background px-2 py-1.5 text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const value = Number(customDurationMinutes);
                      if (Number.isFinite(value) && value >= 5) {
                        toggleDuration(Math.round(value));
                        setCustomDurationMinutes("");
                      }
                    }}
                  >
                    Add custom
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Select as many as make sense (a coffee vs. a hike need very different amounts of
                  time) - people vote on what works.
                </p>
              </div>

              <div className="space-y-2">
                <Label>When are you available?</Label>
                <AvailabilityBuilder windows={myWindows} onChange={setMyWindows} />
              </div>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date</Label>
                <Calendar
                  mode="single"
                  selected={isoToDate(fixedDate)}
                  onSelect={(date) => date && setFixedDate(dateToIso(date))}
                  disabled={{ before: isoToDate(todayIso(0)) }}
                  className="rounded-lg border bg-card"
                />
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Start time</Label>
                  <input
                    type="time"
                    value={fixedStart}
                    onChange={(e) => setFixedStart(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label>End time</Label>
                  <input
                    type="time"
                    value={fixedEnd}
                    onChange={(e) => setFixedEnd(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Location suggestions</Label>
            <div className="flex gap-2">
              <Input
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLocationSuggestion();
                  }
                }}
                placeholder="Search and add a location"
                maxLength={200}
              />
              <Button type="button" variant="secondary" onClick={() => addLocationSuggestion()}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add
              </Button>
            </div>
            {locationInput.trim().length >= 3 ? (
              <div className="rounded-xl border bg-background">
                {locationSearchResults.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto p-1">
                    {locationSearchResults.map((item) => (
                      <button
                        key={`${item.displayName}-${item.lat}-${item.lon}`}
                        type="button"
                        onClick={() => addLocationSuggestion(item)}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-muted"
                      >
                        {item.displayName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    {searchingLocations ? "Searching locations..." : "No location suggestions yet."}
                  </p>
                )}
              </div>
            ) : null}
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
                {mapPreviewCoordinates ? (
                  <iframe
                    title={`Map preview for ${mapPreview}`}
                    src={openStreetMapEmbedUrl(
                      mapPreviewCoordinates.lat,
                      mapPreviewCoordinates.lon,
                    )}
                    className="h-56 w-full"
                    loading="lazy"
                  />
                ) : (
                  <div className="p-3 text-xs text-muted-foreground">
                    Select one of the suggested results to preview it on OpenStreetMap.
                  </div>
                )}
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
