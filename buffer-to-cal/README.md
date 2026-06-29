# buffer-to-cal (Buffer2Cal)

Google Apps Script that automatically adds buffer time around Google Calendar events,
with structured logging to Datadog.

## What it does

- Enablement+ sessions (color code 4): adds 60min before and 30min after.
- Appointments (Tomato, color code 11): 30min before for short events; 60min before
  and 30min after for long ones.
- Sends structured logs to Datadog Logs for monitoring (trigger runs, matched events,
  buffer creation, errors).

## Main functions

- `onCalendarEventChanged(e)` — handler for the "Calendar - Changed" trigger.
- `addBufferEventsByColor()` — buffers for Enablement+ sessions.
- `addAppointmentBuffers()` — buffers for appointments.
- `sendToDatadog()` — ships logs to Datadog.

## Setup

1. Script Properties:

   | Property | Value |
   |-|-|
   | `DATADOG_API_KEY` | Datadog API key (for log intake) |
   | `AWS_API_KEY` | API key for the AWS trace endpoint (optional) |

2. Set the target calendar ID in the code if it differs from the default.
3. Install a "Calendar - Changed" trigger for `onCalendarEventChanged` (manual).

## Datadog log types

`trigger_recorded`, `event_matched`, `buffer_added`, `trigger_error`
(service `buffer2cal`, source `appscript`).

## Notes

- Linked to its Apps Script project via `.clasp.json` (run `clasp push` / `clasp pull`).
- Secrets live in Script Properties.
