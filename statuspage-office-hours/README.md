# statuspage-office-hours

Updates a personal Datadog Status Page component based on Google Calendar, every 10 minutes.

- Page: <https://kyouheiohno.statuspage.datadoghq.com/>
- Component: `Availability / Office Hours`
- Business hours: weekdays 09:00-18:00 (JST)

## How it works

`component status` on a Datadog Status Page is a **computed value derived from active
Notices (Degradations)**, not something you set directly. So to color the component we
create a Degradation notice, and to go back to green we resolve it.

Every 10 minutes `updateStatusPage()`:

1. Computes the desired state from the calendar (`computeDesiredState`).
2. Reconciles against the currently active degradation tracked in Script Properties.
3. Creates / switches / resolves a single Degradation notice as needed (idempotent).

### State to color mapping

| Situation | component status | Color | Counts as downtime |
|-|-|-|-|
| Weekend / holiday | `major_outage` | red | yes |
| Full-day OOO / PTO (weekday) | `partial_outage` | orange | yes |
| After hours / stepped out | `maintenance` | maintenance | no |
| Weekday 09-18, working | `operational` | green | no |

`maintenance` keeps uptime % and the daily bar unaffected, so a normal worked weekday
stays green even though the page shows an after-hours banner. Only weekends/holidays
(red) and full-day weekday absences (orange) count against uptime.

## Setup

1. Create a new project at <https://script.google.com>.
2. Paste `Code.gs` and overwrite `appsscript.json` (enable manifest in Project Settings).
3. Set **Script Properties**:

   | Property | Value |
   |-|-|
   | `DD_PAGE_ID` | `275404eb-337d-4625-b16a-fdc16eefc39a` |
   | `DD_COMPONENT_ID` | `b5f2ea20-4dea-4209-bbff-759ec0118592` |
   | `DD_API_KEY` | your Datadog API key |
   | `DD_APP_KEY` | App key from a user with `status_pages_incident_write` |

4. Run `updateStatusPage` once and approve the Calendar + external-request permissions.
5. In the Apps Script **Triggers** panel, add a time-based trigger for `updateStatusPage`
   running every 10 minutes.

## Datadog logging

Each run ships a structured log to Datadog Logs (`https://http-intake.logs.<site>/api/v2/logs`)
using the same `DD_API_KEY`. No extra Script Property needed.

- service `statuspage-office-hours`, source `appscript`, tags `env:kyo`
- Per run (`evt:status_evaluated`): `desired_state`, `previous_state`, `action`
  (`created` / `switched` / `resolved` / `unchanged` / `noop_operational`),
  `component_status`, `degradation_id`, `changed`, plus `log_hour` / `log_weekday`
- On failure (`evt:status_error`, `status:error`): the exception, then re-thrown

Find changes with: `service:statuspage-office-hours @changed:true`.

## Notes

- `DD_APP_KEY` must be created by a user that has `status_pages_incident_write`,
  otherwise notice creation returns 403.
- The trigger runs 24/7; `computeDesiredState` is idempotent across all hours.
- Logs are verbose: the Executions view shows the full evaluation each run.
