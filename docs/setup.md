# Local setup and reproducibility

Use **A** only for a new environment. Use **B** for an existing published database. Never overwrite an existing .env,
remove volumes, rotate credentials or reseed published data just to repeat a demonstration. This setup produces the
analytics/browser/widget deliverable, not a Mendix application; see assessment-requirements.md for acceptance gaps.

## Prerequisites

PowerShell/Windows is the verified host path. Install Docker Desktop with Linux containers, Python 3.11 and Microsoft
ODBC Driver 18 for SQL Server. The widget needs Node >=22.20.0 and <23 (tested 22.23.4) and npm 11.20.0; host Node 22.18
is insufficient for the resolved native packaging dependency. Ignored local tools and credentials are not in a clone.
Use Java 17 for native Java development; Compose builds with Java 17 and Maven Wrapper 3.9.11 without changing host Java.
Install Chrome for Playwright (or configure a compatible Edge). Bundled Chromium download previously received CDN 403.
Ports: SQL host 1433 default, Flask 8000, Spring 8081, browser 3099, synthetic tests 3101. This existing checkout uses SQL
host 11433 due to Windows reservations; the container always uses 1433 internally. Mendix Studio Pro is excluded.

Stop at the first failed command; do not continue provisioning or publication after an error.

## A. New environment only

### 1. Private configuration

Create .env from the safe example only if it is absent. Generate the administrative password privately:

```powershell
@'
from pathlib import Path
import os, secrets
fd = os.open('.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    f.write(Path('.env.example').read_text().replace('MSSQL_SA_PASSWORD=', 'MSSQL_SA_PASSWORD=Sa9!' + secrets.token_urlsafe(30), 1))
'@ | python -
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls .env /inheritance:r /grant:r "${account}:(F)"
```

