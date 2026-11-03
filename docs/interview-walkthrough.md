# Technical interview walkthrough

Use these notes to explain the implemented system. They describe code/evidence, not invented employment experience or
production deployment. Start with the [five-minute demo](demo-walkthrough.md); consult the [requirements matrix](assessment-requirements.md)
for the difference between engineering readiness and assignment completion.

## Business problem and boundaries

The assessment describes a lender portfolio team exporting data to spreadsheets. The demonstrator replaces that manual
reporting step with group totals, filters and drill-down. It does not replace the operational lending system. The actual
Mendix loan-management app is missing; the browser host exists only to present/test the same React widget components.

## Why these components?

SQL Server owns financial aggregation and publication integrity. Spring is a small JWT -> tenant -> parameterized SQL ->
DTO layer. Flask owns the pure Decimal policy and asynchronous worker, not another reporting API. React renders lazy
responses and exact financial strings. Flask and Spring are optional in the assignment; they are implementation choices,
not proof of the required Mendix app. No broker or new orchestration infrastructure was necessary for this prototype.

## SQL and growth

GROUP BY/COUNT/SUM/AVG execute where the indexed tenant-scoped projection lives. Tenant-leading covering indexes support
dimensions; nullable rates are excluded from the unweighted SQL average. Money is DECIMAL(18,2), rate DECIMAL(7,4), and
JSON carries decimal strings. The UI uses Big.js for exact display/complete-root summary sums, not bulk loan aggregation.
Averages are not recomputed from rounded group averages; no invented overall average is shown.

The current fixture has 1,500 total / 1,334 active loans. Larger-fixture correctness tests and sequential timing files are
historical evidence. They do not certify concurrent throughput, an SLA, production query plans or unlimited growth.
Review indexes and actual plans with production distributions before adding infrastructure.

## Risk processing and failures

Submission creates an idempotent tenant job; the HTTP request does not calculate risk. Separate workers claim with locks,
attempt fencing and expiring leases. A consistent active-input snapshot is processed in batches, with heartbeat/progress
checks and source versions. Scores remain in RiskScoreStage. PublishRiskRun validates exact population/counts/versions and
atomically switches RiskPublication together with success. Failed/incomplete runs retain the old pointer and visible
ratings. Reclaimed jobs use a new attempt/fresh snapshot; permanent scoring errors are not retried forever.

risk-demo-v1 is explicitly a prototype assumption: High before Medium before Low, using the canonical Decimal thresholds.
Borrower risk is not the computed loan rating. Unpublished loans are Unrated. No balance-recalculation formula was supplied;
authoritative balance refresh is upstream, and Mendix synchronization has not been implemented. Nightly execution is a
cron-compatible command or separate loop, not a configured cron deployment inside Flask request workers.

## Spring/JDBC and pagination

JDBC keeps SQL-heavy grouping visible and parameterized without an unnecessary ORM model. A fixed dimension allowlist
selects trusted SQL expressions; values are bound. Tenant identity comes from a verified token, never a browser tenant
field. Reporting/status/submission permissions remain distinct. Spring delegates risk POST with the verified bearer;
it does not create a second risk worker or publish scores.

Each reporting response combines metadata/data in one bounded SQL statement. Existing RCSI is used if enabled; the
fallback uses statement-duration consistency locks. Multiple ordinary SELECTs are not claimed to share a snapshot.
Source watermark and published-risk ID differ. Signed keyset cursors bind tenant, filters, group path, expiry/version and
deterministic position; the unique ID breaks ties. Data can change between requests, so mismatches refresh data rather
than promising a permanent multi-page snapshot.

## React and browser security

Root groups load first, expansion loads children, and leaf expansion loads limited loans. AbortController plus request
ownership and version checks fence stale responses. Identity/scope changes remount state and discard caches, pages,
polling and pending submission intent. Previous/Next uses actual visited cursors; no fabricated page counts.

Production widget auth is injectable from trusted host bindings. Mendix permission hints are presentation only. The demo
uses a separate localhost transport: opaque HttpOnly/SameSite session + CSRF, with JWTs held server-side and a strict
fixed-upstream allowlist. The signing secret stays in the local operator launcher. Profile codes select only preauthorized
fixture scope; no public endpoint accepts arbitrary tenant/permission claims. Default profiles cannot submit risk jobs.
This is not production OIDC, HTTPS deployment, RLS or trusted Mendix session integration.

## Tests and evidence

Fresh counts/commands are in final-validation.md. Explain the boundaries: Jest/client mocks; proxy security tests with a
fake upstream; real browser HTTP scenarios through Spring; synthetic preview with no backend; and real Node HTTP checks.
Never total historical reruns as extra unique cases. Expensive SQL/Flask/Java suites remain historical in this audit.
The new smoke-launcher unit tests verify tenant-qualified published-job discovery, resource cleanup and rejection of
unsafe configuration; historical demo IDs are not trusted as current fixture identity.

Reviewed screenshots contain fictional data, masked loan/borrower identifiers and clear real/mocked labels. Packaging
checks validate the ZIP/XML/editor/runtime assets, not Studio Pro import or actual embedded runtime.

## Trade-offs and next action

Within development scope, the browser/backend/widget deliverable is reviewable with documented limits. The original
assessment remains incomplete because it requires an operational Mendix app and app export. Studio Pro was deliberately
outside the implemented scope; no Mendix runtime was simulated. Request acceptance of a substitute before claiming
compliance. Production work would include reviewed identity/tenant mapping, HTTPS/OIDC, upstream synchronization/version
protocol, scheduled operations, retention, service credential hardening and measured capacity/accessibility testing.
Project licensing and repository visibility remain release decisions.
