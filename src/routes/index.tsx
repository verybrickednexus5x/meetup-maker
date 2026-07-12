import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarClock, Users, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <CalendarClock className="h-5 w-5" />
          </div>
          <span className="font-display text-xl font-bold">Meetly</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-20">
        <section className="pt-10 text-center md:pt-20">
          <div className="inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Find a time everyone actually agrees on
          </div>
          <h1 className="mt-6 text-5xl font-bold leading-tight md:text-6xl">
            Plan the hangout.
            <br />
            <span className="text-primary">Skip the group-chat chaos.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Create an event, share the code, and let your friends drop in their availability.
            We'll pick the time that works.
          </p>
        </section>

        <section className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-5 w-5" />
              <h2 className="font-display text-2xl font-bold">Create an event</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              You'll get a short shareable code. Pick the possible days and a duration.
            </p>
            <Button asChild size="lg" className="mt-6 w-full">
              <Link to="/create">Start planning</Link>
            </Button>
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 text-primary">
              <Users className="h-5 w-5" />
              <h2 className="font-display text-2xl font-bold">Join with a code</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Got a code from a friend? Drop it below to add your availability.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const c = code.trim().toUpperCase();
                if (c) navigate({ to: "/event/$code", params: { code: c } });
              }}
              className="mt-6 flex gap-2"
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={8}
                className="text-center text-lg font-mono tracking-widest uppercase"
              />
              <Button type="submit" size="lg" variant="secondary">
                Join
              </Button>
            </form>
          </div>
        </section>

        <section className="mt-16 grid gap-6 md:grid-cols-3">
          {[
            { n: "1", t: "Create", d: "Name it, pick candidate dates, choose a duration." },
            { n: "2", t: "Share", d: "Send the 6-character code to your friends." },
            { n: "3", t: "Meet", d: "As people submit, Meetly locks in the best time." },
          ].map((s) => (
            <div key={s.n} className="rounded-2xl border bg-card/70 p-5 backdrop-blur">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 font-display text-lg font-bold text-primary">
                {s.n}
              </div>
              <h3 className="mt-3 font-display text-xl font-bold">{s.t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
