# AXIS Loan Portfolio Analytics

Assessment prototype: SQL Server data layer, Flask risk computation and Spring Boot reporting are implemented.
The custom Mendix React widget source/package is now available; Mendix application integration remains the next phase.

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

[risk service implementation validation](docs/phase2-validation.md) records the completed gate before reporting changes.
[reporting API implementation validation](docs/phase3-validation.md) records final executed commands/results, corrections and limitations.
Component READMEs explain JUnit, pytest and opt-in disposable SQL/HTTP integration tests. No tests are assumed to pass
merely because a command is documented. Java 17 runs in Docker; the host Java 23 installation is unchanged.

Next: import the delivered widget, connect the trusted session bridge, then embed and smoke-test
it in Mendix Studio Pro. OIDC/HTTPS production integration, Mendix synchronization, .mpk export and final submission
remain outstanding assessment work. No Redis, Kafka, RabbitMQ, JPA or additional runtime infrastructure was introduced.


## widget implementation widget

The actual Mendix React/TypeScript widget source, official build setup, lockfile and MPK are in
[widget](widget/README.md). [widget implementation validation](docs/phase4-validation.md) records executed checks; Studio Pro import,
runtime rendering and trusted Mendix authentication remain pending. Follow the precise [browser demonstration handoff](docs/phase5-integration.md).
The backend components and persistent fixture are unchanged. No commit or push is performed automatically.
