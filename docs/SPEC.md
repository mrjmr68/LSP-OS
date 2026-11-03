# LSP Operating System — Specification

The buildable spec for Legend Service Pros' operating system. This is the current design in full: what the system is, what every screen does, and the exact rules it enforces. Anything genuinely unresolved is listed under Open decisions — never guessed.

_Revision: Nov 1, 2026 — Muse open decisions 1–8 resolved plus follow-up rulings (auto stage moves, manual paid, Mon–Fri QBO week) with Matt and folded in (see §17). Companion files: DATA_MODEL.md, SCREENS.md, STATE_MACHINES.md, ACCEPTANCE.md._

**Stack intent (from July handoff, unchanged):** Next.js + Supabase (Postgres, Auth, Storage) + Vercel + Resend; one mobile-first PWA shell for both roles; money stored as integer cents; all times stored UTC, displayed America/New_York.

## 1. Overview

One operating system for Legend Service Pros (LSP) that runs the whole business: how calls come in, how work is assigned, what the tech does on site, and how the company bills.

**Who uses it.** A 5-person HVAC company — 3 owner-technicians, 2 employees — serving garden-style apartment communities exclusively. Roughly 800 calls a year. Standardized equipment: 1.5–2 ton heat pumps, electric heat strips, wall-mounted air handlers. Flat-rate billing to property management companies on terms.

**The customer is the property management company — never the resident.** Residents may report problems, but they are not customers.

**System of record.** The app creates every invoice and every estimate, routes every invoice, and holds the full job history. QuickBooks is downstream only: it receives gross sales numbers, once a week, and nothing else. No CRM in QuickBooks. No AP in QuickBooks.

**Design principle (field UI).** The UI knows what the tech is doing next and is ready for them — guided, anticipatory flow, operable one-handed with gloves, in sun, possibly with no signal.

## 2. Roles & permissions

Two roles: **owner** and **tech**. (The 3 owner-technicians hold the owner role; the 2 employees hold the tech role.)

Owners can:
- Elevate a call's priority to High.
- Manage the Board live: assign/reassign visits, change any call's status.
- Review every invoice (approve, flag back, or adjust lines directly).
- Finalize and send estimates.
- Create, edit, and retire bundles in the bundle library.
- See time-tracking data and all financials.

Techs can:
- See the Board (all calls, all statuses).
- Filter to My Jobs, tap a job to go en route, work the visit flow.
- Select bundles, record parts orders, capture diagnostics, close visits.
- Create one-off invoices and draft estimates (both go to owner queues).

Only owners approve invoices (any owner, including one who worked the call); techs cannot approve. Techs cannot change bundle prices. Techs cannot delete requests (deleting a duplicate extra request is an owner action).

## 3. The Board

The central screen. Every user lands here. It lists **all open calls**, categorized by status, visible to everyone.

**Categories (in order):** New, Assigned, Ready, In Progress, To Estimate, Estimate Out, Parts, Complete, Invoiced, Closed.

- **New** — request created, not yet triaged.
- **Assigned** — a tech has it (typically as a first location).
- **Ready** — nothing blocking it; awaiting assignment. A job lands here when a part arrives in-hand, or when an estimate is accepted.
- **In Progress** — tech en route or on site.
- **To Estimate** — an estimate is being built.
- **Estimate Out** — estimate sent, awaiting the property's answer.
- **Parts** — parts ordered, request open, return visit pending.
- **Complete** — visit finished, awaiting owner invoice review.
- **Invoiced** — invoice sent, awaiting payment.
- **Closed** — paid.

**Filter toggle:** All Jobs / My Jobs. Owners also switch the Board to Who's where: one row per active crew member, live call or Free, people with a call first then A–Z. The Board opens on the live stages (New through Parts). Complete, Invoiced, and Closed are behind All stages. The phone remembers that choice.

**2-week repeat-unit highlight.** Any unit with a previous call in the last 2 weeks is visually highlighted on its card. Tapping the highlight shows the recent call history (bundle codes, dates).

