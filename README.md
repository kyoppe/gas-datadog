# gas-datadog

Google Apps Script (GAS) automations that talk to Datadog.

Each subdirectory is a self-contained Apps Script project (`Code.gs` + `appsscript.json`)
that can be pasted into the Apps Script editor, or pushed with `clasp` later.

## Projects

| Directory | What it does |
|-|-|
| [`statuspage-office-hours/`](./statuspage-office-hours) | Drives a personal Datadog Status Page component (Availability / Office Hours) from Google Calendar: weekends, Japanese public holidays, and Out-of-office events flip the component to outage colors. |

## Conventions

- Secrets (Datadog API key / App key) live in **Script Properties**, never in the repo.
- Non-secret IDs (Status Page ID, Component ID) may be committed.
- `.clasp.json` is gitignored so a future `clasp` setup won't leak the script ID.
