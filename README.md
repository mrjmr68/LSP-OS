# Legend Service Pros — Operating System

One Board for the whole crew. Owners and techs use the same phone-first app. The management company is the customer. Calls, visits, bundles, and invoices live here. QuickBooks gets a weekly gross later, not a CRM.

This repo is the clean start. It does not continue the old `jobs` app. The spec in `docs/` wins.

This build is the Board and Quick Add. The price book, the two management companies, and the old call history load with `npm run import:data`. That history stays in `legacy_imports` and is not on the Board. Visit flow, invoicing screens, the portal, and QuickBooks are later. The database already moves a call when an invoice is drafted or sent, or when a part is ordered or in hand.

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
npm test
npm run prove:rls
npm run prove:import
```

`prove:rls` needs local PostgreSQL. It creates a throwaway database, applies the migrations, and checks that a tech cannot approve an invoice or raise a call to High. It does not talk to a hosted Supabase project.

`prove:import` loads the price book and the old history into a different throwaway database, checks the counts, and runs the import again. The second run writes nothing. It also refuses a hosted Supabase URL.

## Environment

Copy `.env.example` to `.env.local`.

| Variable | Who needs it | Now |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server | Yes, before real sign-in |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server | Yes, before real sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only, never `NEXT_PUBLIC_` | Keep it for later admin scripts. The app does not read it yet. |
| `SUPABASE_DB_URL` | The import script only | Yes, before loading the price book. Direct connection, port 5432. |
| `RESEND_API_KEY` | Invoice and flag-back email | No. That is the invoicing milestone. |
| `EMAIL_FROM` | Same | No. |

Vercel needs the same public Supabase variables on the preview and production environments. Creating the Vercel project and the Supabase project is a manual step.

## Load the price book and the old history

Do this once the database exists. The full click-path is `docs/IMPORT.md`. If the hosted project already has the price book, skip the import and apply `supabase/migrations/20261102140000_board_actions.sql` only.

```bash
npm run import:dry-run
npm run import:data -- --commit
```

`--commit` is required when the database URL is not local. The script reads `SUPABASE_DB_URL` from the environment or from `.env.local`. Use the direct connection on port 5432.

A second run does not add duplicate calls, and it does not change a price or a door code you already edited. It only fills links that were missing, such as history for a property you added later.

Old calls live in `legacy_imports` and do not count toward Financial Pulse. They do not become Board cards. New calls come from Quick Add.

## Standing up a new database

The hosted project already has the foundation and the loaded history. Use this list only when the database is empty.

1. Create a Supabase project.
2. Run the SQL files in `supabase/migrations` in order (SQL editor or `supabase db push`). Details are in `docs/MIGRATIONS.md`. An existing project that already ran the earlier files only needs `20261102140000_board_actions.sql`.
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
8. Load the price book and the old history. See `docs/IMPORT.md`.

Not needed yet: a Resend account, a Storage bucket, a portal password, or a QuickBooks connection.

Old history stays off the Board. New calls come from Quick Add. The next build is the active visit.

## Auth and roles

Two roles. Owner-technicians are `owner`. The two employees are `tech`.

Both can see the Board. Only an owner can raise a call to High, approve an invoice, send an estimate, or edit bundle prices. A tech who tries is rejected by row level security even if the extra write guards are off. `npm run prove:rls` is that check.

Sign-in is email and password. `/auth/callback` completes invite and reset links. `/auth/signout` ends the session. There is no public sign-up screen.

## Board

Ten categories, in order: New, Assigned, Ready, In Progress, To Estimate, Estimate Out, Parts, Complete, Invoiced, Closed. Each shows a count. On a phone, an empty category stays collapsed.

All jobs / My jobs is on the shell. **+ Quick Add** asks for contact, property, unit, and issue. The source defaults to phone. A unit with another call in the last 14 days shows a warning and the call is still saved. Offline saves stay on the phone and sync when the signal returns.

An owner assigns a tech, sets High (nothing is texted), switches status, or deletes a duplicate. A skipped status needs a reason. A tech does not get those controls.

My jobs, then the assigned call: **Go en route** moves it to In Progress, starts travel, queues an ETA text when the contact has a phone and texts are on, and opens Google Maps. No phone still moves the call and opens Maps.

A unit with another call in the last 14 days shows **Repeat**. Open it for the dates and bundle codes. That history is real service requests, not the legacy import.

`npm test` checks the Board rules. `npm run prove:rls` checks them in Postgres, including auto rules A1–A5. Apply `supabase/migrations/20261102140000_board_actions.sql` on the hosted database before trying this on the live app. Do not re-run the M2 imports.

## Docs

- `docs/SPEC.md` — what the system is
- `docs/DATA_MODEL.md` — tables
- `docs/STATE_MACHINES.md` — allowed moves
- `docs/SCREENS.md` — screens
- `docs/ACCEPTANCE.md` — checks for later milestones
- `docs/BUILD1_PLAN.md` — milestone order
- `docs/MIGRATIONS.md` — how this database is shaped
- `docs/IMPORT.md` — how to load the price book and the old history

## Stack

Next.js (App Router), TypeScript, Tailwind, shadcn/ui. Supabase for Postgres, Auth, and later Storage. Vercel for hosting. PWA manifest and a small service worker so the shell can be installed. The worker does not cache crew data. Offline visit drafts come later.

Money is integer cents. Stored times are UTC. Display timezone is America/New_York.
