# Final validation and submission review

Executed **2026-11-03**. This report records fresh final-audit executions separately from historical component evidence.
Authority: six-page supplied assessment PDF, reviewed locally; page-referenced obligations are in
[assessment-requirements.md](assessment-requirements.md). No supplied PDF was added to Git. No Mendix app was created,
no authorized risk job was submitted, and the persistent database was not reset or reseeded.

## Independent readiness decisions

- **Engineering deliverable: READY WITH LIMITATIONS.** Implemented SQL/Flask/Spring/widget/browser slice works within its
  documented development boundary and is ready for technical review.
- **Original assessment: INCOMPLETE.** Mandatory Mendix application, loan-management capability, embedded runtime and
  Mendix application export (assessment pp.1,4-5) remain absent/unverified. A widget MPK is not an application export.
  Reviewer acceptance of a substitute is required before claiming compliance.

## Environment and versions

| Item | Observed / declared baseline |
| --- | --- |
| Host | Windows 11 Home 10.0.26300; PowerShell |
| Node / npm | Actual local Node 22.23.4, npm 11.20.0; >=22.20 and <23 required by resolved widget native tooling |
| Python | Host/venv 3.11.9; Dockerfile pins 3.11.14 |
| Java | Container Temurin 17.0.17+10; host Java 23 unchanged |
| Spring / Maven | POM Spring Boot 3.5.16, Wrapper 3.9.11; Java 17 image build |
| Python packages | Flask 3.1.2, PyJWT 2.13.0, pyodbc 5.2.0, pytest 9.1.1 |
| Widget runtime/tooling | React/DOM 19.3.1, TypeScript 5.9.3, Mendix SDK 11.16.0, tools 11.15.0 |
| Browser | Installed Chrome 156.0.8078.79, Playwright 1.64.1, headless en-US/UTC |
| Docker / Compose | Engine 28.3.2, Compose 2.38.2-desktop.1 |
| SQL | Existing SQL Server 2022 CU23 image; no fresh server installation/version migration |

## Fresh executed validation

Commands below ran from repository root, using the existing ignored verified local Node and Python environment where
shown. Equivalent PATH-based commands and prerequisites are in [setup](setup.md). PASS means actually executed.
Raw logs are ignored local files under logs/; [validation-results.json](validation-results.json) is the safe compact record.

| Validation | Command | Result | Evidence |
| --- | --- | --- | --- |
| Compose interpolation | docker compose --profile risk --profile backend config --quiet | PASS | Existing configuration, no secret-expanded config printed |
| Docker services | docker compose ps | PASS | sqlserver, risk-api, risk-worker, spring-boot-api running healthy |
| Spring readiness | Invoke-RestMethod http://127.0.0.1:8081/actuator/health/readiness | PASS | status UP |
| Flask health | Invoke-RestMethod http://127.0.0.1:8000/health | PASS | status ok; liveness only |
| Formatting/lint/types/unit/components/proxy/build | local Node widget/scripts/check.cjs | PASS after formatting correction | final-widget-rerun.log |
| Existing Jest unit + component tests | check.cjs official Jest invocation | PASS: 5 suites, 72 cases, 0 failures; 4.354 s | dist/test-results.json (ignored) |
| Demo server security/proxy | node --test widget/scripts/demo-server.test.cjs (included in check) | PASS: 12 cases, 0 failures/skips; 334.0428 ms | Node TAP output |
| Smoke-launcher unit tests | Python -B -m pytest widget/scripts/test_backend_launcher.py -q -p no:cacheprovider | PASS: 6 cases, 0 failures/skips; 0.40 s | final-launcher-tests.log |
| Real HTTP client scenarios | Python -B widget/scripts/backend-tests.py | PASS: 22 cases, 0 failures, job checks PASS | widget/integration-results.json |
| Preview builds | npm --prefix widget run preview:build through supported Node/npm | PASS: synthetic and real | final-preview-build.log |
| Playwright | local Node widget/node_modules/playwright/cli.js test -c widget/playwright.config.cjs, DEMO_TEST_URL on port 3100 | PASS: 22 cases, 0 failures/skips/flaky; 32.9 s; process exit 0 | Fresh JSON stats and final-browser-process.log |
| Official MPK archive | Python -B widget/scripts/package-check.py | PASS | widget/package-results.json |
| Isolated npm install | npm ci --include=optional in credential-free source snapshot | PASS: exit 0, 213.45 s | final-reproducibility.log |
| Isolated official build | node .../mx-scripts.js release:web | PASS: exit 0, 20.86 s | Same uncompressed MPK payloads |
| Offline seed generation | seed.py --dry-run --count 1500 / 15000 --seed 42 | PASS for both counts | 8,770 / 89,982 payment rows respectively; no SQL connection |
| npm advisory audit | npm audit --json; npm audit --omit=dev --json | PASS as audit execution, findings retained | Full audit exit 1: 9 low; production exit 0: zero |
| Git hygiene | git diff --check; ignore/index/history checks | PASS with disclosed history finding | No staging/publication |
| Secret scan | configured values, current access codes, JWT/private-key patterns, history blobs and unpacked MPK | PASS within stated scan coverage | No sensitive-value matches found |
| Local documentation links | Relative Markdown target/anchor audit | PASS: 109 links, zero broken targets/anchors | Setup guide also parsed: 9 PowerShell blocks, zero syntax errors |
| Full clean-machine backend setup | New SQL/ODBC/provisioning/first publication from scratch | NOT RUN | Existing published environment preserved |
| Mendix Studio Pro import/runtime/app export | Not attempted | NOT RUN | Deliberately excluded and mandatory app absent |
| SQL/Flask/Java expensive suites | Historical commands only | NOT RUN in this final audit | No unchanged backend-suite rerun needed |
| Live risk mutation, production auth, load/SLA | Not attempted | NOT RUN | Outside final read-only verification |

