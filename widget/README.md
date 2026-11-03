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
[widget implementation validation](../docs/phase4-validation.md).

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
requests. Preview mode makes no API calls and displays no token. See the [browser demonstration handoff](../docs/phase5-integration.md)
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

## Real HTTP checks and optional visual harness

With the existing backend healthy and ignored local development credentials available:

```powershell
docker compose ps
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/backend-tests.py
```

This opt-in launcher invokes the actual TypeScript client against Spring, minting restricted local test tokens only in
process memory via the existing operator helper. It submits no authorized risk jobs and writes only aggregate test
summaries to integration-results.json. It does not reset SQL data. Node HTTP checks do not validate browser CORS.

```powershell
npm --prefix widget run preview:build
npm --prefix widget run preview:serve
# Open http://127.0.0.1:3099 or http://127.0.0.1:3099/?empty=1
```

This optional localhost-only visual harness renders the actual dashboard with synthetic fixtures, clearly labelled.
Its CSP forbids network connections, and its client methods are mocked. It is not the primary deliverable, does not
obtain real tokens, and proves neither authenticated backend connectivity nor Mendix rendering. The harness built, but
browser automation was unavailable; no screenshots or browser pass are claimed. The temporary server was stopped.

Remaining work includes compatible Studio Pro import, actual Mendix runtime rendering, trusted application token
acquisition/role mapping, HTTPS/CORS deployment and end-to-end browser checks. The generated toolchain retains legacy
ESLint/Babel build warnings and9 low-severity development audit advisories; production dependencies audit clean.
No commit/push is performed. AGENTS.md, .env, .tools, node_modules, dist and temporary reports stay excluded from Git;
release MPK, source, lockfile and compact validation summaries are retained for assessment delivery.
