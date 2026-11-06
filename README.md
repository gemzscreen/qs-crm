# ARZA QS CRM SYSTEM — v2.0.0 (v2: rationalized BQ)

**Updating to v2.0.0:**
1. GitHub Pages: replace `index.html` (keep `Breakdown_QTY_Template.xlsx` beside it).
2. Apps Script: paste the new `Code.gs` over the old one, save.
3. Deploy › Manage deployments › Edit › Version: New version › Deploy (same URL). No new permissions needed.
4. Nothing to add in the sheet: on the first call the script adds the **Revisions** tab and the `contract_sum` / `contract_rev` columns on Tenders.
5. **Do not keep `QS_CRM_DB.xlsx` in this repo** — the repo is public and that file holds priced BQ lines. Delete it here and keep it in Google Drive (it is only needed for the first setup and the read-only mode).

**Rationalization workflow:** lock the tendered BQ at submission → Rationalized BQ › **+ New revision** (copy of the tendered BQ) or **Import revision workbook** → edit qty / rate, omit or add items (added IDs: `B1.1.X1`, `B4.X1`, `C.X1`) → Save draft → Changes → **Approval record** (date, both parties, letter ref, signed document) → R1 is locked and becomes the contract BQ. As-built Report 2 then shows Tendered | Rationalized | As-Built.

**As-built workflow:** Tenders › import the priced workbook (gives the tendered BQ) → As-built › pick the tender › Import Breakdown QTY (standard template or the old MOE layout) → check Matching check → Report 1 / Report 2 → Excel or PDF / Print.

**Workbook file name (recommended):** `Priced BQ Estimate - <client ref> Tender <n> - <Mon YYYY> rev<k>.xlsx`
e.g. `Priced BQ Estimate - JKR-DBSBM021-2026 Tender 11 - Nov 2026 rev0.xlsx`. "Tender 11" becomes T11 when that number is free; everything else is read from the workbook (Tender Info + B-sheets).

## Setup (about 10 minutes, once)

1. **Make the Google Sheet.** Upload `QS_CRM_DB.xlsx` to Google Drive → open it → *File › Save as Google Sheets*. Rename the new file **QS CRM DB**. Keep it private (do not share).
2. **Time zone.** In the sheet: *File › Settings › Time zone* = (GMT+08:00) Brunei.
3. **Add the API.** *Extensions › Apps Script*. Delete the sample code, paste all of `Code.gs`, save. In *Project Settings* (gear) set the time zone to Asia/Brunei too.
4. **Set your password.** In `setPassword()` replace `CHANGE-ME` with your own password (8+ characters). Select `setPassword` in the toolbar and click *Run* (allow the permissions — it is your own script). Then put `CHANGE-ME` back and save. The password is kept as a hash in Script Properties.
5. **Deploy.** *Deploy › New deployment › Web app* — Execute as **Me**, Who has access **Anyone** → *Deploy*. Copy the URL ending in `/exec`.
   "Anyone" is needed so the page can call it; every call still needs your password.
6. **Publish the page.** Put `index.html` in a GitHub repo (e.g. `qs-crm`) → *Settings › Pages* → deploy from `main` / root. Open the Pages URL, paste the `/exec` URL and password → *Sign in*.

After changing `Code.gs`: *Deploy › Manage deployments › Edit (pencil) › Version: New version › Deploy* (URL stays the same).

## What it does
- Register of all tenders (T01, T02 … = primary key), search, filters (status, client group, type, year), sort, export to Excel.
- Add / edit tenders; next T number is assigned on save.
- Status Prospect → Pricing → Submitted → Won / Lost / Cancelled / No bid.
- **Lock BQ** at submission: freezes our sum and the ID scheme; unlocking needs a reason (logged).
- **Bid result**: winner, winning sum, result date, source; % difference (ours vs winner) computed.
- BQ tab: tendered BQ lines and amount per bill, checked against our sum, and the tender sum history.
- Rationalized BQ: revisions R1, R2 … with approval record, changes, sum history, rationalization statement (PDF) and Excel.
- As-built: Breakdown QTY import, matching check, Report 1 As-Built BQ, Report 2 Tendered vs Rationalized vs As-Built.
- Every change is written to the **Log** tab.
- No setup needed to look: *Open QS_CRM_DB.xlsx (read-only)* on the sign-in page reads the file in the browser only.

## Files
| File | Purpose |
|---|---|
| `index.html` | the app (one file; SheetJS from CDN for Excel) |
| `Code.gs` | API on the Google Sheet |
| `src/*.js` | modules embedded in index.html: itemid, bq-read, tender-info, bqty-read (as-built), revision (v2) |
| `QS_CRM_DB.xlsx` | DB seed (10 tenders, 386 priced BQ lines) — keep it private, not in this repo |
