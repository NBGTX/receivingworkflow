/* "How to use this screen": a collapsed note under each page title. Text lives here so it is easy to edit. */
const HOW={
 login:['Signing in',[
  'Tap your name card, then enter your PIN on the number pad. Your admin sets and resets PINs.',
  'Wrong PIN too many times locks the card for a few minutes. Ask an admin to unlock it.',
  'Admins use <b>Admin sign-in (Windows)</b>. Your Windows account must be on the admin list (Settings, Admins).',
  'You are signed out automatically after a period of no activity.']],
 inbox:['My inbox',[
  'These are packets waiting for inspection on the dock. <b>To inspect</b> is what is open, <b>Mine</b> is what you claimed, <b>Submitted</b> is what you finished.',
  'Open a packet, then tap an inspection type for a PO (coil, flat sheet, flat bar, beam, rod/pipe/tube). One form per PO and material type.',
  '<b>Claim this packet</b> if you want the others to know you are on it. Only one person can have a form open at a time.',
  'When every PO has a submitted inspection, press <b>Inspection complete</b> to send the packet to review.']],
 board:['Packets',[
  'Every packet and where it stands. The number cards count packets in each step. Type in the search box to find a BOL, PO, vendor, heat or CC #.',
  'Tap a row to open the packet. A red time in the last column means it has sat in that step for a day or more.',
  '<b>New packet</b> starts intake: open the BOL PDF, check the details, and send it to the receivers.']],
 dashboard:['Dashboard',[
  'A quick read on the whole flow: packets per week, average time spent in each step, packets stuck for a day or more, and rejects by vendor.',
  'Use <b>Stuck for a day or more</b> as your daily nudge list. Tap a BOL to open it.']],
 'new':['New packet (intake)',[
  '1. <b>Choose PDF files</b> (or drop them on the box) and pick the BOL PDF. Several files are joined into one packet, in the order picked.',
  '2. The page is read automatically. BOL, vendor, ship date, carrier and the item rows fill in. <b>Compare with the PDF</b>: handwriting and poor scans read badly.',
  '3. To fix a field, click it, then drag a box around the right text on the PDF. The dotted pills are other readings you can tap. To fill a whole column, click the first cell of that column in the table, then drag one box around the whole column on the PDF: it fills the rows downward by itself.',
  '4. <b>Check heats against the MTR pages</b> and the saved layouts help with repeat vendors. A saved layout remembers where this vendor puts things.',
  '5. <b>Save and send to receivers</b>. The receivers are emailed once the PDF is stored.',
  '<b>Teaching it a new vendor:</b> the first time a vendor’s BOL comes in, fix any wrong field (or drag a box around the right text). When you save, the app remembers the vendor’s format: which label sits next to the BOL #, ship date and carrier, where you drew boxes, and what the top of the page looks like. The next BOL in that format is recognised on its own and the labelled fields fill in correctly. Digital (typed) PDFs are read from their own text, which is far more accurate than a scan. Make sure the Vendor field holds the vendor’s name before you save, because the format is stored under it.']],
 reviews:['Reviews',[
  'Packets whose inspections are finished and waiting for approval. <b>Waiting for you</b> lists the ones that need your approval.',
  'Open a packet, look at the inspections and the packet PDF, then press <b>Approve</b>. The packet moves on when every named reviewer has approved.',
  'Coordinators can reassign reviewers or skip a review (a reason is required and recorded).']],
 'packet:new':['This packet',[
  'The packet is waiting for inspection. Tap an inspection type under a PO to start. Items of the same material type go in the same form.',
  'Coordinators: use <b>Change reviewers</b> to choose who approves. <b>Delete packet</b> removes the packet, but not once it is filed.']],
 'packet:inspecting':['This packet',[
  'Yellow tiles are drafts or forms someone has open. Green tiles are submitted. Open a green tile to look, or <b>Reopen to edit</b> if it needs a fix.',
  'When every PO has at least one submitted inspection, press <b>Inspection complete</b> to send it to review.']],
 'packet:review':['This packet',[
  'Reviewers: look over the inspections and the packet PDF, then <b>Approve</b>. Everyone listed must approve unless Settings says one is enough.',
  'Coordinators can <b>Reassign reviewers</b> or <b>Skip review</b> when someone is out.']],
 'packet:receive':['This packet',[
  'Reviews are done. Receive the material in D365, type the D365 receipt number, then press <b>Mark received</b>.']],
 'packet:authorize':['This packet',[
  'Check the cover sheet data, then <b>Authorize and file</b>. This builds and stores the final packet PDF and emails the final notification.',
  '<b>Preview final packet</b> shows what will be filed without storing it.']],
 'packet:filed':['This packet',[
  'This packet is filed. <b>Download final packet (PDF)</b> is the one file for DocuWare. Its cover sheet holds every index field as text, so the data can be keyed or indexed from it.',
  '<b>Index data (CSV)</b> is the same fields as a spreadsheet row. <b>Original documents</b> is only the BOL, MTR and PO pages as received.',
  '<b>Reopen packet</b> (coordinators) puts it back to authorize and discards the stored final packet; a new one is stored when you authorize again.']],
 form:['This inspection',[
  'Pick a packet item in <b>Fill from packet item</b> to fill heat, description and CC #, or type them. <b>Add rows from BOL</b> adds one row for every BOL line not inspected yet.',
  'Fill the measurements. Tap <b>OK</b> or <b>Reject</b> on Surface and Visual (a reject sends the team an email when you submit). <b>Cert.</b> is a <b>Yes / No</b> question: is the mill cert with the material.',
  'Use <b>Tolerance tables</b> to check sizes. Yellow boxes warn when a number is out of tolerance; they are advice only and you can still submit.',
  '<b>Scan</b> reads a CC # barcode with the camera. <b>Add photo</b> attaches pictures to a row.',
  '<b>Save draft</b> keeps your work and lets you come back. <b>Discard</b> throws the draft away. A form left blank is not saved. <b>Submit inspection</b> locks it; use <b>Reopen to edit</b> to change it later.',
  'Only one person can have a form open at a time. If someone else has it, you can read it but not change it.']],
 'settings:status':['Status',['A health check of the system: backups, alerts, mail and users. Anything marked as a problem needs attention.']],
 'settings:users':['Users',['These are the receivers, coordinators and reviewers who sign in with a card and PIN. Add people, set their roles and email, and reset or unlock PINs here.','Roles: receiver (does inspections), coordinator (intake and filing), reviewer (approves). One person can have several.']],
 'settings:admins':['Admins',['Admins sign in with their Windows account (domain\\user). Add the account and an email here to give someone admin rights and alert emails.']],
 'settings:email':['Email server',['Enter the SMTP server and sender, then use <b>Send test emails</b>: one of every message type is sent with sample data so you can see how each looks.','Nothing is sent until the server is set up. Failed mail is retried automatically.']],
 'settings:notifs':['Notifications',['Choose who is emailed at each step and edit the subject and wording. Use <b>Preview</b> to see the finished email.']],
 'settings:general':['General & security',['Site name, the address people type to reach the app (used in email links), idle sign-out, PIN rules and how many reviewers must approve.','Demo data loads sample packets and users for training. <b>Scorched earth</b> wipes everything but admins and settings and needs several confirmations.']],
 'settings:backups':['Backups',['A zip with the database, packet PDFs, final packets, photos and keys is made every night, and you can make one now. Keep a copy off this server.','To restore, unzip into the data folder while the app is stopped.']],
 'settings:integrations':['Integrations',['<b>Copy to folder</b> drops each final packet (and the index CSV) into a folder, for example one DocuWare watches. The app pool account needs write access to it.','<b>DocuWare index columns</b> sets the order and names of the CSV columns. <b>PO list</b> lets intake check POs against a D365 export.']],
 'settings:outbox':['Sent mail',['Every email the app sent or tried to send, and whether it worked. Use it to see why someone did not get a message.']],
 'settings:audit':['Audit log',['Who did what and when: sign-ins, approvals, filings, deletions and settings changes. Use the search box to filter.']]
};
function howTo(key){
  const h=HOW[key];if(!h)return '';
  return `<details class="howto"><summary>How to use this screen</summary><div class="howbody"><b>${h[0]}</b><ul>${h[1].map(x=>`<li>${x}</li>`).join('')}</ul></div></details>`;
}
