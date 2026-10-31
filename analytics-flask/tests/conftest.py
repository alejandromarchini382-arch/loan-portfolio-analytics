import os
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"sql"))
sys.path.insert(0,str(ROOT/"sql"/"tests"))
sys.path.insert(0,str(ROOT/"analytics-flask"))


@pytest.fixture
def sql_case(request):
    if os.getenv("RISK_INTEGRATION")!="1":
        pytest.skip("RISK_INTEGRATION=1 and local SQL admin/service credentials required")
    import pyodbc
    from scripts.provision import provision,read_env
    from risk.config import Settings
    from risk.auth import Auth
    from risk.db import Database
    from risk.jobs import Repository
    from seed.generate import generate
    from seed.seed import insert_dataset
    from test_database import execute_script
    env={**read_env(ROOT/".env"),**os.environ}
    database="loan_sql_test_"+uuid4().hex
    admin_settings=Settings(env.get("RISK_TEST_HOST","127.0.0.1,1433"),"master","sa",
        env.get("RISK_TEST_ADMIN_PASSWORD",env.get("MSSQL_SA_PASSWORD","")),trust_certificate=True)
    master=pyodbc.connect(admin_settings.connection_string(),autocommit=True,timeout=5)
    admin=None
    created=False
    try:
        master.execute(f"CREATE DATABASE [{database}]").close()
        created=True
        admin=pyodbc.connect(replace(admin_settings,database=database).connection_string(),autocommit=True,timeout=5)
        execute_script(admin,ROOT/"sql"/"001_schema.sql")
        execute_script(admin,ROOT/"sql"/"002_indexes.sql")
        provision(admin,env["RISK_API_DB_USER"],env["RISK_API_DB_PASSWORD"],env["RISK_WORKER_DB_USER"],env["RISK_WORKER_DB_PASSWORD"])
        count=getattr(request,"param",24)
        data=generate(count,42)
        admin.autocommit=False
        insert_dataset(admin,data,500,pyodbc)
        admin.autocommit=True
        tenants=tuple(t["TenantId"] for t in data["Tenants"])
        worker=Settings(admin_settings.host,database,env["RISK_WORKER_DB_USER"],env["RISK_WORKER_DB_PASSWORD"],tenants,
            trust_certificate=True,batch_size=1000 if count>=1500 else 2,cooldown_seconds=0)
        api=replace(worker,user=env["RISK_API_DB_USER"],password=env["RISK_API_DB_PASSWORD"])
        yield SimpleNamespace(admin=admin,worker=Repository(Database(worker)),api=Repository(Database(api)),
            settings=worker,api_settings=api,tenants=tenants,count=count,
            auth=Auth(env["RISK_JWT_SECRET"],"test-issuer","test-audience",tenants))
    finally:
        if admin: admin.close()
        if created:
            master.execute(f"ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE").close()
            master.execute(f"DROP DATABASE [{database}]").close()
        master.close()