Exact fresh output excerpts:

```text
Test Suites: 5 passed, 5 total
Tests:       72 passed, 72 total
Time:        4.354 s

# tests 12
# pass 12
# fail 0
# skipped 0

6 passed in 0.40s
22 passed (32.9s)
Playwright process exit code: 0
```

The HTTP summary has scenariosPassed=22, failed=0, authorizedRiskRunsSubmitted=0 and jobStatusChecks=PASS. Do not add
repeated runs as new cases, or combine all categories as though they validate a complete Mendix application.

### Browser evidence boundaries

| Project | Fresh passing cases | What it establishes |
| --- | ---: | --- |
| mocked-browser | 14 | Controlled responses, delays/errors, state/formatting, retention, auth-expiry presentation |
| real-backend-browser | 7 | Actual Spring/SQL-backed reporting through restricted local proxy, grouping/pages/filters/tenant/permission checks |
| synthetic-browser | 1 | Clearly labelled fixtures, actual component rendering, no API/auth calls |

No authorized risk POST occurred. Risk submission opt-in was disabled. Session codes were used only locally in test
memory, with trace/video/HAR/storage-state recording disabled. This verifies the same-origin proxy, not direct
Mendix-origin CORS or trusted host token delivery. The actual browser tests use fresh preauthorized 15-minute startup
credentials; historical access files are not assumed valid.

## Backend and data preservation

Observed loopback bindings: SQL host 11433 -> container 1433; risk-api 8000; spring-boot-api 8081. Worker is separate.
All four services were healthy and both HTTP health checks returned their expected status-only responses. Existing images
were used; no service rebuild/recreation or volume reset was required. SQL schema/procedure/roles and application backend
source were unchanged. The reporting account, not SA, is used by the corrected smoke fixture-discovery query.

Current active reporting observations: A 669 / USD 248,964,756.01; B 665 / USD 217,399,661.07. The 1,500-total fixture has
1,334 active loans, below the PDF's 1,500+ active-loan context. No reseed was performed to disguise this distinction.
Previous successful publication remains displayed alongside the already recorded failed job. No newly induced live
failure or new publication is claimed. Source synchronization and balance recalculation are not implemented.

## Package verification

- Artifact: widget/releases/axis.loanportfolio.AxisLoanPortfolio.mpk
- Package version: 0.1.0; widget ID: axis.loanportfolio.axisloanportfolio.AxisLoanPortfolio
- Actual size: **32,287 bytes**; SHA-256: **942e073e9bbd79fd6f3866e6a0bde53084071b95c67a1ffdab8c2533ef2c4adb**
- Official build: generated release:web, executed by check.cjs; isolated fresh-dependency build also passed.
- 13 archive entries, including package.xml, AxisLoanPortfolio.xml, compiled JS/MJS/CSS and editor preview/config assets.
- CRC/XML/required-asset checks passed. No source maps, test source, .env or discovered secrets were packaged.
- Entry names and every uncompressed payload match HEAD and the isolated build. ZIP entry ordering/metadata differ;
  byte-identical archive reproducibility is not claimed. An initial order-sensitive comparison was corrected accordingly.
- Official dependencies.txt reports no additional Mendix runtime packages; that metadata is not a legal inventory of
  bundled JavaScript. Runtime library notices are supplied in widget/THIRD_PARTY_NOTICES.md, copied from installed sources.
- Widget build: VERIFIED. MPK inspection: VERIFIED. Studio Pro import: NOT RUN. Mendix runtime: NOT RUN.

## Reproducibility and corrections