**High flag.** Two priorities only: normal and high. High is **solely owner-determined** — no operational rule, pure owner judgment. It is a visual flag only: unmissable treatment on the card, floats to the top of its category. No automatic notifications on elevation. No special property communication. The normal flow (en-route ETA text, etc.) handles all communications.

**Manual status changes.** Owners change a call's status with an easy status switch directly on the Board card — no separate admin screen. Jobs **auto-move stage to stage** as the work happens (ruled Nov 1 2026): tapping a job from My Jobs → In Progress; invoice drafted → Complete; invoice finalized and sent → Invoiced; part order information entered → Parts; part in-hand → Ready. Owners keep the status switch for everything else and as override. Mark paid (→ Closed) is manual only.

**No forward schedule.** There is no week view, no scheduling optimizer. Owners direct all 5 techs to their first location, then manage live through the day — who needs a part, who needs help, who's in the town of the new call, who's leaving early. The Board is the truth; it must always reflect reality.

**Sidebar (future, not in scope):** an automated system that pings properties in a town a tech is headed to, prompting for more business to cut down on multiple trips.

## 4. Intake

**Primary channel: the property web portal.** It knows the user and prefills their property info. Corporate management preferences drive portal behavior. Phone, text, and email still exist as intake channels, but the portal is the intended front door — partly because it absorbs what missed calls miss.

**Quick Add (sub-30 seconds).** Required fields — exactly four, nothing more:
- **Contact**
- **Property**
- **Unit**
- **Issue** (one line of free text)

Quick Add does not ask for source or whether a resident reported the call. It stores source `phone` and `reported_by_resident` false.

**Two-way contact/property picker.** Pick a contact → choose from their related properties. Or pick a property → choose from its contacts. (Some managers run multiple properties.) Unit field offers recently-serviced units at that property first.

**Duplicate handling.** Intake runs a duplicate check in the background and may surface a warning ("unit 12B had a no-heat call 3 days ago — completed"), but it never blocks. **Duplicates are allowed.** The request is created; the tech verifies in the field; the extra request is deleted (owner action) as needed.

**What the system does not do:** no voicemail in the system. Owners all have voicemail on their personal phones — returning calls is a human responsibility; the software doesn't try to save them here.

**After-hours.** No after-hours service is offered. After-hours emergencies reach the owners' personal cell numbers (clients have them) and are responded to immediately and personally — outside the system. Known gap: night/after-hours handling is not automated, and the design doesn't attempt it yet.

**Source tagging.** Every request is tagged with its source: portal, phone, text, email, dispatcher, tech-direct, or onsite.

## 5. Customer record (the relationship contract)

Each customer (management company) and property (location) carries relationship terms, defined once and enforced every time. No judgment calls at the unit door.

Per property / management company, the record holds:
- **Billing contact + payment terms** (terms drive invoice due dates automatically).
- **Site access / arrival process info** — e.g. keys or combinations for key boxes vs. contact maintenance to be accompanied to the unit. Varies by management company. Shown to the tech on the job view.
- **Add-on approval terms** — how to handle extra work found on site (e.g. "just do it under $X" vs. "call for approval first"). Shown to the tech when they create an add-on call from the Board.
- **Sign-off requirements** — what closeout requires at this property (e.g. walk-through + signature vs. photos only). Enforced at visit close.
- **Resident-report handling** — what to do when a resident (not the property) reports a problem: confirm with the property first, just go, or tenant must go through maintenance. The report is handled how the property has directed.

## 6. Dispatch & field flow

**Morning: first locations.** Owners assign each tech their first location on the Board. The tech filters to **My Jobs**.

