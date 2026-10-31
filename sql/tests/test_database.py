"""Opt-in SQL Server integration: uses and drops only uniquely named test databases."""
import os
import re
from pathlib import Path
from uuid import uuid4

import pytest

from seed.generate import generate
from seed.seed import COLUMNS, connection_string, insert_dataset

pytestmark = pytest.mark.skipif(os.getenv("SQLSERVER_TESTS") != "1", reason="SQLSERVER_TESTS=1 and a reachable SQL Server are required")
ROOT = Path(__file__).resolve().parents[1]


def execute_script(connection, path):
    cursor = connection.cursor()
    try:
        for batch in re.split(r"(?im)^GO\s*$", path.read_text(encoding="utf-8")):
            if batch.strip():
                cursor.execute(batch)
                while cursor.nextset():
                    pass
    finally:
        cursor.close()


@pytest.mark.parametrize("count", [1500, 15000])
def test_migrations_seed_rerun_and_sql_smoke(count):
    import pyodbc
    database = "loan_sql_test_" + uuid4().hex
    env = dict(os.environ, SQLSERVER_DATABASE="master")
    master = pyodbc.connect(connection_string(env), autocommit=True, timeout=15)
    connection = None
    created = False
    try:
        master.execute(f"CREATE DATABASE [{database}]")
        created = True
        env["SQLSERVER_DATABASE"] = database
        connection = pyodbc.connect(connection_string(env), autocommit=True, timeout=15)
        for _ in range(2):
            execute_script(connection, ROOT / "001_schema.sql")
            execute_script(connection, ROOT / "002_indexes.sql")
        connection.autocommit = False
        data = generate(count, 42)
        insert_dataset(connection, data, 500, pyodbc)
        insert_dataset(connection, data, 500, pyodbc)
        for table in COLUMNS:
            for tenant in data["Tenants"]:
                expected = sum(row["TenantId"] == tenant["TenantId"] for row in data[table])
                actual = connection.execute(f"SELECT COUNT(*) FROM analytics.[{table}] WHERE TenantId = ?", tenant["TenantId"]).fetchone()[0]
                assert actual == expected
                columns = COLUMNS[table]
                selected = ", ".join(f"[{c}]" for c in columns)
                stored = connection.execute(f"SELECT {selected} FROM analytics.[{table}] WHERE TenantId = ?", tenant["TenantId"]).fetchall()
                def normalized(values):
                    return tuple(str(value).lower() if column.endswith("Id") and value is not None else value
                                 for column, value in zip(columns, values))
                assert {normalized(row) for row in stored} == {
                    normalized(tuple(row[c] for c in columns)) for row in data[table]
                    if row["TenantId"] == tenant["TenantId"]
                }
        for tenant in data["Tenants"]:
            assert connection.execute("SELECT COUNT(*) FROM analytics.PublishedLoanPortfolio WHERE TenantId = ? AND LoanRiskRating IS NOT NULL", tenant["TenantId"]).fetchone()[0] == 0
        connection.commit()
        connection.autocommit = True
        execute_script(connection, ROOT / "tests" / "smoke.sql")
    finally:
        if connection is not None:
            connection.close()
        if created:
            # Name is generated locally; never taken from user input or environment.
            master.execute(f"ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE")
            master.execute(f"DROP DATABASE [{database}]")
        master.close()
