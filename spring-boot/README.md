# Spring Boot portfolio reporting API

Java 17, Spring Boot 3.5.16, Spring JDBC and Maven Wrapper 3.9.11. This is the thin reporting boundary:
verified JWT -> tenant authorization -> parameterized SQL aggregation -> DTO. SQL tables/procedures are unchanged.
SQL owns COUNT/SUM/AVG; Java uses BigDecimal and emits exact decimal strings. Risk requests delegate to Flask with
the original verified bearer token. Java never calculates risk or reads unpublished score stages.

## Start locally (PowerShell, repository root)

First follow [SQL setup](../sql/README.md) and [Flask setup](../analytics-flask/README.md). Retain the existing ignored
.env and SQL volume. Never reseed/reset a published demonstration just to rerun it.

```powershell
# Uses the existing Python environment and local administrative credential only for provisioning.
analytics-flask/.venv/Scripts/python.exe -B spring-boot/scripts/provision.py
docker compose --profile risk --profile backend config --quiet
docker compose --profile risk --profile backend up --build -d --wait
docker compose ps
Invoke-RestMethod http://127.0.0.1:8081/actuator/health/readiness
```

Provisioning adds only missing PORTFOLIO_* entries to ignored .env; existing credentials are not rotated. The dedicated
login is added to analytics_reader, never db_owner. SA is used only for this administrative command and disposable tests.
Normal Spring operation uses PORTFOLIO_DB_USER/PASSWORD, with no INSERT/UPDATE/DELETE, stage SELECT or publication EXECUTE.
Compose preserves SQL storage. API ports bind localhost. The image runs uid 10001 with Java 17, 1 CPU/512MiB limits;
the host's Java installation is not changed. Maven packaging executes the JUnit suite.

