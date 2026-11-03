# LSP OS — Acceptance Criteria (v0.1, Nov 1 2026)

## Quick Add
- AC-QA1 Given any user opens Quick Add, when Contact, Property, Unit, Issue are filled and Save tapped, then a request in New is created with source `phone` and reported_by_resident false, in < 30 s of typical use. The form does not ask for source or resident-reported.
- AC-QA2 Given any of the 4 fields is blank, when Save tapped, then save is blocked and the empty field highlighted; no other field is required.
- AC-QA3 Given a contact is picked, then the property list shows only that contact's properties; given a property is picked first, the contact list shows its contacts.
- AC-QA4 Given the unit had a request in the last 14 days, when saving, then a duplicate warning shows and the request is still created.
- AC-QA5 Given the device is offline, when Save is tapped, then the request is queued, shown with pending state, and synced automatically on reconnect.

## Board
- AC-B1 Given open requests exist, when the Board loads, then 10 categories show in spec order with counts.
- AC-B2 Given a tech toggles My Jobs, then only requests assigned to them show; toggle back shows all.
- AC-B3 Given a unit had a call in the last 14 days, its card shows the repeat highlight; tapping it lists dates + bundle codes.
- AC-B4 Given a tech, the High control is absent/disabled; given an owner sets High, the card floats to the top of its category and no message is sent.
- AC-B5 Given a tech attempts any status switch, then it is rejected; given an owner switches status, a StatusEvent is logged.

## Dispatch
- AC-D1 Given a tech taps an Assigned job in My Jobs and confirms, when the contact has a phone and sms_ok, then the request moves to In Progress, an ETA text (Maps travel time from current location) is sent, and Google Maps opens to the address.
- AC-D2 Given the contact has no phone, then status moves and Maps opens, and the tech sees "No ETA text sent — no phone."
- AC-D3 Given GPS enters the property geofence, then Travel ends and Access begins without a tap; tapping Start job ends Access and starts Work.

## Guided complete
- AC-G1 Given no bundle and no one-off/attempt marker, Complete is disabled.
- AC-G2 Given the note is empty, Complete is disabled.
- AC-G3 Given the parts path, when model or serial typed field is empty, Complete and leaving the visit are blocked; a nameplate photo alone does not satisfy it.
- AC-G4 Given any path, photos are never required (except a property sign-off rule of `photos`).
- AC-G5 Given an attempt, a reason is required and the request stays open.
- AC-G6 Given the property sign-off is walkthrough_signature, close requires name + signature.

## Parts
- AC-P1 Given a parts-path close with supplier/order#/ETA blank, the close succeeds and the request goes to Parts.
- AC-P2 Given an owner opens a Parts request, they can fill/edit supplier, order #, ETA; last_updated_by records the owner.
- AC-P3 Given a Parts request, when "Part in hand" is tapped, then it moves to Ready and to the top of Ready; there is no "shipped" state.
- AC-P4 Given a request not yet in Parts, when a tech or owner saves part order information (supplier / order #), then the request auto-moves to Parts and a StatusEvent (trigger system) is logged.

## Invoices
- AC-I0 Given a tech closes a visit on the easy / one-off path, when the invoice draft is created, then the request auto-moves to Complete.
- AC-I1 Given a Complete request, an invoice card appears in the owner queue.
- AC-I2 Given an owner approves, then a PDF is generated, emailed to the billing contact, status → Invoiced, due date = date + terms.
- AC-I3 Given owner flags back with a question, then the tech gets an email and the request stays Complete.
- AC-I4 Given owner adjusts/adds a line, totals and 6.75% tax (on full total) recompute; catalog prices unchanged.
- AC-I5 Given an owner who worked a visit on the request opens it in the queue, then Approve is enabled. Given a non-owner tech, then the Invoice queue and Approve are not available.
- AC-I6 Given a visit closes on a billable path, then the invoice is created in `draft` and is not sent until an owner approves.
- AC-I6 Given a bundle price later changes, existing invoices/selections keep snapshot amounts.
- AC-I8 Given an Invoiced request, when an owner taps Mark paid, then invoice → paid and request → Closed; nothing marks paid automatically.
- AC-I9 Given the weekly QBO push, the week is Mon–Fri business days.
- AC-I7 Customer PDF shows narrative + totals only; no cost/profit lines.

## Estimates
- AC-E1 Given a tech drafts an estimate, it appears in the owner estimate queue; tech cannot send.
- AC-E2 Given owner sends, status = sent and request → Estimate Out; opening link marks viewed.
- AC-E3 Given accepted, owner is prompted and on confirm request → Ready.

## Offline
- AC-O1 Given today/tomorrow assignments, with no signal the tech can open them and their references.
- AC-O2 Every field saves locally as typed; force-closing the app loses nothing.
- AC-O3 Queued writes retry automatically; visit shows pending vs synced.
- AC-O4 Given an owner changed the request while tech offline, on sync the Board state wins and the visit is flagged offline_conflict for review.

## QBO (future)
- AC-Q1 Given a completed week, one journal/sales receipt with company-wide gross (pre-tax sales + tax) is pushed once; per-invoice data is not sent; re-run does not duplicate.

## Sales tax
- AC-T1 Given an owner runs the monthly sales tax report for a month, then it lists taxable sales, tax collected, and exempt sales grouped by tax rate/property from approved invoices in that month, exportable as CSV/PDF for the CPA.

## Portal
- AC-P1 Given a property portal login (shared password), when a request is submitted, then it requires submitter name + callback phone, is tagged source `portal`, and prefills that property.
- AC-P2 Given an owner resets a property's portal password, then the old password stops working immediately.

## Financial Pulse
- AC-F1 Burn = $2,400 × business days elapsed (Mon–Fri minus US Federal Holidays).
