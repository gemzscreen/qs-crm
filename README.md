# ARZA QS CRM SYSTEM — v3.1.2 (Supabase)

## How updates work (from v2.1.1)
Claude opens a **pull request** with each change. You review it and click **Merge**. Then, automatically:
- **Website** — GitHub Pages republishes `index.html` (1–2 minutes).
- **Database** — the *Database* workflow runs `supabase/schema.sql` on Supabase when that file changed (safe to re-run, one transaction: an error changes nothing).
- **Version** — the *Release* workflow tags `vX.Y.Z` and publishes a GitHub release with the notes from the app's "What's new".
- **Apps Script** (`Code.gs`, the Drive file service) rarely changes. When it does, the release notes say so: paste it in Apps Script and Deploy › Manage deployments › Edit › New version.

Check results in the repo's **Actions** tab (green = done). Database by hand: Actions › Database › Run workflow.

**One-time setup:** Supabase › **Connect** › *Session pooler* › copy the connection string and put your database password in it (letters/digits are safest; symbols must be URL-encoded, e.g. `@` → `%40`). GitHub › repo **Settings › Secrets and variables › Actions › New repository secret**: name `SUPABASE_DB_URL`, value = that string. Use the Session pooler (not Direct connection — GitHub's servers cannot reach the direct IPv6 address).

## Versioning
- `VERSION` is the single source of truth (`x.y.z`). The app shows the same number (top bar, "What's new"), and each release is tagged `vX.Y.Z` on GitHub.
- New version: `node scripts/version.mjs bump x.y.z` → add the entry at the top of `CHANGELOG` in `index.html` → `node scripts/version.mjs changelog` (regenerates `CHANGELOG.md`).
- The *Check* workflow blocks a pull request when the numbers disagree, `CHANGELOG.md` is stale, any JavaScript has a syntax error, or the app / database / Apps Script changed without a new version.
- `schema.sql` and `Code.gs` headers carry the version in which they last changed (never higher than `VERSION`).
- patch (2.1.**1**) = fixes · minor (2.**2**.0) = new features · major (**3**.0.0) = big platform change.

Tender register, priced BQs, rationalized revisions, bid results and as-built reports for ARZA SDN BHD.
**Data:** Supabase (PostgreSQL, sign-in, roles). **Files:** Google Drive (Apps Script file service). **Masterlists:** Google Sheets (pricing, inventory).

## Move to Supabase (about 30 minutes, once)

### 1. Supabase project
1. https://supabase.com › sign in with Google › **New project**. Name `qs-crm`, a strong database password (keep it), **Region: Southeast Asia (Singapore)**. Free plan.
2. **SQL Editor › New query** › paste all of `supabase/schema.sql` › **Run**. (Safe to run again after updates.)
3. **Authentication › Sign In / Providers › Email**: keep Email on; turn **"Allow new users to sign up" OFF** (only the admin adds people).
4. **Authentication › URL Configuration › Site URL**: your app address (e.g. `https://qs.yourdomain.com`) — used by the password-reset link.
5. **Authentication › Users › Add user › Create new user**: your email + password, tick **Auto Confirm User**. The first account becomes **admin** automatically.
6. Click **Connect** (top of the project page) or **Project Settings › Data API** for the **Project URL** (`https://xxxx.supabase.co`). **Project Settings › API Keys** for the **publishable** key (`sb_publishable_…`) and, only for step 2, a **secret** key (`sb_secret_…` — keep it secret). The legacy `anon` / `service_role` keys also work but Supabase retires them at the end of 2026.

### 2. Drive file service (Apps Script)
1. Open your existing Apps Script project (or script.google.com › New project), replace all code with `Code.gs`.
2. In `setSupabase()` paste the Project URL, the publishable key and (optional, to add users from the app) the secret key › Run › allow permissions › put the `PASTE-…` texts back › Save.
3. Run `setMasterlist()` with the link of the **ARZA Tender Pricing Masterlist** Google Sheet (v2.2.0: the Masterlist page reads it, read only).
4. Run `setDriveFolder()` (paste your Drive folder link, or leave it to create "QS CRM - Tenders"). Same folder as before = existing tender folders are reused.
5. **Deploy › Manage deployments › Edit › Version: New version › Deploy** (or New deployment › Web app › Execute as Me › Anyone). Copy the `/exec` URL.

### 3. Website (GitHub Pages)
1. Fill `config.js`: `supabaseUrl`, `supabaseKey` (publishable key), `driveUrl` (/exec). **Never put the secret key in config.js.**
2. Upload `index.html`, `config.js`, `Breakdown_QTY_Template.xlsx` to the repo (replace the old files).
3. **Delete `QS_CRM_DB.xlsx` from the public repo** (it holds priced BQ lines).

### 4. Move the data
1. Google Sheet **QS CRM DB** › File › Download › Microsoft Excel (.xlsx).
2. Sign in to the app as admin › your name (top right) › **Team & access** › *Choose QS CRM DB.xlsx…* › Import. Check the register shows all tenders.
3. Keep the Google Sheet as an archive (it is no longer updated).

### 5. Add people
**Your name (top right) › Team & access › + Add team member** (email, name, role, temporary password) — needs the service key in step 2; otherwise add them in Supabase › Authentication › Users (Auto Confirm) and set the role on the Team & access page. Everyone fills in their own name, designation and phone under **My profile**.
Roles: **admin** — users + everything · **qs** — all changes · **viewer** — read only (ARZA management, client). pm / site are for the v7 site modules (read only until then).
Everyone can change their password by clicking their name (top right). Forgot password sends a reset link by email.

## Free plan notes
- Free projects **pause after 7 days without use** (data kept; restore with one click in the Supabase dashboard). Normal weekly use keeps it awake.
- No automatic daily backups on Free: export the register / reports to Excel regularly, or move to **Pro (US$25/month)** for daily backups and no pausing once ARZA relies on it.

## Files
| File | Purpose |
|---|---|
| `index.html` | the app (one file) |
| `vendor/` | SheetJS 0.18.5 + supabase-js 2.119.0, served from this site (the CDN is only a fallback) — upgrade by replacing the file and its name in index.html |
| `VERSION`, `CHANGELOG.md`, `scripts/version.mjs` | version number, changelog (generated), version tool |
| `.github/workflows/` | Check (pull requests), Database (apply schema.sql), Release (tag + notes) |
| `config.js` | Supabase URL + anon key + Drive service URL |
| `supabase/schema.sql` | tables, row-level security, roles, all business rules (crm_* functions) |
| `Code.gs` | Apps Script: Google Drive file service (+ add users) |
| `src/*.js` | modules embedded in index.html: itemid, bq-read, tender-info, bqty-read (as-built), revision, procure-std (Procurement standards: IDs, zones, phones, de-dup, templates) |
| `test/` | `node test/t_procure.js` (Procurement helpers; the parts using Gemz's workbooks need local fixtures from `test/make_fixture.py`, never committed) · `bash test/db/run.sh` (schema.sql twice on a local PostgreSQL + crm_* procurement tests; also run by the Check workflow) |
| `Breakdown_QTY_Template.xlsx` | standard site measurement template |

## What it does
- Register of all tenders (T01…), search, filters, Excel export; add / edit; status; **Lock BQ** at submission; bid results.
- Import a priced workbook as a tender (file stored in Drive).
- **Rationalized BQ**: revisions R1, R2 … (draft editor or workbook import), changes, approval record (both parties, letter ref, signed document), void with reason, tender sum history, rationalization statement PDF.
- **As-built**: Breakdown QTY import, matching check, Report 1 As-Built BQ, Report 2 Tendered vs Rationalized vs As-Built, Excel / PDF.
- **Dashboard**: pipeline, won value after rationalization, win rate, closing soon, revisions waiting, won projects vs as-built.
- **BQ Library**: every priced BQ line across tenders with rate history (min / median / avg / max / latest, won vs lost, by client, chart).
- **Masterlist**: the pricing masterlist Google Sheet, read only (Rates + Resources), with History links into the BQ Library.
- Reports and charts; activity log with the user's name; read-only mode from an .xlsx copy.
- **RFQ (v3.1.2)**: New RFQ (fill-in item table / paste / import), supplier shortlist by category + urgency zones, send list with one-click Roundcube Email + WhatsApp (click log), chase today, statuses, RFQ PDF, RFQ reports.
- **Procurement (v3.1.0)**: supplier database (SUP-0001…, contacts, categories, sourcing zones, verification), review queue for AI-found suppliers (offline + DNS checks, duplicates, approve / merge / reject), one-click Email (Roundcube) / WhatsApp / Call, Excel export; Company & settings (letterhead + logo, approval addressee, public holidays).
