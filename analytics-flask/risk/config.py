import os
from dataclasses import dataclass, field
from uuid import UUID


def uuid_text(value):
    try:
        if not isinstance(value, str) or len(value) != 36:
            raise ValueError()
        parsed = str(UUID(value))
        if parsed != value.lower():
            raise ValueError()
        return parsed
    except (ValueError, TypeError, AttributeError):
        raise ValueError("INVALID_UUID") from None


def integer(env, key, default, low, high):
    try:
        value = int(env.get(key, str(default)))
        if not low <= value <= high:
            raise ValueError()
        return value
    except (ValueError, TypeError):
        raise ValueError("INVALID_CONFIG_" + key) from None


@dataclass(frozen=True)
class Settings:
    host: str
    database: str
    user: str
    password: str = field(repr=False)
    tenants: tuple[str, ...] = ()
    driver: str = "ODBC Driver 18 for SQL Server"
    trust_certificate: bool = False
    batch_size: int = 1000
    lease_seconds: int = 120
    poll_seconds: int = 2
    max_attempts: int = 3
    sql_tries: int = 3
    cooldown_seconds: int = 10
    query_timeout: int = 15
    schedule_interval: int = 86400

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        required = ("SQLSERVER_HOST", "SQLSERVER_DATABASE", "SQLSERVER_USER", "SQLSERVER_PASSWORD", "RISK_TENANTS")
        if any(not env.get(k) for k in required):
            raise ValueError("MISSING_SERVICE_CONFIG")
        if env["SQLSERVER_USER"].casefold() == "sa":
            raise ValueError("SERVICE_MUST_NOT_USE_SA")
        tenants = tuple(sorted({uuid_text(t.strip()) for t in env["RISK_TENANTS"].split(",")}))
        if not 1 <= len(tenants) <= 100:
            raise ValueError("INVALID_TENANT_ALLOWLIST")
        trust = env.get("SQLSERVER_TRUST_SERVER_CERTIFICATE", "no").lower()
        if trust not in ("yes", "no"):
            raise ValueError("INVALID_CERTIFICATE_CONFIG")
        return cls(env["SQLSERVER_HOST"], env["SQLSERVER_DATABASE"], env["SQLSERVER_USER"], env["SQLSERVER_PASSWORD"],
            tenants, env.get("SQLSERVER_DRIVER", "ODBC Driver 18 for SQL Server"), trust == "yes",
            integer(env, "RISK_BATCH_SIZE", 1000, 1, 10000), integer(env, "RISK_LEASE_SECONDS", 120, 30, 3600),
            integer(env, "RISK_POLL_SECONDS", 2, 1, 60), integer(env, "RISK_MAX_ATTEMPTS", 3, 1, 10),
            integer(env, "RISK_SQL_TRIES", 3, 1, 5), integer(env, "RISK_COOLDOWN_SECONDS", 10, 0, 3600),
            integer(env, "RISK_QUERY_TIMEOUT", 15, 1, 60), integer(env, "RISK_SCHEDULE_INTERVAL", 86400, 60, 604800))

    def connection_string(self):
        def quote(value):
            return "{" + str(value).replace("}", "}}") + "}"
        parts = {"DRIVER": self.driver, "SERVER": self.host, "DATABASE": self.database,
            "UID": self.user, "PWD": self.password, "Encrypt": "yes",
            "TrustServerCertificate": "yes" if self.trust_certificate else "no"}
        return ";".join(k + "=" + quote(v) for k, v in parts.items())
