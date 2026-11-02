# Migrations

Authority for these tables is `docs/DATA_MODEL.md` and `docs/STATE_MACHINES.md` (Nov 1, 2026). There is no `jobs` table and no separate Office/Field shell.

Apply the files in `supabase/migrations` in filename order. Each file runs once.

| File | What it does |
|---|---|
| `20261101160000_enums.sql` | Status, role, source, invoice, and parts enums. No `shipped` parts state. |
| `20261101161000_tables.sql` | Profiles, customers, properties, units, systems, requests, visits, time, bundles, snapshots, parts, invoices, estimates, photos, config, audit. |
| `20261101162000_rls.sql` | Row level security and write guards. |
| `20261101163000_seed_app_config.sql` | The one AppConfig row, including US federal holidays 2026–2035. |
| `20261102120000_legacy_import.sql` | Old workbook calls. Not Board cards and not invoices. Financial Pulse cannot count them. |

Money is integer cents. Times are `timestamptz` (UTC). The app shows America/New_York.

## How to apply

On a hosted Supabase project, paste each file into the SQL editor and run it, in order. Or, with the CLI linked to that project:

```bash
supabase db push
```

`supabase db push` applies migrations. It does not run `supabase/seed.sql`. AppConfig is in a migration on purpose, so production gets the labor rate and the holiday list.

Local proof, without a Supabase project:

```bash
npm run prove:rls
```

That builds a throwaway database named `lsp_os_rls`, applies a stub `auth.uid()`, runs the migrations, and checks the role rules. It refuses a hosted Supabase URL.

## Roles

`public.profiles` is the User record. `auth.users` is Supabase login.

- A new auth user gets a profile with role `tech` from the trigger on `auth.users`.
- Promote an owner from the SQL editor (the postgres role), not from the signed-in app:

```sql
update public.profiles
set role = 'owner'
where email = 'you@example.com';
```

A tech cannot run that update. The proof checks it.

Phone starts as `unset` when the auth user has no phone in metadata. Fill the real number before flag-back email and ETA texts matter.

## What the proof checks

`supabase/tests/rls_proof.sql`

- Labor rate is 9000 cents ($90/hr). Profit floor is 10000 cents (~$100/hr). Daily burn is 240000 cents ($2,400).
- Business days are Monday–Friday minus the federal holiday list. July 4, 2026 (Saturday) is observed Friday July 3. Thanksgiving 2026 is November 26. New Year 2028 is observed December 31, 2027.
- With the guard triggers turned off, RLS still rejects a tech who tries to set an invoice to `approved_sent` or a request to `high`.
- RLS rejects a tech who tries to set their own role to `owner`.
- With the triggers on, a tech can edit the call text and cannot move the call to `invoiced`.
- An owner can set High and can approve the invoice.
- The fixture rolls back, so the draft invoice and normal priority remain.

## Rules encoded for later milestones

These are in the database now so M3–M5 do not have to loosen security to ship.

- Techs insert requests as `new` / `normal` only. They cannot soft-delete.
- Tech board moves are only the work events: assigned or ready → in progress (when the call is theirs), in progress → complete / parts / to estimate / assigned / ready, and parts → ready.
- Parts → ready requires a parts order already `in_hand`, unless an owner sets `app.status_override_reason` in the same transaction.
- Reopening `closed` requires that same owner reason.
- Techs may insert invoices as `draft` or `in_review`. They cannot set `approved_sent`, `paid`, `void`, a reviewer, a sent time, or a number.
- Techs may draft estimates. They cannot send them.
- Techs cannot insert or edit bundles. They cannot change a selection's snapshotted price after insert.
- Any owner may approve, including an owner who worked the call. The data-model note that `reviewed_by` must differ from the visit tech is superseded by SPEC §17.15.

## Names worth knowing

- Customer is the management company. The property is the community.
- `billing_contact_id` is required. Insert the customer and the contact in one transaction; the foreign key is deferred.
- Effective contract (property override, otherwise the customer value) is the view `property_contract`.
- Portal login is one username and password hash per property. Not built in this run.
- `unit_label_norm` is lowercased and trimmed. Fuller unit-number matching is still an open decision.
- QuickBooks is a stub table, `qbo_weekly_pushes`. No push runs yet.
- Photos store a `storage_path`. Create a private Storage bucket when the visit flow needs it. Not required for the empty Board.
- `legacy_imports` holds the old workbook. `counts_toward_pulse` is constrained false. Crew members can read the rows. They cannot insert them. Loading the rows is `docs/IMPORT.md`.
