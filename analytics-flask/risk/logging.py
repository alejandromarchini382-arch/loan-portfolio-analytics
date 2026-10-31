"""Only allowlisted operational fields enter JSON logs."""
import json
import logging
import sys
from datetime import datetime, timezone

FIELDS = {"event", "requestId", "tenantId", "runId", "status", "batch", "processedLoans", "durationMs", "errorCode"}


class JsonFormatter(logging.Formatter):
    def format(self, record):
        fields = getattr(record, "fields", {})
        return json.dumps({"timestamp": datetime.now(timezone.utc).isoformat(), "level": record.levelname,
            **{k: v for k, v in fields.items() if k in FIELDS}}, separators=(",", ":"))


def configure():
    logger = logging.getLogger("risk")
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def event(name, **fields):
    logging.getLogger("risk").info("event", extra={"fields": {"event": name, **fields}})
