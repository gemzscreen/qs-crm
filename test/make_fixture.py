# Builds the local JSON fixtures for t_procure.js from the original workbooks (supplier data - NOT committed, see .gitignore).
#   python3 -I test/make_fixture.py rfq    "RFQ-2611-002_SS304_Railing_Tubes_-_Supplier_Send_List.xlsx" test/fixtures/rfq002.json
#   python3 -I test/make_fixture.py aircon "Aircon_Materials_Suppliers_Directory-v2.xlsx"               test/fixtures/aircon.json
import sys, json, os, openpyxl
kind, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
wb = openpyxl.load_workbook(src)
if kind == 'rfq':
    ws = wb['Discovery (import)']
    rows = list(ws.iter_rows(values_only=True)); h = rows[0]
    disc = [{k: (v if v is not None else "") for k, v in zip(h, r)} for r in rows[1:]]
    sl = wb['Send List']; links = []
    for r in range(5, 5 + len(disc)):
        e, w = sl.cell(r, 11).hyperlink, sl.cell(r, 12).hyperlink
        links.append({"name": sl.cell(r, 4).value, "email_link": e.target if e else None, "wa_link": w.target if w else None})
    text = {r[0]: r[1] for r in wb['RFQ Text'].iter_rows(values_only=True)}
    out = {"discovery": disc, "links": links, "text": text}
else:  # Gemini directory: header on row 3; country sheets have no Country column
    out = {}
    for ws in wb:
        rows = list(ws.iter_rows(values_only=True)); h = rows[2]
        out[ws.title] = [{k: v for k, v in zip(h, r) if k} for r in rows[3:] if any(r)]
        if ws.title != 'All Suppliers':
            for r in out[ws.title]: r['Country'] = ws.title
os.makedirs(os.path.dirname(dst) or '.', exist_ok=True)
json.dump(out, open(dst, 'w'), indent=1, default=str)
print(kind, "fixture written:", dst)
