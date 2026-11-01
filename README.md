# Legend Service Pros — Operating System

One Board for the whole crew. Owners and techs use the same phone-first app. The management company is the customer. Calls, visits, bundles, and invoices live here. QuickBooks gets a weekly gross later, not a CRM.

This repo is the clean start. It does not continue the old `jobs` app. The spec in `docs/` wins.

This slice is the foundation only: the app shell, sign-in, the database, and an empty Board with the ten categories. Visit flow, email, the portal, imports, and QuickBooks are not in this build.

## Run it locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). It redirects to the Board.

Without Supabase keys, the Board is an empty preview and `/login` lists the setup steps. Sign-in starts working after the keys are in `.env.local` and the dev server is restarted.

```bash
npm run build
npm run lint
npm run prove:rls
```

`prove:rls` needs local PostgreSQL. It creates a throwaway database, applies the migrations, and checks that a tech cannot approve an invoice or raise a call to High. It does not talk to a hosted Supabase project.

## Environment

Copy `.env.example` to `.env.local`.

| Variable | Who needs it | Now |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server | Yes, before real sign-in |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server | Yes, before real sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only, never `NEXT_PUBLIC_` | Keep it for later admin scripts. The app does not read it yet. |
| `RESEND_API_KEY` | Invoice and flag-back email | No. That is the invoicing milestone. |
| `EMAIL_FROM` | Same | No. |

Vercel needs the same public Supabase variables on the preview and production environments. Creating the Vercel project and the Supabase project is a manual step.

## What to create before the next milestone

The next milestone loads the price book, the property hierarchy, and old history. Do that only after this database exists.

1. Create a Supabase project.
2. Run the four SQL files in `supabase/migrations` in order (SQL editor or `supabase db push`). Details are in `docs/MIGRATIONS.md`.
3. Copy the project URL and the anon key into `.env.local` and into Vercel.
4. In Authentication, turn off public sign-up. Add each person. New users become `tech` automatically.
5. In the SQL editor, promote the owner-technicians:

```sql
update public.profiles
set role = 'owner'
where email = 'you@example.com';
```

6. Confirm one `app_config` row: labor `9000` cents ($90/hr), profit floor `10000` cents, burn `240000` cents per business day, timezone `America/New_York`.
7. Create the Vercel project, set the env vars, and open the preview URL on a phone. Sign in and you should land on the Board.

Not needed yet: a Resend account, a Storage bucket, a portal password, or a QuickBooks connection.

## Auth and roles

Two roles. Owner-technicians are `owner`. The two employees are `tech`.

Both can see the Board. Only an owner can raise a call to High, approve an invoice, send an estimate, or edit bundle prices. A tech who tries is rejected by row level security even if the extra write guards are off. `npm run prove:rls` is that check.

Sign-in is email and password. `/auth/callback` completes invite and reset links. `/auth/signout` ends the session. There is no public sign-up screen.

## Board

Ten categories, in order: New, Assigned, Ready, In Progress, To Estimate, Estimate Out, Parts, Complete, Invoiced, Closed.

All jobs / My jobs is on the shell. Lists are empty until calls exist. This slice still shows every category so the shape of the Board is visible. The screen spec hides an empty category once the live Board is built.

High calls sort to the top of a category. Nothing is sent when a call is marked High.

## Docs

- `docs/SPEC.md` — what the system is
- `docs/DATA_MODEL.md` — tables
- `docs/STATE_MACHINES.md` — allowed moves
- `docs/SCREENS.md` — screens
- `docs/ACCEPTANCE.md` — checks for later milestones
- `docs/BUILD1_PLAN.md` — milestone order
- `docs/MIGRATIONS.md` — how this database is shaped

## Stack

Next.js (App Router), TypeScript, Tailwind, shadcn/ui. Supabase for Postgres, Auth, and later Storage. Vercel for hosting. PWA manifest and a small service worker so the shell can be installed. The worker does not cache crew data. Offline visit drafts come later.

Money is integer cents. Stored times are UTC. Display timezone is America/New_York.
