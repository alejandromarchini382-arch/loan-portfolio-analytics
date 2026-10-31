"""Internal enqueue/status API; scoring is never performed by HTTP handlers."""
import time
from uuid import uuid4
from datetime import timezone

from flask import Flask, g, jsonify, request
from werkzeug.exceptions import HTTPException

from .auth import Auth
from .config import Settings, uuid_text
from .db import Database
from .errors import RiskError
from .jobs import Repository, validate_key
from .logging import configure, event


def timestamp(value):
    return None if value is None else value.replace(tzinfo=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")


def create_app(settings=None, repository=None, auth=None):
    settings=settings or Settings.from_env()
    auth=auth or Auth.from_env(settings.tenants)
    repo=repository or Repository(Database(settings))
    configure()
    app=Flask(__name__)
    app.config.update(MAX_CONTENT_LENGTH=1024,JSON_SORT_KEYS=False)

    @app.before_request
    def request_context():
        g.request_id=str(uuid4())
        g.started=time.monotonic()

    def tenant(permission):
        verified=auth.verify(request.headers.get("Authorization"),permission)
        g.tenant_id=verified
        return verified

    @app.after_request
    def response_context(response):
        response.headers["X-Request-Id"]=g.request_id
        response.headers["Cache-Control"]="no-store"
        response.headers["X-Content-Type-Options"]="nosniff"
        event("http_request",requestId=g.request_id,tenantId=getattr(g,"tenant_id",None),
            runId=getattr(g,"run_id",None),status=response.status_code,durationMs=int((time.monotonic()-g.started)*1000))
        return response

    @app.errorhandler(RiskError)
    def domain_error(exc):
        return jsonify(error={"code":exc.code,"message":exc.code.replace("_"," ").lower(),"requestId":g.request_id}),exc.status

    @app.errorhandler(HTTPException)
    def http_error(exc):
        return domain_error(RiskError("INVALID_REQUEST" if exc.code<500 else "SERVICE_ERROR",exc.code))

    @app.errorhandler(Exception)
    def unexpected_error(exc):
        event("http_failed",requestId=g.request_id,errorCode="INTERNAL_ERROR")
        return domain_error(RiskError("INTERNAL_ERROR",500))

    @app.get("/health")
    def health():
        return jsonify(status="ok")

    @app.post("/risk/runs")
    def submit():
        scope=tenant("risk:run")
        if request.args or not request.is_json or request.get_json() != {}:
            raise RiskError("INVALID_REQUEST",400)
        key=validate_key(request.headers.get("Idempotency-Key"))
        row=repo.submit(scope,key)
        g.run_id=str(row["RunId"]).lower()
        return jsonify(runId=g.run_id,status=row["Status"],requestId=g.request_id),202

    @app.get("/risk/runs/<run>")
    def status(run):
        scope=tenant("risk:read")
        if request.args: raise RiskError("INVALID_REQUEST",400)
        try: run=uuid_text(run)
        except ValueError: raise RiskError("INVALID_RUN_ID",400) from None
        row=repo.get(scope,run)
        if row is None: raise RiskError("RUN_NOT_FOUND",404)
        g.run_id=run
        return jsonify(runId=str(row["RunId"]).lower(),jobId=str(row["JobId"]).lower(),status=row["Status"],
            processedLoans=row["ProcessedLoans"],totalLoans=row["TotalLoans"],startedAtUtc=timestamp(row["StartedAtUtc"]),
            completedAtUtc=timestamp(row["CompletedAtUtc"]),errorCode=row["ErrorCode"],requestId=g.request_id)

    return app


def main():
    from waitress import serve
    app=create_app()
    serve(app,host="0.0.0.0",port=8000,threads=4,channel_timeout=30,clear_untrusted_proxy_headers=True)


if __name__ == "__main__":
    main()
