# AXIS Loan Portfolio - Mendix web widget

This is an actual official-generator React/TypeScript pluggable widget, not a standalone replacement application.
The entrypoint, XML, generated typings, package metadata and editor components are preserved. The first minimal MPK
was built and inspected before dashboard work. Backend source, database schema, jobs and persistent seed data are unchanged.

## Deliverables and compatibility

- Source: src/, generated declarations: typings/AxisLoanPortfolioProps.d.ts (edit XML, then regenerate; never hand-edit).
- Release: [axis.loanportfolio.AxisLoanPortfolio.mpk](releases/axis.loanportfolio.AxisLoanPortfolio.mpk).
- Widget ID: axis.loanportfolio.axisloanportfolio.AxisLoanPortfolio (official generator namespace convention).
- Artifact size/checksum and pending runtime checks: [package-results.json](package-results.json).
- Current SDK/build baseline: generator 11.13.0, tools 11.15.0, resolved Mendix SDK 11.16.0, React/ReactDOM 19.3.1.
- Target: a compatible Mendix 11 React-client application, initially Studio Pro 11.16.x. CLI packaging is verified;
  Studio Pro import/runtime compatibility is pending. No compatibility certification for older Mendix versions is claimed.
- Node 22.20+ within 22.x; tested22.23.4, npm 11.20.0. Host Node 22.18.0 was left unchanged. The generator/tools declare
  ^22.18.0, but resolved native packaging dependency @napi-rs/lzma1.5.2 requires >=22.20 in Node 22.

