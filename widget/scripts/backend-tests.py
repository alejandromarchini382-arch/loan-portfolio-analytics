"""Read-only integration launcher; never prints or persists the short-lived test bearer tokens."""
import json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'analytics-flask'))
from scripts.provision import read_env
from risk.auth import Auth

def main():
    env={**read_env(ROOT/'.env'),**os.environ}
    tenants=tuple(t.strip() for t in env['RISK_TENANTS'].split(','))
    auth=Auth.from_env(tenants,env)
    demo=ROOT/'spring-boot/demo-results.json'
    job=json.loads(demo.read_text())['tenants'][0]['successfulRun']['jobId'] if demo.exists() else None
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
