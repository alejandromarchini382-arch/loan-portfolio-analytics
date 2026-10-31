from collections import Counter
from decimal import Decimal
import random

import pytest

from seed.generate import AS_OF, generate
from seed.seed import COLUMNS, KEYS, connection_string, insert_dataset, main


@pytest.fixture(scope="module", params=[1500, 15000], ids=["1500-loans", "15000-loans"])
def dataset(request):
    return request.param, generate(request.param, 42)


def test_counts_and_tenant_qualified_relationships(dataset):
    count, data = dataset
    assert len(data["Tenants"]) == 2
    assert len(data["Divisions"]) == 10
    assert len(data["LoanOfficers"]) == 40
    assert len(data["Loans"]) == len(data["Borrowers"]) == len(data["LoanPortfolio"]) == count
    assert set(Counter(row["TenantId"] for row in data["Loans"]).values()) == {count // 2}
    for table, rows in data.items():
        assert len({tuple(row[k] for k in KEYS[table]) for row in rows}) == len(rows)
    borrowers = {(r["TenantId"], r["BorrowerId"]) for r in data["Borrowers"]}
    divisions = {(r["TenantId"], r["DivisionId"]) for r in data["Divisions"]}
    officers = {(r["TenantId"], r["LoanOfficerId"]) for r in data["LoanOfficers"]}
    loans = {(r["TenantId"], r["LoanId"]) for r in data["Loans"]}
    for loan in data["Loans"]:
        assert (loan["TenantId"], loan["BorrowerId"]) in borrowers
        assert loan["DivisionId"] is None or (loan["TenantId"], loan["DivisionId"]) in divisions
        assert loan["LoanOfficerId"] is None or (loan["TenantId"], loan["LoanOfficerId"]) in officers
    assert all((p["TenantId"], p["LoanId"]) in loans for p in data["PaymentHistory"])


def test_money_rates_dates_and_payment_consistency(dataset):
    _, data = dataset
    payments = {}
    for payment in data["PaymentHistory"]:
        assert isinstance(payment["PaymentAmount"], Decimal)
        assert payment["PaymentAmount"] >= 0
        assert payment["PaymentAmount"].as_tuple().exponent == -2
        assert type(payment["IsLate"]) is bool
        assert payment["PostedAtUtc"].date() == payment["PaymentDate"] <= AS_OF
        payments.setdefault((payment["TenantId"], payment["LoanId"]), []).append(payment)
    for loan in data["Loans"]:
        assert Decimal("10000") <= loan["PrincipalAmount"] <= Decimal("2500000")
        assert Decimal("0") <= loan["CurrentBalance"] <= loan["PrincipalAmount"] * Decimal("1.05") + Decimal("0.01")
        for key in ("PrincipalAmount", "CurrentBalance"):
            assert isinstance(loan[key], Decimal) and loan[key].as_tuple().exponent == -2
        rate = loan["InterestRate"]
        assert rate is None or (isinstance(rate, Decimal) and Decimal("0.0350") <= rate <= Decimal("0.2400") and rate.as_tuple().exponent == -4)
        assert 0 <= loan["DaysPastDue"] <= 180
        assert loan["OriginationDate"] < loan["MaturityDate"]
        assert loan["CurrencyCode"] == "USD" and loan["SourceVersion"] == 1
        history = payments.get((loan["TenantId"], loan["LoanId"]), [])
        assert 0 <= len(history) <= 12
        assert loan["LastPaymentDate"] == max((p["PaymentDate"] for p in history), default=None)
        assert all(p["PaymentDate"] > loan["OriginationDate"] for p in history)
    assert all(not isinstance(v, float) for rows in data.values() for row in rows for v in row.values())


def test_distributions_and_unrated(dataset):
    count, data = dataset
    loans = data["Loans"]
    active = sum(r["Status"] == "ACTIVE" for r in loans) / count
    corporate = sum(r["BorrowerType"] == "CORPORATE" for r in data["Borrowers"]) / count
    assert 0.80 < active < 0.95
    assert 0.25 < corporate < 0.45
    assert {r["Status"] for r in loans} == {"ACTIVE", "CLOSED", "DEFAULTED"}
    assert {r["BorrowerRiskRating"] for r in data["Borrowers"]} == {"LOW", "MEDIUM", "HIGH", None}
    assert any(r["InterestRate"] is None for r in loans)
    assert any(r["CurrentBalance"] == 0 for r in loans)
    assert any(r["DivisionId"] is None for r in loans)
    assert any(r["LoanOfficerId"] is None for r in loans)
    for lower, upper in [(0, 0), (1, 14), (15, 29), (30, 59), (60, 180)]:
        assert any(lower <= r["DaysPastDue"] <= upper for r in loans)
    assert "RiskScoreStage" not in data and "RiskPublication" not in data and "RiskJob" not in data
    assert all("LoanRiskRating" not in r for r in data["LoanPortfolio"])


def test_deterministic_at_both_sizes(dataset):
    count, data = dataset
    assert data == generate(count, 42)


def test_overlapping_ids_and_labels_are_separated_by_tenant(dataset):
    _, data = dataset
    a, b = [t["TenantId"] for t in data["Tenants"]]
    for table, key in [("Loans", "LoanId"), ("Loans", "LoanNumber"), ("Divisions", "DivisionName"), ("LoanOfficers", "LoanOfficerName")]:
        assert {r[key] for r in data[table] if r["TenantId"] == a} == {r[key] for r in data[table] if r["TenantId"] == b}


@pytest.mark.parametrize("count", [0, 1, -1, True, 3.5, "1500"])
def test_invalid_counts(count):
    with pytest.raises(ValueError):
        generate(count)


@pytest.mark.parametrize("seed", [True, None, 1.5, "42"])
def test_invalid_seeds(seed):
    with pytest.raises(ValueError):
        generate(2, seed)


def test_default_odd_counts_seed_variation_and_global_rng():
    assert len(generate()["Loans"]) == 1500
    assert sorted(Counter(r["TenantId"] for r in generate(5)["Loans"]).values()) == [2, 3]
    assert generate(10, 41) != generate(10, 42)
    before = random.getstate()
    generate(10)
    assert random.getstate() == before


class RecordingCursor:
    __slots__ = ("existing", "fail", "single", "batches", "closed", "fast_executemany")

    def __init__(self, existing=None, fail=False):
        self.existing = existing
        self.fail = fail
        self.single = []
        self.batches = []
        self.closed = False

    def execute(self, statement, *args):
        self.single.append((statement, args))
        return self

    def fetchone(self):
        return self.existing

    def executemany(self, statement, parameters):
        if self.fail:
            raise RuntimeError("simulated batch failure")
        self.batches.append((statement, parameters))

    def close(self):
        self.closed = True


class RecordingConnection:
    def __init__(self, **kwargs):
        self.recording = RecordingCursor(**kwargs)
        self.commits = self.rollbacks = 0

    def cursor(self):
        return self.recording

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_parameterized_batches_and_transaction(dataset):
    _, data = dataset
    connection = RecordingConnection()
    insert_dataset(connection, data, batch_size=137)
    assert connection.commits == 1 and connection.rollbacks == 0 and connection.recording.closed
    assert connection.timeout == 60
    for table, columns in COLUMNS.items():
        batches = [(sql, params) for sql, params in connection.recording.batches if sql.startswith(f"INSERT INTO analytics.[{table}] ")]
        assert sum(len(params) for _, params in batches) == len(data[table])
        for sql, params in batches:
            assert 0 < len(params) <= 137
            assert "WHERE NOT EXISTS" in sql and "[TenantId] = ?" in sql
            assert sql.count("?") == len(columns) + len(KEYS[table])
            assert all(len(row) == sql.count("?") for row in params)
        # Each bound value is passed separately, never concatenated into the SQL statement.
        assert data[table][0]["TenantId"] not in batches[0][0]


def test_batch_failure_rolls_back():
    connection = RecordingConnection(fail=True)
    with pytest.raises(RuntimeError, match="simulated"):
        insert_dataset(connection, generate(2))
    assert connection.commits == 0 and connection.rollbacks == 1 and connection.recording.closed


def test_changed_seed_or_count_rejected_before_inserts():
    connection = RecordingConnection(existing=("some different fixture",))
    with pytest.raises(ValueError, match="fresh database"):
        insert_dataset(connection, generate(2))
    assert not connection.recording.batches
    assert connection.commits == 0 and connection.rollbacks == 1


@pytest.mark.parametrize("size", [0, -1, True, 0.5])
def test_invalid_batch_size(size):
    with pytest.raises(ValueError):
        insert_dataset(RecordingConnection(), generate(2), size)


def test_env_credentials_are_required_and_escaped():
    with pytest.raises(ValueError, match="required"):
        connection_string({})
    result = connection_string({"SQLSERVER_HOST": "localhost,1433", "SQLSERVER_DATABASE": "demo",
        "SQLSERVER_USER": "demo", "SQLSERVER_PASSWORD": "secret};UID=intruder"})
    assert "PWD={secret}};UID=intruder}" in result
    assert "Encrypt={yes}" in result and "TrustServerCertificate={no}" in result


def test_cli_dry_run_and_invalid_input(capsys):
    assert main(["--dry-run", "--count", "2"]) == 0
    assert "Loans=2" in capsys.readouterr().out
    assert main(["--count", "1"]) == 2
    assert "count must" in capsys.readouterr().err
