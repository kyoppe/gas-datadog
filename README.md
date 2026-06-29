# gas-datadog

Google Apps Script (GAS) automations that talk to Datadog.

Each subdirectory is a self-contained Apps Script project linked to its remote project
via `.clasp.json`, so you can edit locally and `clasp push` / `clasp pull`.

## Projects

| Directory | What it does |
|-|-|
| [`statuspage-office-hours/`](./statuspage-office-hours) | Drives a personal Datadog Status Page component (Availability / Office Hours) from Google Calendar: weekends, Japanese public holidays, and Out-of-office events flip the component to outage colors. |
| [`buffer-to-cal/`](./buffer-to-cal) | Adds buffer time around Google Calendar events (Enablement+ sessions, appointments) and ships structured logs to Datadog. |

## clasp

Projects are managed with [`clasp`](https://github.com/google/clasp).

```bash
clasp login            # one-time browser auth
cd <project-dir>
clasp pull             # fetch remote into local
clasp push             # push local to remote
```

`.clasp.json` (scriptId only, no secrets) is committed. Credentials (`~/.clasprc.json`)
are not.

## Conventions

- Secrets (Datadog API key / App key) live in **Script Properties**, never in the repo.
- Non-secret IDs (Status Page ID, Component ID, scriptId) may be committed.
- `.clasp.json` (scriptId) is committed; clasp credentials `.clasprc.json` are gitignored.
