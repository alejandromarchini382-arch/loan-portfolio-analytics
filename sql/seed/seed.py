"""CLI and parameterized, transactional insertion for owned fictional fixtures."""
from __future__ import annotations

import argparse
import os
import sys

if __package__:
    from .generate import generate
else:
    from generate import generate

# Static identifiers only. No caller-provided table/column names enter SQL.
COLUMNS = {
    "Tenants": ("TenantId", "TenantName"),
    "Divisions": ("TenantId", "DivisionId", "DivisionName"),
    "LoanOfficers": ("TenantId", "LoanOfficerId", "LoanOfficerName"),
    "Borrowers": ("TenantId", "BorrowerId", "BorrowerName", "BorrowerType", "Industry", "BorrowerRiskRating"),
    "Loans": ("TenantId", "LoanId", "LoanNumber", "BorrowerId", "DivisionId", "LoanOfficerId", "PrincipalAmount", "CurrentBalance", "InterestRate", "Status", "OriginationDate", "MaturityDate", "DaysPastDue", "LastPaymentDate", "CurrencyCode", "SourceVersion", "UpdatedAtUtc"),
    "PaymentHistory": ("TenantId", "PaymentId", "LoanId", "PaymentDate", "PaymentAmount", "IsLate", "PostedAtUtc"),
    "LoanPortfolio": ("TenantId", "LoanId", "LoanNumber", "BorrowerId", "BorrowerName", "BorrowerType", "Industry", "BorrowerRiskRating", "PrincipalAmount", "CurrentBalance", "InterestRate", "Status", "Division", "LoanOfficer", "OriginationDate", "MaturityDate", "DaysPastDue", "LastPaymentDate", "CurrencyCode", "SourceVersion", "LastSyncedUtc"),
}
KEYS = {"Tenants": ("TenantId",), "Divisions": ("TenantId", "DivisionId"),
    "LoanOfficers": ("TenantId", "LoanOfficerId"), "Borrowers": ("TenantId", "BorrowerId"),
    "Loans": ("TenantId", "LoanId"), "PaymentHistory": ("TenantId", "PaymentId"),
    "LoanPortfolio": ("TenantId", "LoanId")}


def insert_statement(table: str) -> str:
    columns, keys = COLUMNS[table], KEYS[table]
    return (f"INSERT INTO analytics.[{table}] ({', '.join('[' + c + ']' for c in columns)}) "
        f"SELECT {', '.join('?' for _ in columns)} WHERE NOT EXISTS "
        f"(SELECT 1 FROM analytics.[{table}] WITH (UPDLOCK, HOLDLOCK) WHERE "
        + " AND ".join(f"[{k}] = ?" for k in keys) + ")")


def input_sizes(columns, odbc):
    """Explicit ODBC types avoid first-row NULL/decimal inference in array binding."""
    result = []
    for column in columns:
        if column in ("PrincipalAmount", "CurrentBalance", "PaymentAmount"):
            result.append((odbc.SQL_DECIMAL, 18, 2))
        elif column == "InterestRate":
            result.append((odbc.SQL_DECIMAL, 7, 4))
        elif column.endswith("Date"):
            result.append((odbc.SQL_TYPE_DATE, 10, 0))
        elif column.endswith("Utc"):
            result.append((odbc.SQL_TYPE_TIMESTAMP, 23, 3))
        elif column == "IsLate":
            result.append((odbc.SQL_BIT, 1, 0))
        elif column in ("DaysPastDue", "SourceVersion"):
            result.append((odbc.SQL_BIGINT, 19, 0))
        else:
            result.append((odbc.SQL_WVARCHAR, 200, 0))
    return result


def insert_dataset(connection, data: dict, batch_size: int = 500, odbc=None) -> None:
    """One transaction; caller must provide a dedicated autocommit=False connection.

    Reruns preserve existing source edits and published scores. A dataset manifest in
    fixture tenant names rejects a changed seed/count before any insertion.
    """
    if isinstance(batch_size, bool) or not isinstance(batch_size, int) or batch_size < 1:
        raise ValueError("batch_size must be a positive integer")
    if set(data) != set(COLUMNS):
        raise ValueError("unexpected fixture tables")
    cursor = connection.cursor()
    try:
        connection.timeout = 60
        cursor.execute("SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; "
            "SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET ARITHABORT ON; "
            "SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF;")
        for tenant in data["Tenants"]:
            cursor.execute("SELECT TenantName FROM analytics.Tenants WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = ?", tenant["TenantId"])
            existing = cursor.fetchone()
            if existing is not None and existing[0] != tenant["TenantName"]:
                raise ValueError("fixture seed/count differs; use a fresh database")
        cursor.fast_executemany = odbc is not None
        for table, columns in COLUMNS.items():
            rows = data[table]
            if not rows:
                continue
            if odbc is not None:
                cursor.setinputsizes(input_sizes(columns + KEYS[table], odbc))
            statement = insert_statement(table)
            for offset in range(0, len(rows), batch_size):
                batch = rows[offset:offset + batch_size]
                parameters = [tuple(row[c] for c in columns + KEYS[table]) for row in batch]
                cursor.executemany(statement, parameters)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()


def connection_string(env) -> str:
    required = ("SQLSERVER_HOST", "SQLSERVER_DATABASE", "SQLSERVER_USER", "SQLSERVER_PASSWORD")
    if any(not env.get(name) for name in required):
        raise ValueError("required: " + ", ".join(required))
    def escape(value):
        return "{" + str(value).replace("}", "}}") + "}"
    values = {"DRIVER": env.get("SQLSERVER_DRIVER", "ODBC Driver 18 for SQL Server"),
        "SERVER": env["SQLSERVER_HOST"], "DATABASE": env["SQLSERVER_DATABASE"],
        "UID": env["SQLSERVER_USER"], "PWD": env["SQLSERVER_PASSWORD"],
        "Encrypt": "yes", "TrustServerCertificate": "no"}
    trust = env.get("SQLSERVER_TRUST_SERVER_CERTIFICATE", "no").lower()
    if trust not in ("yes", "no"):
        raise ValueError("SQLSERVER_TRUST_SERVER_CERTIFICATE must be yes or no")
    values["TrustServerCertificate"] = trust
    return ";".join(f"{key}={escape(value)}" for key, value in values.items())


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=1500, help="total loans across two tenants (>=2)")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true", help="generate and print counts without SQL dependencies")
    args = parser.parse_args(argv)
    try:
        if args.batch_size < 1:
            raise ValueError("batch-size must be positive")
        data = generate(args.count, args.seed)
        if not args.dry_run:
            settings = connection_string(os.environ)
            import pyodbc
            with pyodbc.connect(settings, autocommit=False, timeout=15) as connection:
                insert_dataset(connection, data, args.batch_size, pyodbc)
        print(("Generated" if args.dry_run else "Seed completed") + ": "
            + ", ".join(f"{table}={len(rows)}" for table, rows in data.items()))
        return 0
    except ValueError as exc:
        # Only our controlled validation messages, never connection strings or financial rows.
        print(f"Seed rejected: {exc}", file=sys.stderr)
        return 2
    except Exception:
        print("Seed failed; transaction rolled back. Check SQL connectivity, driver and schema.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
