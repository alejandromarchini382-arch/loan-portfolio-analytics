"""Fast unit checks for tenant-scoped, read-only fixture discovery; no real DB calls."""
import importlib.util
from pathlib import Path
from unittest.mock import Mock
import pytest

spec = importlib.util.spec_from_file_location("backend_launcher", Path(__file__).with_name("backend-tests.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
TENANT = "11111111-1111-1111-1111-111111111111"
JOB = "22222222-2222-2222-2222-222222222222"
ENV = {"PORTFOLIO_DB_USER": "fixture_reader", "PORTFOLIO_DB_PASSWORD": "unit-placeholder", "RISK_TEST_HOST": "127.0.0.1,11433"}


def test_published_job_binds_tenant_and_closes_resources():
    connect = Mock()
    connection = connect.return_value
    cursor = connection.execute.return_value
    cursor.fetchone.return_value = (JOB,)
    assert launcher.published_job(ENV, TENANT, connect) == JOB
    sql, tenant = connection.execute.call_args.args
    assert "j.TenantId=p.TenantId" in sql and "WHERE p.TenantId=?" in sql
    assert tenant == TENANT and TENANT not in sql
    assert "fixture_reader" in connect.call_args.args[0]
    cursor.close.assert_called_once()
    connection.close.assert_called_once()


def test_no_publication_does_not_fabricate_job():
    connect = Mock()
    connect.return_value.execute.return_value.fetchone.return_value = None
    assert launcher.published_job(ENV, TENANT, connect) is None


@pytest.mark.parametrize("env,tenant", [({}, TENANT), ({**ENV, "PORTFOLIO_DB_USER": "sa"}, TENANT), (ENV, "bad-tenant")])
def test_invalid_configuration_fails_before_connection(env, tenant):
    connect = Mock()
    with pytest.raises(ValueError):
        launcher.published_job(env, tenant, connect)
    connect.assert_not_called()


def test_query_failure_still_closes_connection():
    connect = Mock()
    connect.return_value.execute.side_effect = RuntimeError("controlled test failure")
    with pytest.raises(RuntimeError):
        launcher.published_job(ENV, TENANT, connect)
    connect.return_value.close.assert_called_once()