Generator11.13.0 supports tools^11.11.0 and React^19;11.15.0 satisfies its range. Direct versions are pinned and the
lockfile records transitive versions. Use npm 11.20.0: npm 10 failed the generated range-override lockfile validation.
The verified local Node distribution is ignored under .tools/; it is not part of the delivered widget or Git source.
Official references: [generator workflow](https://docs.mendix.com/howto/extensibility/create-a-pluggable-widget-one/),
[widget API/package](https://docs.mendix.com/apidocs-mxsdk/apidocs/pluggable-widgets/),
[property APIs](https://docs.mendix.com/apidocs-mxsdk/apidocs/pluggable-widgets-property-types/).

## Install and verify

From repository root with supported Node/npm on PATH:

```powershell
node --version
npm --version
npm --prefix widget ci --include=optional
npm --prefix widget run check
python widget/scripts/package-check.py
```

check runs Prettier, ESLint with the generated Mendix configuration, TypeScript, Jest/React Testing Library with the
official configuration, and official release:web packaging. Child exit codes are checked explicitly. package-check.py
validates the ZIP/XML/assets and copies the official release into releases/; it never synthesizes an MPK.
Tests use synthetic fixtures/mocks and never issue authorized production risk jobs. Details are recorded in
[Widget validation](../docs/widget-validation.md).

This checkout also has a verified project-local Node 22.23.4, useful while host Node remains22.18:

```powershell
Push-Location widget
$node=Join-Path $PWD '.tools/node-v22.23.4-win-x64/node.exe'
$npmCli=Join-Path $env:APPDATA 'npm/node_modules/npm/bin/npm-cli.js' # existing npm 11.20.0
$env:Path=(Split-Path $node)+';'+$env:Path
& $node $npmCli --version
& $node $npmCli ci --include=optional
& $node scripts/check.cjs
Pop-Location
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/package-check.py
```

Optional individual commands:

```powershell
npm --prefix widget run typecheck
npm --prefix widget run format:check
npm --prefix widget run lint
npm --prefix widget test -- --ci --runInBand
npm --prefix widget run build
npm --prefix widget run release
```

The generated Mendix dev/watch scripts remain available. config.projectPath points to ignored .mendix-app as a copy
staging directory, not a real application. Set it to an actual app directory for npm run dev; do not assume it creates
an app. The official package is first generated under dist/0.1.0/.

## Responsibilities

AxisLoanPortfolio.tsx adapts Mendix properties to an injectable PortfolioAuthProvider. PortfolioDashboard owns grouping
and filters; useRemote owns query-scoped fetch state, cache ownership and cancellation. GroupTable lazy-loads children;
LoanDetails loads cursor pages and retains visited pages for Previous/Next. RiskStatus submits with a retained
idempotency key and monitors either the actual returned jobId or latest status. portfolioClient centralizes fetch,
URLSearchParams, authentication, response validation, 10s timeout and one bounded GET retry after429. POST never retries
automatically. Pure utilities format Big.js decimal values and compare all response-version fields.

Every identity/scope change remounts data state, clears loan pages, polling and pending submission intent, and fences late
responses. Same-session token renewal updates the provider without losing an uncertain submission key. Nothing is stored
in localStorage/sessionStorage or logged as portfolio responses/tokens. No tenant selector or caller-authorized tenant
parameter exists. UI permission hints are not security enforcement; Spring authorizes every request.

## Widget properties

| Property | XML type | Configuration |
| --- | --- | --- |
| apiBaseUrl | string, required | HTTPS trusted reporting origin/base path; HTTP loopback only for local development |
| title | string | Loan Portfolio Analytics |
| primary | enumeration | division, loanOfficer, borrowerType, riskRating; default division |
| secondary | enumeration | none or a different dimension; default none |
| pageSize | integer |1-100, default 50 |
| showRisk | boolean | Show eligible risk controls, default true |
| accessToken | String expression | Runtime short-lived token from a trusted application integration; never a constant shared token |
| sessionScope | String expression | Opaque identity/tenant/authorization-session scope; rotate on identity/scope change |
| canReadRisk | Boolean expression | UI hint only for risk:read, default false |
| canRunRisk | Boolean expression | UI hint only for risk:run, default false |
| renewSession | optional action | Updates bound session properties; execute() does not return a token |

The XML requires an entity context. Missing/invalid configuration or unavailable session values fail closed before data
requests. Mendix editor preview makes no API calls and displays no token. See the [Mendix integration handoff](../docs/mendix-integration.md)
for the required nonpersistent context and trusted renewal boundary. Production OIDC/trusted acquisition is not implemented
by a widget package. This widget never signs JWTs or contains database/service credentials.

## Reporting behavior

Metadata supplies the four grouping selectors. At most two different dimensions are supported. Expansion lazily requests
children, then paginated loans; a leaf expands into loans even when hasChildren=false. Collapsing cached groups does not
refetch. Null, empty and literal "null" keys stay distinct; documented IsNull flags select SQL NULL, never display labels.
Native buttons, labels, tables, ARIA expansion/status messages, focus outlines and scoped responsive CSS support keyboard
and narrow-container use. Tables scroll horizontally rather than clip financial values.

Filters use existing status, division, borrowerType, published riskRating and inclusive origination dates. Dates are
validated before requests; filter/group changes abort and discard obsolete expansions/cursors. Cursor values are opaque,
passed unchanged, and never decoded/generated by the widget. Previous/Next uses visited pages; there are no fictional
numbered pages or total-page claims. Snapshot/publication/as-of mismatches invalidate expansions and refresh roots.
INVALID_CURSOR restarts the affected loan list; SNAPSHOT_CHANGED refreshes the root. No permanently pinned snapshot is
claimed. The server's100-group safety cap remains an explicit error; there is no hidden truncation or group paging.

Complete root responses provide exact count/balance summary sums; amounts never pass through binary floating point.
Rates are annual fractions displayed as percentages with decimal rounding; nulls display an em dash, never zero.
The overall rate card is omitted because non-null-rate counts are absent. Each group shows its authoritative SQL average.
Borrower risk and published loan risk remain distinct. Business DATE strings are displayed without timezone shifts;
source timestamps are explicitly UTC. Source sync and publication identity are separate.

## Risk and errors

portfolio:read never implies risk:run/risk:read. A new intentional run uses a new idempotency key; uncertain network/503
retries retain it. Submitted jobs use returned jobId for detailed polling. Existing jobs discovered through latest have
no fabricated identifier and are monitored only through latest. Polling occurs approximately every 2s while a job is
queued/running, stops on success/failure/error, and aborts on unmount/scope change. Use Refresh risk status to discover
external jobs started after idle polling stopped. Successful publication refreshes the report; failure retains it.
A submission-only user can submit but cannot inspect status; totals/progress are not fabricated from a queued response.

400/401/403/404/409/429/503 map to fixed safe messages and request references.401 requires session renewal,403 indicates
an authorization/origin issue,429 is bounded, and503 has manual retry. No infinite auth retries or automatic failed-job
resubmission. Failed report refreshes retain the prior valid data with a visible error.

## Browser demonstration

The additional browser surface renders the same `PortfolioDashboard`, grouping/loan tables, filters, formatting and
risk components. Production source/entrypoint, XML, typings, preview component and authentication provider are unchanged.
The official Mendix `.mpk` package was built and validated, but Studio Pro import and Mendix runtime execution were not
performed. This browser demonstration is not a working Mendix application.

### Real backend mode

Requirements: supported Node/npm above, existing Flask Python 3.11 virtualenv/dependencies, authorized ignored root
`.env`, and the initialized backend/fictional published fixture described in the component READMEs. Preserve the SQL volume and
publications. From the repository root:

```powershell
docker compose --profile risk --profile backend config --quiet
docker compose --profile risk --profile backend up -d --no-build --wait
docker compose ps
Invoke-RestMethod http://127.0.0.1:8081/actuator/health/readiness
npm --prefix widget run preview:build
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/demo.py --mode real --port 3099
```

Open **http://127.0.0.1:3099** (use this exact IP, not localhost). The launcher prints a private access-code **file path**,
not credentials. Open that ignored file locally, select the matching profile and paste its code into the password field.
Do not share the file, print its contents in test logs or put codes into URLs. Windows ACLs restrict it to the current
user; POSIX uses mode 0600. Stop with Ctrl+C, which removes the file and stops the child server.

Default profiles: `tenant-a` and `tenant-b` allow reporting plus risk status; `viewer-a` allows reporting only. Profile
codes select server-configured authorized scopes; the browser cannot supply tenant IDs or permissions. All credentials
expire at most 15 minutes after launch, even following another login. Relaunch to renew; no public token issuer exists.
`--session-seconds 60` can shorten sessions. The launcher uses the configured `PORTFOLIO_PORT` (8081 by default),
`RISK_TENANTS` and existing `RISK_AUTH_MODE`, issuer, audience and signing configuration. It fails closed on invalid
configuration. Signing material stays in the Python operator process; only pre-authorized JWTs pass over a private stdin
pipe into the Node server's memory. Child environment keys containing PASSWORD/SECRET/TOKEN are removed. No JWTs are
written to the access file or sent to the browser.

The browser receives an opaque HttpOnly, SameSite=Strict session cookie, in-memory CSRF proof and opaque scope. Nothing
is stored in localStorage/sessionStorage. Login/logout, expiry and identity changes discard dashboard caches/polling.
DemoPortfolioClient extends the existing API client with a demo-only fetch transport: it removes Authorization before
browser network I/O and uses same-origin session/CSRF headers. Production widget authentication is unchanged.

The proxy binds only 127.0.0.1, checks exact Host/Origin and Fetch Metadata, requires a custom request header and CSRF
proof, and forwards only GET metadata/groups/children/loans/latest/job status and opt-in POST risk-runs. It has a fixed
local Spring upstream, bounded bodies/responses and timeout, and follows no redirects. Spring still validates each JWT,
tenant and permission. No backend CORS setting was changed: this is a same-origin proxy test, not direct browser CORS
certification. HTTP cookies intentionally lack Secure on this loopback-only development surface. Do not expose it through
a tunnel, public listener or deployment; HTTPS/OIDC, trusted Mendix sessions and multi-user identity mapping remain work.

Risk jobs are never automatic. Normal demonstrations and all real-backend tests are read-only. Only an explicit
`--allow-risk-runs` startup opt-in adds `operator-a` with `risk:run`; the operator must then intentionally click the
existing control. This is a privileged development action and can change publications. Do not enable it simply to view
published ratings or test against the persistent fixture. Unit proxy tests use a fake upstream for authorized POSTs.

### Synthetic mode

```powershell
npm --prefix widget run preview:build
npm --prefix widget run preview:serve
# http://127.0.0.1:3099 or /?empty=1
# Alternatively: analytics-flask/.venv/Scripts/python.exe -B widget/scripts/demo.py --mode synthetic --port 3101
```

This separate process/mode has a prominent MOCK DATA banner, mock client, no session/proxy and CSP `connect-src 'none'`.
Stop the real server before using the same port, or use 3101. Real failures never select synthetic mode or fixtures.

### Reviewer walkthrough

1. Sign in as tenant-a, observe metadata-driven Division / Loan officer selectors and SQL-backed totals.
2. Expand a division, then an officer. Demo page size defaults to 5 (host control offers 5/25/50); use Next/Previous.
3. Select Loan risk rating; observe actual published groups and separate source/publication timestamps.
4. Open Portfolio filters; apply status/division/type/rating/dates. Select no secondary dimension to inspect a null group.
5. Sign out and sign in as tenant-b; prior data disappears before new requests. Reporting-only viewer hides risk controls;
   manually attempting risk status still receives Spring 403. No tenant/body field grants authority.
6. For controlled empty/loading/error/stale-request scenarios use the separate mocked browser suite. Do not stop SQL,
   alter sources, reseed, or submit risk jobs to manufacture screenshot states.

### Tests and evidence

With the protected real launcher still running in another terminal (fresh access codes, default permissions):

```powershell
npm --prefix widget run check
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/package-check.py
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/backend-tests.py
$env:DEMO_TEST_URL = 'http://127.0.0.1:3099'
npm --prefix widget run test:browser
# Or separated projects:
npm --prefix widget run test:browser:mocked
npm --prefix widget run test:browser:real
```

`check` executes existing 72 Jest unit/component cases, formatting, generated production ESLint/TypeScript, additional
preview ESLint/TypeScript, server-security tests and official release packaging. Package validation inspects the official
archive and copies it to releases/. The HTTP launcher runs the actual TypeScript client against Spring without authorized
risk mutations; aggregate-only results go to integration-results.json.

Playwright 1.64.1 uses installed Google Chrome (`chrome` channel), one worker, no retries. Set `DEMO_BROWSER=msedge` only
with a compatible installed Edge. Bundled Chromium download was denied by its CDN in this environment; installed Chrome
was used successfully. The synthetic server on 3101 is managed automatically. Real/mock projects require the separately
launched protected server and latest private code file for the chosen port; no auth bypass or stored bearer is used.
All browser identities/codes are passed only in local test memory. Trace/video/HAR/storage-state capture is disabled.
Raw reports/error contexts stay in ignored .demo/. Do not publish them without review. Explicit screenshots in
[evidence/browser-demo](evidence/browser-demo) mask password fields and loan/borrower-identifying cells; they use fictional fixtures
and are retained as local validation evidence. `mocked-error.png` is explicitly labelled mocked evidence.

See [Browser demo validation](../docs/browser-demo-validation.md), [browser summary](browser-results.json) and
[Submission checklist](../docs/submission-checklist.md). Remaining assessment gaps include Studio Pro import/runtime, a real Mendix
operational app with loan CRUD, a trusted session bridge, synchronization and final submission. Legacy official build
warnings remain and are recorded separately from failures. Local environment files, tools, node_modules, dist,
.demo credentials and raw reports are excluded from Git.
