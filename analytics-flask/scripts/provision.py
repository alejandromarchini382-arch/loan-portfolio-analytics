"""Administrative bootstrap only; runtime services never use the administrative account."""
import os
from pathlib import Path
import re
import secrets
import sys

import pyodbc

from risk.config import Settings


def provision(connection, api_user, api_password, worker_user, worker_password):
    names=(api_user,worker_user)
    if (api_user==worker_user or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}",n) or n.casefold() in
        {"sa","dbo","guest","public"} for n in names) or any(len(p)<24 or len(p)>100 for p in (api_password,worker_password))):
        raise ValueError("INVALID_SERVICE_ACCOUNT_CONFIG")
    for user,password in ((api_user,api_password),(worker_user,worker_password)):
        # Password/name are bound values. QUOTENAME safely constructs the required DDL identifiers/literals.
        connection.execute("""DECLARE @name SYSNAME=?, @password NVARCHAR(100)=?, @sql NVARCHAR(MAX);
            IF SUSER_ID(@name) IS NULL BEGIN
                SET @sql=N'CREATE LOGIN '+QUOTENAME(@name)+N' WITH PASSWORD='+QUOTENAME(@password,CHAR(39))+N',CHECK_POLICY=ON';
                EXEC(@sql);
            END ELSE IF IS_SRVROLEMEMBER('sysadmin',@name)=1 OR NOT EXISTS
                (SELECT 1 FROM sys.sql_logins WHERE name=@name AND PWDCOMPARE(@password,password_hash)=1)
                THROW 51100,'EXISTING_LOGIN_NOT_SAFE_OR_CREDENTIAL_MISMATCH',1;
            IF DATABASE_PRINCIPAL_ID(@name) IS NULL BEGIN
                SET @sql=N'CREATE USER '+QUOTENAME(@name)+N' FOR LOGIN '+QUOTENAME(@name); EXEC(@sql);
            END;
            IF IS_ROLEMEMBER('db_owner',@name)=1 THROW 51101,'SERVICE_USER_IS_DATABASE_OWNER',1;
            """,user,password).close()
    connection.execute("""IF DATABASE_PRINCIPAL_ID(N'analytics_risk_api') IS NULL
        CREATE ROLE analytics_risk_api AUTHORIZATION dbo;
        GRANT SELECT,INSERT ON OBJECT::analytics.RiskJob TO analytics_risk_api;""").close()
    for role,user in (("analytics_risk_api",api_user),("analytics_worker",worker_user)):
        connection.execute("DECLARE @sql NVARCHAR(MAX)=N'ALTER ROLE '+QUOTENAME(?)+N' ADD MEMBER '+QUOTENAME(?); EXEC(@sql);",role,user).close()


def read_env(path):
    if not path.exists(): return {}
    return dict(line.split("=",1) for line in path.read_text(encoding="utf-8").splitlines() if line and not line.startswith("#") and "=" in line)


def main():
    root=Path(__file__).resolve().parents[2]
    path=root/".env"
    values=read_env(path)
    env={**values,**os.environ}
    if not env.get("MSSQL_SA_PASSWORD"):
        raise ValueError("MISSING_LOCAL_ADMIN_PASSWORD")
    additions={
        "RISK_API_DB_USER":"risk_api_login", "RISK_WORKER_DB_USER":"risk_worker_login",
        "RISK_API_DB_PASSWORD":"Api9!"+secrets.token_urlsafe(30),
        "RISK_WORKER_DB_PASSWORD":"Wrk9!"+secrets.token_urlsafe(30),
        "RISK_JWT_SECRET":secrets.token_urlsafe(48), "RISK_AUTH_MODE":"development-jwt",
        "RISK_JWT_ISSUER":"axis-local-risk", "RISK_JWT_AUDIENCE":"axis-risk-service",
        "RISK_DATABASE":"LoanPortfolio",
    }
    # Stable fixture tenant IDs, supplied by the existing deterministic generator.
    sys.path.insert(0,str(root/"sql"))
    from seed.generate import generate
    additions["RISK_TENANTS"]=",".join(t["TenantId"] for t in generate(2)["Tenants"])
    missing={key:value for key,value in additions.items() if not env.get(key)}
    env.update(missing)
    admin=Settings(env.get("SQLSERVER_HOST","127.0.0.1,1433"),env.get("RISK_DATABASE","LoanPortfolio"),
        env.get("RISK_ADMIN_USER","sa"),env["MSSQL_SA_PASSWORD"],trust_certificate=True)
    connection=pyodbc.connect(admin.connection_string(),autocommit=True,timeout=5)
    try:
        provision(connection,env["RISK_API_DB_USER"],env["RISK_API_DB_PASSWORD"],env["RISK_WORKER_DB_USER"],env["RISK_WORKER_DB_PASSWORD"])
    finally: connection.close()
    if missing:
        with path.open("a",encoding="utf-8") as handle:
            handle.write("\n"+"\n".join(f"{k}={v}" for k,v in missing.items())+"\n")
    print("Dedicated API and worker accounts provisioned; ignored .env updated without displaying secrets.")


if __name__=="__main__":
    try: main()
    except Exception:
        print("Provisioning failed. Check local administrative configuration and existing analytics schema.",file=sys.stderr)
        raise SystemExit(1)
