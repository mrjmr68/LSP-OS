# Load the price book, the properties, and the old history

This is the data load for Build 1. It fills the catalog, Wynnefield, Sasser, and the old calls. It does not put those calls on the Board, and it does not create invoices. Financial Pulse must ignore them.

The live app does not need a new deploy for this. The rows go into the LSP Operations database (`ifneznpvppgqlfidwysi`). Afterward, sign in and the Board is still empty. That is expected. Live calls start with the next milestone.

## What you will see

| What | Count | Where it goes |
|---|---:|---|
| Repair bundles | 40 | `bundles` |
| Parts, materials, refrigerant, and the $0 furnace placeholder | 71 | `bundle_lines` |
| Management companies | 2 | `customers` (Wynnefield Properties, Sasser Companies) |
| Communities and sites | 123 | `properties` |
| People and site lines | 250 | `customer_contacts` |
| Person-to-property links | 346 | `contact_properties` |
| Units named in the old calls | 933 | `units` |
| Old calls | 1,227 | `legacy_imports` |
| Old-call total | $1,227,652.57 | integer cents on those rows |

1,106 calls match a bundle. 121 do not:

- 115 are `SYS - TOTAL - Change Out - Wall Mount`. There is no wall-mount bundle. Build that one later in the repair flow, using that exact code, then run the import again. Those 115 rows will link, and nothing else will be copied.
- 10 attic/crawl change-outs used an older code (`SYS - TOTAL - Change Out - Attic/Crawl AHU`). They link to `SYS - Attic/Crawl AHU - Change Out`.
- 4 calls have a note instead of a code (blower wheel, duct insulation).
- 2 calls have no diagnosis at all.

Seven history names are not in the property files, so those calls stay unlinked until you add the property and run the import again:

Commercial, Forest Park Crossing, New Garden, Other, Villas at Forest Park, Villas at Hope Crest, West Cumberland.

`Other` and `Commercial` are catch-all names from the workbook, not communities. Add a property only when you know the street.

No equipment rows are created. The files do not have model and serial numbers.

## What the prices mean

The catalog price is the workbook **Flat Rate**, in cents. The old "what we have been charging" number stays on the history row. It is not the price the next visit will use.

Labor hours are the workbook **Total Time** (travel plus the repair). A capacitor is 1.00 hour. The attic/crawl change-out is 18.00 hours.

The workbook column "One Shot" means the job is normally finished on the first visit. In this app, `one_shot` means the opposite: pre-arm the parts / return path. A capacitor is not one-shot. A compressor replacement is.

Variable bundles (coil, compressor, condenser coil, attic/crawl change-out, in-wall leak, restriction) carry a reference part cost when the workbook names one. The attic/crawl bundle includes the $0 furnace placeholder. That is the only placeholder. There is no wall-mount row.

`ITEMS.csv` is the older cost list. Where a part price disagrees, the workbook wins. The import prints those differences. It does not load ITEMS as its own table.

`AHU - Coil - Defrost & Clean` is on the old seed and in the scratch area of the workbook, with no code, price, or narrative. It is not a bundle.

Quick select, most calls first: low-voltage short, condensate lines, easy leak, compressor, evap coil, condenser capacitor, fire damper, transverse motor.

## Property details that are not in the spec

These are placeholders until you set the real contract. The import will not overwrite them on a later run.

- Payment terms: 30 days.
- Add-on approval: call first. No dollar limit.
- Sign-off: none.
- Resident report: confirm with the property.
- Portal: off.
- Billing contact: "Wynnefield Properties billing" and "Sasser Companies billing", with no phone and no email. Put the real AP name on those two rows before anyone sends an invoice.

Door codes from the Wynnefield sheet are stored as the arrival note. When the note contains a code, the same text is also on the lockbox field. Both are for the tech.

Where every old invoice for a property used one tax rate, that rate is stored (6.75%, 7.00%, or 7.25%). A property with no history stays at 6.75%. The history row keeps the rate that was actually charged.

Two source cells were unusable:

- Juniper Village had no ZIP. It is set to 27546, the only ZIP for Lillington.
- Sasser Harrisburg's street was the text "I'm". The street is "Address not on file". Fix it before anyone is sent there.

The manager is the primary contact. If a property has no manager, the primary is maintenance, then the regional, then the office line. Each Sasser site's primary contact is the site phone on that row.

## How to run it against LSP Operations

1. In Supabase, open Project Settings → Database and copy the **direct** connection URI (host `db.ifneznpvppgqlfidwysi.supabase.co`, port **5432**). Do not use the transaction pooler on port 6543.
2. Put it in `.env.local` as `SUPABASE_DB_URL`. Do not commit that file. Do not put the URI in a `NEXT_PUBLIC_` variable.
3. From this repo:

```bash
npm install
npm run import:dry-run
npm run import:data -- --commit
```

The dry run writes nothing. It prints the counts above. `--commit` is required for the hosted database so a casual run cannot write to it.

Run it again the same way whenever you want. On an unchanged database the second run adds nothing and changes nothing. It will:

- add a bundle, property, contact, or unit that is missing
- link history when a property or a bundle now matches
- remove a history row that you deleted from `data/import/Call History.csv`

It will not change a price, a door code, a tax rate, or a contract term you edited in the app. Money on an existing history row is not rewritten. The row's identity includes the amounts, so a changed amount in the file becomes a new row and the old row is removed.

If you need to rebuild the catalog before anyone has selected a bundle on a visit:

```sql
update public.legacy_imports set bundle_id = null where bundle_id is not null;
delete from public.bundle_lines;
delete from public.bundles;
```

Then run the import again. It inserts the 40 bundles and links the calls.

## Check

`npm run import:data -- --commit` exits with an error if the history count, the per-property counts, or the dollar total do not match the files. It also checks that every workbook bundle is present and that no wall-mount bundle was created.

`npm run prove:import` does the same load in a throwaway local database, runs it a second time, edits a price and a payment term and checks the rerun left them alone, adds Forest Park Crossing and checks those calls link, and checks a signed-in tech can read history but cannot insert it. It refuses a hosted Supabase URL.

## Files

`data/import/` is the snapshot the script reads:

- `Operations - Invoicing - V2.csv` — the price book
- `diagnoses_seed.sql` — stable bundle ids only
- `ITEMS.csv` — compared, not loaded as the price
- `wynnefield_seed.sql`, `sasser_seed.sql` — company and property ids and streets
- `Wynnefield Properties - Locations.csv`, `Sasser Companies - Locations.csv` — people, phones, door codes
- `Call History.csv` — the 1,227 calls

The old `jobs` importer is not used. Nothing is written to `service_requests`.
