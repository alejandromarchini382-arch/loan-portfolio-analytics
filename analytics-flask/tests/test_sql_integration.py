from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pyodbc
import pytest

from risk.app import create_app
from risk.errors import LostClaim,RiskError
from risk.scoring import ScoringError,score_loan,SQL_RATINGS
from risk.worker import process_run


def published(case,tenant):
    return {str(row[0]).lower():row[1] for row in case.admin.execute(
        "SELECT LoanId,LoanRiskRating FROM analytics.PublishedLoanPortfolio WHERE TenantId=?",tenant).fetchall()}


def new_claim(case,tenant=None):
    tenant=tenant or case.tenants[0]
    job=case.api.submit(tenant,str(uuid4()))
    claim=case.worker.claim(tenant,str(job["RunId"]).lower())
    assert claim is not None
    return claim


def test_concurrent_claim_and_idempotent_submission(sql_case):
    case=sql_case;tenant=case.tenants[0]
    barrier=Barrier(2)
    def submit(_):
        barrier.wait()
        return case.api.submit(tenant,"one-logical-request")
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs=list(pool.map(submit,range(2)))
    assert jobs[0]["RunId"]==jobs[1]["RunId"]
    with pytest.raises(RiskError) as error: case.api.submit(tenant,"different-request")
    assert error.value.status==409
    barrier=Barrier(2)
    def claim(_):
        barrier.wait()
        return case.worker.claim(tenant)
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims=list(pool.map(claim,range(2)))
    assert len([c for c in claims if c])==1
    assert case.admin.execute("SELECT COUNT(*) FROM analytics.RiskJob WHERE TenantId=?",tenant).fetchone()[0]==1


def test_expired_worker_cannot_stage_update_or_publish_after_reclaim(sql_case):
    case=sql_case;tenant=case.tenants[0]
    old=new_claim(case)
    loans,watermark=case.worker.snapshot(old)
    case.worker.initialize(old,len(loans))
    first=[(loans[0],score_loan(loans[0].values))]
    assert case.worker.stage(old,first)==1
    assert all(v is None for v in published(case,tenant).values())
    case.admin.execute("UPDATE analytics.RiskJob SET LeaseUntilUtc='20200101' WHERE TenantId=? AND RunId=?",tenant,old.run).close()
    fresh=case.worker.claim(tenant,old.run)
    assert fresh.attempt==old.attempt+1
    for action in (lambda:case.worker.stage(old,first),lambda:case.worker.heartbeat(old),
        lambda:case.worker.initialize(old,1),lambda:case.worker.publish(old,watermark),lambda:case.worker.fail(old,"WORKER_ERROR")):
        with pytest.raises(LostClaim): action()
    assert case.admin.execute("SELECT COUNT(*) FROM analytics.RiskScoreStage WHERE TenantId=? AND RunId=?",tenant,old.run).fetchone()[0]==0
    assert process_run(case.worker,fresh)=="SUCCEEDED"
    case.worker.publish(fresh,watermark) # publication outcome reconciliation is idempotent
    assert case.worker.claim(tenant,fresh.run) is None


def test_failed_scoring_and_incomplete_publication_preserve_previous_ratings(sql_case):
    case=sql_case;tenant=case.tenants[0]
    assert process_run(case.worker,new_claim(case))=="SUCCEEDED"
    original=published(case,tenant)
    claim=new_claim(case)
    def fail_after_batch(batch,processed):
        assert published(case,tenant)==original
        raise ScoringError("INVALID_SCORING_INPUT")
    assert process_run(case.worker,claim,after_batch=fail_after_batch)=="FAILED"
    assert case.api.get(tenant,claim.run)["ErrorCode"]=="INVALID_SCORING_INPUT"
    assert published(case,tenant)==original
    incomplete=new_claim(case)
    loans,watermark=case.worker.snapshot(incomplete)
    case.worker.initialize(incomplete,len(loans))
    first=[(loans[0],score_loan(loans[0].values))]
    assert case.worker.stage(incomplete,first)==1
    assert case.worker.stage(incomplete,first)==1 # unknown commit/repeated batch does not double-count
    with pytest.raises(RiskError,match="SOURCE_SNAPSHOT_CHANGED"):
        case.worker.publish(incomplete,watermark)
    case.worker.fail(incomplete,"SOURCE_SNAPSHOT_CHANGED")
    assert published(case,tenant)==original