A separate ignored .tools source snapshot copied Git-eligible files, with no .env, node_modules or local credentials.
It reused the verified external toolchain and available package cache, successfully installed the pinned npm lockfile,
built the official MPK and generated both fixture sizes offline. It is not a fully cold OS/registry/SQL installation.
Python package installation, host ODBC, fresh SQL provisioning and first publication were not rerun. [Setup](setup.md)
checks those commands against existing provisioners/seed/migrations, distinguishes existing versus new environments and
places first publication behind an explicit new-fixture-only step. No destructive verification was used.

Material reproducibility correction: widget/scripts/backend-tests.py previously read a historical job ID from committed
demo evidence. It now discovers the actual published job with a tenant-qualified, parameterized RiskPublication/RiskJob
join using dedicated reporting credentials. No ID is fabricated, no backend contract changes, and no write is performed.
Six mocked cases cover valid discovery, missing publication, unsafe/missing config, invalid tenant and cleanup on failure.
Without a successful publication two optional HTTP job-status checks are explicitly NOT RUN rather than a false pass.

Other failures/corrections observed during this audit:

- Initial check.cjs exited at Prettier: renamed screenshot-folder path needed wrapping. Formatter corrected only the
  helper layout; rerun passed all categories. Backend behavior was unchanged.
- The first Playwright invocation reported 22 passing cases but the PowerShell wrapper surfaced a nonzero warning status.
  A direct subprocess rerun recorded the actual child exit code 0 and 22 passes. NO_COLOR/FORCE_COLOR notices remain.
- An attempted documentation write had a nested here-string parse error; it did not execute the embedded setup commands.
  Quoting was corrected and the guide was written. No database initialization/publication was accidentally performed.
- Existing generated ESLint legacy-config and dynamic-import packaging notices remain nonfatal. No dependency upgrades
  were introduced to suppress warnings/advisories.

## Security and history audit

Initial scan inspected 162 Git-eligible files and 194 history blobs across all six local commits. It compared configured
password/signing/cursor values and live access codes, and checked JWT/private-key patterns without printing values. No
matches were found; no machine-specific user path was found in submission files. Final post-documentation/archive checks
are recorded in the completion note. This is a bounded local scan, not a guarantee of absence of every possible unknown
historic secret; no external comprehensive secret scanner or production penetration test was run.

AGENTS.md is **not tracked now** and git check-ignore confirms its exclusion, but it exists in earlier Git history. This
is a historical instruction-file finding, not a discovered credential exposure. No history was rewritten; the candidate
must decide whether instruction-history removal is necessary before publication. Current .env, .env.local/.production,
private key patterns, demo codes/reports, .tools, dependencies and virtualenvs are ignored. Safe .env.example remains
Git-eligible. No real environment/access file was added. No confirmed secret exposure requiring rotation was found.

The demo still binds only 127.0.0.1, validates exact Host/Origin/Fetch Metadata, requires session/CSRF/custom headers,
uses a fixed upstream and path/method allowlist and stores JWTs server-side. Profile selection cannot invent tenant or
permission claims. Cookies are HttpOnly/SameSite=Strict and expire; Secure is intentionally absent on loopback HTTP.
Defaults allow reporting/status only. Production identity, HTTPS, RLS and hostile service-credential protection remain
limitations. Local same-user compromise is outside this development boundary.

## Dependency and licensing review

npm advisory results were refreshed: **9 low**, **0 moderate/high/critical**, and **0 production advisories**. Full audit
exit 1 means advisories were reported, not that the command failed to run. No breaking upgrade was made. Node/npm pins,
package-lock, Python requirement closure and Maven Wrapper/BOM are retained. No new dependency was added. Python pins
lack hash locking and some image/OS packages are not digest-pinned; bit-for-bit supply-chain reproducibility is not claimed.
No comprehensive fresh Java/Python vulnerability scanner was installed/run.

Installed metadata observations (not a project-wide licensing grant or legal clearance):

| Component | License metadata |
| --- | --- |
| React/ReactDOM 19.3.1, Mendix SDK 11.16.0 | MIT |
| Big.js 6.2.2, classnames 2.5.1 | MIT; exact source notices copied into widget/THIRD_PARTY_NOTICES.md |
| TypeScript 5.9.3, widget tools 11.15.0, Playwright 1.64.1 | Apache-2.0 |
| Flask 3.1.2 / PyJWT 2.13.0 | BSD-3-Clause / MIT |
| pyodbc 5.2.0 / waitress 3.0.2 | MIT-0 / ZPL 2.1 |
| SQL Server / Microsoft ODBC binaries | Vendor terms; do not assume open-source redistribution |

widget/package.json declares Apache-2.0 and widget/LICENSE contains a generated abbreviated notice (including duplicated
Copyright wording). There is no root license or established repository-wide ownership/distribution decision. These were
not changed into an invented grant. Candidate/assessment owner must approve project licensing and appropriate full
license/NOTICE treatment before public distribution. Adding a project license, changing copyright ownership or publishing
the supplied assessment is not authorized by this audit. GitHub visibility/confidentiality remains undecided.

