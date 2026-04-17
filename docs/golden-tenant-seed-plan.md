# Golden tenant seed plan

## Target tenant
- Preferred base: `abc` (`Alvaro HVAC`)

## Why this tenant
- It already has the richest real footprint in the current environment.
- It has historical calls, metrics, a voicemail record, and calendar credentials, so we can upgrade it instead of inventing a new demo tenant.

## Golden-state goals
- Make the dashboard feel alive inside the default 30 day window.
- Cover both happy-path and QA edge cases.
- Keep the seed repeatable and safe to rerun.

## Minimum target state
- Recent calls with real-looking caller phones and mixed outcomes.
- Qualified leads present on a subset of completed calls.
- Recent appointments across multiple statuses:
  - confirmed upcoming
  - completed
  - cancelled
  - no-show
- Voicemails with recordings and transcripts.
- Ready call recordings with transcripts for at least a few completed calls.
- A recent successful calendar sync run so calendar health stops reading as dead.

## Proposed seeded coverage
- 10 recent call logs
  - 5 completed
  - 3 missed
  - 1 failed
  - 1 outbound follow-up
- 3 voicemail rows
  - 2 with transcript
  - 3 with recording URL
- 4 call recordings
  - ready transcripts for completed calls
- 5 appointments
  - 2 upcoming confirmed
  - 1 completed
  - 1 cancelled
  - 1 no-show
- Recent client metrics for observability smoke checks
- 1 successful `calendar_sync_runs` row

## Seed safety rules
- Use deterministic ids with a dedicated seed prefix.
- Delete and recreate only prior seed-generated rows.
- Do not touch unrelated historical tenant data.

## Expected product impact
- Admin overview stops looking empty.
- Client drilldown gets believable KPI, conversion, voicemail, recordings, and calendar states.
- QA has one dependable tenant for regression checks and future agent bakeoffs.