@pytest.mark.parametrize("watermark_unchanged",[False,True])
def test_source_version_change_detected_before_publication(sql_case,watermark_unchanged):
    case=sql_case;tenant=case.tenants[0]
    if watermark_unchanged:
        case.admin.execute("""UPDATE analytics.LoanPortfolio SET SourceVersion=10 WHERE TenantId=? AND LoanId=
            (SELECT TOP(1) LoanId FROM analytics.LoanPortfolio WHERE TenantId=? AND Status='ACTIVE' ORDER BY LoanId DESC)""",tenant,tenant).close()
    assert process_run(case.worker,new_claim(case))=="SUCCEEDED"
    original=published(case,tenant)
    claim=new_claim(case)
    def mutate_source():
        case.admin.execute("""UPDATE analytics.LoanPortfolio SET SourceVersion=SourceVersion+1
            WHERE TenantId=? AND LoanId=(SELECT TOP(1) LoanId FROM analytics.LoanPortfolio WHERE TenantId=? AND Status='ACTIVE' ORDER BY LoanId)""",tenant,tenant).close()
    assert process_run(case.worker,claim,before_publish=mutate_source)=="FAILED"
    assert case.api.get(tenant,claim.run)["ErrorCode"]=="SOURCE_SNAPSHOT_CHANGED"
    assert published(case,tenant)==original


def test_api_tenant_isolation_and_minimum_permissions(sql_case):
    case=sql_case;a,b=case.tenants
    client=create_app(case.api_settings,case.api,case.auth).test_client()
    def headers(tenant): return {"Authorization":"Bearer "+case.auth.token(tenant),"Idempotency-Key":"api-request"}
    response=client.post("/risk/runs",json={},headers=headers(a))
    assert response.status_code==202
    run=response.json["runId"]
    assert client.post("/risk/runs",json={},headers=headers(a)).json["runId"]==run
    assert client.get("/risk/runs/"+run,headers=headers(b)).status_code==404
    assert client.get("/risk/runs/"+run,headers=headers(a)).status_code==200
    assert client.post("/risk/runs",json={"tenantId":a},headers=headers(b)).status_code==400
    for settings,sql in ((case.api_settings,"SELECT * FROM analytics.LoanPortfolio WHERE TenantId=?"),
        (case.api_settings,"UPDATE analytics.RiskJob SET Attempts=99 WHERE TenantId=?"),
        (case.settings,"UPDATE analytics.RiskPublication SET LoanCount=0 WHERE TenantId=?")):
        connection=pyodbc.connect(settings.connection_string(),autocommit=True)
        try:
            with pytest.raises(pyodbc.Error): connection.execute(sql,a)
        finally: connection.close()


@pytest.mark.parametrize("sql_case",[1500,15000],indirect=True)
def test_full_seeded_dataset_atomic_batches(sql_case):
    case=sql_case
    for tenant in case.tenants:
        initial=published(case,tenant)
        assert len(initial)==case.count//2 and all(v is None for v in initial.values())
        claim=new_claim(case,tenant)
        loans,_=case.worker.snapshot(claim)
        expected={loan.loan_id:SQL_RATINGS[score_loan(loan.values)] for loan in loans}
        def staged(batch,processed):
            assert 0<processed<=len(loans)
            assert published(case,tenant)==initial
        assert process_run(case.worker,claim,after_batch=staged)=="SUCCEEDED"
        actual=published(case,tenant)
        assert {k:v for k,v in actual.items() if v is not None}==expected
        assert all(actual[k] is None for k in initial.keys()-expected.keys())
        row=case.api.get(tenant,claim.run)
        assert row["Status"]=="SUCCEEDED" and row["ProcessedLoans"]==row["TotalLoans"]==len(loans)


