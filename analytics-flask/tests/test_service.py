import json
import logging
from dataclasses import replace
from datetime import datetime,timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import jwt
import pyodbc
import pytest

from risk.app import create_app
from risk.auth import Auth
from risk.config import Settings
from risk.db import Database
from risk.errors import LostClaim,RiskError
from risk.jobs import Claim,SnapshotLoan,validate_key
from risk.logging import JsonFormatter
from risk.scheduler import submit_scheduled
from risk.scoring import LoanInput,ScoringError
from risk.worker import process_run
from decimal import Decimal

TENANT=str(uuid4()); OTHER=str(uuid4()); RUN=str(uuid4())


@pytest.fixture
def settings(): return Settings("host","database","risk_worker","test-placeholder",(TENANT,OTHER),batch_size=2,sql_tries=3)


@pytest.fixture
def auth(): return Auth("a"*48,"test-issuer","test-audience",(TENANT,OTHER))


@pytest.fixture
def repository(settings):
    repo=Mock()
    repo.settings=settings
    repo.submit.return_value={"RunId":RUN,"Status":"QUEUED"}
    repo.get.return_value={"RunId":RUN,"JobId":str(uuid4()),"Status":"RUNNING","ProcessedLoans":2,"TotalLoans":3,
        "StartedAtUtc":datetime(2026,1,1),"CompletedAtUtc":None,"ErrorCode":None}
    return repo


def headers(auth,tenant=TENANT,permissions=("risk:run","risk:read")):
    return {"Authorization":"Bearer "+auth.token(tenant,permissions),"Idempotency-Key":"test-request"}


def test_api_submission_status_health(settings,auth,repository):
    client=create_app(settings,repository,auth).test_client()
    response=client.post("/risk/runs",json={},headers=headers(auth))
    assert response.status_code==202 and response.json["runId"]==RUN
    repository.submit.assert_called_once_with(TENANT,"test-request")
    response=client.get("/risk/runs/"+RUN,headers=headers(auth))
    assert response.status_code==200 and response.json["processedLoans"]==2 and response.json["completedAtUtc"] is None
    assert response.json["startedAtUtc"].endswith("Z")
    assert client.get("/health").json=={"status":"ok"}


@pytest.mark.parametrize("body",[{"tenantId":TENANT},[],None,{"extra":1}])
def test_api_invalid_body(settings,auth,repository,body):
    client=create_app(settings,repository,auth).test_client()
    assert client.post("/risk/runs",json=body,headers=headers(auth)).status_code==400
    repository.submit.assert_not_called()


@pytest.mark.parametrize("case",["missing","expired","wrong-signature","issuer","audience","algorithm","tenant","permissions","claims"])
def test_invalid_auth(settings,auth,repository,case):
    now=int(datetime.now(timezone.utc).timestamp())
    claims={"sub":"tester","tenantId":TENANT,"permissions":["risk:read"],"iss":auth.issuer,"aud":auth.audience,"iat":now,"exp":now+60}
    secret=auth.secret;algorithm="HS256"
    if case=="expired": claims["exp"]=now-1
    if case=="wrong-signature": secret="b"*48
    if case=="issuer": claims["iss"]="other"
    if case=="audience": claims["aud"]="other"
    if case=="algorithm": algorithm="HS384"
    if case=="tenant": claims["tenantId"]="invalid"
    if case=="permissions": claims["permissions"]="risk:read"
    if case=="claims": del claims["exp"]
    header={} if case=="missing" else {"Authorization":"Bearer "+jwt.encode(claims,secret,algorithm=algorithm)}
    assert create_app(settings,repository,auth).test_client().get("/risk/runs/"+RUN,headers=header).status_code==401
    repository.get.assert_not_called()


def test_api_forbidden_cross_tenant_conflict_and_errors(settings,auth,repository):
    client=create_app(settings,repository,auth).test_client()
    assert client.post("/risk/runs",json={},headers=headers(auth,permissions=("risk:read",))).status_code==403
    repository.get.return_value=None
    assert client.get("/risk/runs/"+RUN,headers=headers(auth,OTHER)).status_code==404
    repository.get.assert_called_with(OTHER,RUN)
    repository.submit.side_effect=RiskError("ACTIVE_RUN_EXISTS",409)
    assert client.post("/risk/runs",json={},headers=headers(auth)).status_code==409
    repository.submit.side_effect=RiskError("DATABASE_UNAVAILABLE")
    assert client.post("/risk/runs",json={},headers=headers(auth)).status_code==503
    assert client.get("/risk/runs/not-a-uuid",headers=headers(auth)).status_code==400


