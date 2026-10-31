"""SQL Server connections, short tenant locks and bounded transient retries."""
import time
from contextlib import contextmanager

import pyodbc

from .errors import LostClaim, RiskError

pyodbc.pooling = False  # Session application locks must never escape into a pool.
SESSION_OPTIONS = """SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF;"""


def transient(exc):
    state = str(exc.args[0]) if exc.args else ""
    return state.startswith("08") or state in {"40001", "HYT00", "HYT01"} or "(1205)" in str(exc)


def sql_error(exc):
    text = str(exc)
    if any(f"({n})" in text for n in (51004, 51005)):
        return RiskError("SOURCE_SNAPSHOT_CHANGED", 409)
    if "(51002)" in text:
        return LostClaim()
    if "(51003)" in text:
        return RiskError("STALE_RUN", 409)
    return RiskError("DATABASE_OPERATION_FAILED")


class Database:
    def __init__(self, settings, connect=None, sleep=time.sleep):
        self.settings = settings
        self.connect = connect or self._connect
        self.sleep = sleep

    def _connect(self):
        connection = pyodbc.connect(self.settings.connection_string(), autocommit=True, timeout=5)
        connection.timeout = self.settings.query_timeout
        connection.execute(SESSION_OPTIONS).close()
        return connection

    def tenant(self, tenant):
        if tenant not in self.settings.tenants:
            raise RiskError("TENANT_NOT_AUTHORIZED", 403)

    @contextmanager
    def session(self, tenant, lock=False, transaction=False, serializable=False):
        self.tenant(tenant)
        connection = self.connect()
        locked = False
        try:
            if lock:
                code = connection.execute("""DECLARE @r INT;
                    EXEC @r = sys.sp_getapplock @Resource=?, @LockMode='Exclusive',
                    @LockOwner='Session', @LockTimeout=1000, @DbPrincipal='public'; SELECT @r;""",
                    "risk-service:" + tenant).fetchone()[0]
                if code < 0:
                    raise RiskError("JOB_LOCK_BUSY")
                locked = True
            if transaction:
                if serializable:
                    connection.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE").close()
                connection.autocommit = False
            yield connection
            if transaction:
                connection.commit()
        finally:
            try:
                if not connection.autocommit:
                    connection.rollback()
                    connection.autocommit = True
                if locked:
                    connection.execute("EXEC sys.sp_releaseapplock @Resource=?, @LockOwner='Session', @DbPrincipal='public'",
                        "risk-service:" + tenant).close()
            except pyodbc.Error:
                pass
            finally:
                connection.close()

    def run(self, tenant, operation, **options):
        for attempt in range(self.settings.sql_tries):
            try:
                with self.session(tenant, **options) as connection:
                    return operation(connection)
            except pyodbc.Error as exc:
                if not transient(exc):
                    raise sql_error(exc) from None
                if attempt + 1 == self.settings.sql_tries:
                    raise RiskError("DATABASE_UNAVAILABLE") from None
                self.sleep(min(0.1 * 2 ** attempt, 1.0))
