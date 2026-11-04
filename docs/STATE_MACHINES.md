# LSP OS — State Machines (v0.1, Nov 1 2026)

Rule zero (revised Nov 1 2026 per Matt): **jobs auto-move stage to stage when the work event happens**; owners keep a manual status switch for everything else and as override. Automatic transitions:
- **A1** tech taps a job in My Jobs → `in_progress`
- **A2** invoice drafted (visit closed on easy / one-off path, or owner creates à la carte invoice) → `complete`
- **A3** invoice finalized and sent (owner approve → PDF emailed) → `invoiced`
- **A4** part order information entered (PartsOrder needed → ordered: supplier/order # saved by tech or owner) → `parts`
- **A5** part marked in-hand → `ready` (top of Ready)
Mark paid stays **manual only** (invoiced → closed). Every change writes a StatusEvent.

## 1. ServiceRequest.board_status
Format: from → to (who, trigger)

| From | To | Who | Trigger |
|---|---|---|---|
| (none) | new | anyone / portal | Quick Add or portal submit |
| new | assigned | owner | assigns tech on Board |
| new | ready | owner | triaged, no tech yet |
| new | to_estimate | owner | known estimate job |
| ready | assigned | owner | assigns tech |
| assigned | new | owner | unassign, and no visit is past planned (only planned, cancelled, or none) |
| assigned | ready | owner | unassign after a visit is past planned (en route, on site, working, closed, or attempt) |
| in_progress | ready | owner | unassign; the active visit is cancelled so the call is not in progress with no tech |
| ready | ready | owner | unassign clears the tech only |
| new, to_estimate, estimate_out, parts, complete, invoiced, closed | same status | owner | unassign clears the tech only |
| assigned / ready | in_progress | assigned person, owner or tech (A1) | On the way. Not a status-switch skip, so no reason. |
| in_progress | complete | system (A2) | invoice drafted on visit close (easy / one-off path satisfied) |
| in_progress | parts | tech / system (A4) | closes visit on parts path (model+serial typed); or part order info entered |
| in_progress | to_estimate | tech | closes visit on estimate path |
| in_progress | assigned / ready | tech (attempt) or owner | attempt visit closed; request stays open for return |
| to_estimate | estimate_out | owner | finalizes + sends estimate |
| estimate_out | ready | owner | estimate accepted (manual switch; app prompts) |
| estimate_out | complete | owner | declined, diagnostic billable |
| estimate_out | closed | owner | declined, not billable |
| parts | ready | system (A5) on owner/tech tap | **part physically in-hand** tapped; floats to top |
| complete | invoiced | system (A3) on approve by any owner | invoice finalized + sent → PDF emailed |
| complete | closed | owner | non-billable (warranty/goodwill), no invoice |
| invoiced | closed | owner | **marked paid manually** (no import) |
| any open | (deleted) | owner | soft-delete duplicate |
| any | any | owner | **status switch** override (logged; requires reason if skipping a forward gate) |

Forbidden (system rejects for non-owners; owner override needs confirmation + reason):
- Tech changing status other than via A1–A5 work events and visit-close outcomes.
- parts → ready while no PartsOrder is `in_hand` ("shipped" doesn't exist).
- complete → invoiced by anyone other than approving an invoice; by a non-owner tech — **never** (any owner may approve, including one who worked the call).
- Flag back moving status: **flagged invoice stays `complete`**, never back to in_progress.
- closed → anything except owner reopen (logged).
- Any automatic advance besides A1–A5 (e.g. estimate accepted does NOT auto-move; app shows a prompt). Paid is never automatic.

Priority (orthogonal): normal ↔ high — **owner only**, any open status. No notifications.

## 2. ServiceVisit.status
| From | To | Who | Trigger |
|---|---|---|---|
| (none) | planned | owner/system | assignment creates visit |
| planned | en_route | tech | My Jobs tap (starts Travel) |
| en_route | on_site | system | GPS geofence (ends Travel, starts Access); fallback "I'm here" tap |
| on_site | working | tech | Job Start tap (ends Access, starts Work) |
| working | closed | tech | Complete with path gates met |
| en_route / on_site | attempt | tech | "Couldn't get in" + reason |
| planned / en_route | cancelled | owner | reassigned or duplicate |
| planned | cancelled | owner | |
| planned / en_route / on_site / working | cancelled | owner | unassign (open time segments end; on site and working are cancelled, not closed) |
Forbidden: working → on_site/en_route; closed → anything (owner may "reopen" creating audit; tech never); skipping on_site to working without GPS or tap.

Close gates (guided capture): bundle or one-off/attempt marker + note always; parts → model_typed+serial_typed; estimate → bundle or narrative; sign-off per contract; attempt → reason.

## 3. PartsOrder.status
needed → ordered (tech/owner, order# entered) · needed/ordered → in_hand (tech/owner, manual) · needed/ordered → cancelled (owner). in_hand is terminal. No "shipped".

## 4. InvoiceRecord.status
| From | To | Who | Trigger |
|---|---|---|---|
| (none) | draft | system | visit closed / à la carte created → request auto → complete (A2) |
| draft | in_review | system | immediately |
| in_review | in_review | owner | adjust lines |
| in_review | flagged | owner | flag back (email to tech) |
| flagged | in_review | tech | answers |
| in_review | approved_sent | any owner | approve → PDF + email; request → invoiced |
| approved_sent | paid | owner | mark paid (manual only); request → closed |
| approved_sent | void | owner | void + reissue |
Blockers (only three): parts return pending; not reviewed; flagged.

## 5. Estimate.status
draft (tech) → in_review (tech submits) → sent (owner finalize+send) → viewed (system, link opened) → accepted / declined (property via link, or owner records phone/email answer). sent → accepted/declined allowed directly. Any non-terminal → void (owner). No expiry, no nudges. Accepted prompts owner to switch request to `ready`.

## 6. Offline sync (per write)
local_draft → queued → synced; queued → conflict (server status changed by owner) → visit.offline_conflict = true, Board wins, owner review.
