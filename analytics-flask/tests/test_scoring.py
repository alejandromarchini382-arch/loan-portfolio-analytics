from dataclasses import replace
from decimal import Decimal, localcontext
import pytest
from risk.scoring import LoanInput, ScoringError, score_loan


@pytest.mark.parametrize("dpd,balance,late,inspected,expected", [
    (0,"500",0,6,"Low"), (14,"500",1,6,"Low"), (14,"500",2,6,"Medium"),
    (15,"500",0,6,"Medium"), (29,"950",0,6,"Medium"), (30,"900",0,6,"Medium"),
    (30,"900.01",0,6,"High"), (45,"950",3,6,"High"), (59,"800",0,6,"Medium"),
    (60,"200",0,6,"High"), (0,"500",2,3,"Medium"), (0,"0",0,0,"Low"),
    (60,"0",2,2,"High"), (30,"900.00000000000000000000001",0,6,"High")])
def test_policy(dpd,balance,late,inspected,expected):
    assert score_loan(LoanInput(Decimal("1000"),Decimal(balance),dpd,late,inspected)) == expected


@pytest.mark.parametrize("field,value", [("PrincipalAmount",Decimal("0")),("PrincipalAmount",Decimal("NaN")),
    ("PrincipalAmount",Decimal("Infinity")),("CurrentBalance",Decimal("-1")),("CurrentBalance",1.5),
    ("DaysPastDue",-1),("DaysPastDue",True),("DaysPastDue",None),("LatePaymentsLastSix",7),
    ("PaymentRowsInspected",7),("LatePaymentsLastSix",2),("Status","CLOSED")])
def test_bad_input(field,value):
    loan=replace(LoanInput(Decimal("1000"),Decimal("500"),0,0,0),**{field:value})
    with pytest.raises(ScoringError): score_loan(loan)


def test_missing_input_and_decimal_context():
    with pytest.raises(ScoringError): score_loan(object())
    with localcontext() as ctx:
        ctx.prec=6
        assert score_loan(LoanInput(Decimal("1000"),Decimal("900.00000001"),30,0,0)) == "High"
