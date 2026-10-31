"""Authoritative risk-demo-v1; independent of HTTP and database code."""
from dataclasses import dataclass
from decimal import Decimal, localcontext


class ScoringError(ValueError):
    """Invalid input must fail the run, never produce a fallback rating."""


@dataclass(frozen=True)
class LoanInput:
    PrincipalAmount: Decimal
    CurrentBalance: Decimal
    DaysPastDue: int
    LatePaymentsLastSix: int
    PaymentRowsInspected: int
    Status: str = "ACTIVE"


def ratio(loan: LoanInput) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = 50
        return loan.CurrentBalance / loan.PrincipalAmount


def score_loan(loan: LoanInput) -> str:
    try:
        principal, balance = loan.PrincipalAmount, loan.CurrentBalance
        dpd, late, inspected = loan.DaysPastDue, loan.LatePaymentsLastSix, loan.PaymentRowsInspected
        if (not isinstance(principal, Decimal) or not isinstance(balance, Decimal)
                or not principal.is_finite() or not balance.is_finite()
                or principal <= 0 or balance < 0 or loan.Status != "ACTIVE"
                or any(type(value) is not int for value in (dpd, late, inspected))
                or dpd < 0 or not 0 <= late <= inspected <= 6):
            raise ScoringError("INVALID_SCORING_INPUT")
    except (AttributeError, TypeError) as exc:
        raise ScoringError("INVALID_SCORING_INPUT") from exc
    if dpd >= 60 or (dpd >= 30 and ratio(loan) > Decimal("0.90")):
        return "High"
    if dpd >= 15 or late >= 2:
        return "Medium"
    return "Low"


SQL_RATINGS = {"High": "HIGH", "Medium": "MEDIUM", "Low": "LOW"}
