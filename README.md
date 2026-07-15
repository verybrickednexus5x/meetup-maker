# Meetly

A collaborative scheduling app for figuring out when a group can actually meet up - built with [TanStack Start](https://tanstack.com/start) and [Supabase](https://supabase.com).

Someone starts a plan, shares a short code, and everyone adds the dates and times that work for them by dragging a slider - no back-and-forth messages, no fixed time picked before anyone's even weighed in.

## Features

- **Flexible dates** - everyone (including the person who started the plan) picks any number of dates and drags a slider to mark the times they're free. The app finds the window with the most overlap.
- **Fixed dates** - for things that can't move, like a birthday: set one specific date and time, and guests RSVP instead of voting on availability.
- **Flexible duration** - pick from common presets (30 min–4+ hours, all day) or enter a custom length; the group votes on what works.
- **Location suggestions** - propose one or more places and let the group vote, with an inline map preview.
- **No accounts required** - a plan is identified by a short shareable code; anyone with the code can view and respond.

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React, file-based routing, SSR) on [Nitro](https://nitro.build) targeting Cloudflare Workers
- [Supabase](https://supabase.com) (Postgres + PostgREST) for storage
- Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com) components
- TypeScript throughout

## Getting started

This project uses [bun](https://bun.sh) as its package manager (see `bunfig.toml` / `bun.lock`).

```bash
bun install
cp .env.example .env   # then fill in your Supabase project's values
bun run dev
```

Other scripts:

```bash
bun run build     # production build
bun run lint       # eslint
bun run format     # prettier --write
```

### Environment variables

Copy `.env.example` to `.env` and fill in your own Supabase project's values. `VITE_`-prefixed variables are bundled into the client and are expected to be public (Supabase's anon key is designed to be exposed - access is controlled by Row Level Security policies on the tables, not by keeping the key secret). `SUPABASE_SERVICE_ROLE_KEY` is server-only, bypasses Row Level Security entirely, and must never be committed or prefixed with `VITE_`.

### Database

Schema and RLS policies live in `supabase/migrations/`. If you're managing this project through [Lovable](https://lovable.dev), migrations added outside of Lovable's own chat flow (e.g. merged in from a PR) aren't applied to the live database automatically - either ask Lovable to run the pending migration, or run the SQL directly from the Supabase SQL editor (linked from Lovable's Cloud tab).

## Project structure

```
src/
  routes/          File-based routes (/, /create, /event/$code)
  components/      Shared UI, including shadcn/ui primitives in components/ui/
  lib/hangout.ts   Core scheduling logic (slot types, overlap calculation, formatting)
  integrations/    Supabase client + generated types
supabase/
  migrations/      SQL migrations, applied in order
```
