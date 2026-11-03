# widget implementation validation - 2026-11-03

Scope: the actual React/TypeScript Mendix pluggable web widget in widget/. SQL Server, Flask, Spring Boot and Compose
source remain unchanged. The existing persistent1500-loan fixture was neither reset nor reseeded. The earlier156 backend
passes are historical reporting API evidence; those SQL/Flask/Java suites were NOT rerun during widget validation.

## Tooling and minimal-package gate

Read the approved contracts, actual controllers/DTOs/authentication, prior validation and official Mendix tooling docs.
Inspected the published generator 11.13.0 tarball before scaffolding: its template allows tools^11.11.0 and React^19.
Selected11.15.0 satisfies that range. Both declare Node^22.18.0; installed host Node 22.18.0/npm 11.20.0 were inspected.
Resolved @napi-rs/lzma1.5.2 packaging requires Node>=22.20 within 22.x, so validation used a project-local Node 22.23.4,
leaving host Node unchanged. Its official ZIP SHA256 was verified:

```text
node-v22.23.4-win-x64.zip
cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20
```

Ran the official `npx --yes @mendix/generator-widget@11.13.0` in the empty widget directory with TypeScript, function
components, web, empty template, unit tests enabled and Cypress disabled. The generated namespace was retained.
SDK/runtime development resolutions in the final lockfile: tools 11.15.0, Mendix 11.16.0, React/ReactDOM 19.3.1.
These are a CLI baseline and an initial Studio Pro 11.16.x target, not verified Studio Pro runtime compatibility.

Before dashboard implementation, `npm run build` through the official build:web command produced an 8523-byte MPK.
ZIP inspection verified package.xml, widget XML, CSS, JS/MJS and editor preview/config assets. Minimal TypeScript passed;
the generated component test passed 1 test in 53.158s. Its temporary Hello World code/test were removed after the gate.
Final entrypoint, XML, declarations and editor components remain in the production widget structure.

Intermediate failures/corrections:

- The first generator invocation was accidentally run against the nonempty repository root and correctly refused;
  reran inside widget/. No root scaffold was created.
- Generator auto-build initially failed on a missing optional native LZMA binding under Node 22.18. Reinstalled optional
  dependencies with compatible local Node 22.23.4. The generated audit command also added scoped glob/minimatch overrides.
- An npm 10 lockfile check reported missing glob/path-scurry entries. Regenerated/verified with the generator's npm 11.20.0;
  the clean install subsequently passed. A mistaken root-directory invocation was corrected to the widget working directory.
- First dashboard build found unknown-valued JSX error conditions incompatible with React 19 types; made conditions Boolean.
- Direct ESLint found parameter accessibility, effect/ref and hook dependency issues. Corrected them and verified ESLint
  independently with the generated configuration. A wrong-working-directory ESLint attempt first reported tsconfig lookup
  errors. The final verification runner fixes its working directory and checks every child exit code explicitly.
- A final behavioral review found completed-own-job refresh should rediscover external jobs via latest. Corrected it and
  added a passing test. No fabricated jobId or backend contract change was introduced.

## Clean installation and final checks

Executed a clean `npm ci --include=optional` with Node 22.23.4/npm 11.20.0:1217 packages installed,1218 audited in 3m.
The pinned package-lock.json is included. For this checkout, the exact local-node
commands are in widget/README.md. Standard equivalents with compatible Node/npm on PATH:

```text
npm --prefix widget ci --include=optional
npm --prefix widget run check
```

The actual final check was `node scripts/check.cjs` in widget/ using the verified local Node executable. It runs:

```text
Prettier --check: All matched files use Prettier code style!
ESLint --config .eslintrc.js ... --max-warnings 0: PASS (zero rule errors/warnings)
tsc --noEmit: PASS
Jest with the official Mendix configuration:
Test Suites: 5 passed, 5 total
Tests:       72 passed, 72 total
Snapshots:   0 total
Time:        4.738 s
Official pluggable-widgets-tools release:web: PASS
All widget checks passed.
```

Jest's JSON report confirms 72 passed,0 failed,0 pending/skipped:

| Category | Cases |
| --- | ---: |
| Decimal formatting, totals and version comparisons |17 |
| API/auth/validation/client |29 |
| Dashboard/grouping/filter/pagination/races/keyboard |14 |
| Mendix property adapter and identity/token renewal |4 |
| Risk permission/idempotency/polling/terminal/external status |8 |
| Total |72 |

Thus 46 unit/client cases and26 component cases executed. Component tests use contract-shaped mocked API responses,
including source/publication changes, null groups, canceled/late responses, identity cache clearing, cursor errors,
terminal states, idempotent uncertain retry and actual keyboard Enter expansion in the DOM test environment.
They do not claim browser layout or authenticated Mendix integration.

