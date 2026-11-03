# LSP OS — Screen Specs (v0.1, Nov 1 2026)

One mobile-first PWA shell; owners see extra controls on the same screens. Top bar: LSP, sync indicator (green synced / amber "N pending" / grey offline), avatar menu. Large tap targets (≥48px), high-contrast for sun, one-handed.

## S1 Board (home)
Purpose: live truth of all open calls.
Elements: All Jobs / My Jobs toggle. Owners also get Board / Who's where. Live stages by default: New, Assigned, Ready, In Progress, To Estimate, Estimate Out, Parts. Complete, Invoiced, and Closed sit behind Live stages / All stages. That choice is remembered on the phone. Empty live stages stay visible as a quiet count of 0. When about ten or fewer live calls are on screen, columns stack and cards sit tighter. Request cards (property, unit, issue, assigned avatar, age, source, High treatment, 2-week repeat badge, pending-sync dot); FAB "+ Quick Add". Avatar menu: Report / suggest (signed-in crew) opens a sheet — type Bug, Observation, or Request / suggestion, plus a note. The sheet shows the page, the All / My jobs filter, and the open call as a read-only line.
Who's where: one card per active crew member, including people with no call (they say Free). People with a live call sort first, then A–Z. Tapping a call opens the same detail and assign actions as a Board card.
Taps: card → Job view (S3). My Jobs card tap (assigned tech, status assigned/ready) → confirm sheet "Go en route?" → A1 (In Progress, ETA SMS, Maps). Repeat badge → sheet of recent calls (date, bundle codes). Owner: status pill → status switch sheet (allowed targets; override needs reason); long-press or Assign → assign tech, High on/off, delete duplicate. Unassign says where the call landed, for example "unassigned → New".
Sort: High first, then Parts→Ready bumped, then oldest.
Empty: a live stage with no calls stays on screen, quiet, count 0. All empty → "No open calls." My Jobs empty → "Nothing assigned to you — check with an owner."
Error: load fail → keep cached board + banner "Showing saved board from 8:42 AM". 
Offline: cached board read-only for status switching; Quick Add still works (queued).

## S2 Quick Add (sheet)
Fields (4, all required): Contact, Property (two-way picker), Unit (recent units first; type to add new), Issue (one line). Save tags source `phone` and leaves reported-by-resident false. The sheet does not ask for source or whether a resident reported it.
Taps: Save → request `new`; duplicate warning inline ("12B had no-heat 3 days ago — Complete") never blocks.
Error: missing field highlights; contact with no link to property → "Link contact to this property?" yes adds ContactProperty.
Offline: saves to queue, card shows pending.

## S3 Job view (request + current visit)
Header: property, unit, issue, contact (Call button), status, High, repeat badge.
Blocks: site access/arrival info; 6-month bundle history at unit; visits list; parts orders; estimate/invoice status. Overflow (⋯): References, Add-on call (after close; shows add-on approval terms), View photos.
Taps: Start (en route) if mine; Call contact; Open in Maps.
Offline: fully cached for today+tomorrow assignments.

## S4 Arrival
Shown after GPS arrival (or "I'm here" fallback). Shows access info big, lockbox, contact call button, Couldn't get in (→ attempt reason sheet). Primary button "Tools on equipment — Start job" → Job Start, S5.
Error: no GPS → fallback tap logs source=tap.

## S5 Diagnostic
Path chooser chips: Easy repair · Needs parts · Needs estimate · One-off. Easy → straight to S6. Others: guided fields — model/serial typed (with Nameplate photo button), readings (superheat, subcool, ΔT, pressures), equipment size, photo (optional), AI assist (future improvement; not in v1).
Complete button disabled with checklist of what's missing for the chosen path + sign-off requirement from contract.
Offline: every field autosaves locally.

## S6 Bundle picker
Quick-select tiles (top bundles), search by code/keyword, results show title + price (tech sees price, never cost). Variable bundles show "price adjusts for actual part" + reference part. One-shot bundles pre-select parts path. "No bundle fits → One-off" link.
Empty search → "No match — use One-off."

## S7 Parts
Order Part form: part description R, model/serial (pulled from S5; required), supplier picker with phone/email tap-to-call, order #, expected delivery (all optional for tech — "Owner will finish" toggle). Owner view of any Parts call: same form editable + "Part in hand" button → Ready. Saving supplier/order # auto-moves the request to Parts.
Departure gate: leaving visit without model+serial → blocked sheet.

## S8 Visit close / sign-off
Summary of selections, note (required), sign-off capture per contract (name, signature pad or note), Close. Results: request status per path; pending-sync shown if offline.

## S9 Invoice review queue (owner)
List of cards (Complete requests): property/unit, bundle lines + snapshot price, internal cost/profit, tech note, photos, time segments, attempt flags. Actions: Approve (any owner; invoices arrive here as drafts from visit close), Flag back (question text → email tech), Adjust (edit/add lines, tax recomputes).
Empty: "All invoices reviewed."
Error: send fail → stays Complete with "Email failed — retry"; status not advanced until send succeeds.

## S10 Estimate queue (owner)
Same card shape; Finalize & Send; status timeline sent/viewed/accepted/declined; Record answer (phone) buttons; on accept prompt "Move to Ready?".

## S11 Customer / property edit (owner)
Tabs: Company (billing contact, terms, contract fields), Properties (address, tax rate, overrides, access, lockbox), Contacts (link to properties), Units.
Validation: do_under_limit requires $ limit; tax rate required.

## S12 Bundle library admin (owner)
List (active/retired, count vs 50 cap warning), edit form with lines, live cost/profit/profit-per-hour (red under $100/hr), near-duplicate panel while typing title (difference note required to save), Promote from one-off.

## S13 References (on demand)
From Job view ⋯ only. Grouped: Goodman wiring, Ruud wiring, Goodman charging, Ruud charging, Thermostats. Opens cached PDF/image viewer. Offline: cached.

## S14 Financial Pulse (owner, v1 simple)
Revenue (approved invoices) MTD vs burn (business days elapsed × $2,400), net, chart by week. Optional for v1.

## S15 Payments / AR (owner)
Invoiced list with due date and age; Mark paid (manual only) → Closed. Future: QBO weekly push status.


## Portal (property shared login)
Sign in: property username + shared password. Submit request: unit, issue, priority, submitter name (R), callback phone (R); property prefilled. Owner side (Customer/property): portal enabled toggle, reset password.

## Monthly sales tax report (owner)
Month picker → taxable sales, tax collected, exempt, by rate/property; Export CSV/PDF for CPA.
