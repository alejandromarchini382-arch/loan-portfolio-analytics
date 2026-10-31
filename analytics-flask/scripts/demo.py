"""Local assessment demonstration. Requires the existing seeded database and ignored .env.

Intentionally advances one fictional loan's source version to prove failed publication safety.
Does not reset data, edit financial values, or add test-only HTTP/worker behavior.
"""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
from uuid import uuid4

import pyodbc

from risk.auth import Auth
from risk.config import Settings
from scripts.provision import read_env

ROOT=Path(__file__).resolve().parents[2]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-rated",action="store_true",help="repeat using the current publication without resetting it")
    args=parser.parse_args()
    env={**read_env(ROOT/".env"),**os.environ}
    tenants=tuple(env["RISK_TENANTS"].split(","))
    if len(tenants)!=2: raise RuntimeError("Demo requires the two fixture tenants")
    auth=Auth.from_env(tenants,env)
    base="http://127.0.0.1:"+env.get("RISK_API_PORT","8000")
    admin_settings=Settings(env.get("SQLSERVER_HOST","127.0.0.1,1433"),env.get("RISK_DATABASE","LoanPortfolio"),
        "sa",env["MSSQL_SA_PASSWORD"],trust_certificate=True)
    connection=pyodbc.connect(admin_settings.connection_string(),autocommit=True,timeout=5)
    connection.timeout=15
    def docker(*arguments,batch=50,background=False):
        command=["docker","compose","--profile","risk",*arguments]
        child_env={**env,"RISK_BATCH_SIZE":str(batch)}
        if background:
            return subprocess.Popen(command,cwd=ROOT,env=child_env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        result=subprocess.run(command,cwd=ROOT,env=child_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if result.returncode: raise RuntimeError("Docker demonstration command failed")
        return result
    def http(method,path,tenant,body=None,key=None):
        headers={"Authorization":"Bearer "+auth.token(tenant)}
        payload=None
        if body is not None:
            payload=json.dumps(body).encode()
            headers["Content-Type"]="application/json"
        if key: headers["Idempotency-Key"]=key
        request=urllib.request.Request(base+path,data=payload,headers=headers,method=method)
        started=time.monotonic()
        try:
            response=urllib.request.urlopen(request,timeout=10)
        except urllib.error.HTTPError as exc: response=exc
        with response:
            return response.status,json.load(response),round((time.monotonic()-started)*1000,2)
    def ratings(tenant):
        return {str(r[0]).lower():r[1] for r in connection.execute(
            "SELECT LoanId,LoanRiskRating FROM analytics.PublishedLoanPortfolio WHERE TenantId=?",tenant).fetchall()}
    def submit(tenant,key):
        for _ in range(30):
            code,row,latency=http("POST","/risk/runs",tenant,{},key)
            if code==429:
                time.sleep(1)
                continue
            if code!=202: raise RuntimeError("Demo submission rejected")
            return row,latency
        raise RuntimeError("Demo submission cooldown did not clear")
    def watch(jobs,prior,fail=False):
        observed_running=observed_staged=mutated=False
        final={}
        deadline=time.monotonic()+180
        while time.monotonic()<deadline:
            for tenant,run in jobs.items():
                code,row,_=http("GET","/risk/runs/"+run,tenant)
                if code!=200: raise RuntimeError("Demo status unavailable")
                current=ratings(tenant)
                if row["status"]=="RUNNING":
                    observed_running=True
                    if row["processedLoans"]>0 and current==prior[tenant]:
                        observed_staged=True
                        if fail and not mutated:
                            # Same-transaction version advancement; monetary inputs remain unchanged.
                            target=connection.execute("SELECT TOP(1) LoanId FROM analytics.LoanPortfolio WHERE TenantId=? AND Status='ACTIVE' ORDER BY LoanId",tenant).fetchone()[0]
                            connection.autocommit=False
                            try:
                                connection.execute("UPDATE analytics.Loans SET SourceVersion=SourceVersion+1,UpdatedAtUtc=SYSUTCDATETIME() WHERE TenantId=? AND LoanId=?",tenant,target).close()
                                connection.execute("UPDATE analytics.LoanPortfolio SET SourceVersion=SourceVersion+1,LastSyncedUtc=SYSUTCDATETIME() WHERE TenantId=? AND LoanId=?",tenant,target).close()
                                connection.commit()
                            except Exception:
                                connection.rollback()
                                raise
                            finally: connection.autocommit=True
                            mutated=True
                if row["status"] in ("SUCCEEDED","FAILED"):
                    final[tenant]=row
            if len(final)==len(jobs):
                return final,observed_running,observed_staged,mutated
            time.sleep(.02)
        raise RuntimeError("Demo worker did not finish in time")
    report={}
    try:
        docker("stop","risk-worker")
        docker("up","-d","--no-build","--wait","risk-api")
        initial={t:ratings(t) for t in tenants}
        total=sum(len(rows) for rows in initial.values())
        rated=sum(v is not None for rows in initial.values() for v in rows.values())
        if total!=1500 or (rated and not args.allow_rated):
            raise RuntimeError("Demo requires 1500 initially Unrated loans; --allow-rated permits a repeat without resetting data")
        report["initial"]={"loans":total,"rated":rated,"unrated":total-rated}
        jobs={};submissions=[]
        for tenant in tenants:
            row,latency=submit(tenant,"demo-success:"+str(uuid4()))
            if row["status"]!="QUEUED": raise RuntimeError("HTTP request unexpectedly processed work")
            jobs[tenant]=row["runId"]
            submissions.append({"tenantId":tenant,"runId":row["runId"],"httpStatus":202,"status":"QUEUED","latencyMs":latency})
        report["submission"]=submissions
        # Scheduling uses the same submit path and defers these already-active tenants.
        docker("run","--rm","--no-deps","risk-worker","python","-m","risk.scheduler","--once")
        report["scheduler"]={"exitCode":0,"activeTenantRunsDeferred":True}
        starter=docker("up","-d","--no-build","risk-worker",background=True)
        final,running,staged,_=watch(jobs,initial)
        starter.communicate(timeout=30)
        if starter.returncode or not running or not staged or any(r["status"]!="SUCCEEDED" for r in final.values()):
            raise RuntimeError("Successful workflow observation failed")
        report["runningObserved"]=running
        report["stagedBeforePublicationObserved"]=staged
        successful=[]
        for tenant in tenants:
            current=ratings(tenant)
            active=connection.execute("SELECT COUNT(*) FROM analytics.LoanPortfolio WHERE TenantId=? AND Status='ACTIVE'",tenant).fetchone()[0]
            if sum(v is not None for v in current.values())!=active: raise RuntimeError("Published active population mismatch")
            successful.append({"tenantId":tenant,"activeRated":active,"inactiveUnrated":len(current)-active,
                "ratings":dict(Counter(v for v in current.values() if v is not None))})
        report["successful"]=successful
        docker("stop","risk-worker")
        tenant=tenants[0];prior={tenant:ratings(tenant)};key="demo-failure:"+str(uuid4())
        failure,_=submit(tenant,key)
        starter=docker("up","-d","--no-build","risk-worker",batch=10,background=True)
        result,running,staged,mutated=watch({tenant:failure["runId"]},prior,fail=True)
        starter.communicate(timeout=30)
        failed=result[tenant]
        if (starter.returncode or not mutated or failed["status"]!="FAILED" or failed["errorCode"]!="SOURCE_SNAPSHOT_CHANGED"
            or ratings(tenant)!=prior[tenant]): raise RuntimeError("Failure preservation check failed")
        report["failure"]={"runId":failure["runId"],"status":failed["status"],"errorCode":failed["errorCode"],
            "sourceVersionAdvanced":True,"publicationPreserved":True}
        before=connection.execute("SELECT COUNT(*) FROM analytics.RiskJob WHERE TenantId=?",tenant).fetchone()[0]
        replay,_=submit(tenant,key)
        after=connection.execute("SELECT COUNT(*) FROM analytics.RiskJob WHERE TenantId=?",tenant).fetchone()[0]
        if replay["runId"]!=failure["runId"] or before!=after: raise RuntimeError("Idempotency check failed")
        report["idempotency"]={"sameRun":True,"jobsBefore":before,"jobsAfter":after,"status":replay["status"]}
        cross,_,_=http("GET","/risk/runs/"+failure["runId"],tenants[1])
        if cross!=404: raise RuntimeError("Cross-tenant isolation check failed")
        report["crossTenantHttpStatus"]=cross
        report["workerDemoBatchSizes"]={"success":50,"failure":10,"serviceDefault":1000}
        output=ROOT/"analytics-flask"/"demo-results.json"
        output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
        print(json.dumps(report,indent=2))
    finally: connection.close()


if __name__=="__main__":
    try: main()
    except Exception as exc:
        print("Demonstration failed: "+str(exc) if isinstance(exc,RuntimeError) else "Demonstration failed; inspect local runtime and sanitized service logs.")
        raise SystemExit(1)
