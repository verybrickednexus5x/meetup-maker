import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import {
  ArrowLeft,
  BedDouble,
  CalendarClock,
  Check,
  Clock3,
  Copy,
  MapPin,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
  creator_name: string;
  creator_token: string;
  duration_minutes: number;
  date_options: string[];
  day_start_minute: number;
  day_end_minute: number;
  duration_options?: number[] | null;
  allow_sleepover?: boolean | null;
  location_suggestions?: string[] | null;
};
type ResponseRow = {
  id: string;
  event_id: string;
  name: string;
  availability: Slot[];
  preferred_duration?: number | null;
  preferred_location?: string | null;
  can_sleepover?: boolean | null;
  leave_by_minute?: number | null;
};

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
      { title: `Event ${params.code} — Meetly` },
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

function EventPage() {
  const { code } = Route.useParams();
  const upper = code.toUpperCase();
  const { data } = useSuspenseQuery(eventQuery(upper));
  const qc = useQueryClient();
  const { event, responses } = data;

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
  const allowsSleepover = Boolean(event.allow_sleepover);

  const [availability, setAvailability] = useState<Slot[]>([]);
  const [preferredDuration, setPreferredDuration] = useState<number | null>(null);
  const [preferredLocation, setPreferredLocation] = useState("");
  const [canSleepover, setCanSleepover] = useState(false);
  const [leaveByMinute, setLeaveByMinute] = useState(9 * 60);
  useEffect(() => {
    setAvailability(myResponse?.availability ?? []);
    setPreferredDuration(myResponse?.preferred_duration ?? null);
    setPreferredLocation(myResponse?.preferred_location ?? "");
    setCanSleepover(Boolean(myResponse?.can_sleepover));
    setLeaveByMinute(myResponse?.leave_by_minute ?? 9 * 60);
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

  const effectiveDuration =
    winningDuration === ALL_DAY_DURATION
      ? event.day_end_minute - event.day_start_minute
      : winningDuration;

  const best = useMemo(
    () =>
      computeBestSlot(
        event.date_options,
        effectiveDuration,
        responses,
        event.day_start_minute,
        event.day_end_minute,
      ),
    [effectiveDuration, event, responses],
  );

  async function saveAvailability() {
    if (!myName.trim()) {
      toast.error("Enter your name first.");
      return;
    }
    try {
      localStorage.setItem(`meetly:name:${upper}`, myName.trim());
    } catch {
      void 0;
    }
    const payload = {
      event_id: event.id,
      name: myName.trim().slice(0, 50),
      availability: availability as unknown as never,
      preferred_duration: preferredDuration,
      preferred_location: preferredLocation || null,
      can_sleepover: allowsSleepover ? canSleepover : false,
      leave_by_minute: allowsSleepover && canSleepover ? leaveByMinute : null,
    };
    let error;
    if (myResponse) {
      ({ error } = await supabase
        .from("responses")
        .update({
          availability: availability as unknown as never,
          preferred_duration: preferredDuration,
          preferred_location: preferredLocation || null,
          can_sleepover: allowsSleepover ? canSleepover : false,
          leave_by_minute: allowsSleepover && canSleepover ? leaveByMinute : null,
        })
        .eq("id", myResponse.id));
    } else {
      ({ error } = await supabase.from("responses").insert(payload));
    }
    if (error) {
      toast.error("Could not save availability.");
      return;
    }
    toast.success("Availability saved!");
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
  const sleepoverCount = responses.filter((r) => r.can_sleepover).length;

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
              <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Hosted by {event.creator_name}
              </div>
              <h1 className="mt-1 font-display text-4xl font-bold">{event.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Suggested duration: {durationToLabel(winningDuration)} · window{" "}
                {minutesToLabel(event.day_start_minute)}–{minutesToLabel(event.day_end_minute)}
              </p>
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

          {best && responses.length > 0 && (
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
                Duration used: {durationToLabel(winningDuration)}
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
              {isCreator ? "Your availability" : "Add your availability"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tap slots you're free. We'll find a window that fits{" "}
              {durationToLabel(winningDuration)}.
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
              {durationOptions.length > 0 && (
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

              {allowsSleepover && (
                <div className="space-y-3 rounded-xl border bg-background p-4">
                  <div className="flex items-center gap-2">
                    <BedDouble className="h-4 w-4 text-primary" />
                    <Label className="text-sm">Sleepover</Label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCanSleepover((v) => !v)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${
                      canSleepover
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    {canSleepover ? "I can sleep over" : "I can't sleep over"}
                  </button>
                  {canSleepover && (
                    <div className="space-y-2">
                      <Label>Leave by: {minutesToLabel(leaveByMinute)}</Label>
                      <input
                        type="range"
                        min={360}
                        max={900}
                        step={15}
                        value={leaveByMinute}
                        onChange={(e) => setLeaveByMinute(Number(e.target.value))}
                        className="w-full accent-[var(--color-primary)]"
                      />
                    </div>
                  )}
                </div>
              )}

              {event.date_options.map((iso) => (
                <DayGrid
                  key={iso}
                  date={iso}
                  dayStart={event.day_start_minute}
                  dayEnd={event.day_end_minute}
                  duration={event.duration_minutes}
                  slots={availability}
                  onChange={setAvailability}
                />
              ))}
            </div>

            <Button size="lg" className="mt-6 w-full" onClick={saveAvailability}>
              <Check className="mr-2 h-4 w-4" />
              {myResponse ? "Update my availability" : "Submit availability"}
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
                    {topLocation ? (
                      <iframe
                        title={`Map preview for ${topLocation}`}
                        src={`https://www.google.com/maps?q=${encodeURIComponent(topLocation)}&output=embed`}
                        className="mt-3 h-40 w-full rounded-lg border"
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                )}

                {allowsSleepover && (
                  <div className="rounded-xl border bg-background p-3 text-sm">
                    <div className="flex items-center gap-1">
                      <BedDouble className="h-3.5 w-3.5 text-primary" />
                      <span className="font-medium">Sleepover</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {sleepoverCount} of {responses.length} can sleep over
                    </div>
                  </div>
                )}

                <ul className="space-y-2">
                  {responses.map((r) => (
                    <li key={r.id} className="rounded-xl border bg-background px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.availability.length} slots
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                        {r.preferred_duration != null && (
                          <span>Duration: {durationToLabel(r.preferred_duration)}</span>
                        )}
                        {r.preferred_location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {r.preferred_location}
                          </span>
                        )}
                        {allowsSleepover && (
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3 w-3" />
                            {r.can_sleepover
                              ? `Sleepover, leaves ${minutesToLabel(r.leave_by_minute ?? 9 * 60)}`
                              : "No sleepover"}
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

function DayGrid({
  date,
  dayStart,
  dayEnd,
  duration,
  slots,
  onChange,
}: {
  date: string;
  dayStart: number;
  dayEnd: number;
  duration: number;
  slots: Slot[];
  onChange: (s: Slot[]) => void;
}) {
  const step = 30;
  const cells: number[] = [];
  for (let t = dayStart; t + step <= dayEnd; t += step) cells.push(t);

  const selectedSet = useMemo(() => {
    const set = new Set<number>();
    for (const s of slots) {
      if (s.date !== date) continue;
      for (let t = s.start; t < s.end; t += step) set.add(t);
    }
    return set;
  }, [slots, date]);

  const toggle = (t: number) => {
    const currentlySelected = selectedSet.has(t);
    // rebuild all slots for this date
    const others = slots.filter((s) => s.date !== date);
    const cellState = new Map<number, boolean>();
    for (const c of cells) cellState.set(c, selectedSet.has(c));
    cellState.set(t, !currentlySelected);
    // merge contiguous
    const merged: Slot[] = [];
    let start: number | null = null;
    for (const c of cells) {
      if (cellState.get(c)) {
        if (start === null) start = c;
      } else if (start !== null) {
        merged.push({ date, start, end: c });
        start = null;
      }
    }
    if (start !== null) merged.push({ date, start, end: cells[cells.length - 1] + step });
    onChange([...others, ...merged]);
  };

  const daySlots = slots.filter((s) => s.date === date);
  const hasEnoughRoom = daySlots.some((s) => s.end - s.start >= duration);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-display text-lg font-bold">{formatDate(date)}</h3>
        <span
          className={`text-xs ${
            hasEnoughRoom ? "text-[color:var(--color-success)]" : "text-muted-foreground"
          }`}
        >
          {daySlots.length === 0
            ? "not available"
            : hasEnoughRoom
              ? "✓ fits duration"
              : "add more time"}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {cells.map((t) => {
          const on = selectedSet.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggle(t)}
              className={`rounded-md border px-2 py-1.5 text-xs transition ${
                on
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background hover:border-primary/40 hover:bg-muted"
              }`}
            >
              {minutesToLabel(t)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
