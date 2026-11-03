# Reviewer demonstration walkthrough

Purpose: demonstrate the existing widget components against real Spring/SQL responses. This is **not Mendix runtime**.
For a new clone follow [setup](setup.md), including explicit initial publication; for the current published environment
skip initialization and mutations. Use only fictional fixture profiles, and never show access files or tokens on screen.

## Prepare

```powershell
docker compose --profile risk --profile backend config --quiet
docker compose --profile risk --profile backend up -d --no-build --wait
docker compose ps
Invoke-RestMethod http://127.0.0.1:8081/actuator/health/readiness
Invoke-RestMethod http://127.0.0.1:8000/health
npm --prefix widget run preview:build
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/demo.py --mode real --port 3099
```

Confirm sqlserver, risk-api, risk-worker and spring-boot-api are healthy. Use a fresh private access-code file from the
launcher; old startup codes expire within 15 minutes. Open http://127.0.0.1:3099, select tenant-a, and paste its code.
Close the private file before screen sharing. Never place credentials in URLs or browser storage. Default profiles have
reporting/status permissions only; do not opt into risk submission or start jobs for this walkthrough.

## Five-minute path

| Time | Action | What to explain |
| --- | --- | --- |
| 0:00-0:45 | Confirm the REAL BACKEND banner and sign in privately | Local opaque session; JWT stays on server; Spring still verifies tenant/permissions |
| 0:45-1:30 | Show Division / Loan officer selectors and summary | SQL calculates counts, balances and per-group averages; UI formats decimal strings |
| 1:30-2:30 | Expand a division, then an officer; Next and Previous | Lazy requests, two levels and signed keyset pagination; demo page size is 5 |
| 2:30-3:15 | Select Loan risk rating | Last successful publication is separate from latest job status; a failed job does not replace ratings |
| 3:15-4:00 | Open filters, apply a division/status, then clear | The API applies bound SQL filters; empty results are explicit |
| 4:00-4:40 | Sign out and sign into tenant-b | Previous data disappears; scoped cache/cursor isolation; portfolio:read does not imply risk permission |
| 4:40-5:00 | Show the widget MPK path and requirements matrix | Officially packaged widget; mandatory Mendix app/export and runtime verification remain missing |

Current recorded fixture observations are A: 669 active / USD 248,964,756.01; B: 665 active / USD 217,399,661.07.
These are evidence of this fictional dataset, not constants or a promise for another dataset. The fixture has 1,500
TOTAL loans, not 1,500 active. Always show live API values rather than editing screenshots or hardcoding totals.

## Longer discussion

- Inspect browser Network for metadata -> root groups -> children -> paginated loans; do not expose private headers or
  raw loan/borrower responses during a public presentation. UI-only permission hints do not authorize a request.
- Select no secondary grouping and expand Unassigned: SQL NULL uses a null-path flag, not the display label as an ID.
- Show the reporting-only viewer: no risk controls. Authorization, stale-response, session and failure cases have
  separate automated evidence; do not manipulate persistent SQL data to demonstrate them live.
- Explain Flask submission -> claim/lease -> snapshot -> batches/stage -> count/version validation -> PublishRiskRun.
  Source changes or failure leave the old publication visible. No new scoring job is needed to explain this.
- Show [test evidence](final-validation.md), distinguishing 14 mocked browser tests, 7 real-backend browser tests and
  1 synthetic test. The mocked-error screenshot is explicitly labelled and does not prove a real backend outage.
- Show [architecture](architecture.md), [contract](data-contract.md) and [requirements](assessment-requirements.md).
  A source watermark, publication UUID and response timestamp have different meanings; cursors do not freeze all data.

## Stop and recovery

Ctrl+C stops the launcher and removes its private access file. Relaunch for expired credentials. If a previous launcher
owns 3099, identify and stop only that demo before restarting. Do not restart SQL, change its password or remove a volume
for an authentication expiry. Real-mode failures remain errors; synthetic mode is a distinct process with a mock banner
and no backend connectivity. Direct Mendix-origin CORS and trusted Mendix sessions remain unverified.

## Suggested reviewer disclosure (draft, not sent)

The SQL/Flask/Spring analytics path, React widget source, official widget MPK and real-browser demonstration are ready
for review. I have not delivered the required operational Mendix application, Studio Pro integration or Mendix app export.
Would you accept the widget package plus browser demonstration as a substitute, or is the full Mendix app required for
acceptance? The requirements matrix lists these gaps explicitly.
