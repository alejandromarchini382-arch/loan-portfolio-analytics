from collections import Counter
from decimal import Decimal
import json
import os
from pathlib import Path
import statistics
import time
from uuid import uuid4

import pyodbc
import pytest

from risk.config import Settings
from risk.scoring import ScoringError
from risk.worker import process_run

pytestmark=pytest.mark.skipif(os.getenv("PORTFOLIO_INTEGRATION")!="1",reason="PORTFOLIO_INTEGRATION=1 and built Docker images required")
BASE="/api/v1/portfolio"
COLUMNS={"division":"Division","loanOfficer":"LoanOfficer","borrowerType":"BorrowerType","riskRating":"LoanRiskRating"}


def groups(web,dimension,tenant=None,**extra):
    code,body,_=web.request(BASE+"/groups",tenant,dict(groupBy=dimension,**extra))
    assert code==200,body.get("error",{}).get("code")
    return body


def compare_sql(web,dimension,tenant,body,clause="",params=()):
    col=COLUMNS[dimension]
    rows=web.case.admin.execute(f"""SELECT {col},COUNT_BIG(*),SUM(CurrentBalance),AVG(CAST(InterestRate AS decimal(18,8)))
        FROM analytics.PublishedLoanPortfolio WHERE TenantId=? AND Status='ACTIVE' {clause} GROUP BY {col}""",tenant,*params).fetchall()
    expected={r[0]:(r[1],r[2],r[3]) for r in rows}
    assert {g["key"] for g in body["groups"]}==set(expected)
    for group in body["groups"]:
        count,balance,rate=expected[group["key"]]
        assert group["loanCount"]==count
        assert isinstance(group["totalBalance"],str) and Decimal(group["totalBalance"])==balance
        assert (group["averageInterestRate"] is None)==(rate is None)
        if rate is not None:assert isinstance(group["averageInterestRate"],str) and Decimal(group["averageInterestRate"])==rate
        if group["key"] is None:assert group["label"]==("Unrated" if dimension=="riskRating" else "Unassigned")


def claim(web,tenant):
    row=web.case.api.submit(tenant,str(uuid4()))
    return web.case.worker.claim(tenant,str(row["RunId"]).lower())


