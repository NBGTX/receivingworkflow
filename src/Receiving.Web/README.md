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
