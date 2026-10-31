"""Pure fixture generation. Values are examples, never lender policy."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from random import Random
from uuid import UUID, uuid5

NAMESPACE = UUID("f149a1fb-ec87-408c-9639-1aaaeb514d65")
AS_OF = date(2026, 10, 30)
STAMP = datetime.combine(AS_OF, time(3))  # naive UTC for SQL DATETIME2
CENT = Decimal("0.01")
DIVISIONS = ("Commercial", "Retail", "Mortgage", "Small Business", "Agriculture")
INDUSTRIES = ("Manufacturing", "Technology", "Healthcare", "Retail", "Agriculture")


def identifier(kind: str, number: int, seed: int = 0) -> str:
    return str(uuid5(NAMESPACE, f"{seed}:{kind}:{number}"))


def generate(count: int = 1500, seed: int = 42) -> dict[str, list[dict]]:
    """Return exactly count total loans, with equal IDs/labels across tenant boundaries.

    Stable namespace and manifest tenant names let the insertion layer reject an incompatible
    fixture rerun without adding a seed-control table to the business schema.
    """
    if isinstance(count, bool) or not isinstance(count, int) or count < 2:
        raise ValueError("count must be an integer >= 2")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("seed must be an integer")
    rng = Random(seed)
    data = {name: [] for name in (
        "Tenants", "Divisions", "LoanOfficers", "Borrowers", "Loans", "PaymentHistory", "LoanPortfolio"
    )}
    for tenant_number, tenant_count in enumerate(((count + 1) // 2, count // 2)):
        tenant = identifier("tenant", tenant_number)
        data["Tenants"].append({"TenantId": tenant,
            "TenantName": f"Fictional Lender {'AB'[tenant_number]} [fixture-v1 count={count} seed={seed}]"})
        for i, label in enumerate(DIVISIONS):
            data["Divisions"].append({"TenantId": tenant, "DivisionId": identifier("division", i, seed), "DivisionName": label})
        for i in range(20):
            data["LoanOfficers"].append({"TenantId": tenant, "LoanOfficerId": identifier("officer", i, seed), "LoanOfficerName": f"Demo Officer {i + 1:02d}"})
        for i in range(tenant_count):
            loan_id = identifier("loan", i, seed)
            borrower_id = identifier("borrower", i, seed)
            corporate = rng.randrange(100) < 35
            borrower = {"TenantId": tenant, "BorrowerId": borrower_id,
                "BorrowerName": f"Fictional {'Company' if corporate else 'Person'} {i + 1:06d}",
                "BorrowerType": "CORPORATE" if corporate else "INDIVIDUAL",
                "Industry": rng.choice(INDUSTRIES) if corporate else None,
                "BorrowerRiskRating": rng.choices(["LOW", "MEDIUM", "HIGH", None], [60, 25, 10, 5])[0]}
            data["Borrowers"].append(borrower)
            principal = Decimal(rng.randint(1000000, 250000000 if corporate else 75000000)) / 100
            status = rng.choices(["ACTIVE", "CLOSED", "DEFAULTED"], [88, 8, 4])[0]
            balance = (principal * Decimal(rng.randint(0, 10500)) / 10000).quantize(CENT, rounding=ROUND_HALF_UP)
            if status == "CLOSED":
                balance = Decimal("0.00")
            rate = None if rng.randrange(100) < 3 else Decimal(rng.randint(350, 2400)).scaleb(-4)
            bucket = rng.choices([0, 1, 15, 30, 60], [70, 12, 8, 6, 4])[0]
            dpd = 0 if bucket == 0 else rng.randint(bucket, {1: 14, 15: 29, 30: 59, 60: 180}[bucket])
            # Lifecycle consistency is fixture convention only, not an enforced lending rule.
            if status == "CLOSED":
                dpd = 0
            elif status == "DEFAULTED":
                dpd = rng.randint(60, 180)
            division = None if rng.randrange(100) < 2 else rng.randrange(5)
            officer = None if rng.randrange(100) < 2 else rng.randrange(20)
            origination = AS_OF - timedelta(days=rng.randint(400, 1800))
            maturity = origination + timedelta(days=rng.choice([730, 1095, 1825, 3650]))
            payment_count = rng.randint(0, 12)
            last_payment = None
            for j in range(payment_count):
                payment_date = AS_OF - timedelta(days=dpd + (payment_count - j) * 30)
                # Even the oldest payment follows origination.
                payment_date = max(payment_date, origination + timedelta(days=j + 1))
                last_payment = payment_date
                data["PaymentHistory"].append({"TenantId": tenant,
                    "PaymentId": identifier(f"payment-{i}", j, seed), "LoanId": loan_id,
                    "PaymentDate": payment_date,
                    "PaymentAmount": (principal / Decimal(120) * Decimal(rng.randint(80, 120)) / 100).quantize(CENT, rounding=ROUND_HALF_UP),
                    "IsLate": rng.randrange(100) < (35 if dpd >= 15 else 5),
                    "PostedAtUtc": datetime.combine(payment_date, time(12))})
            loan = {"TenantId": tenant, "LoanId": loan_id, "LoanNumber": f"LN-{i + 1:06d}",
                "BorrowerId": borrower_id,
                "DivisionId": None if division is None else identifier("division", division, seed),
                "LoanOfficerId": None if officer is None else identifier("officer", officer, seed),
                "PrincipalAmount": principal.quantize(CENT), "CurrentBalance": balance,
                "InterestRate": rate, "Status": status, "OriginationDate": origination,
                "MaturityDate": maturity, "DaysPastDue": dpd, "LastPaymentDate": last_payment,
                "CurrencyCode": "USD", "SourceVersion": 1, "UpdatedAtUtc": STAMP}
            data["Loans"].append(loan)
            projection = {k: v for k, v in loan.items() if k not in ("DivisionId", "LoanOfficerId", "UpdatedAtUtc")}
            projection.update({k: borrower[k] for k in ("BorrowerName", "BorrowerType", "Industry", "BorrowerRiskRating")})
            projection.update({"Division": None if division is None else DIVISIONS[division],
                "LoanOfficer": None if officer is None else f"Demo Officer {officer + 1:02d}", "LastSyncedUtc": STAMP})
            data["LoanPortfolio"].append(projection)
    return data
