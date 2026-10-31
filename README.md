# loan-portfolio-analytics


## SQL Server data layer

The owned SQL schema, indexes, deterministic fictional seed and tests are in [sql](sql/README.md).
Follow that README for Docker Compose startup, initialization, environment variables and seed commands.
This phase adds SQL Server only; React, Mendix, Spring Boot and Flask implementations are unchanged.

```powershell
python -m pip install -r sql/seed/requirements.txt
python -m pytest sql/tests -q
python sql/seed/seed.py --dry-run --count 15000 --seed 42
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
```

Database integration tests require the SQL environment described in sql/README.md and SQLSERVER_TESTS=1. Two cases
otherwise skip explicitly. Seeded analytics records do not implement Mendix synchronization or a running risk worker.


SQL validation on 2026-10-30: **33 tests passed, no skips**, including SQL Server integration with 1,500 and 15,000
loans. Container initialization and the seed CLI were also exercised. SQL Server 2022 CU23 (16.0.4236.2) is running
locally with 1,500 fictional, unrated loans; the ignored `.env` contains its generated local credential. See the SQL
README for tested versions, corrected initial failures, reuse instructions and remaining limitations.


## Flask risk service

The [risk service README](analytics-flask/README.md) covers the implemented authenticated internal API, separate worker,
standalone scheduling, Docker setup, dedicated accounts, recovery and tests. It uses the existing SQL structures and
PublishRiskRun unchanged. The earlier SQL-phase Unrated state above is historical; the live risk demonstration publishes
active-loan ratings. Non-active loans remain outside the scoring population. See
[recorded demonstration](analytics-flask/demo-results.json) for actual results.
