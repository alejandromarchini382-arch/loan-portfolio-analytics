"""Loopback demonstration launcher. JWTs stay server-side; only access codes enter a private ignored file."""
import argparse,json,os,secrets,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]

def private_file(path,data):
    path.parent.mkdir(exist_ok=True)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    os.close(fd)
    if os.name=='nt':
        account=os.environ.get('USERDOMAIN','')+'\\'+os.environ['USERNAME']
        r=subprocess.run(['icacls',str(path),'/inheritance:r','/grant:r',account+':(F)'],capture_output=True)
        if r.returncode:raise RuntimeError('Private file permissions could not be set')
    path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--mode',choices=['real','synthetic'],default='real');ap.add_argument('--port',type=int,default=3099)
    ap.add_argument('--allow-risk-runs',action='store_true');ap.add_argument('--session-seconds',type=int,default=900)
    a=ap.parse_args()
    if not 1024<=a.port<=65535 or not 1<=a.session_seconds<=900:raise ValueError('Invalid local limits')
    config={'mode':a.mode,'port':a.port,'sessionSeconds':a.session_seconds,'allowRisk':a.allow_risk_runs,'profiles':[]}
    access=None
    if a.mode=='real':
        sys.path.insert(0,str(ROOT/'analytics-flask'))
        from scripts.provision import read_env
        from risk.auth import Auth
        env={**read_env(ROOT/'.env'),**os.environ};tenants=tuple(t.strip() for t in env['RISK_TENANTS'].split(','))
        auth=Auth.from_env(tenants,env)
        config['upstream']='http://127.0.0.1:'+str(int(env.get('PORTFOLIO_PORT','8081')))
        expires=int(time.time()*1000)+899000
        specs=[('tenant-a','Fixture tenant A - reporting and risk status',tenants[0],True,False),('viewer-a','Fixture tenant A - reporting only',tenants[0],False,False)]
        if len(tenants)>1:specs.append(('tenant-b','Fixture tenant B - reporting and risk status',tenants[1],True,False))
        if a.allow_risk_runs:specs.append(('operator-a','Fixture tenant A - authorized risk operator',tenants[0],True,True))
        for identity,label,tenant,read,run in specs:
            perms=['portfolio:read']+(['risk:read'] if read else [])+(['risk:run'] if run else [])
            config['profiles'].append({'id':identity,'label':label,'code':secrets.token_urlsafe(32),'token':auth.token(tenant,perms,lifetime=900),'expiresAt':expires,'canReadRisk':read,'canRunRisk':run})
        access=ROOT/'widget/.demo'/f'access-{a.port}-{secrets.token_hex(4)}.json'
        private_file(access,{'port':a.port,'expiresAt':expires,'profiles':[{'id':p['id'],'label':p['label'],'code':p['code']} for p in config['profiles']]})
        print('Private access-code file: '+str(access.relative_to(ROOT)),flush=True)
    local=ROOT/'widget/.tools/node-v22.23.4-win-x64/node.exe';node=str(local) if local.exists() else 'node'
    child_env={k:v for k,v in os.environ.items() if not any(word in k.upper() for word in ['PASSWORD','SECRET','TOKEN'])}
    child=subprocess.Popen([node,'scripts/demo-server.cjs','--port',str(a.port)],cwd=ROOT/'widget',stdin=subprocess.PIPE,env=child_env)
    try:
        child.stdin.write(json.dumps(config).encode());child.stdin.close()
        return child.wait()
    except KeyboardInterrupt:
        child.terminate();child.wait(timeout=10);return 0
    finally:
        if child.poll() is None:child.terminate();child.wait(timeout=10)
        if access and access.exists():access.unlink()
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception:
        print('Local demonstration setup failed; check the existing private development configuration.',file=sys.stderr);raise SystemExit(1)
