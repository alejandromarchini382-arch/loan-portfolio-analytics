# AXIS Loan Portfolio Analytics

Assessment prototype: SQL Server data layer, Flask risk computation and Spring Boot reporting are implemented.
The custom Mendix React widget source/package and an additional real-backend browser demonstration are available.
Mendix Studio Pro import and runtime integration remain unverified.

| Component | Implementation / setup |
| --- | --- |
| SQL Server 2022 | [sql/README.md](sql/README.md): schema, covered indexes, deterministic fictional seeds, smoke tests |
| Flask + separate worker | [analytics-flask/README.md](analytics-flask/README.md): risk-demo-v1, leases, staging, atomic publication, scheduling |
| Spring Boot / Java 17 | [spring-boot/README.md](spring-boot/README.md): JWT, tenant-scoped JDBC aggregation, two grouping levels, signed loan cursors, Flask delegation |
| Frontend handoff | [docs/frontend-integration.md](docs/frontend-integration.md): exact routes, fields, auth, lazy loading and response-version rules |

Canonical contracts are [data-contract.md](docs/data-contract.md); decisions are in [decisions.md](docs/decisions.md).
No production lending policy is claimed. The prototype is USD-only. SQL money is DECIMAL(18,2); rates DECIMAL(7,4)
annual fractions. Reporting emits exact decimal strings and reads the last successful risk publication only.

## Existing local checkout

Retain ignored .env and the persistent SQL volume. Follow component READMEs for first-time initialization/provisioning.
The following starts the available backend (PowerShell, root):

```powershell
docker compose --profile risk --profile backend config --quiet
docker compose --profile risk --profile backend up --build -d --wait
docker compose ps
Invoke-RestMethod http://127.0.0.1:8081/actuator/health/readiness
```

Spring listens on localhost:8081, Flask on localhost:8000. This checkout uses SQLSERVER_PORT=11433 because Windows
reserved host port 1433 after a Docker restart; internal SQL remains sqlserver:1433. Preserve the configured password
with the existing volume. Host connections use 127.0.0.1,11433; RISK_TEST_HOST records that override. No SQL structures,
indexes or PublishRiskRun were changed for reporting API implementation. Normal services use dedicated non-owner accounts.

The 1500-loan fixture has already been scored. Active loans are published;166 inactive loans remain Unrated.
Do not reset publications just to repeat a demonstration. [reporting API implementation results](spring-boot/demo-results.json) record the
latest HTTP reporting/delegation demonstration; [risk service implementation results](analytics-flask/demo-results.json) retain its history.

## Validation and next phase

[SQL and risk validation](docs/risk-service-validation.md) records the completed gate before reporting changes.
[Reporting API validation](docs/reporting-api-validation.md) records final executed commands/results, corrections and limitations.
Component READMEs explain JUnit, pytest and opt-in disposable SQL/HTTP integration tests. No tests are assumed to pass
merely because a command is documented. Java 17 runs in Docker; the host Java 23 installation is unchanged.

The widget MPK is delivered. Remaining work: import it, connect a trusted session bridge and embed/smoke-test
it in Mendix Studio Pro. A real Mendix operational app/export, OIDC/HTTPS production integration, synchronization and final
submission remain outstanding assessment work. No Redis, Kafka, RabbitMQ, JPA or additional runtime infrastructure was introduced.


## Mendix widget

The actual Mendix React/TypeScript widget source, official build setup, lockfile and MPK are in
[widget](widget/README.md). [Widget validation](docs/widget-validation.md) records executed checks; Studio Pro import,
runtime rendering and trusted Mendix authentication remain pending. Follow the precise [deferred Mendix handoff](docs/mendix-integration.md).
The backend components and persistent fixture are unchanged. No commit or push is performed automatically.


## Real browser demonstration

The existing React widget dashboard runs against the real Spring API through a restricted localhost session proxy.
Synthetic preview is a separately labelled mode with no backend calls. JWTs remain server-side; there are no browser
signing secrets, stored bearer tokens or automatic risk jobs. No backend source or persistent data was changed.

With the existing authorized ignored .env, initialized fixture and supported Node/npm/Python installed:

```powershell
docker compose --profile risk --profile backend up -d --no-build --wait
npm --prefix widget run preview:build
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/demo.py --mode real --port 3099
```

Open **http://127.0.0.1:3099**. The launcher prints the path of a private, ignored access-code file; open it locally and
use the matching profile/code. Sessions/startup credentials expire within 15 minutes. Relaunch to renew; Ctrl+C cleans
up the launcher. Do not expose this development server publicly or reset/reseed the database.

[Widget setup and reviewer walkthrough](widget/README.md#browser-demonstration),
[browser demonstration results](docs/browser-demo-validation.md), [redacted screenshots](widget/evidence/browser-demo), and
[Submission checklist](docs/submission-checklist.md) explain reproduction, tests, security and remaining work.

**The official Mendix `.mpk` package was built and validated, but Studio Pro import and Mendix runtime execution were
not performed.** The browser demonstration is an additional validation surface, not a completed Mendix application.