def test_empty_population_and_attempt_exhaustion(sql_case):
    case=sql_case;tenant=case.tenants[0]
    case.admin.execute("UPDATE analytics.LoanPortfolio SET Status='CLOSED',SourceVersion=SourceVersion+1 WHERE TenantId=?",tenant).close()
    empty=new_claim(case)
    assert process_run(case.worker,empty)=="SUCCEEDED"
    assert case.api.get(tenant,empty.run)["TotalLoans"]==0
    exhausted=new_claim(case)
    case.admin.execute("UPDATE analytics.RiskJob SET Attempts=?,LeaseUntilUtc='20200101' WHERE TenantId=? AND RunId=?",
        case.settings.max_attempts,tenant,exhausted.run).close()
    assert case.worker.claim(tenant,exhausted.run) is None
    assert case.api.get(tenant,exhausted.run)["ErrorCode"]=="ATTEMPTS_EXHAUSTED"


def test_failed_array_insert_rolls_back_entire_batch(sql_case,monkeypatch):
    from dataclasses import replace
    case=sql_case;tenant=case.tenants[0]
    assert process_run(case.worker,new_claim(case))=="SUCCEEDED"
    original=published(case,tenant)
    claim=new_claim(case)
    loans,watermark=case.worker.snapshot(claim)
    loans[1]=replace(loans[1],loan_id=str(uuid4())) # Deliberately violates tenant-qualified projection FK.
    monkeypatch.setattr(case.worker,"snapshot",lambda _: (loans,watermark))
    assert process_run(case.worker,claim)=="FAILED"
    assert case.api.get(tenant,claim.run)["ErrorCode"]=="DATABASE_OPERATION_FAILED"
    assert case.admin.execute("SELECT COUNT(*) FROM analytics.RiskScoreStage WHERE TenantId=? AND RunId=?",tenant,claim.run).fetchone()[0]==0
    assert published(case,tenant)==original


def test_lost_publication_acknowledgement_reconciles_committed_success(sql_case):
    case=sql_case;tenant=case.tenants[0]
    claim=new_claim(case)
    loans,watermark=case.worker.snapshot(claim)
    case.worker.initialize(claim,len(loans))
    case.worker.stage(claim,[(loan,score_loan(loan.values)) for loan in loans])
    original_connect=case.worker.db.connect
    dropped=[False]
    class LoseAcknowledgement:
        def __init__(self,connection): self.connection=connection
        def __getattr__(self,name): return getattr(self.connection,name)
        def execute(self,sql,*args):
            cursor=self.connection.execute(sql,*args)
            if sql.startswith("EXEC analytics.PublishRiskRun") and not dropped[0]:
                cursor.close() # Complete/commit the real SQL procedure before losing its response.
                dropped[0]=True
                raise pyodbc.OperationalError("08S01","simulated response loss")
            return cursor
    case.worker.db.connect=lambda: LoseAcknowledgement(original_connect())
    case.worker.publish(claim,watermark)
    assert dropped[0]
    assert case.api.get(tenant,claim.run)["Status"]=="SUCCEEDED"
    assert any(v is not None for v in published(case,tenant).values())


def test_last_six_payment_ordering_and_tenant_counts(sql_case):
    from datetime import date,datetime
    from uuid import UUID
    case=sql_case;a,b=case.tenants
    loan=case.admin.execute("SELECT TOP(1) LoanId FROM analytics.LoanPortfolio WHERE TenantId=? ORDER BY LoanId",a).fetchone()[0]
    for tenant in (a,b):
        case.admin.execute("""UPDATE analytics.LoanPortfolio SET Status='ACTIVE',DaysPastDue=0,
            PrincipalAmount=1000,CurrentBalance=500,SourceVersion=SourceVersion+1 WHERE TenantId=? AND LoanId=?""",tenant,loan).close()
        for i in range(1,8):
            late=(i in (1,7)) if tenant==a else True
            case.admin.execute("INSERT analytics.PaymentHistory VALUES (?,?,?,?,?,?,?)",tenant,str(UUID(int=i)),loan,
                date(2026,10,30),100,late,datetime(2026,10,30,12)).close()
    for tenant,late in ((a,1),(b,6)):
        claim=new_claim(case,tenant)
        inputs,_=case.worker.snapshot(claim)
        selected=next(item for item in inputs if item.loan_id==str(loan).lower())
        assert selected.values.PaymentRowsInspected==6 and selected.values.LatePaymentsLastSix==late
        assert score_loan(selected.values)==("Low" if tenant==a else "Medium")