If 1433 is occupied, edit SQLSERVER_PORT, SQLSERVER_HOST and RISK_TEST_HOST in .env consistently before starting a new
SQL volume. Never change the password of an existing volume merely by editing .env. Load settings without printing them:

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
```

### 2. SQL startup and initialization

```powershell
docker compose config --quiet
docker compose up -d --wait sqlserver
docker compose exec -T -e "SQLCMDPASSWORD=$env:MSSQL_SA_PASSWORD" sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -Q "IF DB_ID(N'LoanPortfolio') IS NULL EXEC(N'CREATE DATABASE [LoanPortfolio]');"
docker compose exec -T -e "SQLCMDPASSWORD=$env:MSSQL_SA_PASSWORD" sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -d LoanPortfolio -i /sql/001_schema.sql
docker compose exec -T -e "SQLCMDPASSWORD=$env:MSSQL_SA_PASSWORD" sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -d LoanPortfolio -i /sql/002_indexes.sql
```

Keep the default database name here; another name requires consistent changes to every database/config argument.
Migrations are repeatable initial migrations, not schema-drift repair. Preserve the SQL persistent volume. Developer
edition is for development only; check Microsoft runtime/distribution terms before deployment.

### 3. Python and fictional fixtures

```powershell
python -m venv analytics-flask/.venv
analytics-flask/.venv/Scripts/python.exe -m pip install -r analytics-flask/requirements-dev.txt
$env:SQLSERVER_DATABASE = 'LoanPortfolio'
$env:SQLSERVER_USER = 'sa'
$env:SQLSERVER_PASSWORD = $env:MSSQL_SA_PASSWORD
$env:SQLSERVER_TRUST_SERVER_CERTIFICATE = 'yes' # local self-signed SQL certificate only
analytics-flask/.venv/Scripts/python.exe -B sql/seed/seed.py --count 1500 --seed 42
```

This is 1,500 TOTAL loans across two fictional tenants: 1,334 active, initially Unrated. The assessment context is 1,500+
ACTIVE loans, which this demonstration does not itself contain. A changed count/seed is rejected in the same fixture
namespace. For 15,000 total loans use a separate database as in sql/README.md, never reset this one.

### 4. Dedicated accounts and backend

```powershell
Push-Location analytics-flask
.venv/Scripts/python.exe -B -m scripts.provision
Pop-Location
analytics-flask/.venv/Scripts/python.exe -B spring-boot/scripts/provision.py
Remove-Item Env:SQLSERVER_USER,Env:SQLSERVER_PASSWORD
# Reload missing settings appended by the provisioners, without displaying secrets.
Get-Content .env | ForEach-Object {
  if ($_ -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
docker compose --profile risk --profile backend config --quiet
docker compose --profile risk --profile backend up --build -d --wait
```

Flask provisioning uses SQLSERVER_HOST; reporting provisioning uses RISK_TEST_HOST. Both must match the chosen host port.
Provisioning creates only missing settings and refuses credential mismatches/privileged accounts. Runtime services use
risk_api_login, risk_worker_login and portfolio_reader_login, not SA; worker receives no signing secret. Images run as
non-root. Registry/HTTPS downloads are required for Python/ODBC/Maven/images. If the Python Docker download is blocked,
use the existing prepare_wheels/offline fallback in analytics-flask/README.md; never disable TLS verification or commit
wheels. Normal provisioning is not a password rotation tool.

### 5. First publication - explicit mutation, new fixture only

Skip this step for an existing published demonstration and routine validation. This operator command enqueues jobs for
configured tenants using the existing scheduler. The already running worker stages active-loan results and publishes
atomically. Do not write ratings/pointers directly.

```powershell
docker compose --profile risk run --rm --no-deps risk-worker python -m risk.scheduler --once
# Repeat only this SELECT while waiting, not the submission command:
docker compose exec -T -e "SQLCMDPASSWORD=$env:MSSQL_SA_PASSWORD" sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b -d LoanPortfolio -Q "SELECT TenantId,Status,ProcessedLoans,TotalLoans FROM analytics.RiskJob; SELECT TenantId,PublishedRunId,LoanCount FROM analytics.RiskPublication;"
```

Wait for SUCCEEDED and a publication pointer for both tenants before published-fixture browser tests. A running job or
staged row is not a publication. For failure follow the Flask recovery guide. Nightly automation requires a separately
installed OS scheduler/cron; Compose does not install one. This initialization command is documented, not executed by
the final audit against the persistent demonstration.

### 6. Widget and browser

```powershell
node --version
npm --version
npm --prefix widget ci --include=optional
npm --prefix widget run check
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/package-check.py
npm --prefix widget run preview:build
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/demo.py --mode real --port 3099
```

Open http://127.0.0.1:3099 (exact IP). Open the private access-code file printed by the launcher, select the corresponding
profile and paste its code. JWTs remain server-side. Credentials expire within 15 minutes; stop with Ctrl+C and relaunch.
A busy port may mean an older launcher is still running: stop only that identified demo process. Default profiles cannot
submit risk jobs. Do not enable operator mode for ordinary demonstrations. The official widget MPK is in widget/releases/;
it is not a Mendix application export. Follow demo-walkthrough.md for the five-minute presentation.

## B. Existing published environment

Keep .env, credentials, seed, jobs and volume. Skip all initialization/seeding/first-publication commands.

```powershell
docker compose --profile risk --profile backend config --quiet
docker compose --profile risk --profile backend up -d --no-build --wait
docker compose ps
Invoke-RestMethod http://127.0.0.1:8081/actuator/health/readiness
Invoke-RestMethod http://127.0.0.1:8000/health
npm --prefix widget run preview:build
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/demo.py --mode real --port 3099
```

Synthetic mode is separate: npm --prefix widget run preview:serve, or demo.py --mode synthetic --port 3101. Its mock-data
banner and CSP prohibit backend calls. Real errors never switch to fixtures. Do not expose the localhost server publicly.

## C. Tests

With a fresh protected real demo running in another terminal:

```powershell
npm --prefix widget run check
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/package-check.py
analytics-flask/.venv/Scripts/python.exe -B -m pytest widget/scripts/test_backend_launcher.py -q -p no:cacheprovider
analytics-flask/.venv/Scripts/python.exe -B widget/scripts/backend-tests.py
$env:DEMO_TEST_URL='http://127.0.0.1:3099'
npm --prefix widget run test:browser
```

The HTTP launcher discovers the current published job using the dedicated reporting account and a tenant-qualified
read-only query, not a historical job ID. Without a successful publication its two job-status checks are explicitly NOT
RUN. Browser suites assume two published fixture tenants, SQL NULL groups and enough loans for pagination. No authorized
risk mutation is submitted by these tests. Historical expensive backend suites are linked separately, not counted as fresh.

## Verification boundary

See final-validation.md for actual isolated install/build/generator results. A source snapshot without .env/node_modules
verifies frontend installation and packaging with the available toolchain/cache. It does not prove a new Docker/SQL/ODBC
installation, account provisioning or initial publication from scratch. Full clean-machine backend installation is NOT
RUN in this audit; instructions are checked against existing scripts. Persistent data preservation takes priority.
Mendix import/runtime, operational management and synchronization remain unimplemented/unverified.
