# Steel Receiving Web App — Plan

Replaces DocuWare Forms + Workflow Manager + Web Client for steel receiving (Nucor Building Systems Texas, Terrell). DocuWare stays as final archive: manual upload + tag of finished packet.

## Scope

In: packet intake with click-to-index, task inbox per packet, five inspection forms, routing/approval, final export bundle for DocuWare.
Out: D365 receive (manual, external), F1-type general receiving, DocuWare API integration.

## Workflow (maps to old 10 steps)

| # | Step | Actor | App feature |
|---|------|-------|-------------|
| 1 | Build packet (BOL+MTR+PO) in Bluebeam | Coordinator | Upload PDF |
| 2 | Index packet | Coordinator | Click-to-index screen |
| 3 | Create task, links grouped by PO# | System | Auto on save |
| 4 | Inspect, submit form per PO# per material type | Receiving Team | Tablet forms, pre-filled |
| 5 | Attach form to packet | System | DB relation (no Clip hack) |
| 6 | Inspection Complete | Receiving Team | Explicit button, blocks if PO has no form |
| 7 | Review | Boothe, Segovia, Parsons, Coordinator | Review queue, approve/return |
| 8 | Receive in D365 | Coordinator | Checkbox + D365 receipt# field |
| 9 | Authorize | Coordinator | Approve w/ name + timestamp |
| 10 | Close and export | System | Merged PDF + index CSV for DocuWare upload |

## Data model

- **Packet**: id, bol_no (unique), vendor, ship_date, carrier, pdf_file, status, created_by, created_at
- **PacketRow**: packet_id, po_no, heat_no, mill_coil_no, cc_no, mtr_no, weight
- **Inspection**: id, packet_id, po_no, material_type (coil|flat_sheet|flat_bar|shapes|rod_pipe_tube), header JSON, submitted_by, submitted_at
- **InspectionRow**: inspection_id, item fields per type, measurements, pass/fail
- **Task / Event log**: packet_id, step, actor, decision, timestamp, note
- **User**: Entra ID oid, name, role (coordinator | receiving | reviewer)

## Click-to-index design

- PDF.js renders page; text layer gives word boxes. Click word or drag across words, text fills focused field, focus advances.
- Picked words highlighted on page; click highlight jumps to field.
- Table: add row, tab across cells; same pick behavior.
- Scanned page (empty text layer): drag rectangle, crop canvas, Tesseract.js OCR.
- Regex suggestions (BOL#, PO#, Heat#) as one-click chips. Later: remember layout per vendor.
- Typing always allowed. Duplicate BOL# warning.

## Stack (proposed, confirm)

- Frontend: React + PDF.js, responsive, tablet-first for inspection screens
- Backend: Python FastAPI or Node, Postgres (SQLite for pilot), files on shared drive/Blob
- Auth: Entra ID (MSAL) before production; roles from AD groups
- Hosting: TBD (Azure App Service vs internal server)
- No LLM needed. If added later: Azure AI Foundry, managed identity.

## Phases

1. **Prototype** (this mockup): intake click-to-index, inbox, one form. Validate with real packets.
2. **MVP**: backend + DB, upload, all 5 forms, task routing, review/authorize, export bundle. Local auth stub.
3. **Production**: Entra ID, hosting, audit log, email notify, backups, user training.

## Open questions

1. Hosting location and tablet network reach
2. Real sample PDFs (Berkeley, Delta, one scanned BOL) to test text layers
3. CC# origin: physical card or system-assigned
4. Authorize: name+timestamp OK, or stamp on PDF
5. Email notification needed
6. DocuWare fields required at manual upload (drives export CSV columns)
7. Five sheet PDFs needed to build exact form fields

## Findings from real samples (2026-10-05)

- All sample PDFs are image scans: zero text layer (pdftotext = 0 chars). OCR is required, not a fallback. Plan: PDF.js renders page, user drags box, Tesseract.js OCRs that crop. Type-in always allowed.
- Pages arrive rotated (MTRs, scanned inspection sheets sideways). Viewer needs rotate buttons per page, saved with packet.
- Packet order: BOL, MTR page(s), PO page(s). PO#, vendor ID, PO date are printed on the PO page ("PO Number:", "Vendor: V000xxx").
- PO# is also on the BOL: Arkansas BOL "CUST ORDER NO" column (TX-0013183), Berkeley BOL "Cust. PO#" column (TX-0015373 x5, TX-0015478 x1). One BOL, two POs confirmed.
- CC# varies by packet: handwritten beside heat line (Arkansas coil BOL, e.g. 156832) or typed "CC# 161886" (Berkeley). Handwriting OCR is unreliable, so manual typing must be fast.
- Inspection sheet column "NBS#" holds the CC#. Same value as existing DocuWare NBS# field. CC# = NBS#.
- Heat# repeats across rows (Berkeley: 1612252 on 3 bundles). Table rows are per bundle/coil, not per heat.
- Coil BOL: coil# is 2115023.1000 style, three coils share heat 2157562, weights per coil.
- Beam sheet columns: Heat#, Description, NBS#, Qty Rec/BOL, Depth, Width, Visual Insp, Thickness, Sweep/Camber, Comments, Cert. Coil sheet: Coil#, Heat#, Description, NBS#, I.D., O.D., Gauge, Width, Color, Comments. Header: PO#, Vendor, Inspector, Date.
- Vendor name on BOL (Nucor Steel Arkansas) differs from PO vendor (Nucor Hickman, V000160). Pick one source; PO page recommended.
