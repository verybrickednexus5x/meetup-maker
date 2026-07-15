import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Check, Copy, MapPin, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AvailabilityBuilder } from "@/components/availability-builder";
import {
  ALL_DAY_DURATION,
  formatDate,
  minutesToLabel,
  durationToLabel,
  computeBestSlot,
  type Slot,
} from "@/lib/hangout";

type EventRow = {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  category?: string | null;
  event_type?: string | null;
  creator_name: string;
  creator_token: string;
  duration_minutes: number;
  date_options: string[];
  day_start_minute: number;
  day_end_minute: number;
  duration_options?: number[] | null;
  location_suggestions?: string[] | null;
};
type ResponseRow = {
  id: string;
  event_id: string;
  name: string;
  availability: Slot[];
  preferred_duration?: number | null;
  preferred_location?: string | null;
};

function openStreetMapEmbedUrl(lat: number, lon: number) {
  const delta = 0.01;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta]
    .map((value) => value.toFixed(6))
    .join("%2C");
  const marker = encodeURIComponent(`${lat.toFixed(6)},${lon.toFixed(6)}`);
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
}

function eventQuery(code: string) {
  return queryOptions({
    queryKey: ["event", code],
    queryFn: async () => {
      const { data: event, error } = await supabase
        .from("events")
        .select("*")
        .eq("code", code)
        .maybeSingle();
      if (error) throw error;
      if (!event) throw notFound();
      const { data: responses, error: rerr } = await supabase
        .from("responses")
        .select("*")
        .eq("event_id", event.id)
        .order("created_at");
      if (rerr) throw rerr;
      return {
        event: event as unknown as EventRow,
        responses: (responses ?? []) as unknown as ResponseRow[],
      };
    },
  });
}

export const Route = createFileRoute("/event/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Event ${params.code} - Meetly` },
      { name: "description", content: "Add your availability for this hangout." },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(eventQuery(params.code.toUpperCase())),
  component: EventPage,
  errorComponent: ({ error }) => <ErrorState message={error.message || "Something went wrong"} />,
  notFoundComponent: () => <ErrorState message="No event found for that code." />,
});

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <h1 className="font-display text-2xl font-bold">Can't find that event</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Button asChild className="mt-6">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}

function normalizeDurationOptions(event: EventRow): number[] {
  const raw = Array.isArray(event.duration_options)
    ? event.duration_options
    : [event.duration_minutes];
  const cleaned = raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && (value === ALL_DAY_DURATION || value >= 15));
  return cleaned.length > 0 ? Array.from(new Set(cleaned)).sort((a, b) => a - b) : [60];
}

