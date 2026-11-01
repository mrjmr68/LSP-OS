# LSP OS — Data Model (v0.1, Nov 1 2026)

Conventions: Postgres (Supabase). `id uuid pk` and `created_at / updated_at timestamptz` on every table (omitted below). Money = `int` **cents**. Times stored UTC, shown America/New_York. `R` = required. Enums in `code`.

Core rules
- **Customer = management company.** Residents are never customers.
- **ServiceRequest 1 → N ServiceVisit.** The Board card is the request.
- **One InvoiceRecord per request** (when billable work is complete). No split billing.
- **Snapshots:** bundle selections, invoice lines, estimate lines copy title/narrative/price/cost lines at selection time. Money never live-joins the catalog.
- Hierarchy: Customer → Property → Unit → System (optional).

## 1. User (Person)
| Field | Type | R | Notes |
|---|---|---|---|
| auth_user_id | uuid | R | Supabase auth link |
| full_name | text | R | |
| role | enum `owner`,`tech` | R | Owner-technicians are `owner` |
| phone | text | R | Used for flag-back / contact |
| email | text | R | Flag-back emails |
| truck_label | text | | Future truck-inventory module |
| active | bool | R | default true |

## 2. Customer (management company)
| Field | Type | R | Notes |
|---|---|---|---|
| name | text | R | |
| billing_contact_id | fk CustomerContact | R | Invoice recipient |
| billing_email_override | text | | If AP inbox ≠ contact |
| payment_terms_days | int | R | e.g. 30 → due date = invoice date + terms |
| site_access_text | text | | Default arrival process; property may override |
| addon_approval_mode | enum `do_under_limit`,`call_first`,`estimate_required` | R | |
| addon_approval_limit_cents | int | | Required when `do_under_limit` |
| addon_approval_notes | text | | Shown at add-on creation |
| signoff_requirement | enum `none`,`note_only`,`walkthrough_signature`,`photos` | R | Enforced at visit close |
| signoff_notes | text | | |
| resident_report_mode | enum `confirm_with_property`,`just_go`,`must_use_maintenance` | R | |
| resident_report_notes | text | | |
| requires_estimate_over_cents | int | | Pre-approval threshold → estimate path |
| portal_enabled | bool | R | |
| active | bool | R | |

## 3. CustomerContact
| Field | Type | R | Notes |
|---|---|---|---|
| customer_id | fk Customer | R | |
| name | text | R | |
| title | text | | Manager, maintenance sup., AP |
| phone | text | | Needed for ETA text |
| email | text | | |
| sms_ok | bool | R | default true |
| portal_user_id | — | | Removed: portal login is per property (see Property.portal_*) |
| active | bool | R | |

**ContactProperty** (join, many-to-many): contact_id R, property_id R, is_primary bool. Drives two-way picker.

**Portal auth model (v1):** one shared login per Property (`portal_username` text unique, `portal_password_hash` text, `portal_password_set_at` timestamptz on Property). ServiceRequest from portal stores `submitted_by_name` text R and `submitted_by_phone` text R. Accepted low-stakes model; no per-person accounts.

**AppConfig.holidays:** US Federal Holidays only (date list).

## 4. Property (location)
| Field | Type | R | Notes |
|---|---|---|---|
| customer_id | fk Customer | R | |
| name | text | R | Community name |
| address_line1, city, state, zip | text | R | Maps target |
| lat, lng | numeric | | Geocoded; GPS arrival geofence |
| geofence_radius_m | int | R | default 150 |
| tax_rate_bps | int | R | default 675 (6.75%) |
| site_access_text | text | | Overrides customer default |
| lockbox_info | text | | Shown to tech only |
| *_override fields | | | Optional overrides of each customer contract field (addon, signoff, resident-report, terms); null = inherit |
| active | bool | R | |

Effective contract = property override ?? customer value.

## 5. Unit
| Field | Type | R | Notes |
|---|---|---|---|
| property_id | fk | R | |
| unit_label | text | R | As the property writes it |
| unit_label_norm | text | R | lower/trim; future normalization |
| building | text | | |
| notes | text | | |
Unique (property_id, unit_label_norm).

## 6. System (equipment at a unit) — optional but recommended
| Field | Type | R | Notes |
|---|---|---|---|
| unit_id | fk | R | |
| kind | enum `ahu`,`heat_pump`,`condenser`,`furnace`,`thermostat`,`other` | R | |
| brand | text | | Goodman/Ruud usual |
| model | text | | Typed |
| serial | text | | Typed |
| tonnage | numeric(3,1) | | match-up |
| refrigerant | text | | R410A/R32 |
| installed_on | date | | |
| nameplate_photo_id | fk Attachment | | backup |
| retired_at | timestamptz | | on change-out |

