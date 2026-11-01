"""Repeatable Phase 3 demonstration on the existing 1500 fictional loans; never resets ratings.
Stops the continuous worker temporarily so this separate worker process can observe each batch.
Advances one source version (no financial edits) to prove failed publication safety.
"""
from collections import Counter
from dataclasses import replace
from decimal import Decimal
import json,os,sys,time,subprocess,urllib.request,urllib.error,urllib.parse
from pathlib import Path
from uuid import uuid4
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'analytics-flask'))
import pyodbc
from scripts.provision import read_env
from risk.auth import Auth
from risk.config import Settings
from risk.db import Database
from risk.jobs import Repository
from risk.worker import process_run


def main():
    env={**read_env(ROOT/'.env'),**os.environ};tenants=tuple(env['RISK_TENANTS'].split(','));auth=Auth.from_env(tenants,env)
    base='http://127.0.0.1:'+env.get('PORTFOLIO_PORT','8081')+'/api/v1/portfolio'
    settings=Settings(env.get('RISK_TEST_HOST','127.0.0.1,1433'),env.get('PORTFOLIO_DATABASE','LoanPortfolio'),env['RISK_WORKER_DB_USER'],env['RISK_WORKER_DB_PASSWORD'],tenants,trust_certificate=True,batch_size=100,cooldown_seconds=0)
    worker=Repository(Database(settings))
    admin=pyodbc.connect(replace(settings,user='sa',password=env['MSSQL_SA_PASSWORD']).connection_string(),autocommit=True)
    def http(path,tenant,params=None,method='GET',key=None,permissions=('portfolio:read',)):
        headers={'Authorization':'Bearer '+auth.token(tenant,permissions)};body=None
        if method=='POST':body=b'{}';headers['Content-Type']='application/json';headers['Idempotency-Key']=key
        url=base+path+('?' + urllib.parse.urlencode(params) if params else '')
        started=time.perf_counter()
        try:r=urllib.request.urlopen(urllib.request.Request(url,data=body,headers=headers,method=method),timeout=15)
        except urllib.error.HTTPError as ex:r=ex
        with r:return r.status,json.load(r),round((time.perf_counter()-started)*1000,2)
    def groups(tenant,dimension='riskRating',**extra):
        code,row,_=http('/groups',tenant,dict(groupBy=dimension,**extra));assert code==200,row.get('error');return row
    def submit(tenant,key):
        for _ in range(15):
            code,row,ms=http('/risk-runs',tenant,method='POST',key=key,permissions=('risk:run',))
            if code==429:time.sleep(1);continue
            assert code==202,row.get('error');return row,ms
        raise RuntimeError('Submission cooldown did not clear')
    def docker(action):
        r=subprocess.run(['docker','compose','--profile','risk',action,'risk-worker'],cwd=ROOT,capture_output=True)
        if r.returncode:raise RuntimeError('Worker lifecycle command failed')
    report={'dataset':'existing persistent 1500-loan fixture; prior publications preserved','tenants':[]}
    stopped=False
    try:
        count=admin.execute('SELECT COUNT(*) FROM analytics.PublishedLoanPortfolio').fetchone()[0]
        assert count==1500
        docker('stop');stopped=True
        for tenant in tenants:
            item={'tenantId':tenant,'aggregations':{}}
            for dimension,column in {'division':'Division','loanOfficer':'LoanOfficer','borrowerType':'BorrowerType','riskRating':'LoanRiskRating'}.items():
                body=groups(tenant,dimension)
                sql=admin.execute(f"SELECT {column},COUNT_BIG(*),SUM(CurrentBalance),AVG(CAST(InterestRate AS decimal(18,8))) FROM analytics.PublishedLoanPortfolio WHERE TenantId=? AND Status='ACTIVE' GROUP BY {column}",tenant).fetchall()
                expected={r[0]:r for r in sql}
                for group in body['groups']:
                    row=expected[group['key']];assert group['loanCount']==row[1] and Decimal(group['totalBalance'])==row[2]
                    assert (Decimal(group['averageInterestRate']) if group['averageInterestRate'] is not None else None)==row[3]
                assert len(expected)==len(body['groups'])
                item['aggregations'][dimension]={'matchesSql':True,'groups':body['groups']}
            root=groups(tenant,'division',subgroupBy='loanOfficer');parent=max(root['groups'],key=lambda g:g['loanCount'])
            path={'groupBy':'division','subgroupBy':'loanOfficer'}
            path.update({'parentKeyIsNull':'true'} if parent['key'] is None else {'parentKey':parent['key']})
            code,children,_=http('/groups/children',tenant,path);assert code==200 and sum(g['loanCount'] for g in children['groups'])==parent['loanCount']
            path={'groupBy':'division','limit':'7'};path.update({'groupKeyIsNull':'true'} if parent['key'] is None else {'groupKey':parent['key']})
            ids=[];pages=0
            while True:
                code,page,_=http('/loans',tenant,path);assert code==200
                ids.extend(l['loanId'] for l in page['loans']);pages+=1
                if page['nextCursor'] is None:break
                path['cursor']=page['nextCursor']
            assert len(ids)==len(set(ids))==parent['loanCount']
            item['pagination']={'pages':pages,'uniqueLoans':len(ids),'nestedChildrenReconciled':True}
            before=groups(tenant);key='spring-demo:'+str(uuid4());created,ms=submit(tenant,key)
            assert created['status']=='QUEUED';claim=worker.claim(tenant);assert claim
            observations=[]
            def staged(*_):
                current=groups(tenant);assert current['riskRunId']==before['riskRunId'] and current['groups']==before['groups']
                code,status,_=http('/risk-runs/'+created['jobId'],tenant,permissions=('risk:read',));assert code==200 and status['status']=='RUNNING'
                observations.append(status['processedLoans'])
            assert process_run(worker,claim,after_batch=staged)=='SUCCEEDED'
            after=groups(tenant);assert after['riskRunId'].lower()==claim.run
            item['successfulRun']={'jobId':created['jobId'],'runId':claim.run,'httpStatus':202,'submissionMs':ms,'runningObserved':True,'stagedBatchProgress':observations,'oldPublicationRetainedBeforePublish':True,'publicationChanged':after['riskRunId']!=before['riskRunId']}
            item['activeLoans']=sum(g['loanCount'] for g in after['groups'])
            report['tenants'].append(item)
        tenant=tenants[0];before=groups(tenant);key='spring-failure:'+str(uuid4());created,_=submit(tenant,key);claim=worker.claim(tenant);mutated=[]
        def change_source(*_):
            if mutated:return
            assert groups(tenant)['riskRunId']==before['riskRunId']
            target=admin.execute("SELECT TOP(1) LoanId FROM analytics.LoanPortfolio WHERE TenantId=? AND Status='ACTIVE' ORDER BY LoanId",tenant).fetchone()[0]
            admin.autocommit=False
            try:
                admin.execute('UPDATE analytics.Loans SET SourceVersion=SourceVersion+1,UpdatedAtUtc=SYSUTCDATETIME() WHERE TenantId=? AND LoanId=?',tenant,target).close()
                admin.execute('UPDATE analytics.LoanPortfolio SET SourceVersion=SourceVersion+1,LastSyncedUtc=SYSUTCDATETIME() WHERE TenantId=? AND LoanId=?',tenant,target).close();admin.commit()
            except Exception:admin.rollback();raise
            finally:admin.autocommit=True
            mutated.append(True)
        assert process_run(worker,claim,after_batch=change_source)=='FAILED'
        retained=groups(tenant);assert retained['riskRunId']==before['riskRunId'] and retained['groups']==before['groups']
        error=admin.execute('SELECT ErrorCode FROM analytics.RiskJob WHERE TenantId=? AND JobId=?',tenant,created['jobId']).fetchone()[0]
        assert error=='SOURCE_SNAPSHOT_CHANGED'
        replay,_=submit(tenant,key);assert replay['jobId']==created['jobId']
        cross=http('/risk-runs/'+created['jobId'],tenants[1],permissions=('risk:read',))[0];assert cross==404
        forbidden=http('/risk-runs',tenant,method='POST',key=str(uuid4()))[0];assert forbidden==403
        report['failure']={'status':'FAILED','errorCode':error,'previousPublicationPreserved':True,'sameKeySameJob':True,'crossTenantStatus':cross,'reportingOnlySubmissionStatus':forbidden}
        report['inactiveUnrated']=admin.execute("SELECT COUNT(*) FROM analytics.PublishedLoanPortfolio WHERE Status<>'ACTIVE' AND LoanRiskRating IS NULL").fetchone()[0]
        report['success']=True
        (ROOT/'spring-boot/demo-results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'success':True,'activeLoans':[r['activeLoans'] for r in report['tenants']],'inactiveUnrated':report['inactiveUnrated'],'failure':report['failure']},indent=2))
    finally:
        admin.close()
        if stopped:docker('start')

if __name__=='__main__':main()