function normalizeLocationSuggestions(event: EventRow): string[] {
  if (!Array.isArray(event.location_suggestions)) return [];
  return event.location_suggestions
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function groupWindowsByDate(windows: Slot[]): { date: string; windows: Slot[] }[] {
  const byDate = new Map<string, Slot[]>();
  for (const w of windows) {
    const list = byDate.get(w.date) ?? [];
    list.push(w);
    byDate.set(w.date, list);
  }
  return Array.from(byDate.entries())
    .map(([date, list]) => ({
      date,
      windows: [...list].sort((a, b) => a.start - b.start),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function EventPage() {
  const { code } = Route.useParams();
  const upper = code.toUpperCase();
  const { data } = useSuspenseQuery(eventQuery(upper));
  const qc = useQueryClient();
  const { event, responses } = data;
  const isFixed = event.event_type === "fixed";

  const [creatorToken, setCreatorToken] = useState<string | null>(null);
  const [myName, setMyName] = useState("");

  useEffect(() => {
    try {
      setCreatorToken(localStorage.getItem(`meetly:creator:${upper}`));
      setMyName(localStorage.getItem(`meetly:name:${upper}`) ?? "");
    } catch {
      void 0;
    }
  }, [upper]);

  const isCreator = creatorToken === event.creator_token;

  const myResponse = useMemo(
    () => responses.find((r) => r.name.toLowerCase() === myName.trim().toLowerCase()),
    [responses, myName],
  );
  const durationOptions = useMemo(() => normalizeDurationOptions(event), [event]);
  const locationSuggestions = useMemo(() => normalizeLocationSuggestions(event), [event]);

  const [availability, setAvailability] = useState<Slot[]>([]);
  const [preferredDuration, setPreferredDuration] = useState<number | null>(null);
  const [preferredLocation, setPreferredLocation] = useState("");
  useEffect(() => {
    setAvailability(myResponse?.availability ?? []);
    setPreferredDuration(myResponse?.preferred_duration ?? null);
    setPreferredLocation(myResponse?.preferred_location ?? "");
  }, [myResponse]);

  const durationVoteCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const option of durationOptions) counts.set(option, 0);
    for (const response of responses) {
      if (response.preferred_duration == null) continue;
      counts.set(response.preferred_duration, (counts.get(response.preferred_duration) ?? 0) + 1);
    }
    return counts;
  }, [durationOptions, responses]);

  const winningDuration = useMemo(() => {
    let winner = durationOptions[0] ?? event.duration_minutes;
    let winnerVotes = -1;
    for (const option of durationOptions) {
      const votes = durationVoteCounts.get(option) ?? 0;
      if (votes > winnerVotes) {
        winner = option;
        winnerVotes = votes;
      }
    }
    return winner;
  }, [durationOptions, durationVoteCounts, event.duration_minutes]);

  const effectiveDuration = winningDuration === ALL_DAY_DURATION ? 0 : winningDuration;

  const best = useMemo(
    () => (isFixed ? null : computeBestSlot(responses, effectiveDuration)),
    [isFixed, effectiveDuration, responses],
  );

  async function saveAvailability() {
    if (!myName.trim()) {
      toast.error("Enter your name first.");
      return;
    }
    if (!isFixed && availability.length === 0) {
      toast.error("Add at least one date and time window you're available.");
      return;
    }
    try {
      localStorage.setItem(`meetly:name:${upper}`, myName.trim());
    } catch {
      void 0;
    }
    const fixedSlot: Slot[] = [
      { date: event.date_options[0], start: event.day_start_minute, end: event.day_end_minute },
    ];
    const payload = {
      event_id: event.id,
      name: myName.trim().slice(0, 50),
      availability: (isFixed ? fixedSlot : availability) as unknown as never,
      preferred_duration: isFixed ? event.duration_minutes : preferredDuration,
      preferred_location: preferredLocation || null,
    };
    let error;
    if (myResponse) {
      ({ error } = await supabase
        .from("responses")
        .update({
          availability: payload.availability,
          preferred_duration: payload.preferred_duration,
          preferred_location: payload.preferred_location,
        })
        .eq("id", myResponse.id));
    } else {
      ({ error } = await supabase.from("responses").insert(payload));
    }
    if (error) {
      toast.error("Could not save. Try again.");
      return;
    }
    toast.success(isFixed ? "You're on the list!" : "Availability saved!");
    qc.invalidateQueries({ queryKey: ["event", upper] });
  }

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/event/${upper}` : "";
  const locationVoteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const location of locationSuggestions) counts.set(location, 0);
    for (const response of responses) {
      if (!response.preferred_location) continue;
      counts.set(response.preferred_location, (counts.get(response.preferred_location) ?? 0) + 1);
    }
    return counts;
  }, [locationSuggestions, responses]);
  const topLocation = useMemo(() => {
    let winner = locationSuggestions[0] ?? "";
    let votes = -1;
    for (const location of locationSuggestions) {
      const count = locationVoteCounts.get(location) ?? 0;
      if (count > votes) {
        votes = count;
        winner = location;
      }
    }
    return winner;
  }, [locationSuggestions, locationVoteCounts]);
  const [topLocationCoords, setTopLocationCoords] = useState<{ lat: number; lon: number } | null>(
    null,
  );
  useEffect(() => {
    if (!topLocation) {
      setTopLocationCoords(null);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(topLocation)}`,
          { signal: controller.signal, headers: { Accept: "application/json" } },
        );
        if (!res.ok) throw new Error("Location lookup failed");
        const payload = (await res.json()) as Array<{ lat?: string; lon?: string }>;
        const first = payload[0];
        const lat = Number(first?.lat);
        const lon = Number(first?.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setTopLocationCoords({ lat, lon });
          return;
        }
        setTopLocationCoords(null);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setTopLocationCoords(null);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [topLocation]);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <CalendarClock className="h-5 w-5" />
          </div>
          <span className="font-display text-xl font-bold">Meetly</span>
        </Link>
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Home
          </Link>
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        <div className="rounded-3xl border bg-card p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Started by {event.creator_name}
                <Badge variant={isFixed ? "default" : "secondary"} className="normal-case">
                  {isFixed ? "Fixed date" : "Flexible dates"}
                </Badge>
                {event.category ? (
                  <Badge variant="outline" className="normal-case">
                    {event.category}
                  </Badge>
                ) : null}
              </div>
              <h1 className="mt-1 font-display text-4xl font-bold">{event.title}</h1>
              {event.description ? (
                <p className="mt-2 max-w-xl whitespace-pre-wrap text-sm text-muted-foreground">
                  {event.description}
                </p>
              ) : null}
              {isFixed ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {formatDate(event.date_options[0])} · {minutesToLabel(event.day_start_minute)}–
                  {minutesToLabel(event.day_end_minute)}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Suggested duration: {durationToLabel(winningDuration)}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="rounded-xl border bg-background px-4 py-2 font-mono text-2xl font-bold tracking-widest">
                {event.code}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  toast.success("Share link copied!");
                }}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy link
              </Button>
            </div>
          </div>

          {!isFixed && best && responses.length > 0 && (
            <div className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-5">
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-widest">
                  Best time so far
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
                <div className="font-display text-3xl font-bold">{formatDate(best.date)}</div>
                <div className="text-lg text-muted-foreground">
                  {minutesToLabel(best.start)} – {minutesToLabel(best.end)}
                </div>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Works for {best.attendees} of {responses.length}{" "}
                {responses.length === 1 ? "person" : "people"}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-[1.5fr_1fr]">
          <section className="rounded-3xl border bg-card p-6 shadow-sm">
            <h2 className="font-display text-2xl font-bold">
              {isFixed ? "RSVP" : isCreator ? "Your availability" : "Add your availability"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFixed
                ? "Let the host know you're coming."
                : `Add dates and time windows you're free - as many as you want. We'll find what overlaps.`}
            </p>

            <div className="mt-4 space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                placeholder="Your name"
                maxLength={50}
                disabled={isCreator}
              />
            </div>

            <div className="mt-6 space-y-6">
              {!isFixed && durationOptions.length > 0 && (
                <div className="space-y-2">
                  <Label>Pick your preferred duration</Label>
                  <div className="flex flex-wrap gap-2">
                    {durationOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setPreferredDuration(option)}
                        className={`rounded-full border px-3 py-1.5 text-xs transition ${
                          preferredDuration === option
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        }`}
                      >
                        {durationToLabel(option)} · {durationVoteCounts.get(option) ?? 0} votes
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {locationSuggestions.length > 0 && (
                <div className="space-y-2">
                  <Label>Pick your preferred location</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {locationSuggestions.map((location) => (
                      <button
                        key={location}
                        type="button"
                        onClick={() => setPreferredLocation(location)}
                        className={`rounded-xl border p-3 text-left text-sm transition ${
                          preferredLocation === location
                            ? "border-primary bg-primary/10"
                            : "hover:border-primary/40 hover:bg-muted"
                        }`}
                      >
                        <div className="flex items-center gap-1 font-medium">
                          <MapPin className="h-3.5 w-3.5" />
                          {location}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {locationVoteCounts.get(location) ?? 0} votes
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!isFixed && (
                <AvailabilityBuilder windows={availability} onChange={setAvailability} />
              )}
            </div>

            <Button size="lg" className="mt-6 w-full" onClick={saveAvailability}>
              <Check className="mr-2 h-4 w-4" />
              {isFixed
                ? myResponse
                  ? "You're on the list"
                  : "I'll be there"
                : myResponse
                  ? "Update my availability"
                  : "Submit availability"}
            </Button>
          </section>

          <aside className="rounded-3xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-display text-2xl font-bold">Responses ({responses.length})</h2>
            </div>
            {responses.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No one has replied yet. Share the code above with your friends!
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {locationSuggestions.length > 0 && (
                  <div className="rounded-xl border bg-background p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Location votes
                    </div>
                    <div className="space-y-1.5">
                      {locationSuggestions.map((location) => (
                        <div key={location} className="flex items-center justify-between text-sm">
                          <span className="truncate">{location}</span>
                          <span className="text-xs text-muted-foreground">
                            {locationVoteCounts.get(location) ?? 0}
                          </span>
                        </div>
                      ))}
                    </div>
                    {topLocation && topLocationCoords ? (
                      <iframe
                        title={`Map preview for ${topLocation}`}
                        src={openStreetMapEmbedUrl(topLocationCoords.lat, topLocationCoords.lon)}
                        className="mt-3 h-40 w-full rounded-lg border"
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                )}

                <ul className="space-y-3">
                  {responses.map((r) => (
                    <li key={r.id} className="rounded-xl border bg-background px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{r.name}</span>
                        {isFixed ? (
                          <Badge variant="secondary">Attending</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {r.availability.length} window{r.availability.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                      {!isFixed && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {groupWindowsByDate(r.availability).map(({ date, windows }) => (
                            <span
                              key={date}
                              className="rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {formatDate(date)}:{" "}
                              {windows
                                .map((w) => `${minutesToLabel(w.start)}–${minutesToLabel(w.end)}`)
                                .join(", ")}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        {!isFixed && r.preferred_duration != null && (
                          <span>Duration: {durationToLabel(r.preferred_duration)}</span>
                        )}
                        {r.preferred_location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {r.preferred_location}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-6 rounded-xl bg-muted/60 p-4 text-xs text-muted-foreground">
              Share this code: <span className="font-mono font-bold">{event.code}</span>
              <br />
              Or send them the link with the copy button above.
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