@pytest.mark.parametrize("key",[None,""," a","a ","x"*121,"bad\nkey","unicode-\u2603"])
def test_idempotency_key_validation(key):
    with pytest.raises(RiskError): validate_key(key)


def test_config_fail_closed(settings):
    with pytest.raises(ValueError): Settings.from_env({})
    env={"SQLSERVER_HOST":"host","SQLSERVER_DATABASE":"database","SQLSERVER_USER":"sa","SQLSERVER_PASSWORD":"test",
        "RISK_TENANTS":TENANT}
    with pytest.raises(ValueError,match="SA"): Settings.from_env(env)
    env["SQLSERVER_USER"]="service"
    assert Settings.from_env(env).batch_size==1000
    env["RISK_BATCH_SIZE"]="0"
    with pytest.raises(ValueError): Settings.from_env(env)
    with pytest.raises(ValueError): Auth.from_env((TENANT,),{})
    with pytest.raises(RiskError): Database(settings).tenant(str(uuid4()))
    assert "test-placeholder" not in repr(settings)


@pytest.mark.parametrize("count",[0,1,5,15000])
def test_worker_batches(repository,count):
    loan=SnapshotLoan(str(uuid4()),1,LoanInput(Decimal("1000"),Decimal("500"),0,0,0))
    repository.snapshot.return_value=([loan]*count,1 if count else 0)
    repository.stage.side_effect=lambda batch_claim,scored: min(repository.stage.call_count*2,count)
    claim=Claim(TENANT,RUN,1)
    assert process_run(repository,claim)=="SUCCEEDED"
    assert repository.stage.call_count==(count+1)//2
    repository.initialize.assert_called_once_with(claim,count)
    repository.publish.assert_called_once_with(claim,1 if count else 0)


@pytest.mark.parametrize("failure",[ScoringError("INVALID_SCORING_INPUT"),RiskError("DATABASE_UNAVAILABLE"),LostClaim()])
def test_worker_failure_preserves_publication(repository,failure):
    repository.snapshot.side_effect=failure
    result=process_run(repository,Claim(TENANT,RUN,1))
    assert result==("LOST" if isinstance(failure,LostClaim) else "FAILED")
    repository.publish.assert_not_called()
    if isinstance(failure,LostClaim): repository.fail.assert_not_called()
    else: repository.fail.assert_called_once()


def test_sql_retry_is_bounded_and_reconnects(settings):
    factory=Mock(side_effect=pyodbc.OperationalError("08S01","connection lost"))
    db=Database(settings,connect=factory,sleep=lambda _:None)
    with pytest.raises(RiskError,match="DATABASE_UNAVAILABLE"): db.run(TENANT,lambda _:None)
    assert factory.call_count==settings.sql_tries
    factory=Mock(side_effect=pyodbc.IntegrityError("23000","invalid data"))
    with pytest.raises(RiskError): Database(settings,connect=factory).run(TENANT,lambda _:None)
    assert factory.call_count==1


def test_scheduler_reuses_bucket_and_logs_are_allowlisted(repository):
    submit_scheduled(repository,now=1234)
    submit_scheduled(repository,now=1235)
    keys=[call.args[1] for call in repository.submit.call_args_list]
    assert len(set(keys))==1
    record=logging.LogRecord("risk",logging.INFO,"",0,"",(),None)
    record.fields={"runId":RUN,"processedLoans":2,"password":"hidden","borrowerName":"hidden"}
    encoded=JsonFormatter().format(record)
    assert "hidden" not in encoded and json.loads(encoded)["runId"]==RUN


def test_worker_stop_is_recorded_without_publication(repository):
    import threading
    stop=threading.Event()
    loan=SnapshotLoan(str(uuid4()),1,LoanInput(Decimal("1000"),Decimal("500"),0,0,0))
    repository.snapshot.return_value=([loan]*5,1)
    repository.stage.return_value=2
    claim=Claim(TENANT,RUN,1)
    assert process_run(repository,claim,stop,after_batch=lambda *_:stop.set())=="FAILED"
    repository.fail.assert_called_once_with(claim,"WORKER_STOPPED")
    repository.publish.assert_not_called()