For native execution, point JAVA_HOME for this shell at a Java 17 JDK, and load configuration from ignored .env:

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
$env:PORTFOLIO_DB_HOST='127.0.0.1'
$env:PORTFOLIO_DB_PORT=$env:SQLSERVER_PORT # 11433 in this checkout after Windows reserved 1433
$env:PORTFOLIO_TRUST_CERTIFICATE='true' # local self-signed SQL certificate only
$env:FLASK_BASE_URL='http://127.0.0.1:8000'
.\spring-boot\mvnw.cmd -f spring-boot/pom.xml test
.\spring-boot\mvnw.cmd -f spring-boot/pom.xml spring-boot:run
```

Or run the wrapper with Java 17 entirely in Docker:

```powershell
docker run --rm -v "${PWD}/spring-boot:/workspace" -v axis-maven-cache:/root/.m2 -w /workspace maven:3.9.11-eclipse-temurin-17 sh ./mvnw -B test
```

## Authentication and API

Development JWT mode must be explicitly enabled. Missing configuration fails startup. Signature HS256, issuer,
audience, expiration, issued-at, optional not-before, subject, tenant UUID/allowlist and permissions are validated.
After loading .env into the shell as shown above, the existing token helper can issue an explicit reporting permission
(do not print or commit its result):

```powershell
$tenant=($env:RISK_TENANTS -split ',')[0]
$token=docker compose --profile risk exec -T risk-api python -m risk.token --tenant $tenant --permission portfolio:read
$headers=@{Authorization="Bearer $token"}
Invoke-RestMethod -Headers $headers 'http://127.0.0.1:8081/api/v1/portfolio/metadata'
Invoke-RestMethod -Headers $headers 'http://127.0.0.1:8081/api/v1/portfolio/groups?groupBy=division&subgroupBy=loanOfficer'
```

The helper runs in the configured Flask container. Token defaults remain risk:read + risk:run; reporting is explicit.
Use repeatable --permission flags for a combined token only when the caller should hold those permissions.

| Route under /api/v1/portfolio | Permission | Behavior |
| --- | --- | --- |
| GET /metadata | portfolio:read | Dimension allowlist, units and limits |
| GET /groups | portfolio:read | Root SQL aggregates |
| GET /groups/children | portfolio:read | Second grouping level for one parent |
| GET /loans | portfolio:read | Signed keyset pagination of a selected leaf |
| POST /risk-runs | risk:run | Empty JSON + Idempotency-Key; Flask delegation, 202 with jobId |
| GET /risk-runs/{jobId} | risk:read | Tenant-qualified status/progress |
| GET /risk-runs/latest | risk:read | Latest job state and successful publication |

Do not send tenantId in requests. A reporting-only token cannot submit or inspect risk jobs. JobId is the public Spring
job identifier; RunId identifies the internal scoring/publication run. The mapping always includes the verified tenant.
See [frontend handoff](../docs/frontend-integration.md) and the canonical [contract](../docs/data-contract.md), sections 6/12.

## Environment

| Variable | Default / purpose |
| --- | --- |
| RISK_AUTH_MODE | Required development-jwt; deliberately no anonymous fallback |
| RISK_JWT_SECRET | Required >=32 UTF-8 bytes; development HS256 signing key |
| RISK_JWT_ISSUER / RISK_JWT_AUDIENCE | Required; match Flask |
| RISK_TENANTS | Required comma-separated authorized UUIDs, max 100 |
| PORTFOLIO_CURSOR_SECRET | Required independent >=32-byte key |
| PORTFOLIO_DB_HOST / PORTFOLIO_DB_PORT | 127.0.0.1 / 1433; Compose host sqlserver |
| PORTFOLIO_DATABASE | LoanPortfolio |
| PORTFOLIO_DB_USER / PORTFOLIO_DB_PASSWORD | Required dedicated reporting login; sa rejected |
| PORTFOLIO_TRUST_CERTIFICATE | false; Compose true only for local SQL container |
| FLASK_BASE_URL | http://127.0.0.1:8000; Compose http://risk-api:8000 |
| PORTFOLIO_QUERY_SECONDS | 5; range 1-30 |
| PORTFOLIO_CURSOR_SECONDS | 900; range 1-3600 |
| PORTFOLIO_REQUESTS_PER_MINUTE | 120 per verified tenant per instance; range 1-100000 |
| PORTFOLIO_CORS_ORIGINS | Empty = no cross-origin access; explicit comma-separated origins |
| SERVER_PORT / PORTFOLIO_PORT | Native 8081 / Compose host 8081 (internal 8080) |

Compose exposes the standard local settings; optional Java settings can be supplied through a Compose override or
native environment. JDBC pool max 5, login/connect 5s, Flask connect/read 5s. JSON body max 1KiB and bounded nesting.
Structured ECS JSON logs contain generated requestId, verified tenant, status and duration, never records or tokens.

## Consistency and recovery

Each report is one SQL statement, including source watermark and publication identity. Existing RCSI is used when on;
otherwise statement-duration HOLDLOCK provides serializable consistency. No database isolation setting is changed.
Current SQL has RCSI off, so short read locks can briefly delay publication. Query timeout bounds this exposure.
snapshotVersion is MAX(SourceVersion), not the publication version. riskRunId separately identifies the successful
risk run. asOfUtc is MAX(LastSyncedUtc), not the request clock. Source facts can be newer than published risk scores.

Cursors bind tenant, filter/group path, limit, SQL ordering position, watermark/as-of, publication and expiry.
400 INVALID_CURSOR means discard the cursor; 409 SNAPSHOT_CHANGED means discard expanded data/pages and refresh.
They are signed, not encrypted. Data is not pinned between requests; conforming source writes must update versions
and synchronization time. MAX/version/time cannot detect all deletes or nonconforming upstream writes.

Flask downtime returns sanitized 503; retry the same idempotency key after an uncertain POST, rather than create a new
job. Failed runs remain visible and retain prior published ratings. Worker recovery/scheduling remains owned by Flask.
Per-instance throttling is deliberately small; production needs reviewed gateway rate controls and trusted OIDC/JWKS,
HTTPS, secret rotation, tenant/division authorization and network restrictions. RLS remains deferred: the database login
can read multiple tenants, so SQL predicates enforce service isolation. No production deployment claim is made.

## Tests and demonstration

```powershell
# Requires SQL container and both local images; creates/drops only generated loan_sql_test_* databases.
$env:RISK_INTEGRATION='1'
$env:PORTFOLIO_INTEGRATION='1'
analytics-flask/.venv/Scripts/python.exe -B -m pytest spring-boot/tests -q -rs -p no:cacheprovider --tb=short
# Persistent 1500-loan fixture: briefly stops/restarts the existing worker; never resets published ratings.
analytics-flask/.venv/Scripts/python.exe -B spring-boot/scripts/demo.py
```

JUnit covers validation, monetary formatting, cursor integrity/expiry/version changes, JWT failures, tenant and permission
boundaries, CORS, error sanitization and rate limiting. HTTP tests use actual SQL Server, dedicated users and actual Flask
containers/worker code, including 1500/15000 datasets. Performance JSON files record 20 warmed local HTTP samples per
operation (p50/p95), not load/concurrency guarantees. No extra indexes are added without plan evidence.

Actual execution results are recorded in [Phase 3 validation](../docs/phase3-validation.md).
