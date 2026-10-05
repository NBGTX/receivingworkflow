# Handoff: Paperless Steel Receiving Workflow (DocuWare) — Nucor Building Systems Texas (Terrell, TX)

*Prepared 2026-10-05 from a Cowork design/build session. Paste this into Claude Code as context.*

## Goal
Replace the paper inspection process on the receiving dock with a paperless workflow in **DocuWare** (Configuration console + Workflow Manager), used on **Android tablets** (DocuWare Web Client in browser). Build is done by hand in the DocuWare UI; Claude's role is guidance, expressions/scripts, and keeping the design docs current.

## Source documents (in the project folder)
- `Steel_Receiving_Workflow_Outline_Paperless.md` — the full design and build checklist (kept current; this handoff summarizes it).
- `steel_receiving_workflow_mockup.html` — visual flowchart of the 10 steps, color-coded by actor.
- Five paper inspection sheet PDFs (Coil, Flat Sheet, Flat Bar, Beam/Channel/Angle, Rod/Pipe/Tube) plus two real multi-PO / multi-sheet packet examples (Berkeley, Delta).

## Current-state process
- Receiving Coordinator merges BOL + MTR + PO into one PDF in Bluebeam, types the Coil Card # (CC#) next to each BOL line item, and sends it to a folder that ingests into the DocuWare **Steel Packing Slip** tray.
- BOL layouts vary by mill/carrier, so indexing uses DocuWare **click-to-index** (no fixed template).
- Paper remains only at the dock: print packet, hand-fill one of five sheet types, scan back in.

## Target workflow (10 steps)
1. Coordinator builds packet in Bluebeam.
2. Packet indexed (click-to-index) — header fields + table field; storing triggers workflow Start.
3. **Workflow A**: Assign Data builds pre-filled links to the five inspection Forms for every distinct PO# on the packet; **one Task per packet (per BOL#)** to the Receiving Team's tablets, links grouped by PO#.
4. Receiving Team inspects and submits form(s): one submission per PO# per material type; multiple items of the same type = extra table rows in one form.
5. **Workflow B** (fires per form submission): Assign Data does a File Cabinet lookup (WHERE BOL# = form's pre-filled BOL#) to find the packet's doc ID; Web Service activity calls `PUT /FileCabinets/{FileCabinetId}/Operations/ProcessDocumentAction?docId={DocId}` to **Clip** (not Staple) the form onto the packet.
6. Receiving Team closes the task with an explicit "Inspection Complete" decision.
7. Task routes to John Boothe, Lonnie Segovia, Jessica Parsons, and the Receiving Coordinator.
8. Coordinator receives in D365 (manual, external).
9. Coordinator applies Authorize stamp/decision.
10. Workflow files the packet to Quality documents.

Key design decisions already made: five separate Forms (not one combined); tolerance tables shown as Image elements on the forms (not retyped into fields); one inspection form submission per PO# (Finance, BOMBS net, and Quality all organize by PO#); one BOL per packet (BOL# is header-level); Pre-fill supports header fields only, not table fields; PO#, Heat#, mill coil#/LPN#, CC#, MTR#, weight live in a **table field** (one row per coil) because one BOL can carry multiple POs/MTRs; each table column must be a searchable index field.

## What was learned this session (new)
- The Steel Packing Slip tray files into **[NBGTX] - Accounts Payable**, a shared multi-purpose cabinet (confirmed intentional by the user). There is no dedicated Steel cabinet.
- Existing fields on that cabinet (all flat — **no Table-type field exists yet**): PO# (Text 50), Vendor ID, Document#, Check#, **Doc Type** (Text 50), Date, **BOL#** (Text 50), Due Date, Document Name, Receiver#, Name, Autoindex Status, Status, Status Notes, Assigned To, Terms, Amount, Company, Job#, My List, GP Status, Discount Date, Fulltext, Stored Date, NBS# (255), Mill # (255), **Heat #** (255), Department, Location, PO Status, Received On (DateTime), Buyer, Journal Batch Number.
- `Doc Type` is probably the discriminator between steel packets and AP documents (needed for searches and to scope workflow triggers) — **value used for steel packets not yet confirmed**.
- **Missing entirely**: CC#, MTR#, weight (and possibly ship date).

## Open items / next actions
1. **Naming conflict**: flat `PO#` and `Heat #` already exist, but the design needs them as per-row table columns. Plan: test in Configuration whether DocuWare accepts table columns named `PO#`/`Heat #`; if it rejects duplicates, give the columns distinct names. **Default: leave the existing flat fields untouched** (shared production cabinet; unknown dependencies).
2. User is checking real indexed steel packets in the Web Client (search NBGTX Accounts Payable, open index panel) to learn what `Doc Type`, `Mill #`, `Date`, `Vendor ID`, `PO#`, `Heat #` actually contain, ideally including a multi-PO packet like the Berkeley example. Unknowns this resolves: does `Mill #` = mill coil/lot number or mill identifier; is `Date` the ship date; is `Vendor ID` enough or is vendor name needed; how multi-PO packets are indexed today.
3. Then: add header fields as needed (ship date, vendor name if wanted), add the table field and columns (PO#, Heat#, mill coil#/LPN#, CC#, MTR#, weight), mark columns searchable.
4. Remaining Phase 1: build five Forms (header + repeating table, tolerance image, pre-fill enabled with PO#/BOL#/vendor/date read-only, store dialog mapped to this cabinet); confirm Web Client access for Receiving Team, Coordinator, and MTR group; confirm the Quality documents destination exists.
5. Phase 2: Workflow A (assign task, Inspection Complete decision, route to MTR group, authorize, store to Quality), Workflow B (clip per submission); publish and test with a real packet.
6. Still open from earlier: origin of the CC# (physical card vs assigned); confirm Workflow Manager task/stamp experience works fully in the tablet browser (older native app doesn't support stamps with input fields); F1-type general receiving stays out of scope; Workflow Manager build must go through internal support.

## Where Claude Code could help
Likely candidates: drafting the Assign Data expressions for the distinct-PO# loop and grouped pre-filled form-link text; building and testing the `ProcessDocumentAction` Clip call (request body, auth) against the DocuWare Platform API; scripts to prepare the cropped tolerance-table images (<5MB PNG/JPG) from the five sheet PDFs; keeping the outline and mockup in sync with decisions.

## Constraints
- Nucor org guidance: authentication should be Entra ID where applicable; Nucor architecture guidance was offered and **declined** by the user (DocuWare is a separate platform) — do not re-raise.
- Nucor Brand Kit applies if producing branded deliverables for an audience; not needed for internal working docs.