## Screenshot review

All six actual files in widget/evidence/browser-demo were opened and reviewed after the fresh browser runs:

| File | Classification / review |
| --- | --- |
| real-dashboard.png | REAL BACKEND; group summary, no borrower identities or credentials |
| real-published-risk.png | REAL BACKEND; current published risk groups, no borrower identities |
| real-nested-pagination.png | REAL BACKEND; full loan/borrower identifier cells masked |
| real-filter-empty.png | REAL BACKEND; actual unmatched filter, no borrower identities |
| real-responsive.png | REAL BACKEND; narrow layout and keyboard focus, no borrower identities |
| mocked-error.png | MOCKED ERROR STATE; prominent label, safe controlled error reference |

All fixture data is fictional; password inputs and loan-identifier cells are masked by capture logic. No tokens, cookies,
access codes or sensitive URLs were seen. Screenshots remain local repository assets; no upload occurred. Root README
uses reviewed real evidence and links the additional captures without presenting a mocked outage as real integration.

## Historical evidence and outstanding work

[Reporting validation](reporting-api-validation.md) records historical 45 Java + 106 SQL/Flask + 5 HTTP integration cases;
[widget](widget-validation.md) and [browser](browser-demo-validation.md) records describe prior executions. They are not
added to this audit's fresh counts. Historical sequential performance summaries do not establish production capacity.

Mandatory app/export/runtime gaps remain blockers. Full fresh-machine backend installation, trusted Mendix auth/CRUD/sync,
production OIDC/HTTPS, cron deployment, performance certification and broader accessibility/browser checks remain unverified.
See [submission checklist](submission-checklist.md) and [reviewer walkthrough](demo-walkthrough.md).

Suggested repository description: Tenant-scoped loan portfolio analytics with SQL reporting, asynchronous risk scoring,
a Mendix React widget package and a real-backend browser demonstration.
Suggested topics: loan-analytics, sql-server, spring-boot, flask, react, typescript, mendix, playwright.
Keep visibility private/unchanged until confidentiality and licensing are resolved. Do not create a release or upload.
Suggested commit message after explicit review: `docs: finalize AXIS analytics assessment submission`.


## Completion checks and Git handoff

Post-documentation scan: 169 Git-eligible files plus the unpacked MPK, no configured-secret/access-code/JWT/private-key
pattern matches. All 109 local Markdown references/anchors resolved; all 9 setup PowerShell blocks parsed without errors
and were not executed. Current formatting passed. No backend, SQL, Docker topology, risk policy or production widget
source/typings changes were introduced. Only the smoke test utility and its unit coverage changed functionally; the
screenshot helper received formatting. No dependency upgrade, source deletion or history rewrite occurred.

Nothing is staged. Intended changes comprise .gitignore and safe .env.example; root/widget READMEs; architecture,
requirements/setup/demo/interview/final-validation/submission documents and safe validation JSON; source third-party
notices; smoke discovery/tests; refreshed package metadata/MPK and reviewed screenshot evidence. Local credentials,
AGENTS.md, .tools isolated install, virtualenv/dependencies, logs and raw reports remain ignored. Review `git status --short`
and `git diff --stat` before explicitly authorizing any staging or publication. Publication remains subject to the release checklist.

Read-only final HTTP corroboration compared both tenants with the prior persisted demo evidence: published-run IDs,
risk-group values and latest-risk status all remained unchanged. No authorized scoring submission was used to verify this.
The legacy orchestrator-springboot/.gitkeep placeholder was identified and left untouched; the actual implementation is
spring-boot/. Ignored raw logs/build caches/isolated install remain local and are not submission artifacts.

Final Git snapshot: **0 staged, 17 unstaged tracked paths, 9 untracked intended submission files**. The exact 26-path
inventory is in validation-results.json under gitStatus.paths. This is a review snapshot, not staging authorization.
Actual local-tool commands (repository root) included:

```powershell
widget/.tools/node-v22.23.4-win-x64/node.exe widget/scripts/check.cjs
analytics-flask/.venv/Scripts/python.exe -B -m pytest widget/scripts/test_backend_launcher.py -q -p no:cacheprovider
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/backend-tests.py
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/package-check.py
# The final Playwright child was launched through Python subprocess capture, recording exit 0:
$env:DEMO_TEST_URL='http://127.0.0.1:3100'
widget/.tools/node-v22.23.4-win-x64/node.exe widget/node_modules/playwright/cli.js test -c widget/playwright.config.cjs
```

The test-only port-3100 launcher was stopped after validation. A fresh default-permission reviewer demo was started on
127.0.0.1:3099; its private access file is printed locally and expires within 15 minutes. Never assume it is still valid
at a later review. Use setup.md to stop/relaunch without changing SQL data.
