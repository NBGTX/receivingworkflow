# Receiving Workflow

Paperless steel receiving for Nucor Building Systems Texas (Terrell, TX): packet intake with click-to-index, tablet inspection forms that match the paper QCF sheets, reviewer approvals, D365 receive and authorize steps, email notifications, and an index sheet for the manual DocuWare upload.

- `src/Receiving.Web` - the app (ASP.NET Core 8, SQLite, plain JavaScript). See its [README](src/Receiving.Web/README.md) for running and settings.
- `PLAN.md` - scope, workflow, data model.
- `Inspections/` - the blank paper inspection sheets the forms are built from.
- `Project Folder/`, `Steel_Receiving_Workflow_Outline_Paperless.md` - earlier DocuWare-based design notes.
- `deploy-src/` - `Deploy.ps1` (one-command server update), `Install-Receiving.ps1`, `Restore-Receiving.ps1`.
- `tests/Smoke.ps1` - end-to-end check of the whole workflow on a throwaway copy (31 checks).

Quick start:

```
cd src/Receiving.Web
dotnet run --no-launch-profile
```

Then open http://localhost:5080. Sign-in, SMTP, users and notifications are configured in the Settings panel. The `data/` folder (database, PDFs, keys) is never committed.
