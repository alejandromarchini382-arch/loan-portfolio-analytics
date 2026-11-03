"""Read-only integration launcher; never prints or persists the short-lived test bearer tokens."""
import json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'analytics-flask'))
from scripts.provision import read_env
from risk.auth import Auth
from risk.config import Settings, uuid_text

def published_job(env, tenant, connect=None):
    """Discover an actual job in the authorized fixture; never infer IDs from committed history."""
    tenant = uuid_text(tenant)
    user = env.get("PORTFOLIO_DB_USER", "")
    if not user or user.casefold() in {"sa", "dbo"} or not env.get("PORTFOLIO_DB_PASSWORD"):
        raise ValueError("READ_ONLY_REPORTING_CREDENTIALS_REQUIRED")
    if connect is None:
        import pyodbc
        connect = pyodbc.connect
    settings = Settings(
        env.get("RISK_TEST_HOST", env.get("SQLSERVER_HOST", "127.0.0.1,1433")),
        env.get("PORTFOLIO_DATABASE", env.get("RISK_DATABASE", "LoanPortfolio")),
        user, env["PORTFOLIO_DB_PASSWORD"],
        trust_certificate=env.get("SQLSERVER_TRUST_SERVER_CERTIFICATE", "yes").lower() == "yes",
    )
    connection = connect(settings.connection_string(), autocommit=True, timeout=5)
    try:
        connection.timeout = 5
        cursor = connection.execute("""SELECT j.JobId FROM analytics.RiskPublication AS p
            JOIN analytics.RiskJob AS j ON j.TenantId=p.TenantId AND j.RunId=p.PublishedRunId
            WHERE p.TenantId=? AND j.Status='SUCCEEDED'""", tenant)
        try:
            row = cursor.fetchone()
            return str(row[0]).lower() if row else None
        finally:
            cursor.close()
    finally:
        connection.close()


def main():
    env={**read_env(ROOT/'.env'),**os.environ}
    tenants=tuple(t.strip() for t in env['RISK_TENANTS'].split(','))
    auth=Auth.from_env(tenants,env)
    job=published_job(env, tenants[0])
    local=ROOT/'widget/.tools/node-v22.23.4-win-x64/node.exe'
    executable=str(local) if local.exists() else 'node'
    result=subprocess.run([executable,'scripts/backend-tests.cjs'],cwd=ROOT/'widget',input=json.dumps({
        'base':env.get('PORTFOLIO_TEST_URL','http://127.0.0.1:'+env.get('PORTFOLIO_PORT','8081')),
        'tokens':[auth.token(t,('portfolio:read','risk:read')) for t in tenants], 'jobId':job}),text=True)
    return result.returncode
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception:
        print('Integration setup failed; check the existing local environment without exposing credentials.',file=sys.stderr)
        raise SystemExit(1)