@pytest.mark.parametrize("sql_case",[1500,15000],indirect=True)
def test_financial_grouping_nested_pagination_and_local_timings(web,sql_case):
    case=web.case
    code,meta,_=web.request(BASE+"/metadata")
    assert code==200 and {d["value"] for d in meta["dimensions"]}==set(COLUMNS)
    for tenant in case.tenants:
        for dimension in COLUMNS:compare_sql(web,dimension,tenant,groups(web,dimension,tenant))
        # Real Flask worker populates scores; the reporting login never writes.
        assert process_run(case.worker,claim(web,tenant))=="SUCCEEDED"
        compare_sql(web,"riskRating",tenant,groups(web,"riskRating",tenant))
    tenant=case.tenants[0]
    root=groups(web,"division",tenant,subgroupBy="loanOfficer")
    selected=max(root["groups"],key=lambda g:g["loanCount"])
    child_params={"groupBy":"division","subgroupBy":"loanOfficer"}
    parent_filter=" AND Division IS NULL" if selected["key"] is None else " AND Division=?"
    parent_args=() if selected["key"] is None else (selected["key"],)
    child_params.update({"parentKeyIsNull":"true"} if selected["key"] is None else {"parentKey":selected["key"]})
    code,children,_=web.request(BASE+"/groups/children",tenant,child_params)
    assert code==200 and all(not g["hasChildren"] for g in children["groups"])
    compare_sql(web,"loanOfficer",tenant,children,parent_filter,parent_args)
    assert sum(g["loanCount"] for g in children["groups"])==selected["loanCount"]
    assert sum(Decimal(g["totalBalance"]) for g in children["groups"])==Decimal(selected["totalBalance"])
    officer=max(children["groups"],key=lambda g:g["loanCount"])
    page_params={"groupBy":"division","subgroupBy":"loanOfficer","limit":"17"}
    page_params.update({"groupKeyIsNull":"true"} if selected["key"] is None else {"groupKey":selected["key"]})
    page_params.update({"subgroupKeyIsNull":"true"} if officer["key"] is None else {"subgroupKey":officer["key"]})
    ids=[]
    while True:
        code,page,_=web.request(BASE+"/loans",tenant,page_params)
        assert code==200
        assert len(page["loans"])<=17
        for loan in page["loans"]:
            ids.append(loan["loanId"])
            row=case.admin.execute("SELECT CurrentBalance,InterestRate FROM analytics.PublishedLoanPortfolio WHERE TenantId=? AND LoanId=?",tenant,loan["loanId"]).fetchone()
            assert Decimal(loan["currentBalance"])==row[0]
            assert loan["interestRate"] is None or Decimal(loan["interestRate"])==row[1]
        if page["nextCursor"] is None:break
        page_params["cursor"]=page["nextCursor"]
    assert len(ids)==len(set(ids))==officer["loanCount"]
    # Bound, warmed HTTP measurements, not a production performance guarantee.
    measurements={}
    requests=[(d,BASE+"/groups",{"groupBy":d}) for d in COLUMNS]
    requests.extend([("children",BASE+"/groups/children",child_params),("loans",BASE+"/loans",{k:v for k,v in page_params.items() if k!="cursor"})])
    for name,path,params in requests:
        for _ in range(3):assert web.request(path,tenant,params)[0]==200
        samples=[]
        for _ in range(20):
            status,_,elapsed=web.request(path,tenant,params);assert status==200;samples.append(elapsed)
        ordered=sorted(samples)
        measurements[name]={"samples":20,"p50Ms":round(statistics.median(samples),3),"p95Ms":round(ordered[18],3)}
    artifact=Path(__file__).resolve().parents[1]/f"performance-{case.count}.json"
    artifact.write_text(json.dumps({"loansAcrossTwoTenants":case.count,"httpMeasurements":measurements,
        "environment":"local Java 17 Docker API, 1 CPU/512MiB container; existing SQL Server", "productionGuarantee":False},indent=2)+"\n",encoding="utf-8")


def test_empty_null_unrated_and_tenant_scoped_cursors(web):
    case=web.case;a,b=case.tenants
    # Fixture-only projection changes guarantee zero balances and all-null rates in a null group.
    case.admin.execute("UPDATE analytics.LoanPortfolio SET Division='Other',BorrowerRiskRating='HIGH' WHERE TenantId=?",a).close()
    target=case.admin.execute("SELECT TOP(1) LoanId FROM analytics.LoanPortfolio WHERE TenantId=? AND Status='ACTIVE' ORDER BY LoanId",a).fetchone()[0]
    case.admin.execute("UPDATE analytics.LoanPortfolio SET Division=NULL,LoanOfficer=NULL,InterestRate=NULL,CurrentBalance=0 WHERE TenantId=? AND LoanId=?",a,target).close()
    body=groups(web,"division",a)
    null=next(g for g in body["groups"] if g["key"] is None)
    assert null["label"]=="Unassigned" and null["totalBalance"]=="0.00" and null["averageInterestRate"] is None
    risk=groups(web,"riskRating",a)
    assert len(risk["groups"])==1 and risk["groups"][0]["key"] is None and risk["groups"][0]["label"]=="Unrated"
    code,empty,_=web.request(BASE+"/groups/children",a,{"groupBy":"division","subgroupBy":"loanOfficer","parentKey":"missing"})
    assert code==200 and empty["groups"]==[]
    path={"groupBy":"division","groupKey":"Other","limit":"1"}
    code,page,_=web.request(BASE+"/loans",a,path);assert code==200 and page["nextCursor"]
    token=page["nextCursor"]
    assert web.request(BASE+"/loans",b,{**path,"cursor":token})[0]==400
    assert web.request(BASE+"/loans",a,{**path,"cursor":token,"status":"CLOSED"})[0]==400
    assert web.request(BASE+"/loans",a,{**path,"cursor":token[:-5]+"AAAAA"})[0]==400
    case.admin.execute("UPDATE analytics.LoanPortfolio SET SourceVersion=SourceVersion+1,LastSyncedUtc=SYSUTCDATETIME() WHERE TenantId=? AND LoanId=?",a,target).close()
    assert web.request(BASE+"/loans",a,{**path,"cursor":token})[0]==409
    code,page,_=web.request(BASE+"/loans",a,path);assert code==200
    time.sleep(2.1)
    assert web.request(BASE+"/loans",a,{**path,"cursor":page["nextCursor"]})[0]==400
    assert web.request(BASE+"/groups",a,{"groupBy":"division","tenantId":b})[0]==400
    assert web.request(BASE+"/groups",a,{"groupBy":"Division;DROP TABLE Loans"})[0]==400
    assert web.request(BASE+"/groups",a,{"groupBy":"division","division":"' OR 1=1--"})[1]["groups"]==[]
    assert web.request(BASE+"/loans",a,{**path,"limit":"101"})[0]==400


