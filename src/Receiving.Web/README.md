# Steel Receiving (Nucor Building Systems Texas)

ASP.NET Core 8 + SQLite. Frontend is plain JS in `wwwroot`.

## Run

```
cd src\Receiving.Web
dotnet run --no-launch-profile
```

Open http://localhost:5080. Port and data folder are in `appsettings.json` (`Urls`, `DataDir`). Everything else is set in the Settings panel.

First admin: `BG\sims.anderson` (seeded when the database is empty). Click "Admin sign-in (Windows)". Add more admins, receivers, reviewers and coordinators in Settings.

## Data

`data/receiving.db` (SQLite), `data/pdfs/` (packet PDFs), `data/keys/` (encryption keys for the SMTP password and login cookies, protected with Windows DPAPI). Back up the whole `data` folder.

## Sign-in

- Receivers, coordinators, reviewers: tap card, enter PIN. PIN set by admin, stored hashed (PBKDF2). Lockout after N wrong tries.
- Admins: Windows integrated sign-in (Negotiate). Only accounts listed under Settings > Admins get in. Browser must treat the site as intranet for silent sign-in.
- Idle sign-out and PIN length are in Settings > General.

## Email

Settings > Email server, then Settings > Notifications. Mail is queued in the database and sent by a background worker with retries. See Settings > Sent mail.

## Before real use

- Serve over HTTPS (IIS or Kestrel certificate). PINs travel in the request body.
- Set Site address in Settings > General so email links point to the right server.
- Open the firewall for the port so tablets can reach it.

## Deploying to IIS

From your PC: `.\deploy-src\Deploy.ps1` publishes the app, copies it to `\10.9.33.141\E$\Receiving\deploy` and runs `Install-Receiving.ps1` on the server (through a one-time Task Scheduler job), then checks the site answers. Use `-NoInstall` to copy only. The data folder (`E:\Receiving\data`) is never touched by an update.

## Backups

Settings > Backups. A nightly zip (database snapshot, packet PDFs, final packets, encryption keys) goes to `data\backups` or the folder you set. Restore by stopping the site and unzipping into the data folder.

## Offline libraries

PDF.js and Tesseract.js (with the English language file) are bundled in `wwwroot/vendor`, so the app does not need internet access.

## Day-to-day tools (Settings and Dashboard)

- **Dashboard** (intake): packets by step, average time per step, packets stuck a day or more, rejects by vendor, CSV export of every inspected item.
- **Settings > Status**: disk space, last backup, failed mail, DocuWare folder health. **Alerts** email the admins once a day per problem (failed mail, no backup for 2 days, failed backup, failed folder copy, under 5 GB free).
- **Settings > Integrations**: extra alert addresses; copy each final packet (PDF + index CSV) to a folder on filing; rename and reorder the DocuWare index columns; upload a D365 PO list so packets with unknown POs are flagged at intake.
- **Settings > Audit log**: search by text, user or action.
- Users can be set to **choose their own PIN** at first sign-in; every PIN user has a Change PIN button.
- Inspection forms warn (never block) when a measurement is outside the range printed on the paper sheet, take photos of rejects (included in the final packet), and can scan a CC # barcode (needs HTTPS and Chrome on Android). A rejected item emails the configured people.
- Intake can check heat numbers against the mill test report pages, and the app learns a vendor's corrections.

## Tests and recovery

- `tests\Smoke.ps1` runs 31 end-to-end checks on a throwaway copy.
- `deploy-src\Restore-Receiving.ps1 -Backup <zip>` restores a backup and keeps the old data folder aside.
