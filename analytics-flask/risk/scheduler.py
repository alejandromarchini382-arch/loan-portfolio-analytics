"""Standalone scheduler: --once for cron, or an independent configurable interval loop."""
import argparse
import signal
import threading
import time
from .config import Settings
from .db import Database
from .jobs import Repository
from .errors import RiskError
from .logging import configure,event


def submit_scheduled(repo, now=None):
    bucket=int(time.time() if now is None else now)//repo.settings.schedule_interval
    results=[]
    for tenant in repo.settings.tenants:
        try:
            row=repo.submit(tenant,f"nightly:{repo.settings.schedule_interval}:{bucket}")
            results.append(row)
            event("scheduled_run",tenantId=tenant,runId=str(row["RunId"]).lower(),status=row["Status"])
        except RiskError as exc:
            event("schedule_deferred",tenantId=tenant,errorCode=exc.code)
            if exc.status not in (409,429): raise
    return results


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once",action="store_true")
    args=parser.parse_args(argv)
    configure()
    settings=Settings.from_env()
    repo=Repository(Database(settings))
    stop=threading.Event()
    for sig in (signal.SIGTERM,signal.SIGINT): signal.signal(sig,lambda *_:stop.set())
    result=0
    while not stop.is_set():
        try:
            submit_scheduled(repo)
            result=0
        except RiskError as exc:
            event("scheduler_failed",errorCode=exc.code)
            result=1
        if args.once: break
        stop.wait(settings.schedule_interval)
    return result


if __name__ == "__main__": raise SystemExit(main())
