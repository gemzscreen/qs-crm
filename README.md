# ARZA QS CRM SYSTEM — v1.3.1

**Updating to v1.3.1 (both files change):**
1. Replace `index.html` on GitHub Pages.
2. Apps Script: paste the new `Code.gs` over the old one, save.
3. Google Drive folder: open your chosen folder in Drive, copy the address bar link, paste it into `setDriveFolder()` in place of `PASTE-FOLDER-LINK`, save, select `setDriveFolder` › Run › allow Drive access. Check View › Logs (Execution log) for "Step 2/3 OK". (Leave PASTE-FOLDER-LINK as is to use a new folder "QS CRM - Tenders" in My Drive.)
   - "An unknown error has occurred": open the sheet in an Incognito/private window signed in ONLY to the account that owns the sheet, then Run again.
4. Deploy › Manage deployments › Edit › Version: New version › Deploy (same URL).

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
- BQ tab: tendered BQ lines and amount per bill, checked against our sum.
- Every change is written to the **Log** tab.
- No setup needed to look: *Open QS_CRM_DB.xlsx (read-only)* on the sign-in page reads the file in the browser only.

## Files
| File | Purpose |
|---|---|
| `index.html` | the app (one file; SheetJS from CDN for Excel) |
| `Code.gs` | API on the Google Sheet |
| `src/itemid.js`, `src/bq-read.js`, `src/tender-info.js` | BQ Item ID rule, BQ reader, tender info reader (used by the import module next) |
| `QS_CRM_DB.xlsx` | DB seed: 10 tenders, 386 tendered BQ lines |
