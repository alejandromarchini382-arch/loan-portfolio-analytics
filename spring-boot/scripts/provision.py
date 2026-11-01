"""Provision only the dedicated read-only reporting identity; never rotate existing credentials."""
from pathlib import Path
import os,re,secrets,sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"analytics-flask"))
import pyodbc
from risk.config import Settings
from scripts.provision import read_env


def provision(connection,user,password):
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}",user) or user.casefold() in {"sa","dbo","guest","public"} or not 24<=len(password)<=100:
        raise ValueError("INVALID_REPORT_ACCOUNT_CONFIG")
    connection.execute("""DECLARE @name SYSNAME=?,@password NVARCHAR(100)=?,@sql NVARCHAR(MAX);
        IF SUSER_ID(@name) IS NULL BEGIN
            SET @sql=N'CREATE LOGIN '+QUOTENAME(@name)+N' WITH PASSWORD='+QUOTENAME(@password,CHAR(39))+N',CHECK_POLICY=ON'; EXEC(@sql);
        END ELSE IF IS_SRVROLEMEMBER('sysadmin',@name)=1 OR NOT EXISTS
            (SELECT 1 FROM sys.sql_logins WHERE name=@name AND PWDCOMPARE(@password,password_hash)=1)
            THROW 51102,'UNSAFE_OR_MISMATCHED_REPORT_LOGIN',1;
        IF DATABASE_PRINCIPAL_ID(@name) IS NULL BEGIN
            SET @sql=N'CREATE USER '+QUOTENAME(@name)+N' FOR LOGIN '+QUOTENAME(@name); EXEC(@sql);
        END;
        IF IS_ROLEMEMBER('db_owner',@name)=1 THROW 51103,'REPORT_USER_IS_OWNER',1;
        IF ISNULL(IS_ROLEMEMBER('analytics_reader',@name),0)=0 BEGIN
            SET @sql=N'ALTER ROLE analytics_reader ADD MEMBER '+QUOTENAME(@name);EXEC(@sql);
        END;
        """,user,password).close()


def main():
    path=ROOT/".env";env={**read_env(path),**os.environ}
    additions={"PORTFOLIO_DB_USER":"portfolio_reader_login","PORTFOLIO_DB_PASSWORD":"Rpt9!"+secrets.token_urlsafe(30),
        "PORTFOLIO_CURSOR_SECRET":secrets.token_urlsafe(48),"PORTFOLIO_DATABASE":env.get("RISK_DATABASE","LoanPortfolio")}
    missing={k:v for k,v in additions.items() if not env.get(k)};env.update(missing)
    admin=Settings(env.get("RISK_TEST_HOST","127.0.0.1,1433"),env["PORTFOLIO_DATABASE"],"sa",env["MSSQL_SA_PASSWORD"],trust_certificate=True)
    c=pyodbc.connect(admin.connection_string(),autocommit=True,timeout=5)
    try: provision(c,env["PORTFOLIO_DB_USER"],env["PORTFOLIO_DB_PASSWORD"])
    finally:c.close()
    if missing:
        with path.open("a",encoding="utf-8") as out:out.write("\n"+"\n".join(f"{k}={v}" for k,v in missing.items())+"\n")
    print("Dedicated reporting login provisioned; existing credentials preserved and new secrets saved only in ignored .env.")


if __name__=="__main__":
    try:main()
    except Exception:
        print("Reporting provisioning failed; check local administrative configuration and the analytics schema.",file=sys.stderr)
        raise SystemExit(1)
