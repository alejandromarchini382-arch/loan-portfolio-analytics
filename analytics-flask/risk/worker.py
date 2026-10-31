"""Separate lease-based worker. python -m risk.worker [--once]."""
import argparse
import os
from pathlib import Path
import signal
import tempfile
import threading
import time

from .config import Settings, uuid_text
from .db import Database
from .errors import LostClaim, RiskError
from .jobs import Repository
from .logging import configure, event
from .scoring import ScoringError, score_loan


def process_run(repo, claim, stop=None, after_batch=None, before_publish=None, pulse=lambda: None):
    started = time.monotonic()
    processed = 0
    batch_number = 0
    stop = stop or threading.Event()
    try:
        repo.heartbeat(claim)
        pulse()
        loans, watermark = repo.snapshot(claim)
        repo.initialize(claim, len(loans))
        event("run_started", tenantId=claim.tenant, runId=claim.run, status="RUNNING", processedLoans=0)
        heartbeat_at = time.monotonic()
        for offset in range(0, len(loans), repo.settings.batch_size):
            if stop.is_set():
                raise RiskError("WORKER_STOPPED")
            batch_number += 1
            scored = []
            for loan in loans[offset:offset + repo.settings.batch_size]:
                if stop.is_set():
                    raise RiskError("WORKER_STOPPED")
                if time.monotonic() - heartbeat_at >= repo.settings.lease_seconds / 3:
                    repo.heartbeat(claim)
                    pulse()
                    heartbeat_at = time.monotonic()
                scored.append((loan, score_loan(loan.values)))
            processed = repo.stage(claim, scored)
            pulse()
            event("batch_staged", tenantId=claim.tenant, runId=claim.run, status="RUNNING",
                batch=batch_number, processedLoans=processed, durationMs=int((time.monotonic()-started)*1000))
            if after_batch:
                after_batch(batch_number, processed)
        if stop.is_set():
            raise RiskError("WORKER_STOPPED")
        repo.heartbeat(claim)
        if before_publish:
            before_publish()
        repo.publish(claim, watermark)
        event("run_completed", tenantId=claim.tenant, runId=claim.run, status="SUCCEEDED", batch=batch_number,
            processedLoans=processed, durationMs=int((time.monotonic()-started)*1000))
        return "SUCCEEDED"
    except LostClaim:
        event("claim_lost", tenantId=claim.tenant, runId=claim.run, status="LOST", errorCode="CLAIM_LOST")
        return "LOST"
    except Exception as exc:
        code = "INVALID_SCORING_INPUT" if isinstance(exc, ScoringError) else (exc.code if isinstance(exc,RiskError) else "WORKER_ERROR")
        # fail() checks ownership and refuses to overwrite an already-committed successful publication.
        try:
            repo.fail(claim, code)
        except LostClaim:
            try:
                current=repo.get(claim.tenant,claim.run)
                if current and current["Status"]=="SUCCEEDED":
                    event("publication_reconciled",tenantId=claim.tenant,runId=claim.run,status="SUCCEEDED")
                    return "SUCCEEDED"
            except RiskError:
                event("recovery_required",tenantId=claim.tenant,runId=claim.run,status="RECOVERY_REQUIRED",errorCode=code)
                return "RECOVERY_REQUIRED"
            event("claim_lost",tenantId=claim.tenant,runId=claim.run,status="LOST",errorCode="CLAIM_LOST")
            return "LOST"
        except RiskError:
            event("recovery_required",tenantId=claim.tenant,runId=claim.run,status="RECOVERY_REQUIRED",errorCode=code)
            return "RECOVERY_REQUIRED"
        event("run_failed", tenantId=claim.tenant, runId=claim.run, status="FAILED", batch=batch_number,
            processedLoans=processed, durationMs=int((time.monotonic()-started)*1000), errorCode=code)
        return "FAILED"


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once",action="store_true")
    parser.add_argument("--tenant")
    parser.add_argument("--run-id")
    parser.add_argument("--health-check",action="store_true")
    args=parser.parse_args(argv)
    configure()
    try:
        settings=Settings.from_env()
        heartbeat=Path(os.getenv("RISK_WORKER_HEARTBEAT",str(Path(tempfile.gettempdir())/"risk-worker-heartbeat")))
        if args.health_check:
            return 0 if heartbeat.exists() and time.time()-heartbeat.stat().st_mtime < settings.lease_seconds+30 else 1
        tenants=(uuid_text(args.tenant),) if args.tenant else settings.tenants
        if any(t not in settings.tenants for t in tenants) or (args.run_id and not args.tenant):
            raise ValueError("INVALID_WORKER_SCOPE")
        run=uuid_text(args.run_id) if args.run_id else None
    except ValueError:
        print("Invalid worker configuration.")
        return 2
    stop=threading.Event()
    for sig in (signal.SIGINT,signal.SIGTERM):
        signal.signal(sig,lambda *_: stop.set())
    repo=Repository(Database(settings))
    while not stop.is_set():
        heartbeat.touch()
        for tenant in tenants:
            if stop.is_set(): break
            try:
                claim=repo.claim(tenant,run)
                if claim:
                    process_run(repo,claim,stop,pulse=heartbeat.touch)
            except RiskError as exc:
                event("worker_poll_failed",tenantId=tenant,errorCode=exc.code)
        if args.once: break
        stop.wait(settings.poll_seconds)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
