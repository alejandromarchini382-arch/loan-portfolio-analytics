"""Existing analytics schema only. All tenant mutation paths share the same lock."""
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from uuid import uuid4

import pyodbc

from .errors import LostClaim, RiskError
from .scoring import LoanInput, SQL_RATINGS, ratio

JOB_COLUMNS = """JobId, RunId, Status, ProcessedLoans, TotalLoans, StartedAtUtc, CompletedAtUtc,
ErrorCode, Attempts, CASE WHEN LeaseUntilUtc > SYSUTCDATETIME() THEN 1 ELSE 0 END AS LeaseValid"""


def row_dict(cursor):
    row = cursor.fetchone()
    return None if row is None else dict(zip((c[0] for c in cursor.description), row))


def validate_key(key):
    if (not isinstance(key, str) or not 1 <= len(key) <= 120 or key != key.strip()
            or any(not 32 <= ord(c) <= 126 for c in key)):
        raise RiskError("INVALID_IDEMPOTENCY_KEY", 400)
    return key


@dataclass(frozen=True)
class Claim:
    tenant: str
    run: str
    attempt: int


@dataclass(frozen=True)
class SnapshotLoan:
    loan_id: str
    version: int
    values: LoanInput


class Repository:
    def __init__(self, database):
        self.db, self.settings = database, database.settings

    def get(self, tenant, run):
        return self.db.run(tenant, lambda c: row_dict(c.execute(
            f"SELECT {JOB_COLUMNS} FROM analytics.RiskJob WHERE TenantId=? AND RunId=?", tenant, run)))

    def submit(self, tenant, key):
        validate_key(key)
        def operation(c):
            existing = row_dict(c.execute(f"SELECT {JOB_COLUMNS} FROM analytics.RiskJob WHERE TenantId=? AND IdempotencyKey=?", tenant, key))
            if existing:
                return existing
            if c.execute("SELECT TOP(1) 1 FROM analytics.RiskJob WHERE TenantId=? AND Status IN ('QUEUED','RUNNING')", tenant).fetchone():
                raise RiskError("ACTIVE_RUN_EXISTS", 409)
            if self.settings.cooldown_seconds and c.execute("""SELECT TOP(1) 1 FROM analytics.RiskJob
                WHERE TenantId=? AND CreatedAtUtc > DATEADD(SECOND, ?, SYSUTCDATETIME())""",
                tenant, -self.settings.cooldown_seconds).fetchone():
                raise RiskError("RUN_SUBMISSION_THROTTLED", 429)
            job, run = str(uuid4()), str(uuid4())
            c.execute("""INSERT analytics.RiskJob
                (TenantId,JobId,JobType,Status,IdempotencyKey,RunId,CreatedAtUtc,ProcessedLoans,TotalLoans)
                VALUES (?,?,'RECALCULATE_LOAN_RISK','QUEUED',?,?,SYSUTCDATETIME(),0,0)""", tenant, job, key, run).close()
            return row_dict(c.execute(f"SELECT {JOB_COLUMNS} FROM analytics.RiskJob WHERE TenantId=? AND RunId=?", tenant, run))
        return self.db.run(tenant, operation, lock=True, transaction=True)

    def claim(self, tenant, run=None):
        def operation(c):
            sql = f"""SELECT TOP(1) {JOB_COLUMNS} FROM analytics.RiskJob WITH (UPDLOCK,HOLDLOCK)
                WHERE TenantId=? AND (Status='QUEUED' OR
                (Status='RUNNING' AND (LeaseUntilUtc IS NULL OR LeaseUntilUtc <= SYSUTCDATETIME())))"""
            params = [tenant]
            if run is not None:
                sql += " AND RunId=?"
                params.append(run)
            row = row_dict(c.execute(sql + " ORDER BY CreatedAtUtc, JobId", *params))
            if not row:
                return None
            run_id = str(row["RunId"]).lower()
            if row["Attempts"] >= self.settings.max_attempts:
                c.execute("""UPDATE analytics.RiskJob SET Status='FAILED',ErrorCode='ATTEMPTS_EXHAUSTED',
                    CompletedAtUtc=SYSUTCDATETIME(),LeaseUntilUtc=NULL WHERE TenantId=? AND RunId=?""", tenant, run_id).close()
                return None
            c.execute("""UPDATE analytics.RiskJob SET Status='RUNNING',Attempts=Attempts+1,
                LeaseUntilUtc=DATEADD(SECOND,?,SYSUTCDATETIME()), StartedAtUtc=COALESCE(StartedAtUtc,SYSUTCDATETIME()),
                CompletedAtUtc=NULL,ErrorCode=NULL,ProcessedLoans=0,TotalLoans=0 WHERE TenantId=? AND RunId=?""",
                self.settings.lease_seconds, tenant, run_id).close()
            claim = Claim(tenant, run_id, row["Attempts"] + 1)
            self._owned(c, claim)
            c.execute("DELETE analytics.RiskScoreStage WHERE TenantId=? AND RunId=?", tenant, run_id).close()
            return claim
        return self.db.run(tenant, operation, lock=True, transaction=True)

    def _owned(self, c, claim):
        row = row_dict(c.execute(f"SELECT {JOB_COLUMNS} FROM analytics.RiskJob WITH (UPDLOCK,HOLDLOCK) WHERE TenantId=? AND RunId=?",
            claim.tenant, claim.run))
        if not row or row["Attempts"] != claim.attempt or row["Status"] != "RUNNING" or not row["LeaseValid"]:
            raise LostClaim()
        return row

    def heartbeat(self, claim):
        def operation(c):
            self._owned(c, claim)
            c.execute("""UPDATE analytics.RiskJob SET LeaseUntilUtc=DATEADD(SECOND,?,SYSUTCDATETIME())
                WHERE TenantId=? AND RunId=? AND Attempts=?""", self.settings.lease_seconds, claim.tenant, claim.run, claim.attempt).close()
        self.db.run(claim.tenant, operation, lock=True, transaction=True)

    def snapshot(self, claim):
        def operation(c):
            count, watermark = c.execute("""SELECT COUNT(*),COALESCE(MAX(SourceVersion),0)
                FROM analytics.LoanPortfolio WITH (HOLDLOCK) WHERE TenantId=? AND Status='ACTIVE'""", claim.tenant).fetchone()
            cursor = c.execute("""SELECT p.LoanId,p.SourceVersion,p.PrincipalAmount,p.CurrentBalance,p.DaysPastDue,
                h.LateCount,h.Inspected FROM analytics.LoanPortfolio p WITH (HOLDLOCK)
                CROSS APPLY (SELECT COUNT(*) Inspected,COALESCE(SUM(CONVERT(INT,lastSix.IsLate)),0) LateCount
                    FROM (SELECT TOP(6) IsLate FROM analytics.PaymentHistory WITH (HOLDLOCK)
                        WHERE TenantId=p.TenantId AND LoanId=p.LoanId
                        ORDER BY PaymentDate DESC,PostedAtUtc DESC,PaymentId DESC) lastSix) h
                WHERE p.TenantId=? AND p.Status='ACTIVE' ORDER BY p.LoanId""", claim.tenant)
            loans = []
            while True:
                rows = cursor.fetchmany(self.settings.batch_size)
                if not rows:
                    break
                loans.extend(SnapshotLoan(str(r[0]).lower(),r[1],LoanInput(r[2],r[3],r[4],r[5],r[6])) for r in rows)
                self.heartbeat(claim)
            cursor.close()
            if len(loans) != count:
                raise RiskError("SOURCE_SNAPSHOT_CHANGED",409)
            return loans, watermark
        return self.db.run(claim.tenant, operation, transaction=True, serializable=True)

    def initialize(self, claim, total):
        def operation(c):
            self._owned(c, claim)
            c.execute("UPDATE analytics.RiskJob SET TotalLoans=? WHERE TenantId=? AND RunId=? AND Attempts=?",
                total, claim.tenant, claim.run, claim.attempt).close()
        self.db.run(claim.tenant, operation, lock=True, transaction=True)

    def stage(self, claim, scored):
        parameters = []
        stamp = datetime.utcnow()
        for loan, rating in scored:
            with localcontext() as ctx:
                ctx.prec = 50
                audit_ratio = ratio(loan.values).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_EVEN)
            if audit_ratio >= Decimal("10000000000"):
                raise RiskError("AUDIT_RATIO_OUT_OF_RANGE",400)
            values = loan.values
            parameters.append((claim.tenant,claim.run,loan.loan_id,SQL_RATINGS[rating],"risk-demo-v1",loan.version,
                values.DaysPastDue,audit_ratio,values.LatePaymentsLastSix,values.PaymentRowsInspected,stamp,
                claim.tenant,claim.run,loan.loan_id))
        def operation(c):
            self._owned(c, claim)
            if parameters:
                cursor = c.cursor()
                try:
                    cursor.fast_executemany = True
                    cursor.setinputsizes([(pyodbc.SQL_WVARCHAR,36,0)]*3 + [(pyodbc.SQL_VARCHAR,10,0),(pyodbc.SQL_VARCHAR,40,0),
                        (pyodbc.SQL_BIGINT,19,0),(pyodbc.SQL_INTEGER,10,0),(pyodbc.SQL_DECIMAL,18,8),
                        (pyodbc.SQL_INTEGER,10,0),(pyodbc.SQL_INTEGER,10,0),(pyodbc.SQL_TYPE_TIMESTAMP,23,3)]
                        + [(pyodbc.SQL_WVARCHAR,36,0)]*3)
                    cursor.executemany("""INSERT analytics.RiskScoreStage (TenantId,RunId,LoanId,LoanRiskRating,PolicyVersion,
                        InputSourceVersion,DaysPastDueUsed,BalancePrincipalRatio,LatePaymentsLastSix,PaymentRowsInspected,CalculatedAtUtc)
                        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS
                        (SELECT 1 FROM analytics.RiskScoreStage WHERE TenantId=? AND RunId=? AND LoanId=?)""",parameters)
                finally:
                    cursor.close()
            self._owned(c, claim)  # Lease must still be valid before committing a potentially long batch.
            processed = c.execute("SELECT COUNT(*) FROM analytics.RiskScoreStage WHERE TenantId=? AND RunId=?",claim.tenant,claim.run).fetchone()[0]
            c.execute("""UPDATE analytics.RiskJob SET ProcessedLoans=?,LeaseUntilUtc=DATEADD(SECOND,?,SYSUTCDATETIME())
                WHERE TenantId=? AND RunId=? AND Attempts=?""",processed,self.settings.lease_seconds,claim.tenant,claim.run,claim.attempt).close()
            return processed
        return self.db.run(claim.tenant, operation, lock=True, transaction=True)

    def publish(self, claim, watermark):
        def operation(c):
            row = row_dict(c.execute(f"SELECT {JOB_COLUMNS} FROM analytics.RiskJob WHERE TenantId=? AND RunId=?",claim.tenant,claim.run))
            if row and row["Status"] == "SUCCEEDED" and row["Attempts"] == claim.attempt:
                return  # Reconcile an unknown commit outcome, without touching immutable successful jobs.
            self._owned(c, claim)
            c.execute("EXEC analytics.PublishRiskRun @TenantId=?,@RunId=?,@SourceSnapshotVersion=?",claim.tenant,claim.run,watermark).close()
        self.db.run(claim.tenant, operation, lock=True)  # Autocommit: procedure rejects outer transactions.

    def fail(self, claim, code):
        allowed = {"INVALID_SCORING_INPUT","DATABASE_UNAVAILABLE","DATABASE_OPERATION_FAILED","SOURCE_SNAPSHOT_CHANGED",
            "STALE_RUN","AUDIT_RATIO_OUT_OF_RANGE","WORKER_STOPPED","WORKER_ERROR"}
        safe_code = code if code in allowed else "WORKER_ERROR"
        def operation(c):
            self._owned(c, claim)
            c.execute("""UPDATE analytics.RiskJob SET Status='FAILED',ErrorCode=?,CompletedAtUtc=SYSUTCDATETIME(),LeaseUntilUtc=NULL
                WHERE TenantId=? AND RunId=? AND Attempts=?""",safe_code,claim.tenant,claim.run,claim.attempt).close()
        self.db.run(claim.tenant, operation, lock=True, transaction=True)
