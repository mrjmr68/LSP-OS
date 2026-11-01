# LSP OS — Build 1 Plan (Board-centric)

Authority: SPEC.md + DATA_MODEL.md + STATE_MACHINES.md + SCREENS.md + ACCEPTANCE.md in this folder / agent uploads. Spec Pack Page is the living summary.

Stack: Next.js (App Router) + TypeScript + Supabase (Postgres, Auth, Storage, RLS) + Vercel + Resend. One mobile-first PWA shell. Money in integer cents. Display America/New_York. Clean start — do not revive github.com/mrjmr68/lsp-app jobs model; salvage patterns only (auth, hierarchy, catalog/importers, PDF→Storage→Resend).

## M0 — Foundation
New repo scaffold; Supabase linked (dev); Vercel preview; auth + owner/tech roles; PWA installable.
**Done:** Matt logs in on phone from preview URL and sees authenticated Board shell (empty).

## M1 — Schema + RLS
Migrations for DATA_MODEL entities; enums matching STATE_MACHINES; RLS with role tests; AppConfig seed (labor $90, burn $2400, business days Mon–Fri minus US federal holidays).
**Done:** SQL verification walks request → visit → selection → invoice draft; tech cannot approve invoices.

## M2 — Data in
Port/adapt pricebook + hierarchy seeds + legacy history as `legacy_import` (excluded from Pulse). Idempotent importers. No provisional wall-mount row — create via repair builder later.
**Done:** catalog + history counts reconcile; re-run is no-op except relinks.

## M3 — Board + Quick Add
Board with 10 categories, All/My Jobs, High (owner), repeat highlight; Quick Add 4 fields; auto status rules A1–A5 from STATE_MACHINES.
**Done:** call captured <30s; appears on Board; My Jobs tap → In Progress + ETA text + Maps (AC).

## M4 — Active visit
Arrival → Diagnostic; guided gates; typed model/serial for parts; photos optional; parts order (tech or owner later → Parts); attempt path; offline drafts + queue + sync state.
**Done:** easy / parts / attempt exercised on phone; airplane mode loses nothing.

## M5 — Invoicing + Pulse + tax report
Draft on visit close → Complete; any owner approve/send → Invoiced; flag back stays Complete; adjust lines; mark paid manual → Closed; Financial Pulse (business-day burn); monthly CPA sales-tax report export.
**Done:** emailed PDF matches snapshot; Pulse hand-checks; tax CSV/PDF by rate/property.

## M6 — Portal + polish
Shared property portal login; submitter name + phone; password reset by owner; estimate queue basics if time; References on-demand from job overflow.
**Done:** portal creates New request; acceptance suite green for M0–M5.

## Out of Build 1
Change-out checklist tooling; AI diagnostic assist; truck inventory module; QBO weekly push automation (document stub OK); unit-number normalization; past-due automation.

## Working with Matt
Explain in operational terms. Small verifiable steps. Ask when SPEC is silent. Prefer Board truth over July “Today-only” plan.
