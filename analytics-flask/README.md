# Flask risk-scoring service

Implements `risk-demo-v1` over the existing SQL Server layer. The policy is a demonstration assumption, not an approved
underwriting policy. [Data contract](../docs/data-contract.md) sections 5 and 11 govern the implementation.
The ten SQL tables, existing indexes, triggers, and `analytics.PublishRiskRun` are unchanged.

| Component | Responsibility |
| --- | --- |
| `risk/scoring.py` | Pure validated Decimal policy; High/Medium/Low mapped explicitly to SQL uppercase |
| `risk/db.py`, `risk/jobs.py` | Parameterized tenant queries, bounded retries, submission, claims, snapshots, staging/publication |
| `risk/worker.py` | Separate worker, batches, leases, progress, termination and recovery |
| `risk/app.py`, `risk/auth.py` | Authenticated enqueue/status routes and minimal liveness |
| `risk/scheduler.py` | Standalone scheduled submission using the same queue/idempotency path |
| `risk/config.py`, `risk/logging.py` | Validated environment configuration and allowlisted JSON logs |
| `scripts/provision.py` | Explicit administrative account/bootstrap command; never used by runtime services |
| `scripts/demo.py` | Live local demonstration, including a controlled source-version failure |
| `tests/` | Pure/unit tests and real SQL integration tests using disposable databases |

## Start locally with Docker (PowerShell, repository root)

Prerequisites: the SQL layer initialized as described in [sql/README.md](../sql/README.md), Python 3.11, Docker Desktop
Linux containers and host ODBC Driver 18 for bootstrap/tests. Existing SQL volumes/passwords are retained.

```powershell
python -m venv analytics-flask/.venv
analytics-flask/.venv/Scripts/python.exe -m pip install -r analytics-flask/requirements-dev.txt
Push-Location analytics-flask
.venv/Scripts/python.exe -m scripts.provision
Pop-Location

docker compose --profile risk config --quiet
docker compose --profile risk up --build -d --wait
docker compose --profile risk ps
Invoke-RestMethod http://127.0.0.1:8000/health
```

Provisioning reads the ignored root `.env` local administrative credential, generates random service passwords/JWT
secret if absent, creates `risk_api_login` and `risk_worker_login`, and saves only missing settings in `.env` without
printing secrets. It is repeatable and refuses unsafe names, short passwords, an existing privileged login or a
credential mismatch. It does not create/alter application tables or grant ownership. In real deployments, provision
accounts separately using controlled administrative credentials and secret injection.

The Compose `risk` profile adds API/worker only. Without that profile, existing SQL-only commands still work.
API binds 127.0.0.1:8000; SQL retains 127.0.0.1:1433 and its existing persistent volume. Both Python services run as UID
10001 with distinct database credentials; the worker does not receive the JWT signing secret. API/worker health checks
are liveness checks; dependency failures surface as sanitized errors/logs rather than health payload secrets.

### Optional Docker dependency-download fallback

The normal Dockerfile installs pinned packages over verified HTTPS. This checkout's Docker network encountered a
PyPI timeout and then an untrusted certificate chain. The tested fallback downloads Linux x86_64 wheels through the
host's verified HTTPS connection and installs them offline; it does not disable certificate verification.

```powershell
Push-Location analytics-flask
.venv/Scripts/python.exe -m scripts.prepare_wheels
Pop-Location
$env:RISK_OFFLINE_WHEELS = '1'
docker compose --profile risk up --build -d --wait
```

