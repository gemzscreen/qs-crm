# QS CRM — changelog

Generated from the CHANGELOG in `index.html` by `node scripts/version.mjs changelog`. Do not edit by hand.

## v3.1.0 — 8 Nov 2026

- Procurement (QS CRM v3) starts: new Procurement menu with Suppliers and Review queue.
- Suppliers: own supplier database with IDs SUP-0001 …, country, city, sourcing zone (1 Brunei · 2 Borneo · 3 MY/SG · 4 China/Vietnam · 5 other), material categories (23, mapped to the masterlist), specialty, contacts and verification (Unverified → Checked → Verified / Failed). Search and filter by category, zone, country, verification and status; Excel export (Suppliers, Contacts and a Discovery sheet that imports again).
- Supplier card: contacts with one-click Email (Roundcube compose, To: filled), WhatsApp (mobiles only) and Call buttons; history of every change. Mark Verified / Failed with a note; Inactive or Blacklisted (with a reason) instead of deleting.
- Review queue: import a discovery CSV / sheet (17 columns), the "Discovery (import)" sheet of an RFQ send list, or the Gemini supplier directory. Rows are checked automatically — format, phone numbers by country, free-mail and platform-only notes, mail server (MX) and website (A) by free DNS lookups, duplicates against the database and the file — then you approve, merge into an existing supplier, or reject. Rows that pass the checks are saved as Checked, the rest as Unverified.
- Duplicate check on every new supplier (same email, phone, company web / email domain, or name + country): you choose to merge or keep both.
- Company & settings (admin, under your name): company and letterhead details with logo upload (resized; a copy goes to Drive), test print of the letterhead, approval-pack addressee (default Quantity Surveyor, qs@arzabrunei.com), Brunei public holidays for RFQ reminders, and the category list.
- Database: new tables suppliers, supplier_contacts, categories, supplier_categories, discovery_candidates, settings (+ lists for urgency classes, statuses, holidays). Applied by the Database workflow after merge.
- Apps Script (Code.gs) changed: new procUpload action stores procurement files (now the logo) in Drive › Procurement. Paste Code.gs in Apps Script and Deploy › Manage deployments › Edit › New version. Without it everything else works; only the Drive copy of the logo is skipped.

## v2.3.0 — 7 Nov 2026

- New header: one line, grouped menus — Dashboard · Tenders · Contract (Rationalized BQ, As-built) · Pricing (BQ Library, Masterlist) · Reports. On small screens the menu folds into a ☰ button.
- Profile menu (top right): your initials, "Welcome, <name>" and your role. It holds My profile, Team & access (admin), What's new and Sign out.
- My profile: full name, display name (shown in "Welcome, …"), designation (pre-fills approvals), phone, change password. Email, role and member-since are shown.
- "Users" renamed Team & access, now with a Designation column, so it is not confused with your own account settings.
- Footer: connection status (● Connected · Supabase / read only / read-only file), date and time, and the version button — more room in the header.
- Sign-in reliability: the Supabase and Excel libraries are now served from this site (vendor/), with the public CDN only as a fallback. If they still cannot load, the sign-in page says what to do instead of "Supabase library not loaded".
- Reports: status pipeline bars show the value only (B$), the record count moves to the label below (e.g. Won (3)); rounded axis (0, 250k, 500k …); each status and each month has its own colour.
- Masterlist: short column titles (full sheet header on hover), wider description, compact number columns, long "Priced in" / keywords / source cut to one line with the full text on hover.
- Dashboard: titles and descriptions on one line (full text on hover). BQ Library: compact client, source and unit columns.
- Polish: larger page titles, coloured KPI accents, row hover, focus rings, rounder cards and buttons.
- Sign-in page simplified: the Connection settings link and the "Open QS_CRM_DB.xlsx" read-only file option are removed (the connection is set in config.js; everyone signs in).
- Database: new profile fields + crm_setprofile (applied automatically by the Database workflow on merge). No Apps Script change.

## v2.2.0 — 7 Nov 2026

- v2 complete.
- BQ Library (new page): search every priced BQ line of every tender — tendered BQ and the approved contract revision — by words (-word excludes), unit, client, type, status, year and source.
- Rate history per unit: lines, tenders, min, median, average, max, latest (which tender, when), won average and contract (rationalized) average; by client; rate-over-time chart with won / lost / contract points; Excel export.
- Masterlist (new page): the ARZA Tender Pricing Masterlist Google Sheet, read only — Rates (build-ups, net and all-in) and Resources (prices with confidence grade A / B / C); search and filter by trade; History opens the BQ Library for similar items.
- Dashboard (new page): open and submitted pipeline, won value after rationalization, win rate, tenders closing in 30 days, revisions awaiting approval, tendered vs contract by client, won projects with their as-built position.
- Apps Script changed: paste the new Code.gs, run setMasterlist() once with the masterlist link, then Deploy › Manage deployments › Edit › New version.
- Database: run automatically by the Database workflow (new crm_library and crm_dashboard functions).

## v2.1.1 — 6 Nov 2026

- Supabase new API keys: publishable key (sb_publishable_…) in config.js; secret key (sb_secret_…) in the Apps Script file service (legacy anon / service_role keys still work).
- Project URL pasted with /rest/v1/ at the end is corrected automatically (app and setSupabase()).
- Fixed: one-time import of the QS CRM DB sheet failed with "DELETE requires a WHERE clause" on Supabase — run the new schema.sql once.
- README and config.js: current Supabase menu names (Connect, Data API, API Keys).

## v2.1.0 — 6 Nov 2026