**Going en route.** The tech taps the first job in My Jobs. The system then, automatically:
1. Marks the tech en route and moves the call to **In Progress**.
2. **Texts the job contact with an ETA** (computed from Google Maps travel time from the tech's current location).
3. **Opens Google Maps directions** to the job address.

**Job view.** Shows:
- Property, unit, issue, contact.
- **Bundle codes for repairs in the last 6 months** at this unit.
- **Site access / arrival process info** (from the customer record).
- **Call-site-contact button** (one tap to call).
- 2-week repeat-unit highlight state, High flag state.
- Reference docs (see below).

**Reference docs (resolved).** A tiny curated set only — current Goodman and Ruud wiring diagrams, Goodman and Ruud charging references, and programming/operating info for a few thermostats. Not a document library. Reached **on demand from the job/visit view** via a single low-prominence "References" entry (overflow menu) — never on the main screen or Board, so it does not clutter the UI. Cached for offline.

**Arrival.** GPS ends Travel Time and starts Access Time automatically (see §7). The Arrival Screen is showing. The tech works; when tools are on the equipment, the tech taps the button to move to the Diagnostic Screen — this tap is **Job Start Time**: it ends Access Time and starts Work Time.

**Active visit screen discipline.** The visit screen stays uncluttered. There is deliberately **no "+ Add Unit" button** on the active visit — the tech notes the unit and creates the new call from the Board after closing the active job (the per-property add-on approval terms are shown at creation).

## 7. Time tracking

Background, always on during a visit, **never a separate step for the tech**. Tied to the normal flow:

- **Travel Time** — from en-route tap to GPS-detected arrival.
- **Access Time** — from GPS arrival to the Arrival → Diagnostic Screen tap (how long between arriving on site and putting tools on the broken equipment).
- **Work Time** — from the Job Start tap to visit close.

GPS is used as much as possible; the Job Start transition is a tech tap because it must be deliberate.

**Purpose.** All clock data is background-only, for future management decisions — never a timer the tech watches. It answers "are we fooling ourselves anywhere": calibrating bundle labor hours against reality, validating pricing, process management, employee management as the company grows, and customer data (access delays per property become pricing leverage — "we spend X minutes getting access because your staff is never there").

## 8. Diagnostic Screen

Reached by the Job Start tap. Captures, as applicable:
- **Model and serial** off the equipment (photo of the nameplate where useful).
- **Photos** documenting work and conditions.
- **Temps, pressures, and other conditions** (superheat, subcooling, delta-T, etc.).

**Two paths:**
- **Easy repairs:** the tech skips diagnostics and selects the bundle directly (search by bundle code or keyword).
- **Hard diagnoses:** on-demand **AI assist** — a premade prompt; the app makes an API call sending all captured diagnostic data in and returns a recommendation. For not-easy repairs the app **walks the tech through gathering all necessary info** to move a repair or estimate forward.

**Conditional capture.** Model/serial is not required for everything — but it **is** required when ordering parts and when equipment size matters (e.g. change-out match-up). The guided flow enforces the requirements of the path the tech is on.

**"Complete" is path-dependent.** The guided flow blocks closing the visit until that path's requirements are met:
**Guided-capture rules (first pass, resolved Nov 1 2026 — editable):**
- **All paths:** bundle selected (or marked one-off / attempt) + tech note (one line minimum). Photos are **optional and rare** — there is usually little to photograph.
- **Easy repair:** bundle + note.
- **Parts:** bundle + **typed model and serial (required fields)** + nameplate photo as backup (typed values are primary so nobody opens photos while on the phone with the supply house). Parts-order fields (supplier, order #, expected delivery) may be filled by the **tech, or later by an owner** on the same call. Call → **Parts** until part in-hand → **Ready**.
- **Estimate:** bundle or specialty narrative; equipment size / match-up when relevant; photos only if they help the property decide.
- **Attempt / no-access:** attempt recorded on the open request + reason; photo optional.
- **Change-out:** checklist mechanics still deferred (§13).

## 9. Bundles & price book

**Bundle anatomy.** A bundle is a package of diagnosis + treatment sold together on one visit:
- **Formula-based title** = the brief repair description (e.g. `AHU - Capacitor - Replace`), in the same format as historical diagnosis strings so history joins to the catalog.
- **Full narrative invoice description** — the customer-facing Diagnosis / Repair Completed text.
- **Set labor hours (man-hours)** — accounting for repair + travel + diagnostic time, all in one number. Man-hours, not clock hours.
- **All parts, equipment, materials, and consumables**, with costs.
- **A separate profit line** — so the owner sees exactly what is cleared on each job.

**Pricing math (exact).**
> **Target market price** (set slightly under the going market rate, from 20 years directing maintenance for ~5,000 apartments — apartment turn / apartment service work)
> **minus** [labor man-hours × **$90/hr** + parts + equipment + materials + consumables]
> **= profit**, shown as its own line
> and **profit ÷ hours ≥ ~$100/hr**.

Rules:
- **$90/hr is the internal cost of labor, never a billing rate.**
- **No markups** on labor, materials, or equipment — a bundle is billed at cost plus the profit line.
- If profit per hour comes out under ~$100, the target price is wrong. The profit line is never shrunk to fit the price.
- Labor hours are set from experience; tracked actual hours (§7) calibrate them over time.

**Worked example — wall-mount change-out (first real bundle):**

| Line | Amount |
|---|---|
| Equipment: AHU | $647 |
| Equipment: Heat Pump | $1,597 |
| Materials — Changeout (miscellaneous) | $250 |
| Refrigerant: R32 (2 × $36) | $72 |
| Labor: 14 man-hours × $90 | $1,260 |
| Profit | $1,500 |
| **Target price** | **$5,326** |

Profit per hour: $1,500 ÷ 14 ≈ **$107/hr** — clears the floor. The Furnace line is a $0 placeholder, activated for the occasional furnace system. Labor hours and profit are tweaked for larger or more complex systems.

**Customer-facing presentation.** The customer sees the **narrative invoice description + total only** — never the cost breakdown. Line items are hidden internally.

**Tax.** Sales tax of **6.75%** applies to the **full invoice total, including labor and profit**.

**Price book.** The bundle catalog is the system of record — no master workbook alongside it. Every bundle carries a price (no blanks). Most bundles are **fixed** flat rates; a few are **variable** (coil, compressor, restriction, in-wall leak, attic/crawl change-out class) where the price pre-fills from a stated reference part cost and is adjusted for the actual part before invoicing. A **one-shot flag** marks bundles that pre-arm the parts-needed / return-visit path. The most frequent bundles get quick-select prominence in the repair picker. Price snapshots are taken at bundle selection — later price changes never rewrite old visits.

**Library governance.**
- The library stays small: **30–40, maybe 50 — never 100.**
- Editing is **in-app only**. No CSV/Excel import as the normal path. Price changes apply to future visits only; old invoices keep their snapshots.
- The create-bundle flow **proactively flags near-duplicates** while typing — showing the closest existing bundles and requiring a one-line difference note before a new one is saved.
- Anything that doesn't fit a bundle goes through a **one-off specialty invoice** — the framework is not required to handle every edge case.
- **Bundle discovery pipeline:** one-off invoices are the farm team. When a repeat odd bird emerges, the owner deliberately promotes it to a bundle through the creation flow. Promotion is always an owner decision.

**Future:** multiple change-out bundles (tonnage/system variants — 1.5-ton, 2-ton, furnace, attic/crawl) so no revenue gets missed.

## 10. Parts flow

1. The tech **selects the Bundle first** — the bundle is the plan; the parts order is what happens when the plan hits reality.
2. When the part isn't on the truck, the tech taps **Order Part**. The system **verifies model + serial are captured before the tech leaves** (departure gate).
3. The system **provides supplier contact info** in-app so the tech can get the part found and ordered.
4. The tech records on the call: **expected delivery date, order number, supplier/contact** — or leaves them blank and an **owner fills them in later** (owners often place the order themselves). Model + serial typed fields are required regardless.
5. The call sits in **Parts** on the Board. The request stays open.
6. **When the part is in-hand** (physically received — not on promise, no "shipped" status), the job moves to **Ready** and jumps to the top of the Board for the return trip.
7. **One invoice per call.** No split billing — the diagnostic visit and the return visit bill together when the work is complete.

## 11. Invoicing engine

The app is the sole invoicing engine. **Every invoice is left in draft at the job and gets owner review — any owner can approve and send; techs cannot.**

**Review queue.** Owner sees one card per completed visit: property, unit, bundle line(s) with price snapshot, tech's note, photos, and the background time data. Three actions:
- **Approve** — the invoice **sends immediately**: PDF generated, emailed to the property's billing contact. No batching. The call moves to **Invoiced**.
- **Flag back** — the job **stays Complete**; the owner's questions go to the **tech by email**. The call does not revert to In Progress.
- **Adjust** — the reviewer can **add/adjust lines directly** on the invoice. Used for flagged attempt visits: a no-access trip shows in the queue flagged ("extra dead truck roll on this one") and the reviewer adjusts the invoice directly — **no trip-charge bundle exists**.

**Invoice blockers — the complete list.** Only three things can block billing:
1. Parts return pending (one invoice per call).
2. Not yet owner-reviewed.
3. Flagged back, awaiting tech answers.

Nothing else blocks billing. (A visit marked not billable — warranty/goodwill — produces no invoice at all; it isn't "blocked.")

**Attempt visits.** A no-access trip is recorded as an **attempt visit** on the open request (one request → many visits). The request stays open; a return visit is scheduled. Whether the attempt is chargeable is an owner call per case, handled via the reviewer's direct adjustment above.

**À la carte invoices.** The app supports invoice creation not tied to a field visit's bundle — one-off specialty work. Tech provides **narrative of work done + materials consumed**; the **owner decides the final invoice amount and whether the repair becomes a Bundle** (the discovery pipeline, §9).

**No past-due capabilities for now.** No automated nudges, no escalation flow.

## 12. Estimates

Estimates follow the **same path as invoices**:
- **Born from the tech's diagnosis** — when the property requires pre-approval (per its relationship terms, §5) or unique situations make the repair more than the bundle.
- Goes to an **estimate queue** for owner finalization and send (mirrors the invoice review queue).
- **Receipt tracked:** sent, viewed, accepted, declined.
- **On accept**, the job moves to **Ready** (same as part in-hand). Status changes are manual — the easy status switch on the Board.
- **No expiry, no nudges.** There are few enough estimates that sitting on the Board is itself the follow-up reminder.

## 13. Change-outs

Change-outs run a 36-task process in six stages:
- **Pre-arrival:** confirm equipment is ordered and staged; confirm unit access (tenant notice); supply check at load-out — kit trips plus the materials tote — so nothing is missing on site.
- **Arrival:** check in at the property office; walk the unit; lock out power at the breaker; prep the work area inside and outside (clear belongings, protect floors, set tools, lights, PPE).
- **Removal:** recover refrigerant (inside/outside crews split: outside handles the condenser, inside handles the air handler, with sync points); disconnect whip, wiring, line set, condensate; remove old equipment; inspect plenum and duct connections.
- **Install:** set and secure the new air handler; adapt and seal plenum; install condensate drain and trap; set the condenser on the pad; braze line set with nitrogen; land high and low voltage; install and configure the thermostat.
- **Startup / commissioning:** pressure test with nitrogen and hold; evacuate to 500 microns and hold; release or weigh in charge; power up and verify operation; record superheat, subcooling, delta-T, and other readings.
- **Closeout:** remove debris and old equipment; restore the unit; photograph the completed install; record model and serial of the new equipment; walk through with maintenance or the property contact for **sign-off** (per the property's sign-off terms, §5); confirm the site is secure and depart.

Multi-tech visits show who is lead and who is assist, and where the crews sync. Commissioning sign-off (startup readings, photos, property walk-through) is part of the visit record, not a separate process.

**DEFERRED — not decided:** the change-out checklist mechanics (who checks off tasks, whether sync points gate stages). The change-out tool is a separate animal, to be refined later.

## 14. Payments & QuickBooks

- **Terms** are tracked per customer on the customer record. Invoice due date = invoice date + terms, automatic.
- When paid, the call moves to **Closed** on the Board.
- **QuickBooks receives gross sales numbers only, once a week** (starting point). Not per-invoice. Not CRM. Not AP.
- **AR lives in the app (resolved).** Payments are marked in the app (Invoiced → Closed). QuickBooks gets **one company-wide weekly gross sales total** — not per-invoice, not per-property, no AR. Revisit only if office staff live in QBO daily, per-invoice bank matching is needed, or the CPA requires it.

## 15. Offline

- **Cached:** the tech's assigned visits (today and tomorrow) are available with no signal.
- **Local drafts:** every field form saves locally as typed; nothing entered is ever lost to a dead zone.
- **Queued writes:** offline actions queue and retry automatically when signal returns.
- **Visible sync state:** every visit shows pending-sync vs. synced. Sync is automatic; the tech never has to trigger it, but can always see whether it went through.
- **No conflict resolution.** If an owner moves a call on the Board while a tech has it open offline, the Board (owner action) wins — and the tech's offline visit is flagged for review rather than silently overwritten.

## 16. Future / explicitly out of scope

Not in the current design. Listed here so nothing is built "just in case":
- Troubleshooting app for less-skilled maintenance techs (one-button request handoff).
- Town-ping business development (automated pings to properties in a town a tech is headed to).
- After-hours automation (known gap — handled personally via owners' cells today).
- Past-due flow (no nudges, no escalation).
- Change-out process management (future iteration).
- AI diagnostic assist (future improvement).
- Unit-number normalization system (unit numbering varies by property; needed eventually for matching, history, and the 2-week highlight).

## 17. Decisions — resolved Nov 1, 2026

All eight Muse open decisions are resolved, plus follow-up rulings 9–11:
1. **Burn rate:** Financial Pulse daily expense constant (~$2,400/day) counts **business days** (Mon–Fri minus **US Federal Holidays** only; list in AppConfig).
2. **Inventory / truck stock:** stays in **Google Sheets for now**. Future: a small in-app module for regular per-truck inventory counts. Parts recorded per job are not tied to truck stock yet.
3. **Field test:** a **handful of staged real calls** first, then decide on scale/crew/duration.
4. **Reference docs:** tiny curated set (Goodman/Ruud wiring + charging, a few thermostats); **on demand from the job view**, no main-UI clutter.
5. **Guided capture:** first-pass rules in §8 (typed model/serial; photos optional; owners can complete parts-order fields).
6. **QuickBooks:** **AR in the app**; QBO receives **one company-wide weekly gross sales total** only, week = **Mon–Fri** (LSP works M–F). Payments **marked paid manually** in the app.
12. **Business-day holidays:** **US Federal Holidays** only.
13. **Sales tax:** tax is calculated and snapshotted per invoice in the app; the app produces a **monthly sales tax report for the CPA** (taxable sales, tax collected, by rate/property, exempt if any). The CPA files from that report; QBO sales-tax center is not used. Weekly QBO push stays one company-wide gross figure.
14. **Property portal auth:** **one portal login per property**, password shared among that property's approved people. No per-person accounts/SSO in v1 — acceptable given low stakes. Requests carry a free-text "submitted by" name + callback phone. Owners can reset the property password.
15. **Invoice approval:** visit close leaves the invoice in **draft**; **any owner** may review, approve, and send — including an owner who worked the call. Techs (non-owners) cannot approve.
9. **Auto stage moves:** invoice drafted → Complete; invoice finalized/sent → Invoiced; part order info entered → Parts; part in-hand → Ready; My Jobs tap → In Progress.
10. **Change-out process management:** future iteration.
11. **AI diagnostic assist:** future improvement (not v1).
7. **Old codebases:** **out — clean start.** Port only the salvage list from `lsp-app`: auth/roles/SSR middleware; customer→location→unit→system hierarchy; catalog importer + `DATA/` importers/verifiers (retargeted to request/visit); PDF → Storage → Resend pattern. No `jobs` model, no dual Office/Field shells, no RLS as written.
8. **Missed-call rule:** **owners' judgment only** — no system callback rule for High portal requests.

## 18. Still open (leftovers)
1. Unit-number normalization (still future; affects 2-week highlight matching).