The official generated toolchain emits an ESLint legacy-config deprecation warning and a Babel dynamic-import/MJS
transformation warning during successful packaging. No lint rule warning or build error remained. An audit executed
against the final installed tree reported 9 low development-tool advisories,0 moderate/high/critical. Declared production
dependencies with --omit=dev reported 0 advisories. No force upgrade/downgrade was applied to hide those results.

## Actual backend HTTP integration

Docker Desktop was started during widget validation; existing containers resumed healthy without code,
configuration, credential or storage changes. Spring readiness returned {"status":"UP"}. Executed:

```text
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/backend-tests.py
22 scenarios passed
0 failed
0 authorized risk runs submitted
```

The launcher runs the actual TypeScript client in Node against the existing Spring API. It uses restricted test tokens
from the existing operator helper only in process memory. Tests include all four dimensions for both tenants, exact
complete-root reconciliation, nested groups, real signed pagination, null keys, cross-tenant cursor rejection, latest
status without jobId, invalid-token401, reporting-only submission403 and foreign-job404. No successful POST is issued.
The final read-only rerun also passed 22 scenarios. Evidence: [integration-results.json](../widget/integration-results.json).

| Fixture tenant | Active loans | Current balance USD |
| --- | ---: | ---: |
| A |669 |248964756.01 |
| B |665 |217399661.07 |

These are tenant-scoped results, not an unscoped1500-active-loan claim. The persistent publication remains available.
Node HTTP does not validate browser CORS or the Mendix authentication bridge. Mutating risk success/failure behavior in
the widget is tested with mocks; reporting API publication tests remain historical evidence rather than a new frontend live-run claim.

## Final artifact

Executed `python widget/scripts/package-check.py` after the final official release build. The script validates archive
CRC, XML metadata/version, Web/plugin/offline flags, required compiled assets and absence of source maps/tests/env files.
It copies the official artifact into releases/; it does not construct a substitute ZIP.

- File: [axis.loanportfolio.AxisLoanPortfolio.mpk](../widget/releases/axis.loanportfolio.AxisLoanPortfolio.mpk)
- Size: 32287 bytes
- SHA256: 6a398e2827600ef2ee4b68ab687050ad6e8db272b7e87c41f39f48e76c048513
- Widget ID: axis.loanportfolio.axisloanportfolio.AxisLoanPortfolio
- Archive entries:13 (including directories)
- Compact evidence: [package-results.json](../widget/package-results.json)

## Explicit verification boundaries

| Check | Result |
| --- | --- |
| Widget TypeScript | PASS |
| Formatting / lint | PASS |
| Unit/client/component tests | PASS -72 cases |
| Real backend Node HTTP checks | PASS -22 scenarios |
| Official .mpk packaging / archive validation | PASS |
| Synthetic visual harness bundle | PASS - built with Rollup |
| Browser visual/CORS verification | NOT RUN - no enabled browser |
| Studio Pro import | NOT RUN - no local compatible installation/application found |
| Mendix runtime rendering | NOT RUN |
| Trusted Mendix-to-Spring authentication | NOT RUN - trusted Mendix session bridge required |

The optional harness renders actual dashboard components with clearly labelled synthetic fixtures and CSP connect-src
'none'. Its build passed and localhost 3099 served successfully. Browser automation reported the in-app browser unavailable
and an empty browser inventory, so no visual inspection/screenshots are claimed. The temporary server was stopped;
no additional always-on service remains. Do not present this harness as the deliverable Mendix application.

Final Docker state: SQL Server healthy (host 11433), Flask API healthy (8000), worker healthy, Spring healthy (8081).
Backend source/schema/Compose diffs are empty. No SQL reset, credential rotation, authorized risk run, commit or push.
AGENTS.md remains ignored. Node cache/binaries, node_modules, dist, env and temporary reports remain ignored; the release
MPK, lockfile, source, generated typings and compact evidence are retained for assessment review.

## Mendix integration and limitations

Follow [phase5-integration.md](phase5-integration.md) for actual package import, protected page/Data View setup,
nonpersistent session fields, property expressions, secure role/tenant mapping, renewal, CORS/HTTPS and manual acceptance.
Missing session inputs fail closed; UI hints never authorize the backend. No production issuer/token exchange/OIDC
platform is implemented in the widget. No production or sustained-load measurement is claimed.

Data is not pinned across requests; all three version fields are checked and incompatible expansions reset. The server
limits root groups to 100 and pages loans only. Overall rate is omitted without denominators. External idle jobs require
Refresh risk status to discover; active polling stops at terminal states. Cached visited pages remain in memory only
until their query/identity scope is discarded or the widget unmounts. SDK/schema compatibility and actual trusted browser
connectivity must be verified in Mendix before calling the complete application ready.

Final hygiene checks: git diff --check passed; backend/SQL/Compose source diffs were empty. A scan of 39 widget source/
document candidates plus every release archive entry found no configured local passwords/signing secrets. This is a
local configured-secret check, not a claim of a comprehensive security audit.
