# Browser demonstration validation

Executed 2026-11-03 against the existing fictional 1,500-loan persistent fixture. This phase adds a browser surface to
the existing widget; it does not create a Mendix app. No SQL/Flask/Spring/Compose source changed, no database was reset or
seeded, and no authorized risk jobs were submitted. Screenshots were retained locally for review.

**The official Mendix `.mpk` package was built and validated, but Studio Pro import and Mendix runtime execution were
not performed.** Trusted Mendix authentication, operational CRUD and synchronization remain unverified.

## Implemented boundary

- `widget/preview/real.tsx`: login/session host and actual PortfolioDashboard. No separate dashboard implementation.
- `widget/preview/demoClient.ts`: demo-only transport through the existing PortfolioClient; strips browser Authorization.
- `widget/scripts/demo.py`: authorized local operator launcher; preissues restricted 15-minute JWTs into server memory
  through stdin. Private access-code file contains codes/profile metadata, no JWTs; current-user ACL / mode 0600, ignored and normally removed.
- `widget/scripts/demo-server.cjs`: exact loopback Host/Origin/Fetch Metadata checks, opaque expiring HttpOnly/SameSite
  cookie, CSRF/custom headers, fixed upstream and route/method allowlist, bounded bodies/response/timeout, no redirects.
- Synthetic preview remains separately labelled and has no backend/auth proxy, with CSP connect-src none.
- Default profiles distinguish report/status and reporting-only access. Risk POST requires startup opt-in plus operator
  scope and Spring authorization. No public arbitrary token issuer, persisted browser bearer or backend auth relaxation.
- Logout/identity/expiry clears state. A delayed bootstrap response cannot erase a newer login. Real errors never fall
  back to synthetic fixtures. Production widget source, XML, typings, editor preview and auth boundary were preserved.

## Actual commands and results