def test_delegation_publication_invisibility_and_failure_preservation(web):
    case=web.case;a,b=case.tenants
    before=groups(web,"riskRating",a)
    assert before["riskRunId"] is None
    key=str(uuid4())
    code,created,_=web.request(BASE+"/risk-runs",a,method="POST",body={},key=key,permissions=("risk:run",))
    assert code==202
    # A reporting-only token must not submit or inspect risk jobs.
    assert web.request(BASE+"/risk-runs",a,method="POST",body={},key=str(uuid4()))[0]==403
    assert web.request(BASE+"/risk-runs/latest",a)[0]==403
    code,status,_=web.request(BASE+"/risk-runs/"+created["jobId"],a,permissions=("risk:read",))
    assert code==200 and status["status"]=="QUEUED"
    assert web.request(BASE+"/risk-runs/"+created["jobId"],b,permissions=("risk:read",))[0]==404
    replay=web.request(BASE+"/risk-runs",a,method="POST",body={},key=key,permissions=("risk:run",))
    assert replay[0]==202 and replay[1]["jobId"]==created["jobId"]
    assert web.request(BASE+"/risk-runs",a,method="POST",body={},key=str(uuid4()),permissions=("risk:run",))[0]==409
    active=case.worker.claim(a)
    def check_staging(*_):
        current=groups(web,"riskRating",a)
        assert current["riskRunId"]==before["riskRunId"] and current["groups"]==before["groups"]
    assert process_run(case.worker,active,after_batch=check_staging)=="SUCCEEDED"
    success=groups(web,"riskRating",a)
    assert success["riskRunId"].lower()==active.run and all(g["key"] is not None for g in success["groups"])
    latest=web.request(BASE+"/risk-runs/latest",a,permissions=("risk:read",))
    assert latest[0]==200 and latest[1]["jobStatus"]=="SUCCEEDED"
    failed=claim(web,a)
    def fail(*_):
        assert groups(web,"riskRating",a)["groups"]==success["groups"]
        raise ScoringError("INVALID_SCORING_INPUT")
    assert process_run(case.worker,failed,after_batch=fail)=="FAILED"
    retained=groups(web,"riskRating",a)
    assert retained["riskRunId"]==success["riskRunId"] and retained["groups"]==success["groups"]
    assert web.request(BASE+"/risk-runs/latest",a,permissions=("risk:read",))[1]["jobStatus"]=="FAILED"
    assert groups(web,"riskRating",b)["riskRunId"] is None


def test_reporting_account_cannot_write_or_read_unpublished_stage(web):
    env=web.environment
    settings=Settings(env.get("RISK_TEST_HOST","127.0.0.1,1433"),web.case.settings.database,env["PORTFOLIO_DB_USER"],env["PORTFOLIO_DB_PASSWORD"],trust_certificate=True)
    connection=pyodbc.connect(settings.connection_string(),autocommit=True)
    try:
        for sql in ("UPDATE analytics.LoanPortfolio SET CurrentBalance=0 WHERE TenantId=?",
            "SELECT * FROM analytics.RiskScoreStage WHERE TenantId=?",
            "EXEC analytics.PublishRiskRun @TenantId=?,@RunId=NULL,@SourceSnapshotVersion=0"):
            with pytest.raises(pyodbc.Error):connection.execute(sql,web.case.tenants[0])
    finally:connection.close()