Wheels are ignored artifacts and are not committed. `requirements.lock` pins the full runtime dependency closure.
The Dockerfile pins Python 3.11.14 and Microsoft ODBC 18.7.1.1. The Microsoft driver installation follows its
[official Debian instructions](https://learn.microsoft.com/en-us/sql/connect/odbc/linux-mac/installing-the-microsoft-odbc-driver-for-sql-server).
The optional wheel preparation targets Linux x86_64; regenerate appropriately for a different architecture.

## HTTP endpoints and development authentication

No scoring occurs in request handlers. The internal Flask routes are separate from the preserved Spring Boot
`/api/v1/portfolio/risk-runs` contract. `RunId` and `JobId` are distinct UUIDs.

| Endpoint | Authentication / result |
| --- | --- |
| `POST /risk/runs` | `risk:run`, empty JSON `{}`, required `Idempotency-Key`; 202 with runId/status/requestId |
| `GET /risk/runs/{runId}` | `risk:read`; runId, jobId, status, counts, startedAtUtc/completedAtUtc, errorCode/requestId |
| `GET /health` | No authentication, `{ "status": "ok" }`; liveness only |

Bearer JWTs require HS256 signature, configured issuer/audience, expiration, issued-at, subject, tenant UUID and explicit
permissions. Tenant must be in the operator allowlist. Request bodies/query strings cannot select a tenant. Missing
or invalid authentication configuration fails startup; no unsigned or default-secret mode exists. Unknown/foreign runs
return 404. Other errors: 400 malformed input, 401 invalid/missing token, 403 insufficient permission, 409 another active
run, 429 configured submission cooldown, 503 database/lock availability. Error messages contain fixed safe codes only.
Timestamps are UTC ISO strings or null. API responses are not cached; CORS is not enabled.

Development-only token and API example, with services running:

```powershell
$tenant = '2668d56c-d696-50e6-b98b-79dae5d65c7c' # fictional tenant A
$token = docker compose --profile risk exec -T risk-api python -m risk.token --tenant $tenant
$headers = @{ Authorization = "Bearer $token"; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$job = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/risk/runs -Headers $headers -ContentType application/json -Body '{}'
Invoke-RestMethod -Uri "http://127.0.0.1:8000/risk/runs/$($job.runId)" -Headers $headers
```

Capture tokens into variables; do not commit or log them. The token command is a privileged local operator tool, not an
HTTP token issuer. Production requires reviewed OIDC/service delegation, asymmetric issuer keys/rotation, HTTPS and
production secret management. Do not expose the development service publicly.

## Environment and non-Docker entrypoints

Applications read process environment, not `.env` automatically. Compose injects selected settings; bootstrap/demo
scripts read the ignored file explicitly. `SQLSERVER_USER` must not be `sa` for normal API/worker commands.

| Variable | Required/default |
| --- | --- |
| SQLSERVER_HOST, SQLSERVER_DATABASE, SQLSERVER_USER, SQLSERVER_PASSWORD | Required service connection; dedicated account |
| SQLSERVER_DRIVER | ODBC Driver 18 for SQL Server |
| SQLSERVER_TRUST_SERVER_CERTIFICATE | no; local Compose explicitly supplies yes for its self-signed SQL certificate |
| RISK_TENANTS | Required comma-separated authorized UUIDs, 1-100 tenants |
| RISK_AUTH_MODE | API/token only: explicitly development-jwt |
| RISK_JWT_SECRET, RISK_JWT_ISSUER, RISK_JWT_AUDIENCE | API/token only; secret at least 32 bytes; no defaults |
| RISK_BATCH_SIZE | 1000 (1-10000) |
| RISK_LEASE_SECONDS | 120 (30-3600) |
| RISK_POLL_SECONDS | 2 (1-60) |
| RISK_MAX_ATTEMPTS, RISK_SQL_TRIES | 3 each, bounded claim/operation retries |
| RISK_COOLDOWN_SECONDS | 10 (0-3600); idempotency replays bypass cooldown |
| RISK_QUERY_TIMEOUT | 15 seconds (1-60); login timeout 5 seconds |
| RISK_SCHEDULE_INTERVAL | 86400 seconds (60-604800), UTC bucket idempotency |
| RISK_WORKER_HEARTBEAT | Worker liveness file in the system temporary directory |

Compose reads RISK_API_DB_USER/PASSWORD, RISK_WORKER_DB_USER/PASSWORD, RISK_DATABASE and RISK_API_PORT (default 8000).
RISK_TRUST_SERVER_CERTIFICATE controls Compose's SQL certificate setting; RISK_OFFLINE_WHEELS controls only image build.
No password/signing secret is baked into the image. HTTP configuration is irrelevant to the separate worker.

For native execution, set the table's process variables using the dedicated account, then run from analytics-flask:

```powershell
.venv/Scripts/python.exe -m risk.app
# In another terminal with worker SQL credentials and the authorized tenant allowlist:
.venv/Scripts/python.exe -m risk.worker
# One pass / an explicitly selected existing run:
.venv/Scripts/python.exe -m risk.worker --once
.venv/Scripts/python.exe -m risk.worker --once --tenant <tenant-uuid> --run-id <run-uuid>
```

## Ownership, publication and recovery

Submission and each mutation take the same short per-tenant SQL session application lock. Claim/reclaim increments
Attempts and sets a SQL-time lease. Staging, initialization, progress, heartbeat and failure writes verify tenant, run,
current attempt, RUNNING state and unexpired lease. Stage batches check again before commit. Each batch is transactional;
replaying an acknowledged/uncertain insert does not duplicate rows or progress.

Publication keeps that application lock across the ownership check and autocommit `PublishRiskRun` call, preventing a
cooperating reclaimer from entering between them. The existing procedure validates exact counts and input versions,
then commits completion and the pointer together. Failed/incomplete results remain invisible. Unknown publication
acknowledgements are reconciled against successful state; successful rows are never overwritten as FAILED.

Snapshots use a serializable read transaction over active projection rows and SQL-ordered last-six payment counts.
Only required inputs are kept in memory for this prototype; source locks release before scoring. Missing payment
history records inspected=0; it is not fabricated. Ratios use Decimal precision 50; decisions use the unrounded ratio,
and only the audit ratio is rounded to eight places. Source/payment writers must advance SourceVersion in the same
transaction as input changes. Publication rejects changed versions, even if the maximum watermark did not change.

SIGTERM/SIGINT request clean termination. If failure cleanup cannot complete, the lease expires; another worker claims
with a new attempt, clears only that run's unpublished staging, and starts a fresh snapshot. Old claim handles cannot
stage/update/publish. Recovery stops after the configured attempts. Permanent validation/source-change failures are
terminal; submit a new idempotency key after correcting inputs. Failed and successful run histories remain available.
LOST/RECOVERY_REQUIRED are log outcomes, never additional persisted job states.

The API account has SELECT/INSERT on RiskJob only. The worker uses the existing analytics_worker role for inputs,
staging, job progress and publication, with direct pointer writes denied. Both accounts remain trusted service
infrastructure. Existing roles/table constraints are not RLS: every application query still needs verified tenant scope.
A malicious holder of worker credentials could call the owner-unaware existing procedure directly; defending against
that would require a separately approved SQL contract change. No production RLS or credential-compromise isolation is
claimed. There is no automatic retention/garbage collection for historical jobs/stages.

## Scheduling

Use a host scheduler/cron to invoke a separate command at the chosen nightly time, after authoritative balance refresh:

```powershell
docker compose --profile risk run --rm --no-deps risk-worker python -m risk.scheduler --once
# Or, with service SQL environment set, from analytics-flask:
.venv/Scripts/python.exe -m risk.scheduler --once
# Optional independent interval loop; never started inside Flask:
.venv/Scripts/python.exe -m risk.scheduler
```

RISK_SCHEDULE_INTERVAL changes the interval and UTC idempotency bucket. Multiple invocations in the same bucket reuse
jobs; another active run defers submission. Select the host scheduler's timezone/time explicitly. No host cron task was
installed by this change, and no upstream balance recalculation/synchronization is implemented. A failed --once command
returns nonzero on unavailable dependencies. No Redis, RabbitMQ, Celery or additional queue is used.

## Tests and recorded demonstration

From repository root:

```powershell
analytics-flask/.venv/Scripts/python.exe -m pytest analytics-flask/tests -q
$env:RISK_INTEGRATION = '1'
analytics-flask/.venv/Scripts/python.exe -m pytest analytics-flask/tests -q
```

Integration tests explicitly enabled here load local bootstrap credentials from ignored .env, or process environment.
RISK_TEST_HOST and RISK_TEST_ADMIN_PASSWORD override the local administrative test connection. They create/drop only
random loan_sql_test_* databases and reuse existing migrations, seed and SQL test helpers. Runtime operations use the
actual dedicated accounts. Without RISK_INTEGRATION=1, database cases are explicitly skipped. Tests cover policy edges,
precision/invalid inputs, auth, batching/partial batches, retries, rollback, payment ordering, concurrent claims,
expired-worker fencing, idempotency, tenant isolation, changed source versions, uncertain commits and preservation.

The local Docker demonstration is an explicit administrative diagnostic, not a production endpoint. It starts/stops
only the local risk services and advances one fictional loan's source version without changing money/payment values:

```powershell
Push-Location analytics-flask
.venv/Scripts/python.exe -m scripts.demo
# Repeat after the initial run, preserving the current publication rather than resetting ratings:
.venv/Scripts/python.exe -m scripts.demo --allow-rated
Pop-Location
```

It uses batch sizes 50 and 10 to make running/staging/failure states observable; the service default remains 1000,
which is tested with both 1,500 and 15,000 loans. It writes aggregate-only [demo-results.json](demo-results.json).
Recorded results and final test output follow below. No React, Mendix or Spring Boot code was changed.