PowerShell from repository root, using the already verified ignored local Node 22.23.4 and npm 11.20.0. Normal PATH-based
commands and first-time setup are in [widget/README.md](../widget/README.md#browser-demonstration).

```powershell
& widget/.tools/node-v22.23.4-win-x64/node.exe widget/scripts/check.cjs
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/package-check.py
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/backend-tests.py
# Separate terminal, fresh credentials; final reviewer validation used port 3099:
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/demo.py --mode real --port 3099
$env:DEMO_TEST_URL='http://127.0.0.1:3099'
& widget/.tools/node-v22.23.4-win-x64/node.exe widget/node_modules/playwright/cli.js test -c widget/playwright.config.cjs
```

| Check | Executed result |
| --- | --- |
| Prettier, production generated ESLint, demo ESLint | PASS; zero lint errors/warnings under the configured rules |
| Production and preview TypeScript | PASS |
| Existing Jest unit/component regression | 5 suites, 72 passed, 0 failed; 4.747 s |
| Node localhost server security/proxy tests | 12 passed, 0 failed, 0 skipped; 422.9514 ms |
| Official Mendix release:web build | PASS |
| ZIP/XML/runtime/editor package validation | PASS; 13 entries, 32,287 bytes |
| Actual TypeScript-client backend HTTP scenarios | 22 passed, 0 failed; 0 authorized risk submissions |
| Playwright installed Chrome browser suites | 22 passed, 0 failed, 0 skipped, 0 flaky; 34.3 s |
| Preview Rollup builds, synthetic + real | PASS |
| Backend Docker config/startup/readiness | PASS; all four existing containers healthy |

Relevant exact output excerpts:

```text
Test Suites: 5 passed, 5 total
Tests:       72 passed, 72 total
Snapshots:   0 total
Time:        4.747 s

# tests 12
# pass 12
# fail 0
# skipped 0

22 passed (34.3s)
```

HTTP summary output contains `"scenariosPassed": 22`, `"failed": 0`, `"authorizedRiskRunsSubmitted": 0`.
Compact artifacts: [browser-results.json](../widget/browser-results.json),
[integration-results.json](../widget/integration-results.json), [demo-results.json](../widget/demo-results.json) and
[package-results.json](../widget/package-results.json). Raw logs/reports stay ignored locally and contain no intentional
credential output. Trace/video/HAR/storage-state recording is disabled; only explicitly masked screenshots are retained.

Final official MPK SHA-256:
`38a9bb40da7fe2c7761c06d4939e814012a35d404e91cfeb97c75809bbe8f4d9`.
The rebuilt archive's entry names and every uncompressed payload were compared to the original HEAD package: identical.
The archive hash changed due to packaging metadata; the demo was not added to the Mendix package.

## Browser test separation

Playwright 1.64.1 used installed Google Chrome **156.0.8078.79**, headless, en-US/UTC, desktop 1280x960 and narrow 390x844,
1 worker, 0 retries. Tests authenticate through the real local access-code/session boundary; no network auth bypass.

| Project | Passing cases | Evidence scope |
| --- | --- | --- |
| mocked-browser | 14 | Controlled fixtures/errors/delays through real browser components; not SQL integration |
| real-backend-browser | 7 | Actual Spring HTTP responses through the restricted proxy, existing SQL-backed fixture |
| synthetic-browser | 1 | Explicit mock banner, actual component render, no API/auth requests |

Mocked coverage includes exact decimal display, metadata, nested lazy requests/cache, cursor navigation, null flags,
date validation, filtering, late-response cancellation, source-version mismatch refresh, loading, empty/error/retry,
keyboard/responsive behavior, invalid access code, expiration, bootstrap/login race, backend 401 and RUNNING-to-FAILED
retention of previous publication without fabricated job IDs or POSTs.

Real coverage includes all four grouping dimensions, authoritative financial totals, nested child count consistency,
5-row pages, unchanged opaque signed cursors/Previous/Next/no duplicate loan IDs, SQL NULL filtering, CLOSED and empty
filters, keyboard and narrow rendering, server-side JWT storage, HttpOnly session cookie, empty browser storage, cleared
identity state, tenant-B rejection of tenant-A cursors, Spring 403 for missing risk permission, CSRF rejection and disabled
risk mutations. Default-profile UI contains no recalculate action. No artificial browser failure is claimed as real SQL
failure, and no persistent risk/source mutation was used to create evidence.

## Real demonstration observations

| Fixture tenant | Active loans | SQL/API total current balance |
| --- | ---: | ---: |
| A | 669 | USD 248,964,756.01 |
| B | 665 | USD 217,399,661.07 |

These values came from real API responses, not frontend constants. The client formats decimal strings and sums complete
root aggregates with Big.js; SQL remains responsible for financial grouping/averages. The browser exercised Division ->
Loan officer -> loans, all dimensions including published risk, filtering and pagination. The existing successful risk
publication remains visible alongside a later FAILED job. Aggregate risk groups for both tenants exactly match recorded
reporting API baseline groups; see demo-results.json for read-only corroboration, publication IDs and status. No newly submitted/failed
live run is claimed. Running/failure presentation is additionally tested with controlled browser responses.

Backend checks actually executed:

```powershell
docker compose --profile risk --profile backend config --quiet
docker compose --profile risk --profile backend up -d --no-build --wait
docker compose ps
Invoke-RestMethod http://127.0.0.1:8081/actuator/health/readiness
Invoke-RestMethod http://127.0.0.1:8000/health
```

SQL Server, risk-api, risk-worker and spring-boot-api were healthy; Spring readiness returned `{"status":"UP"}` and
Flask returned `{"status":"ok"}`. Existing volume/credentials were preserved; SQL remains on host 11433, HTTP on
8000/8081. This phase used existing images; no backend image rebuild or expensive SQL/Flask/Java regression rerun was
needed for unchanged backend source. Historical backend test counts are not presented as rerun results.

## Screenshots and reproducibility

Reviewed browser captures:

- [Real dashboard](../widget/evidence/browser-demo/real-dashboard.png)
- [Published risk groups](../widget/evidence/browser-demo/real-published-risk.png)
- [Nested paginated loans, identifying cells masked](../widget/evidence/browser-demo/real-nested-pagination.png)
- [Real filtered empty state](../widget/evidence/browser-demo/real-filter-empty.png)
- [Real narrow layout](../widget/evidence/browser-demo/real-responsive.png)
- [Explicitly mocked upstream error](../widget/evidence/browser-demo/mocked-error.png)

Loan number/borrower cells and password inputs are masked by the capture helper. Only fictional assessment data is used.
Credentials never appear in screenshot URLs. Follow the exact start/login/grouping walkthrough in widget/README.md;
credentials intentionally expire, so an old screenshot session or private code file cannot be reused indefinitely.

## Failures encountered and corrected

- Playwright bundled Chromium installation received CDN HTTP 403, `service is not available in your location`. No bypass
  was attempted. The installed Chrome channel was launched and actually used instead.
- First browser run: **17 passed, 2 failed** (filter control locator). The control was inspected and changed to its
  actual combobox role; no widget or API contract change was needed.
- A test-helper refactor then produced **17 failed, 3 passed** because it referenced a removed credential variable.
  Corrected the helper and reran. The next run passed 20/20; two extra risk/auth cases brought the final run to 22/22.
- Demo lint initially inherited the generated production tsconfig, then found an empty cancellation handler. Isolated
  the demo ESLint config and documented the expected cancellation branch; final lint passed.
- Expired local test credentials were renewed by restarting only the identified demo process. A port-in-use startup
  attempt failed; startup errors are now sanitized. Backend containers/data were not restarted/reset to solve it.
- The official toolchain emits legacy ESLint configuration and dynamic-import build notices. PowerShell may decorate
  stderr notices as NativeCommandError; the check runner verifies actual child exit codes and completed successfully.

## Remaining limitations and submission readiness

This is a restricted single-machine development demo, not production authentication. Operators holding the configured
signing material authorize only fixed fixture profiles; secrets remain trusted operator configuration. Loopback HTTP,
short-lived startup credentials, per-process sessions/rate limits and manually restarted expiration are intentional.
No unrestricted issuer, public listener, production OIDC, direct browser CORS certification, live risk mutation, benchmark,
exhaustive accessibility audit or multi-browser certification is claimed. A same-user hostile local process remains
outside this development boundary. Shut down the launcher when finished.

Studio Pro import/toolbox/runtime, actual Mendix loan CRUD, trusted Mendix authentication, synchronization and app export
remain NOT RUN/unimplemented as previously documented. The browser/widget/backend slice is demonstrable; the complete
original Mendix assessment is not yet ready to claim complete. [Submission checklist](submission-checklist.md) lists the remaining
work. AGENTS.md, .env, node_modules, tools, credentials and raw reports remain ignored; nothing was committed or pushed.

Final hygiene checks: `git diff --check` passed; backend source and widget src/typings diffs were empty; configured secret
values were scanned across Git-eligible files and MPK contents with zero matches. Git confirmed AGENTS.md, .env, .demo,
node_modules and .tools are ignored. A final server test also verifies expired sessions release the bounded session pool
and an existing session can rotate when it is full. The reviewer server was started on 127.0.0.1:3099 with default
reporting/status permissions; its credentials expire within 15 minutes, so relaunch for later review.
