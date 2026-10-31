# SQL Server data layer

Owned `analytics` projection/fixture tables for SQL Server 2022. The contract is
[docs/data-contract.md](../docs/data-contract.md), especially section 10; accepted choices are in
[docs/decisions.md](../docs/decisions.md). Money uses DECIMAL(18,2), interest uses DECIMAL(7,4) annual fractions,
and JSON consumers must retain decimal strings. Risk ratios use DECIMAL(18,8).

## Local setup (PowerShell, repository root)

Requirements: Python 3.11, Docker Desktop with Linux containers, Microsoft ODBC Driver 18 for SQL Server.
Compose pins `mcr.microsoft.com/mssql/server:2022-CU23-ubuntu-22.04`; Developer edition is for development only.
Microsoft documents the image/tooling at [SQL Server containers](https://learn.microsoft.com/sql/linux/install-upgrade/quickstart-install-docker).
No host SQL Server or sqlcmd installation is needed; initialization uses sqlcmd inside the container.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r sql/seed/requirements.txt

# Enter a new strong local password. Never commit credentials.
$env:MSSQL_SA_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Local SQL SA password' -AsSecureString)).Password
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps

# SQLCMDPASSWORD is injected from the environment; no literal password in scripts.
docker compose exec -T -e "SQLCMDPASSWORD=$env:MSSQL_SA_PASSWORD" sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -Q "IF DB_ID(N'LoanPortfolio') IS NULL EXEC(N'CREATE DATABASE [LoanPortfolio]');"
docker compose exec -T -e "SQLCMDPASSWORD=$env:MSSQL_SA_PASSWORD" sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -d LoanPortfolio -i /sql/001_schema.sql
docker compose exec -T -e "SQLCMDPASSWORD=$env:MSSQL_SA_PASSWORD" sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -d LoanPortfolio -i /sql/002_indexes.sql

$env:SQLSERVER_HOST = '127.0.0.1,1433'
$env:SQLSERVER_DATABASE = 'LoanPortfolio'
$env:SQLSERVER_USER = 'sa'
$env:SQLSERVER_PASSWORD = $env:MSSQL_SA_PASSWORD
$env:SQLSERVER_TRUST_SERVER_CERTIFICATE = 'yes' # local self-signed container only
python sql/seed/seed.py --count 1500 --seed 42
python sql/seed/seed.py --count 1500 --seed 42 # no duplicate rows or changed scores
```

An ignored `.env` may instead supply `MSSQL_SA_PASSWORD` to Compose. Python reads environment variables, not `.env`
automatically. Existing persistent volumes retain their configured password; changing an environment variable does not
reset it. `SQLSERVER_PORT` changes the host port (default 1433); match SQLSERVER_HOST accordingly. Compose binds only
127.0.0.1, persists `/var/opt/mssql`, mounts `/sql` read-only and checks SQL login readiness. `docker compose down`
retains data. Do not delete the volume to switch fixture sizes; use a fresh database.

For 15,000 total loans, initialize another database with the same scripts, set SQLSERVER_DATABASE to it, then run:

```powershell
python sql/seed/seed.py --count 15000 --seed 42 --batch-size 500
```

A changed seed/count in the same fixture namespace is rejected before insertion. Exactly two tenants split the total
(odd counts give A one extra). Each has five divisions and twenty officers. Fixtures use a fixed 2026-10-30 date,
seeded IDs and a local PRNG; amounts/rates use Decimal and never binary float. Weighted statuses, borrower types,
delinquency buckets, null grouping labels/rates and zero-to-twelve payments are synthetic demonstration data. Tenant IDs are distinct;
loan IDs/numbers and labels intentionally overlap across tenants as described in the contract. No scoring is performed:
new loans are Unrated, even when the borrower has a rating. Imports insert missing rows in dependency order, use bound
parameters and ODBC array batches, and commit the whole seed transaction together. Existing rows are preserved.

Environment: SQLSERVER_HOST, SQLSERVER_DATABASE, SQLSERVER_USER and SQLSERVER_PASSWORD are mandatory for insertion.
SQLSERVER_DRIVER defaults to `ODBC Driver 18 for SQL Server`. Encryption is always enabled;
SQLSERVER_TRUST_SERVER_CERTIFICATE defaults to `no`. Connection timeout is 15 seconds; statements time out after 60.
For an offline generator check (no credentials or driver required):

```powershell
python sql/seed/seed.py --dry-run --count 1500 --seed 42
python sql/seed/seed.py --dry-run --count 15000 --seed 42
```

## Schema and query use

`001_schema.sql` creates Tenants, Divisions, LoanOfficers, Borrowers, Loans, PaymentHistory, LoanPortfolio, RiskJob,
RiskScoreStage and RiskPublication. Tenant-leading PKs, tenant-qualified FKs and tenant-scoped loan-number uniqueness
prevent cross-tenant references. CHECK constraints enforce the exact enums and documented invalid input restrictions.
Scripts are repeatable initial migrations; they do not alter existing column types or repair schema drift.

`002_indexes.sql` covers division, officer and borrower-type grouping with `(TenantId, Status, dimension)` keys and
included financial/other grouping columns. Risk grouping uses `(TenantId, RunId, LoanRiskRating, LoanId)` on scores,
then joins the tenant publication and projection PK. Financial values belong to the projection, not duplicated scores.
Payment history is indexed in last-six order. FK/queue/idempotency indexes also begin with TenantId. These are proposed
access paths, not measured query-plan/performance claims.

Query `analytics.PublishedLoanPortfolio`, never stages directly for the dashboard. Always bind verified TenantId:

```sql
SELECT Division, COUNT(*) AS LoanCount, SUM(CurrentBalance) AS TotalBalance,
       AVG(CAST(InterestRate AS DECIMAL(18,8))) AS AverageInterestRate
FROM analytics.PublishedLoanPortfolio
WHERE TenantId = @TenantId AND Status = @Status
GROUP BY Division;
```

Use a server-side fixed allowlist for other dimensions. AVG is unweighted and ignores nulls. LoanRiskRating is NULL
until the tenant has a successful publication containing that loan: API `loanRiskRating: null`, risk-group `key: null`,
label `Unrated`. Missing division/officer labels instead display `Unassigned`. This phase does not implement API routes.

## Atomic publication and permissions

Workers capture a fixed active-loan set, its count and MAX(SourceVersion), create a tenant-scoped RUNNING job with a
current lease, and stage one score per loan with its input version. After all batches succeed:

```sql
EXEC analytics.PublishRiskRun @TenantId, @RunId, @SourceSnapshotVersion;
```

The procedure validates the lease, job progress, exact active/staged counts, every input version and run ordering in one
locking transaction; it then switches the pointer and marks SUCCEEDED together. Source/stage changes during validation
block or cause a safe retry. Any rejected run retains the previous pointer. Workers separately mark failures FAILED.
Already-published retries are no-ops. Successful scores/jobs are immutable. Projection/payment writers must increment
SourceVersion in the same transaction when scoring inputs change; this phase does not implement that synchronization protocol or worker.

Assign real service users to `analytics_reader` (published view and status reads) or `analytics_worker` (input reads,
stage/job writes, EXECUTE publication; denied direct publication writes). SA is only for local initialization/tests.
Worker callers must establish tenant scope before every query; publication's TenantId is an internal verified argument.
Database owners are trusted. RLS is deferred, so FKs/indexes/roles do not prevent an unfiltered authorized SELECT from
reading multiple tenants. Authentication, verified connection scope and production least-privilege provisioning remain
integration work. HTTP triggers, scheduling, scoring computation, Mendix synchronization and other app modules are
outside this change.

## Validation

```powershell
python -m pytest sql/tests -q

# Requires the environment above and local admin credentials able to create disposable databases.
$env:SQLSERVER_TESTS = '1'
python -m pytest sql/tests -q -rs
Remove-Item Env:SQLSERVER_TESTS
```

Without SQLSERVER_TESTS=1, two database cases are explicitly skipped. Unit cases exercise both 1,500 and 15,000 loans,
counts, Decimal/range/date/history correctness, tenant references, determinism, null/unrated data, batching and rollback.
Database cases create randomly named `loan_sql_test_*` databases, apply migrations twice, insert each dataset twice,
check counts/Unrated per tenant, execute `sql/tests/smoke.sql`, then drop only their generated database. Smoke checks
cover overlapping tenants, grouping totals, nullable averages, FK violations, enum rejection, worker permissions,
publication retries, incomplete/failed/changed-input/expired-lease runs, and immutable successful scores. The smoke SQL
requires a disposable test database; run the pytest harness rather than pointing it at application data.

Validation results for this checkout are recorded after execution below. No query-plan latency, load benchmark,
production authentication, or worker/scheduler completeness is claimed.


### Executed results ? 2026-10-30

Tested: Python 3.11.9, pytest 9.1.1, pyodbc 5.2.0, Microsoft ODBC Driver 18.7.1.1, Docker Engine 28.3.2,
Compose 2.38.2 and SQL Server 2022 CU23 product version 16.0.4236.2.

Final full-suite invocation (SQLSERVER_TESTS=1 and the SQL environment set):

```text
python -B -m pytest sql/tests -q -rs -p no:cacheprovider
.................................                                        [100%]
33 passed in 39.96s
```

No database cases were skipped in that run. Both database cases applied migrations twice, seeded twice, compared
stored fields to generated values and completed smoke.sql (tenant constraints, aggregates, Unrated, successful/failed/
incomplete publication, input mismatch, expired lease, successful replacement, retry and permission/immutability guards).

Also executed successfully: `docker compose config --quiet`, Compose startup with readiness checking, container
sqlcmd initialization using both scripts, and the actual 1,500-loan seed CLI. Dry runs produced 1,500 loans/8,770
payment rows and 15,000 loans/89,982 payment rows. The local LoanPortfolio database now has 750 loans in each fixture
tenant and zero published loan ratings. The SQL container was left healthy and running.

Earlier checks found and corrected two issues: the first enabled pytest run reported `2 failed, 31 passed in 27.70s`
because statement timeout was assigned to a pyodbc cursor instead of its connection; the timeout is now set correctly.
A subsequent container-sqlcmd initialization failed with SQL error 1934 because QUOTED_IDENTIFIER defaults differed
from ODBC. Both migration scripts now explicitly set the required indexed-object session options; initialization and
the full suite passed afterward. `localhost` also timed out on this machine; the working host configuration uses
127.0.0.1 to match the Compose IPv4 binding.

Validation generated an ignored `.env` with a random local SA password, without printing or committing it. Reuse its
password for the existing volume. To load this generated single-line credential into PowerShell without displaying it:

```powershell
$env:MSSQL_SA_PASSWORD = ((Get-Content .env | Where-Object { $_ -like 'MSSQL_SA_PASSWORD=*' } | Select-Object -First 1) -split '=', 2)[1]
$env:SQLSERVER_PASSWORD = $env:MSSQL_SA_PASSWORD
```

No performance/query-plan benchmarks, RLS, application authentication, Mendix synchronization or live worker/scheduler
were tested or implemented in this phase. Tests use synthetic data only.


The separate [Flask risk service](../analytics-flask/README.md) now implements the worker/API over these unchanged SQL
contracts. The SQL-phase Unrated counts recorded above describe that earlier checkpoint; running the risk demonstration
publishes active-loan ratings and intentionally leaves non-active loans Unrated.
