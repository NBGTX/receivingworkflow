# Daily Steel Receiving — Paperless Workflow (Android Tablets + DocuWare)

## Current-state facts (confirmed)
- The Receiving Coordinator assembles the packet: BOL + MTR + PO merged into one PDF in Bluebeam.
- The Receiving Coordinator types the Coil Card # (CC#) directly onto the BOL in Bluebeam, next to each line item.
- BOL layout varies by mill/carrier, so any indexing approach has to tolerate different layouts rather than assume a fixed template.
- The finished Bluebeam PDF is emailed to the Receiving group email and sent to a folder that ingests into the Docuware Steel Packing Slip tray.
- **Confirmed**: the Steel Packing Slip tray files into the **[NBGTX] - Accounts Payable** file cabinet, not a dedicated Steel cabinet. This is intentional — NBGTX Accounts Payable is a shared, multi-purpose cabinet used for more than just AP invoices. Any references below to "the Steel file cabinet" mean this cabinet.
- **Confirmed**: the cabinet's current field list already has several fields relevant to this design: `Doc Type` (likely the discriminator between Steel Packing Slip and AP invoice/other types — need to confirm the value used for Steel packets), `PO#`, `Heat #`, `BOL#`, `Mill #`, `NBS#`, `PO Status`, `Received On`, `Vendor ID`, `Date`, plus AP-only fields (Check#, Amount, Terms, Discount Date, GP Status, Journal Batch Number, etc.) that don't apply to steel. No Table-type field exists yet on this cabinet — everything currently defined is flat (Text/Date/Numeric/DateTime), one value per document.
- **Open conflict**: `PO#` and `Heat #` already exist as flat, one-value-per-document fields — but this design needs both to be per-line-item (table) values, since a single BOL/packet can carry multiple POs and multiple heats (confirmed Berkeley and Delta examples above). DocuWare field names must be unique per cabinet, so the new table's columns can't reuse the literal names `PO#`/`Heat #` as-is. Needs a decision: keep the old flat fields (retired, renamed, or repurposed) and give the table columns distinct names, or confirm nothing else depends on the flat fields and free the names up. Also unconfirmed: how multi-PO/multi-heat packets are indexed today given only flat fields exist — possibly not handled at all yet, which would explain why this project exists.
- **To confirm**: `Mill #` — is this the mill's coil/lot number (i.e., our "mill coil number/LPN#") or an identifier for which mill supplied the material? `Date` — is this ship date, or something else (e.g., invoice date)? Is `Vendor ID` sufficient for the "vendor" header field, or is a vendor name also needed?
- **Still missing** from the field list entirely: CC# (Coil Card #), MTR#, weight. Ship date may already exist under a different name (see `Date` question above).

## Where paper still exists
Only on the Receiving Team's side at the dock: printing the packet, printing one of the five paper inspection sheet types (Coil, Flat Sheet, Flat Bar, Beam/Channel/Angle, Pipe/Rod/Tube), filling it by hand, and scanning the completed packet back in.

## Indexing the packet in Docuware
Because layouts vary by mill and can't be assumed fixed, use DocuWare's **click-to-index**: the Receiving Coordinator (or whoever indexes the document on upload) clicks each value directly on the displayed PDF and it's captured into the matching index field — no fixed-position template required, and it works the same whether the value came from the mill or from the Receiving Coordinator's Bluebeam typing.

Index field structure needed:
- **Header fields** (one value per document): BOL #, vendor, ship date.
- **Table field** (multiple rows per document): PO #, Heat #, mill coil number/LPN #, CC#, MTR #, weight — one row per coil/line item. PO # has to live in the table, not the header, because a single BOL can carry more than one PO (confirmed example: PO TX-0015373 and TX-0015478 both on one Berkeley BOL, with different line items belonging to each). MTR # also has to live in the table rather than the header, since one BOL can bundle multiple MTR documents (one per heat/lot). Keeping all of these per-row preserves the correct combination for each coil even when they don't match across the document.

**Resolved**: one BOL per packet. BOL # stays a header-level field (one value per document), and the table field doesn't need to carry BOL # as a row-level value.

## Search requirements
Whoever looks this up later needs to search by any of: PO #, BOL #, Heat #, mill coil number, CC#, or MTR # — not just the one they happen to remember. Since these live as table-field columns rather than fixed header fields, make sure each is set up as a searchable index column in the file cabinet, not just a value inside the table for display. This applies to both the merged BOL/MTR/PO packet and the inspection form submissions, so a search on any of these values surfaces the right documents regardless of which one the field started on.

