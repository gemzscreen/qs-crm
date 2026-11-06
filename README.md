# ARZA QS CRM SYSTEM — v2.1.0 (Supabase)

Tender register, priced BQs, rationalized revisions, bid results and as-built reports for ARZA SDN BHD.
**Data:** Supabase (PostgreSQL, sign-in, roles). **Files:** Google Drive (Apps Script file service). **Masterlists:** Google Sheets (pricing, inventory).

## Move to Supabase (about 30 minutes, once)

### 1. Supabase project
1. https://supabase.com › sign in with Google › **New project**. Name `qs-crm`, a strong database password (keep it), **Region: Southeast Asia (Singapore)**. Free plan.
2. **SQL Editor › New query** › paste all of `supabase/schema.sql` › **Run**. (Safe to run again after updates.)
3. **Authentication › Sign In / Providers › Email**: keep Email on; turn **"Allow new users to sign up" OFF** (only the admin adds people).
4. **Authentication › URL Configuration › Site URL**: your app address (e.g. `https://qs.yourdomain.com`) — used by the password-reset link.
5. **Authentication › Users › Add user › Create new user**: your email + password, tick **Auto Confirm User**. The first account becomes **admin** automatically.
6. **Project Settings › API**: copy the **Project URL** and the **anon public** key (and, only for step 2, the **service_role** key — keep it secret).

### 2. Drive file service (Apps Script)
1. Open your existing Apps Script project (or script.google.com › New project), replace all code with `Code.gs`.
2. In `setSupabase()` paste the Project URL, anon key and (optional, to add users from the app) the service_role key › Run › allow permissions › put the `PASTE-…` texts back › Save.
3. Run `setDriveFolder()` (paste your Drive folder link, or leave it to create "QS CRM - Tenders"). Same folder as before = existing tender folders are reused.
4. **Deploy › Manage deployments › Edit › Version: New version › Deploy** (or New deployment › Web app › Execute as Me › Anyone). Copy the `/exec` URL.

### 3. Website (GitHub Pages)
1. Fill `config.js`: `supabaseUrl`, `supabaseKey` (anon), `driveUrl` (/exec). **Never put the service_role key in config.js.**
2. Upload `index.html`, `config.js`, `Breakdown_QTY_Template.xlsx` to the repo (replace the old files).
3. **Delete `QS_CRM_DB.xlsx` from the public repo** (it holds priced BQ lines).

### 4. Move the data
1. Google Sheet **QS CRM DB** › File › Download › Microsoft Excel (.xlsx).
2. Sign in to the app as admin › **Users** › *Choose QS CRM DB.xlsx…* › Import. Check the register shows all tenders.
3. Keep the Google Sheet as an archive (it is no longer updated).

### 5. Add people
**Users › + Add user** (email, name, role, temporary password) — needs the service key in step 2; otherwise add them in Supabase › Authentication › Users (Auto Confirm) and set the role on the Users page.
Roles: **admin** — users + everything · **qs** — all changes · **viewer** — read only (ARZA management, client). pm / site are for the v7 site modules (read only until then).
Everyone can change their password by clicking their name (top right). Forgot password sends a reset link by email.

## Free plan notes
- Free projects **pause after 7 days without use** (data kept; restore with one click in the Supabase dashboard). Normal weekly use keeps it awake.
- No automatic daily backups on Free: export the register / reports to Excel regularly, or move to **Pro (US$25/month)** for daily backups and no pausing once ARZA relies on it.

## Files
| File | Purpose |
|---|---|
| `index.html` | the app (one file; SheetJS + supabase-js from CDN) |
| `config.js` | Supabase URL + anon key + Drive service URL |
| `supabase/schema.sql` | tables, row-level security, roles, all business rules (crm_* functions) |
| `Code.gs` | Apps Script: Google Drive file service (+ add users) |
| `src/*.js` | modules embedded in index.html: itemid, bq-read, tender-info, bqty-read (as-built), revision |
| `Breakdown_QTY_Template.xlsx` | standard site measurement template |

## What it does
- Register of all tenders (T01…), search, filters, Excel export; add / edit; status; **Lock BQ** at submission; bid results.
- Import a priced workbook as a tender (file stored in Drive).
- **Rationalized BQ**: revisions R1, R2 … (draft editor or workbook import), changes, approval record (both parties, letter ref, signed document), void with reason, tender sum history, rationalization statement PDF.
- **As-built**: Breakdown QTY import, matching check, Report 1 As-Built BQ, Report 2 Tendered vs Rationalized vs As-Built, Excel / PDF.
- Reports and charts; activity log with the user's name; read-only mode from an .xlsx copy.