## 7. ServiceRequest (the Board card)
| Field | Type | R | Notes |
|---|---|---|---|
| number | int serial | R | Human ref `LSP-1234` |
| customer_id | fk | R | denormalized from property |
| property_id | fk | R | |
| unit_id | fk | R | Quick Add creates if new |
| contact_id | fk CustomerContact | R | |
| issue | text | R | One line |
| source | enum `portal`,`phone`,`text`,`email`,`dispatcher`,`tech_direct`,`onsite` | R | |
| reported_by_resident | bool | R | default false; triggers resident-report rule |
| board_status | enum (10) `new`,`assigned`,`ready`,`in_progress`,`to_estimate`,`estimate_out`,`parts`,`complete`,`invoiced`,`closed` | R | see STATE_MACHINES |
| priority | enum `normal`,`high` | R | high owner-only |
| assigned_user_id | fk User | | current tech |
| billable | bool | R | default true; false = warranty/goodwill, no invoice |
| duplicate_of_request_id | fk | | set when warned |
| parent_request_id | fk | | add-on created from a visit |
| board_sort_bumped_at | timestamptz | | Parts→Ready / High float |
| deleted_at, deleted_by | | | Soft delete (owner only) |
| closed_at | timestamptz | | |

## 8. ServiceVisit
| Field | Type | R | Notes |
|---|---|---|---|
| request_id | fk | R | 1→N |
| visit_seq | int | R | 1,2,3… |
| tech_user_id | fk User | R | lead |
| assist_user_ids | uuid[] | | multi-tech |
| visit_type | enum `service`,`return`,`estimate`,`changeout` | R | |
| status | enum `planned`,`en_route`,`on_site`,`working`,`closed`,`attempt`,`cancelled` | R | |
| outcome_path | enum `easy`,`parts`,`estimate`,`attempt`,`one_off`,`changeout` | | set at close |
| tech_note | text | R at close | ≥1 line |
| attempt_reason | enum `no_access`,`tenant_refused`,`lockbox`,`no_escort`,`other` | | R when attempt |
| model_typed, serial_typed | text | | R on parts path |
| equipment_size_text | text | | estimate match-up |
| readings | jsonb | | superheat, subcool, deltaT, pressures |
| signoff_name | text | | per sign-off rule |
| signoff_signature_attachment_id | fk | | |
| attempt_flag_for_review | bool | | "extra dead truck roll" |
| offline_conflict | bool | R | Board won; review |
| sync_state | enum `synced`,`pending` | R | client-reported |
| client_draft_id | uuid | | idempotent offline writes |
| closed_at | timestamptz | | |

## 9. TimeSegment
| Field | Type | R | Notes |
|---|---|---|---|
| visit_id | fk | R | |
| user_id | fk | R | |
| kind | enum `travel`,`access`,`work` | R | |
| started_at | timestamptz | R | |
| ended_at | timestamptz | | |
| start_source, end_source | enum `tap`,`gps`,`close`,`owner_edit` | R | |
Background only; owners see.

## 10. Bundle (catalog)
| Field | Type | R | Notes |
|---|---|---|---|
| code | text unique | R | Searchable |
| title | text | R | Formula `AHU - Capacitor - Replace` |
| narrative | text | R | Customer-facing |
| pricing_kind | enum `fixed`,`variable` | R | |
| target_price_cents | int | R | Never blank |
| reference_part_cost_cents | int | | Variable bundles |
| labor_hours | numeric(5,2) | R | man-hours |
| one_shot | bool | R | pre-arms parts path |
| quick_select_rank | int | | frequent first |
| requires_model_serial | bool | R | |
| status | enum `active`,`retired` | R | |
| difference_note | text | | near-dup justification |
| promoted_from_invoice_id | fk | | discovery pipeline |
Derived: cost = labor_hours × labor_rate + Σ lines; profit = target − cost; profit/hr ≥ floor warning.

**BundleLine**: bundle_id R, kind enum `equipment`,`part`,`material`,`consumable`,`refrigerant` R, description R, qty numeric R, unit_cost_cents R, is_placeholder bool (e.g. $0 furnace).

## 11. VisitBundleSelection (snapshot)
| Field | Type | R | Notes |
|---|---|---|---|
| visit_id | fk | R | |
| bundle_id | fk | | null for one-off |
| code_snap, title_snap, narrative_snap | text | R | |
| price_cents_snap | int | R | adjustable for variable before invoicing |
| labor_hours_snap | numeric | R | |
| labor_rate_cents_snap | int | R | |
| cost_lines_snap | jsonb | R | internal only |
| profit_cents_snap | int | R | |
| qty | int | R | default 1 |
| selected_by | fk User | R | |

