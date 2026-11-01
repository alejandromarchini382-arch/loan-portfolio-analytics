# risk service implementation final validation - 2026-10-31

Restarted existing stopped containers with `docker compose --profile risk start`; retained credentials, volume and
published demo data. All three services became healthy. SQL reports RCSI disabled and snapshot isolation state 0.
No implementation regression was found; the Compose version does not support `start --wait`, so plain `start` was used.

With SQLSERVER_TESTS=1, RISK_INTEGRATION=1 and ignored local credentials loaded without printing them:

```text
analytics-flask/.venv/Scripts/python.exe -B -m pytest sql/tests -q -rs -p no:cacheprovider --tb=short
33 passed in 37.09s

analytics-flask/.venv/Scripts/python.exe -B -m pytest analytics-flask/tests -q -rs -p no:cacheprovider --tb=short
72 passed in 56.56s

analytics-flask/.venv/Scripts/python.exe -B -m pytest sql/tests analytics-flask/tests -q -rs -p no:cacheprovider --tb=short
105 passed in 93.03s (0:01:33)
```

No failures or skips. Tests use disposable loan_sql_test_* databases, including 1500/15000 fixtures, and do not reset the
persistent demonstration. These results predate the reporting permission addition. Subsequent regression results are recorded in
[reporting-api-validation.md](reporting-api-validation.md).
