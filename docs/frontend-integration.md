# Frontend integration handoff

The Spring Boot backend and actual widget source/package are implemented in spring-boot/ and widget/.
Mendix application configuration and trusted host authentication remain outstanding. The authoritative field/enum contract is [data-contract.md](data-contract.md), sections 6/12.
Use Spring at http://127.0.0.1:8081 locally; configure the exact Mendix origin through PORTFOLIO_CORS_ORIGINS.
All requests use Authorization: Bearer <verified token>. No tenant selector/body/query supplies authorization.
Production must provide a trusted OIDC/token delegation boundary; never embed the development signing secret in a widget.

## Request sequence

1. GET /api/v1/portfolio/metadata with portfolio:read. Use dimensions.value (division, loanOfficer, borrowerType,
   riskRating), maxDepth=2, defaultStatus=ACTIVE, defaultLimit=50, maxLimit=100, USD/fractionPerYear.
2. GET /api/v1/portfolio/groups?groupBy=division&subgroupBy=loanOfficer. Render returned groups and SQL totals.
3. Expand one parent using /groups/children?groupBy=division&subgroupBy=loanOfficer&parentKey=<encoded label>.
4. Fetch a leaf using /loans?groupBy=division&subgroupBy=loanOfficer&groupKey=<parent>&subgroupKey=<child>&limit=50.
   With no subgroup, /loans requires only groupBy/groupKey. Copy nextCursor unchanged into subsequent requests;
   keep filters, path and limit identical. Null nextCursor ends pagination. Order is LoanNumber ASC, LoanId ASC.

Use URLSearchParams rather than string concatenation for labels. A null key uses parentKeyIsNull=true on children,
groupKeyIsNull=true on loans, or subgroupKeyIsNull=true for a null child. Omit the corresponding key parameter.
The string "null", empty string and missing key are distinct from SQL NULL. Never send labels as null sentinels.
No third grouping level or arbitrary sort is supported. Same primary/secondary dimension is invalid.

Filters (each at most once) are status=ACTIVE|CLOSED|DEFAULTED, division=<label>, borrowerType=INDIVIDUAL|CORPORATE,
riskRating=HIGH|MEDIUM|LOW, originationFrom/to=YYYY-MM-DD inclusive. Default status is ACTIVE. Preserve identical
filters from root to child to loans. Unknown/repeated params, tenantId, bad enums/date ranges and limit>100 return 400.
Risk NULL can be selected through a riskRating grouping path, not a made-up UNRATED enum filter.

## Response semantics

Group responses contain groupBy, subgroupBy (nullable), snapshotVersion, riskRunId (nullable), asOfUtc (nullable),
currency, rateUnit, requestId, groups. Child responses additionally contain parent:{dimension,key}. A group contains
key (nullable), label, loanCount, totalBalance, averageInterestRate (nullable), hasChildren. hasChildren indicates the
configured second grouping level; leaf groups still allow loan expansion.

Loan responses contain the same version/unit/request metadata plus loans and nextCursor. Loan fields are loanId,
loanNumber, borrowerName, borrowerType, industry, division, loanOfficer, principalAmount, currentBalance, interestRate,
status, originationDate, maturityDate, daysPastDue, lastPaymentDate, borrowerRiskRating and loanRiskRating.
Only request individual pages; never download all loans for browser aggregation.

Money is an exact two-place string. Rate fields are eight-place decimal strings, annual fractions: "0.08250000"
means 8.25%. Group rate is unweighted AVG ignoring NULL, not a weighted average. Preserve strings and use a decimal-aware
formatting approach; don't calculate totals with JavaScript Number. A null average displays an em dash, never zero.
LoanRiskRating NULL displays Unrated; BorrowerRiskRating is a separate attribute. Null division/officer displays Unassigned.
Retain null group keys internally even when rendering these labels. Enum values remain uppercase.

snapshotVersion is a source watermark, asOfUtc the latest source sync, riskRunId the published score identity.
Compare all three before combining a root response with children/pages. If they differ, clear that expansion and refetch
root data. Current source facts can be newer than published ratings. Cursors detect a changed watermark/as-of/publication
but do not pin data across requests; conforming source synchronization is required. Group cap100 returns an explicit error,
not a partial list; group pagination is deferred.

## Risk controls and states

Require risk:run separately for POST /api/v1/portfolio/risk-runs with Content-Type application/json, body {}, and a
new Idempotency-Key for each intentional execution. The response is 202 {jobId,status,requestId}; keep the key across
network/503 retries. Duplicate keys return the same job, including after failure. An active conflicting job gives409.
GET /risk-runs/{jobId} requires risk:read and returns jobId,status,processedLoans,totalLoans,requestId. QUEUED totals
may be zero until snapshot capture. Never substitute RunId for JobId. Another tenant's job returns404.
GET /risk-runs/latest with risk:read returns runId (last successful publication), policyVersion, publishedAtUtc,
jobStatus (latest request, nullable), lastRequestedAtUtc. A FAILED latest job can coexist with a valid published run.
portfolio:read alone cannot call either risk-status route or submit. Hide controls based on permissions; backend checks
remain authoritative. Flask retains its own runId interface and permission checks unchanged.

Provide loading, empty, failed/retry and stale/recalculating states. Poll status with a modest interval (for example2s),
stop on SUCCEEDED/FAILED, cancel on unmount/identity change. While QUEUED/RUNNING, retain displayed published results;
on success refresh roots and clear expanded caches/cursors. On failure keep existing ratings and show failure state.
Cache keys include identity/tenant and every grouping/filter/path/version. Never combine data across authenticated tenants.

## Errors and connectivity

Errors use {error:{code,message,requestId}} and X-Request-Id. Do not show raw stack traces. 401 requires reauthentication;
403 means insufficient permission or forbidden origin/tenant;404 hides foreign jobs;400 means invalid input/cursor;
409 SNAPSHOT_CHANGED requires refresh (ACTIVE_RUN_EXISTS means poll existing job);429 requires bounded backoff;
503 means dependency/database unavailable, retry conservatively. Keep POST idempotency keys on ambiguous outcomes.
Health-only /actuator/health/liveness and /readiness are anonymous, status only. Health is not permission evidence.

The local services use HTTP bound to127.0.0.1. A browser running elsewhere cannot use its own localhost to reach them;
deploy behind HTTPS and configure the actual API origin. CORS is an explicit origin allowlist, no wildcard/credentials.
Use AbortController for stale requests and check identity plus response versions before applying a result. Do not store
signing secrets/tokens in committed widget properties. The widget package is now delivered. Mendix embedding/manual smoke test,
OIDC integration and upstream Mendix-to-analytics synchronization remain future integration work.


For the implemented widget and exact browser demonstration property/session/import steps, see [widget README](../widget/README.md)
and [browser demonstration handoff](phase5-integration.md). widget implementation evidence distinguishes DOM tests, real HTTP checks and pending
Studio Pro/browser validation in [phase4-validation.md](phase4-validation.md).