- Data moved to Supabase (PostgreSQL). Google Drive keeps the files; Google Sheets stays for the pricing and inventory masterlists.
- Own accounts: everyone signs in with email and password. Forgot password sends a reset link; change it under My account (click your name).
- Roles: admin (users + everything), qs (all changes), viewer (read only — for ARZA management). Viewers see every page without edit buttons.
- Users page (admin): add accounts, set role, deactivate; one-time import of the QS CRM DB Google Sheet.
- Every rule is enforced in the database (lock, one draft revision, approved = locked, …); the activity log records who did what.
- Files go to Google Drive through the Apps Script file service, which checks the user's sign-in and role first.

## v2.0.0 — 6 Nov 2026

- v2 starts: Rationalized BQ page (top bar, between Tenders and As-built).
- Rationalized revisions R1, R2 … of the locked tendered BQ: start a draft as a copy of the tendered BQ (or the last approved revision), or import a rationalized priced workbook.
- Draft editor: change quantities and rates, omit items, add items, undo; live total against the base and against the tendered sum. One draft at a time.
- Changes: every line marked Qty / Rate / Qty & rate / Added / Omitted, by bill with totals; compare with the base revision or the tendered BQ.
- Approval record: date, for ARZA, for the client (name, designation, organisation), letter / document ref and the signed document (saved to the tender's Drive folder). The revision is then locked and becomes the contract BQ.
- Void the latest approved revision with a reason (kept on record, logged). The tendered BQ cannot be unlocked or replaced once revisions exist.
- Tender sum history: tendered → R1 → R2 … with change against the base and against tendered; also in the tender panel (BQ tab) and the register (contract sum under our sum).
- As-built: matched and priced against the contract BQ. Report 2 is now Tendered | Rationalized | As-Built | Diff qty | Diff % | Rate | Rationalized B$ | As-built B$ | Diff B$; omitted and added items flagged. Excel and PDF updated.
- Rationalization statement (PDF / Print) with both signature blocks, and Excel export of revisions, sum history, lines and changes.
- Google Sheet: the Revisions tab and the contract_sum / contract_rev columns are added automatically on the first call after updating Code.gs.

## v1.4.0 — 6 Nov 2026

- As-built module — v1 complete.
- Import Breakdown QTY: standard ARZA template and the old MOE Block D layout (SL NO / DESCRIPTION / TOTAL QUANTITY; "Total …" rows skipped). File saved to the tender's Drive folder.
- Refs matched to the tendered BQ (B.2.1.B, b2/1/b, "B.2.2-C & B.2.3-C", 4.1.1 …): Matched / Shared / Unmatched / VO?. Saved as named measure sets (As-built, Interim 1 …).
- Report 1 — As-Built BQ and Report 2 — Tendered vs As-Built (qty, %, B$ difference, over/under 10% flags), by bill with totals.
- Matching check: refs not in the BQ, VO? lines, BQ items not measured, shared measurements, unit differences.
- Export to Excel and PDF / Print (A4, ARZA logo, prepared / checked by).
- Standard Breakdown QTY template download.

## v1.3.1 — 5 Nov 2026

- Google Drive: tender files can go to a folder you choose (setDriveFolder in Apps Script); clearer message when Drive is not set up.
- Reports: charts with colour: value by type and records by client (donuts), status pipeline, records by closing month, largest priced records and bid outcomes by type (bars). Hover any bar or slice for the figures.
- Export (green) and Import (orange) buttons with icons.
- BQ import removed from the top bar (same as the Import button).

## v1.3.0 — 5 Nov 2026

- Import: create a tender straight from a priced workbook (.xlsx). Tender details, our sum and every BQ line are read and shown for checking before saving; the file is stored in Google Drive.
- Tender details: Upload file to the tender's Drive folder (can also replace the tendered BQ when not locked) and Open folder.
- Theme switch is now a single icon: Auto / Day / Night.
- Full-screen button beside × on the tender panel; Shift+click pops the tender out in its own window.
- Type cards (Tender, Quotation, Sub-contract quote, Supply quote, Internal estimate) with count, value and results; the KPI row follows the filters.
- New type: Internal estimate (pricing for internal use only).
- Reports page: by type, status pipeline, by client and bid results, with Excel export. The BQ import menu opens the importer.
- BQ item ID scheme: plain-language help with examples; the importer sets it for you.

## v1.2.0 — 4 Nov 2026

- ARZA favicon (browser tab and phone home screen).
- ARZA SDN BHD logo in the top bar and on the sign-in page, with ARZA QS CRM SYSTEM centred below it.
- Colours matched to the ARZA logo blue.
- New sign-in background: deep ARZA blue with a fine blueprint grid and the logo's rings.
- Auto / Day / Night theme switch beside Sign out (Auto follows your device).
- Footer: QS CRM ARZA SDN BHD in bold.

## v1.1.0 — 4 Nov 2026

- New sign-in page: ARZA QS CRM SYSTEM, version shown below; top bar hidden until you sign in.
- Top bar: "Welcome, Gemz" with today's date and time.
- Version button with this change log.
- Footer: QS CRM ARZA SDN BHD — Powered by Darkwiz Lab 2026.
- Cancel buttons beside Save changes and Save result.
- Faster saving: one server call per save (was two); save + lock BQ in one call.
- Clearer message when the web app cannot be reached.

## v1.0.0 — 4 Nov 2026

- Tender register: T01–T10 loaded, search, filters, sort, Excel export.
- Add / edit tenders, status, Lock BQ at submission (unlock needs a reason).
- Bid result: winner, winning sum, % difference, source.
- BQ summary per bill checked against our sum; activity log.
- Read-only mode from QS_CRM_DB.xlsx.