**Resolved**: keep one inspection form submission per PO #, even when a load's material type and BOL are shared across POs. Splitting by PO is how the business tracks things downstream: Finance pays by PO, jobs are tracked in BOMBS net by PO#-to-job# association, and Quality also organizes by PO#. Each form still supports multiple line items/rows for that one PO, same as today.

## Workflow: start to finish

**1. Build the packet (Receiving Coordinator, office)**
Merge BOL + MTR + PO into one PDF in Bluebeam, type the CC# next to each line item, and send the finished PDF to the folder that ingests into the Docuware Steel Packing Slip tray.

**2. Index the packet (Docuware)**
Click-to-index captures the header fields (BOL#, vendor, ship date) and the table field (PO#, Heat#, mill coil#, CC#, MTR#, weight — one row per line item). Storing the document triggers the workflow's Start.

**3. Workflow assigns one task per packet (Receiving Team, tablet)**
An **Assign Data** activity builds a pre-filled link to each of the five inspection Forms for every distinct PO # on the packet — PO#, BOL#, vendor, and date embedded as read-only header values (DocuWare's Pre-fill feature doesn't support Table fields, so only these header values are pre-filled, not the line-item table). One task per packet (per BOL#) goes to the Receiving Team's tablet — the physical unit of work is one truck, one packet — showing the packet plus all the pre-filled form links grouped by PO#. This replaces email to the Receiving Team entirely — the task is how they find out there's work to do.

**4. Inspect and submit form(s) (Receiving Team, tablet)**
They review the packet on-screen, physically inspect the material, and open whichever form(s) match what's actually on the truck — checking values against the attached tolerance-table image (see "Keeping reference tables visible during inspection" below). Multiple items of the same type go in as extra table rows within one form; different material types, or different POs on the same packet, mean separate form submissions. They can submit as many forms as the load needs — see "Handling multiple inspection sheet types per packet" below.

**5. Each submission clips back to the packet immediately (Docuware)**
Every form submission independently triggers a small workflow, built from two standard Workflow Designer activities:
1. **Assign Data** activity — a File Cabinet lookup with a WHERE clause matching the form's pre-filled BOL# finds the original packet and stores its document ID in a global variable. Since it's confirmed one BOL per packet, BOL# alone is enough to find the right document — PO# rides along on the form as its own searchable field but isn't needed for this lookup.
2. **Web Service** activity — calls the DocuWare Platform API endpoint `PUT /FileCabinets/{FileCabinetId}/Operations/ProcessDocumentAction?docId={DocId}` to Clip the submitted form onto that document.

This uses **Clip** rather than **Staple**, so each document keeps its own index values fully intact and searchable while opening/scrolling together as one set. This happens per-submission, not waiting for all expected forms to be done.

**6. Receiving Team marks the task complete (tablet)**
Once they've submitted every form the load needs — across every PO on the packet — they close out their one task with an "Inspection Complete" decision — this explicit action is what signals "done," since the workflow has no way to know in advance how many forms a given packet requires.

**7. Route to the MTR group (Docuware)**
Closing the task moves the now fully-clipped packet to a task for John Boothe, Lonnie Segovia, Jessica Parsons, and the Receiving Coordinator.

**8. Receive in D365 (Receiving Coordinator)**
Separate system, unchanged — done manually against the PO.

**9. Authorize (Receiving Coordinator)**
Reviews the completed set and applies an authorization stamp/decision in Docuware.

**10. File to Quality documents (Docuware)**
Workflow files the authorized, complete packet automatically.

Building this as an actual Workflow Manager process (rather than manual search or basic Notifications) is a deliberate choice: the receiving dock users are non-superusers on tablets — they need a task that shows up and tells them what to do next, not a search skill. This does mean getting a Workflow Manager process built through internal support — treated as a committed project requirement, not something to defer.

## Handling multiple inspection sheet types per packet
A single load can require more than one of the five sheet types, each with multiple line items. Real example (PO TX-0016400, Delta Steel): one packet needed a Beam/Channel/Angle sheet (2 rows: CC# 161794 wide flange, CC# 161795 channel) and a separate Pipe/Rod/Tube sheet (2 rows: CC# 161792 and CC# 161793, both tube). All four line items belonged to the same BOL/PO.

Design to match this:
- Keep the five sheet types as five separate DocuWare Forms (Coil, Flat Sheet, Flat Bar, Beam/Channel/Angle, Pipe/Rod/Tube) rather than one combined form — conditional logic can hide/show fields but doesn't cleanly support a table where each row needs different columns.
- Each form's data section is a repeating table field, so multiple line items of the same type (like the two tube rows above) are multiple rows in one form submission, not multiple submissions.
- The static tolerance tables at the bottom of each paper sheet (coil size constraints, pipe/rod min-max, etc.) don't need to become form fields — they're reference-only and don't vary by load.

## Keeping reference tables visible during inspection
Each paper sheet has a reference section at the bottom (Coil Size Constraints / Panel Material / Black Steel on the Coil sheet; min/max tables on Flat Bar, Flat Sheet, Beam/Channel/Angle, and Pipe/Rod/Tube) that the inspector checks measurements against. DocuWare's Forms designer supports an **Image** element (up to 5MB, PNG/JPG) and a **Fixed Text** block for exactly this kind of static content. The simplest approach: crop each paper sheet's reference table into an image and place it on that same form, below the data-entry table — same position as today, just on-screen instead of printed. No retyping tolerance values into fields (which would risk introducing errors into quality data) — it's just the existing table, displayed on the tablet.

## Build checklist

**Phase 1 — everything except the workflow**

Index fields (on the **NBGTX - Accounts Payable** file cabinet — confirmed this is the Steel Packing Slip tray's target, and it's a shared multi-purpose cabinet, not a dedicated Steel cabinet):
- [ ] Confirm whether a Document Type (or equivalent) field already exists to distinguish Steel Packing Slip documents from AP invoices and other document types in this cabinet; add one if not.
- [ ] Confirm/add header fields: BOL#, vendor, ship date.
- [ ] Confirm/add a table field with columns: PO#, Heat#, mill coil number/LPN#, CC#, MTR#, weight.
- [ ] Mark each table column as a searchable index field, not just a display value.

Five inspection Forms (Coil, Flat Sheet, Flat Bar, Beam/Channel/Angle, Pipe/Rod/Tube):
- [ ] Build each form with fields matching its paper template (header fields + a repeating table field for line items).
- [ ] Add each form's tolerance-table image (Image element) below the data-entry table.
- [ ] On each form's Submission tab, enable "Allow the form to be pre-filled," and mark the PO#/BOL#/vendor/date fields Read-Only.
- [ ] Configure each form's store dialog — target file cabinet, and map submitted form fields to the file cabinet's index fields.

Access:
- [ ] Confirm the Receiving Team, Receiving Coordinator, and MTR group (John Boothe, Lonnie Segovia, Jessica Parsons) have Docuware Web Client access from the tablets (browser, not the older native app).
- [ ] Confirm the Quality documents destination (file cabinet or tray) exists.

**Phase 2 — the workflow**

Workflow A — assign the task:
- [ ] Trigger: Start → new document in the Steel Packing Slip tray.
- [ ] Assign Data activity: loop through the packet's table field to get the distinct PO# list, and build the grouped, pre-filled form-link text (one link per form per PO#) for the task instructions.
- [ ] Task activity: assign to the Receiving Team, showing the packet plus the grouped links — one task per packet (per BOL#).
- [ ] Task decision: "Inspection Complete" on that same task.

Workflow B — clip each submitted form:
- [ ] Trigger: Start → new document, condition "created by Form X" (repeat per form, or filter by document type in one shared config).
- [ ] Assign Data activity: File Cabinet lookup, WHERE BOL# = the form's pre-filled BOL#, to find the original packet and store its document ID.
- [ ] Web Service activity: call the Docuware Platform API's `ProcessDocumentAction` endpoint to Clip the form onto that document.

Workflow A, continued — after "Inspection Complete":
- [ ] Task activity: route the fully-clipped packet to the MTR group (John Boothe, Lonnie Segovia, Jessica Parsons, Receiving Coordinator).
- [ ] Task activity/decision: Receiving Coordinator receives in D365 (manual, external), then applies the Authorize stamp/decision.
- [ ] Store/File Cabinet activity: move the authorized packet to Quality documents automatically.

- [ ] Publish both workflow configurations and test end-to-end with a real packet before rolling out to the tablets.

## Still open
- Where the CC# itself originates (a physical tag/card the Receiving Coordinator reads, or a number they assign) — doesn't affect the indexing design since it's typed text either way, but matters if you ever want to explore barcode-scanning it in later.
- Whether tablets use the Docuware Web Client (browser) or a native app for workflow tasks/stamps — the older native mobile app doesn't support stamps with input/index fields, so confirm the tablet's Workflow Manager task experience works fully through the browser.
- F1-type general receiving (non-coil vendors) stays outside this workflow.
- Getting the Workflow Manager process actually built through internal support — flagged earlier as a real hurdle, now treated as a committed requirement rather than something to design around.