## 12. PartsOrder
| Field | Type | R | Notes |
|---|---|---|---|
| request_id | fk | R | |
| visit_id | fk | R | origin visit |
| part_description | text | R | |
| supplier_id | fk Supplier | | tech or owner later |
| supplier_contact_text | text | | |
| order_number | text | | |
| expected_delivery_date | date | | |
| status | enum `needed`,`ordered`,`in_hand`,`cancelled` | R | no "shipped" |
| in_hand_at, in_hand_by | | | manual |
| entered_by, last_updated_by | fk User | R | |
**Supplier**: name R, phone, email, branch, notes.

## 13. InvoiceRecord
| Field | Type | R | Notes |
|---|---|---|---|
| request_id | fk unique | R | one per request |
| number | text unique | R | assigned at approve |
| kind | enum `bundle`,`one_off` | R | |
| status | enum `draft`,`in_review`,`flagged`,`approved_sent`,`paid`,`void` | R | |
| bill_to_customer_id, bill_to_contact_id | fk | R | snapshot of email |
| bill_to_email_snap | text | R | |
| property_snap, unit_snap | text | R | |
| subtotal_cents | int | R | |
| tax_rate_bps_snap | int | R | from property |
| tax_cents | int | R | on full total incl labor+profit |
| total_cents | int | R | |
| invoice_date | date | | at approve |
| due_date | date | | invoice_date + terms |
| terms_days_snap | int | R | |
| reviewed_by | fk User | | ≠ any visit tech on request |
| flag_question | text | | emailed to tech |
| tech_one_off_narrative, materials_text | text | | one-off |
| pdf_attachment_id | fk | | |
| sent_at, paid_at | timestamptz | | |
| paid_marked_by | fk | | |
| qbo_week_id | fk QboWeeklyPush | | included week |

**InvoiceLine** (snapshot): invoice_id R, sort R, source enum `bundle`,`adjustment`,`one_off`,`trip` R, visit_selection_id, description_customer R, amount_cents R, internal_cost_cents, internal_profit_cents, added_by R. Customer PDF shows narratives + total only.

## 14. Estimate (+ EstimateLine)
Mirrors invoice. Fields: request_id R, number, status enum `draft`,`in_review`,`sent`,`viewed`,`accepted`,`declined`,`void` R, created_by (tech) R, finalized_by (owner), narrative R, equipment_size_text, subtotal/tax/total cents, sent_at, viewed_at, accepted_at, declined_at, response_by_contact_id, response_note, pdf_attachment_id, public_token (view/accept link). Lines same shape as InvoiceLine. Multiple estimates per request allowed; one active (non-void).

## 15. Attachment (Photo/Doc)
owner_type enum `visit`,`request`,`system`,`invoice`,`estimate`,`reference` R; owner_id R; kind enum `photo`,`nameplate`,`signature`,`pdf`,`reference_doc` R; storage_path R; caption; taken_at; uploaded_by R; upload_state enum `local`,`uploaded`.

## 16. ReferenceDoc
title R, brand enum `goodman`,`ruud`,`thermostat`,`other` R, category enum `wiring`,`charging`,`thermostat_program` R, attachment_id R, sort, active. Cached offline.

## 17. AppConfig (singleton)
labor_rate_cents (9000), profit_per_hour_floor_cents (10000), daily_burn_cents (240000), burn_day_basis = `business_days`, non_business_dates date[], default_tax_rate_bps (675), repeat_unit_window_days (14), history_window_months (6), qbo_week_start_dow (1=Mon), qbo_week_days Mon–Fri, timezone `America/New_York`.

## 18. Supporting
- **StatusEvent** (audit): request_id, from_status, to_status, actor_id, trigger enum `manual`,`my_jobs_tap`,`invoice_drafted`,`invoice_sent`,`parts_order_entered`,`part_in_hand`,`mark_paid`,`system`, at.
- **OutboundMessage**: request_id, channel `sms`/`email`, to, template (`eta`,`invoice`,`estimate`,`flag_back`), body, provider_id, status, sent_at.
- **QboWeeklyPush** (future): week_start, week_end, gross_cents, tax_cents, invoice_count, status `pending`,`pushed`,`failed`, qbo_ref, pushed_at.
- **Payment** (optional simple): invoice_id, amount_cents, received_on, method, ref, entered_by.

## Relationships summary
Customer 1–N Property 1–N Unit 1–N System · Customer 1–N Contact N–N Property · Request N–1 Unit, 1–N Visit, 1–N PartsOrder, 0–1 Invoice, 0–N Estimate · Visit 1–N BundleSelection, TimeSegment, Attachment.
