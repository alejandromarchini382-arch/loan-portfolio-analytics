# reporting API implementation backend validation - 2026-10-31

Implemented under spring-boot with Java 17, Spring Boot 3.5.16, Maven Wrapper 3.9.11 and JDBC. No React/Mendix changes,
SQL table/index changes, new database objects or PublishRiskRun modifications. The only Flask behavior addition accepts
an explicit portfolio:read grant while preserving risk permission checks and legacy token defaults.

## Executed automated results

Final Java packaging command (inside the Dockerfile's Java 17 build stage):

```text
sh ./mvnw -B package
Tests run: 19, Failures: 0, Errors: 0, Skipped: 0 -- SecurityWebTests
Tests run: 26, Failures: 0, Errors: 0, Skipped: 0 -- DomainTests
Tests run: 45, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
Total time: 11.066 s
```

The actual image build command was `docker compose --profile backend build spring-boot-api`.
The earlier Java 17 wrapper test invocation also passed 44 cases before the optional-not-before test was added.
The final 45-case packaging run includes JsonLimits in the MVC test configuration.

With RISK_INTEGRATION=1 and PORTFOLIO_INTEGRATION=1:

```text
analytics-flask/.venv/Scripts/python.exe -B -m pytest spring-boot/tests -q -rs -p no:cacheprovider --tb=short
.....                                                                    [100%]
5 passed in 143.07s (0:02:23)
```

These tests run real HTTP against temporary Spring/Flask containers, SQL Server and dedicated accounts. They reuse the
existing SQL fixture infrastructure with generated loan_sql_test_* databases and delete only those generated resources.
Both 1500 and 15000 fixtures verify all four root dimensions for both tenants, SQL monetary totals/nullable AVG, nested
children and deterministic paging. Other cases verify null/zero/empty/Unrated data, cursor tampering/tenant/filter/expiry/
source changes, idempotency, delegation, permission separation, foreign-job404, staging invisibility, success/failure
preservation and real reporting-account denials of writes, stage reads and publication execution.

With SQLSERVER_TESTS=1, RISK_INTEGRATION=1, SQLSERVER_HOST=127.0.0.1,11433, SQLSERVER_USER=sa, local administrative password
loaded from ignored.env without displaying it, and SQLSERVER_TRUST_SERVER_CERTIFICATE=yes:

```text
analytics-flask/.venv/Scripts/python.exe -B -m pytest sql/tests analytics-flask/tests -q -rs -p no:cacheprovider --tb=short
........................................................................ [ 67%]
..................................                                       [100%]
106 passed in 85.25s (0:01:25)
```

That combined run contains 33 SQL and 73 Flask cases, including SQL smoke tests and the new reporting-only permission test.
All final suites executed without skips: 156 passing cases across 45 Java, 5 HTTP integration and 106 SQL/Flask tests.
The preceding [risk service implementation gate](phase2-validation.md) separately records33 SQL,72 Flask and105 combined passes before that
permission test. No coverage percentage is claimed.

## Docker and local environment

Executed successfully:

```text
docker compose --profile risk --profile backend config --quiet
docker compose --profile backend build spring-boot-api
docker compose --profile risk --profile backend up -d --no-build --wait risk-api spring-boot-api
docker compose ps
docker compose exec -T spring-boot-api id
docker compose exec -T spring-boot-api java -version
```

Final service state: sqlserver healthy, risk-api healthy, risk-worker healthy, spring-boot-api healthy.
Spring uid 10001, Temurin 17.0.17+10, localhost 8081. Flask localhost 8000. Host Java 23 remains unchanged.
SQL Server 2022 CU23 retains its existing named volume and data. The original worker container was retained; its scoring
code is unchanged. The API image was updated to accept the approved explicit reporting permission vocabulary.
Provisioning ran again successfully without rotating existing credentials. The reporting login is analytics_reader only;
normal operation never uses SA. Administrative tests/provisioning use SA explicitly and separately.

Corrections and failed intermediate checks, reported rather than hidden:

- Initial Java compilation found an incorrect CORS rejection method signature and a missing test annotation import;
  both were corrected before the first44-pass run.
- The first container startup found a JsonLimits configuration/bean naming collision. The first HTTP run therefore had
  5 setup errors in 490.88s; it did not validate any endpoint behavior. Renamed the bean and imported the configuration
  into MVC tests. An intermediate rebuild also failed for the new test's missing JsonLimits import; corrected it.
- Docker Desktop became unavailable during the interrupted work. After restarting it, Windows' excluded TCP range
  1430-1529 prevented the old localhost 1433 mapping. The next HTTP run had 5 connection setup errors in 32.19s.
  Restarting SQL alone did not restore the binding; recreating that container first reported a Windows port-permission
  failure. Used the existing SQLSERVER_PORT override 11433 and RISK_TEST_HOST=127.0.0.1,11433. Internal port 1433, credentials,
  schema and named storage were preserved. No volume deletion or reseeding occurred. The final rerun passed as above.

## Persistent1500-loan demonstration

Executed:

```text
analytics-flask/.venv/Scripts/python.exe -B spring-boot/scripts/demo.py
{
  "success": true,
  "activeLoans": [669, 665],
  "inactiveUnrated": 166,
  "failure": {
    "status": "FAILED",
    "errorCode": "SOURCE_SNAPSHOT_CHANGED",
    "previousPublicationPreserved": true,
    "sameKeySameJob": true,
    "crossTenantStatus": 404,
    "reportingOnlySubmissionStatus": 403
  }
}
```

The fixture already had published ratings from the risk-service demonstration, so the demonstration preserved its existing publication rather than claiming
an initially Unrated live database. The isolated HTTP integration cases separately demonstrated initial Unrated -> staging
invisibility -> successful publication. The persistent demonstration temporarily stopped the existing continuous worker,
ran the same worker code in a separate process under the actual worker account, then restarted the existing container
in finally cleanup. Batches were 100 for observation; the service default remains 1000.

| Verified result | Tenant A | Tenant B |
| --- | --- | --- |
| Active loans | 669 | 665 |
| Active balance (USD) | 248964756.01 | 217399661.07 |
| POST202 latency (ms) | 211.66 | 51.65 |
| Paginated selected division | 142 unique loans /21 pages | 143 unique loans /21 pages |

Every root dimension matched direct tenant-qualified SQL counts, SUM and unweighted AVG. Nested children reconciled
with their parent. Reports retained the old groups/publication after every staged batch, then changed publication UUID
only on success. A subsequent run advanced one fictional loan's source version in both source/projection in one
transaction, without editing money or payment inputs. Publication rejected it with SOURCE_SNAPSHOT_CHANGED; old groups
and publication UUID remained. Same key returned the same job. Tenant B could not retrieve Tenant A's job. Reporting-only
submission returned 403. All 166 inactive loans remain Unrated. Aggregate-only evidence is in
[spring-boot/demo-results.json](../spring-boot/demo-results.json); no bearer tokens or personal records are stored.

## Local HTTP measurements

Each operation had 3 warmups and 20 measured requests from host Python to the API container. Reported p95 is the 19th
ordered sample (nearest-rank). These are local, small, sequential HTTP measurements on shared Docker resources,
not an isolated load/concurrency benchmark or production guarantee. The persistent demo also ran during part of this
validation, so comparisons between sizes do not establish scaling trends. SQL query-plan analysis was not performed;
no additional indexes were justified from these bounded measurements.

| Operation |1500 p50/p95 ms |15000 p50/p95 ms |
| --- | --- | --- |
| Division groups |63.895 /92.192 |36.677 /75.463 |
| Officer groups |26.441 /68.991 |31.282 /75.083 |
| Borrower type groups |21.360 /62.930 |39.307 /58.466 |
| Published risk groups |24.413 /50.922 |39.073 /62.680 |
| Nested children |19.975 /62.652 |25.658 /44.651 |
| Loan page |20.397 /63.797 |23.274 /37.355 |

Raw summary artifacts: [1500](../spring-boot/performance-1500.json), [15000](../spring-boot/performance-15000.json).
API container is constrained to 1 CPU/512MiB, JVM heap 256MiB; existing SQL Server is shared. Each response is one SQL
statement; existing RCSI is off, so HOLDLOCK provides bounded statement-duration consistency. Short contention with
publication remains possible; no claim of zero blocking or sustained concurrent throughput is made.

## Limits and handoff

Development HS256 authentication is fail-closed and tested, but production OIDC/JWKS, HTTPS, secret rotation and trusted
Mendix delegation remain integration work. Database RLS is deferred; trusted service SQL binds verified tenants on every
data query. The shared read login can otherwise read multiple tenants. Rate limiting is per instance, not distributed.
There is no division-specific authorization policy beyond the documented tenant scope.

Cursors are signed, not encrypted, and do not preserve a permanent snapshot. They validate the observed source watermark,
last sync and publication UUID; nonconforming writes/deletes may evade those watermarks. Source synchronization must
honor its existing version protocol. Group lists cap 100 with explicit error; only loans paginate. No production load,
SQL-plan, long-running contention, external OIDC, browser/Mendix connectivity or nativeJava 17 startup test was executed.
The Java 17 Docker path was executed. The RCSI-enabled branch was not separately integration-tested; this SQL database has RCSI off. Existing SQL/Flask failure-recovery tests ran, but no new host cron task was installed.

[Frontend handoff](frontend-integration.md) contains route/field/auth/decimal/null/filter/pagination/error/version/state
instructions. This report predates the widget and browser demonstration; see the widget and browser validation reports
for subsequent evidence. Mendix application embedding and export remain outstanding.
