"""Real HTTP tests reuse the Phase 2 SQL fixtures and dedicated accounts."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4

import pytest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"analytics-flask"))
spec=importlib.util.spec_from_file_location("risk_sql_fixtures",ROOT/"analytics-flask/tests/conftest.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
sql_case=module.sql_case
spec=importlib.util.spec_from_file_location("portfolio_provision",ROOT/"spring-boot/scripts/provision.py")
provision_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(provision_module)
from scripts.provision import read_env


def command(arguments,env=None):
    result=subprocess.run(arguments,cwd=ROOT,env=env,capture_output=True,text=True,timeout=120)
    if result.returncode:
        raise RuntimeError("Docker operation failed: "+result.stderr[-300:])
    return result.stdout.strip()


def start(name,image,network,env,expose=False):
    args=["docker","run","-d","--name",name,"--network",network,"--memory","512m","--cpus","1"]
    if expose:args.extend(["-p","127.0.0.1::8080"])
    for key in env:args.extend(["-e",key])
    args.append(image)
    command(args,env={**os.environ,**env})


@pytest.fixture
def web(sql_case):
    if os.getenv("PORTFOLIO_INTEGRATION")!="1":pytest.skip("PORTFOLIO_INTEGRATION=1 requires the built Spring image and SQL Server")
    case=sql_case
    env={**read_env(ROOT/".env"),**os.environ}
    provision_module.provision(case.admin,env["PORTFOLIO_DB_USER"],env["PORTFOLIO_DB_PASSWORD"])
    sql_container=command(["docker","compose","ps","-q","sqlserver"])
    network=command(["docker","inspect","--format","{{range $name,$config := .NetworkSettings.Networks}}{{$name}}{{end}}",sql_container])
    suffix=uuid4().hex[:12];flask="axis-risk-test-"+suffix;spring="axis-portfolio-test-"+suffix
    names=[]
    try:
        start(flask,"axis-risk:local",network,{
            "SQLSERVER_HOST":"sqlserver,1433","SQLSERVER_DATABASE":case.settings.database,"SQLSERVER_USER":case.api_settings.user,
            "SQLSERVER_PASSWORD":case.api_settings.password,"SQLSERVER_TRUST_SERVER_CERTIFICATE":"yes",
            "RISK_TENANTS":",".join(case.tenants),"RISK_AUTH_MODE":"development-jwt","RISK_JWT_SECRET":case.auth.secret,
            "RISK_JWT_ISSUER":case.auth.issuer,"RISK_JWT_AUDIENCE":case.auth.audience,"RISK_COOLDOWN_SECONDS":"0"})
        names.append(flask)
        start(spring,"axis-portfolio:local",network,{
            "SERVER_PORT":"8080","PORTFOLIO_DB_HOST":"sqlserver","PORTFOLIO_DATABASE":case.settings.database,
            "PORTFOLIO_DB_USER":env["PORTFOLIO_DB_USER"],"PORTFOLIO_DB_PASSWORD":env["PORTFOLIO_DB_PASSWORD"],
            "PORTFOLIO_TRUST_CERTIFICATE":"true","PORTFOLIO_CURSOR_SECRET":env["PORTFOLIO_CURSOR_SECRET"],
            "RISK_AUTH_MODE":"development-jwt","RISK_JWT_SECRET":case.auth.secret,"RISK_JWT_ISSUER":case.auth.issuer,
            "RISK_JWT_AUDIENCE":case.auth.audience,"RISK_TENANTS":",".join(case.tenants),
            "FLASK_BASE_URL":"http://"+flask+":8000","PORTFOLIO_REQUESTS_PER_MINUTE":"100000","PORTFOLIO_CURSOR_SECONDS":"2"},expose=True)
        names.append(spring)
        port=command(["docker","port",spring,"8080/tcp"]).split(":")[-1]
        base="http://127.0.0.1:"+port
        deadline=time.monotonic()+90
        while True:
            try:
                with urllib.request.urlopen(base+"/actuator/health/readiness",timeout=3) as response:
                    if response.status==200:break
            except (OSError,urllib.error.HTTPError):pass
            if time.monotonic()>deadline:
                (ROOT/"spring-integration-container.log").write_text(command(["docker","logs",spring]),encoding="utf-8")
                raise RuntimeError("Spring test service did not become ready; inspect sanitized container log")
            time.sleep(.3)
        def request(path,tenant=None,params=None,method="GET",body=None,key=None,permissions=("portfolio:read",)):
            tenant=tenant or case.tenants[0]
            headers={"Authorization":"Bearer "+case.auth.token(tenant,permissions)}
            if key:headers["Idempotency-Key"]=key
            data=None
            if body is not None:data=json.dumps(body).encode();headers["Content-Type"]="application/json"
            url=base+path+("?"+urllib.parse.urlencode(params) if params else "")
            started=time.perf_counter()
            try:response=urllib.request.urlopen(urllib.request.Request(url,data=data,headers=headers,method=method),timeout=15)
            except urllib.error.HTTPError as ex:response=ex
            with response:
                return response.status,json.load(response),(time.perf_counter()-started)*1000
        yield SimpleNamespace(case=case,request=request,base=base,environment=env)
    finally:
        for name in reversed(names):
            # Names are generated locally, never supplied by an environment variable or caller.
            subprocess.run(["docker","rm","-f",name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
