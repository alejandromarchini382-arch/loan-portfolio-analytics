# AXIS Loan Portfolio Analytics — Data Contract

**Contract version:** `0.4.0` (assessment prototype)
**Status:** Proposed; not an approved lender data model or credit-risk policy  
**Source of truth:** `AIO_Logic_-_Senior_Full-Stack_Developer_Technical_Assessment.pdf`  
**Related:** [`architecture.md`](architecture.md), [`decisions.md`](decisions.md)

## 1. Authority and non-invention rules

The assessment **requires**: loan number, principal, current balance, interest rate, status; borrower name, borrower
type (Individual/Corporate), industry, risk rating; division, loan officer, origination and maturity dates; days past
due, payment history, last payment date; dynamic groupings, subtotals and nightly/on-demand risk analysis. AXIS must
isolate multiple lender tenants. The assessment does **not** provide SQL column definitions, a loan-status enum, a risk
algorithm, API endpoints, a currency convention, or a payment-history structure.

This document defines **explicit implementation assumptions** for a consistent, testable prototype. Do not pass these
choices off as policies approved by AIO Logic or its clients. Before production, Product/Risk must approve rules and
definitions; the team must agree on authentication, data freshness and ownership.

| Classification | Meaning                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **REQ**        | Explicit assessment requirement.                                                                   |
| **ASSUMPTION** | Chosen prototype interpretation; may change with stakeholder approval.                             |
| **DERIVED**    | Deterministic field/calculation computed from another defined field.                               |
| **OPS**        | Required to make the implementation auditable/operable, not an assessment-provided business field. |

## 2. System boundaries and field conventions

- **Operational owner:** Mendix owns loan/borrower edits and their persisted records.
- **Reporting owner:** SQL Server `analytics` schema stores a **separately managed projection**. Spring Boot queries it;
  it must not make direct assumptions about Mendix-generated storage tables. A simple seeded projection is acceptable in
  the prototype; operational-to-reporting synchronization is a separately documented trade-off.
- **Risk owner:** Flask worker calculates per-loan risk into staging rows and publishes only complete runs. It does
  **not** invent or recompute authoritative loan balances; the upstream nightly balance update must finish before
  scoring starts. The assessment gives no balance-recalculation formula.
- **Tenant:** Every logical table includes `TenantId`. Never trust `TenantId` from a widget, query string, or
  user-supplied JSON. Resolve it from the authenticated Mendix/OIDC context at the service boundary; all joins/queries
  use tenant-qualified keys.
- **ID storage:** `TenantId`, `LoanId`, `BorrowerId`, `PaymentId`, `JobId` and `RunId` are stable identifiers
  (`UNIQUEIDENTIFIER` in SQL Server, serialized as strings in JSON). Actual Mendix GUID mapping is an integration
  decision; do not equate its internal IDs to external IDs without an explicit mapping.
- **Dates/timestamps:** Business dates use SQL `DATE` / JSON `YYYY-MM-DD`; event timestamps use SQL `DATETIME2(3)` UTC /
  ISO 8601 JSON (`...Z`).
- **Money:** SQL `DECIMAL(18,2)` and **JSON decimal strings** to avoid JavaScript precision loss. No binary float in
  Python/Java finance logic. All prototype loans use `USD` (**ASSUMPTION**). Reject a request combining different
  currencies rather than silently summing them.
- **Rate:** SQL `DECIMAL(7,4)`, stored as an **annual fractional rate** (`0.0725` means 7.25% per year). API serializes
  it as a decimal string. This convention is **ASSUMPTION**; confirm against imported source data before any
  calculations.
- **Nulls:** Optional grouping labels can be `NULL`; group response uses `key: null`, `label: "Unassigned"`.
  `LoanRiskRating` can be `NULL` before a successful scoring run; display "Unrated", not "Low".
- **Names:** Use PascalCase SQL columns and camelCase JSON keys; the API maps between the two explicitly.

## 3. Logical schema — fields and ownership

The following is a **proposed logical/SQL reporting model**, not a claim about the actual Mendix-generated schema.
`TenantId` is explicitly present in **every table**.

### 3.1 `analytics.Tenants` (owned provisioning records)

| Column       | SQL type           | Null? | Classification / meaning                                  |
| ------------ | ------------------ | ----- | --------------------------------------------------------- |
| `TenantId`   | `UNIQUEIDENTIFIER` | No    | **OPS**, tenant PK; source of server authorization scope. |
| `TenantName` | `NVARCHAR(150)`    | No    | **OPS**, display label only, not authorization input.     |

### 3.2 `analytics.Borrowers` (owned fictional/source projection records)

| Column               | SQL type           | Null? | Classification / meaning                                                                                 |
| -------------------- | ------------------ | ----- | -------------------------------------------------------------------------------------------------------- |
| `TenantId`           | `UNIQUEIDENTIFIER` | No    | **OPS**, composite PK/FK and access boundary.                                                            |
| `BorrowerId`         | `UNIQUEIDENTIFIER` | No    | **OPS**, composite PK with `TenantId`.                                                                   |
| `BorrowerName`       | `NVARCHAR(200)`    | No    | **REQ**, borrower name.                                                                                  |
| `BorrowerType`       | `VARCHAR(20)`      | No    | **REQ**, `INDIVIDUAL` or `CORPORATE`.                                                                    |
| `Industry`           | `NVARCHAR(100)`    | Yes   | **REQ**, borrower industry.                                                                              |
| `BorrowerRiskRating` | `VARCHAR(10)`      | Yes   | **REQ** input concept; rating supplied/maintained at borrower level. **Not** the calculated loan rating. |

**Key:** `PRIMARY KEY (TenantId, BorrowerId)`.

### 3.3 `analytics.Loans` (owned fictional/source projection records)

| Column            | SQL type           | Null? | Classification / meaning                                         |
| ----------------- | ------------------ | ----- | ---------------------------------------------------------------- |
| `TenantId`        | `UNIQUEIDENTIFIER` | No    | **OPS**, tenant boundary / composite PK.                         |
| `LoanId`          | `UNIQUEIDENTIFIER` | No    | **OPS**, stable loan key within tenant.                          |
| `LoanNumber`      | `NVARCHAR(50)`     | No    | **REQ**, human-visible loan number; unique per tenant.           |
| `BorrowerId`      | `UNIQUEIDENTIFIER` | No    | **OPS**, tenant-qualified FK to borrower.                        |
| `PrincipalAmount` | `DECIMAL(18,2)`    | No    | **REQ**, original principal, `> 0` for prototype risk model.     |
| `CurrentBalance`  | `DECIMAL(18,2)`    | No    | **REQ**, authoritative latest balance, `>= 0`.                   |
| `InterestRate`    | `DECIMAL(7,4)`    | Yes   | **REQ**, annual fractional rate.                                 |
| `Status`          | `VARCHAR(20)`      | No    | **REQ** field; values below are **ASSUMPTION**.                  |
| `DivisionId`      | `UNIQUEIDENTIFIER` | Yes   | Tenant-qualified FK to `analytics.Divisions`; label exposed as `Division`. |
| `LoanOfficerId`   | `UNIQUEIDENTIFIER` | Yes   | Tenant-qualified FK to `analytics.LoanOfficers`; label exposed as `LoanOfficer`. |
| `OriginationDate` | `DATE`             | No    | **REQ**, date originated.                                        |
| `MaturityDate`    | `DATE`             | No    | **REQ**, scheduled maturity date.                                |
| `DaysPastDue`     | `INT`              | No    | **REQ**, last upstream-calculated integer, `>= 0`.               |
| `LastPaymentDate` | `DATE`             | Yes   | **REQ**, last posted payment date (prototype interpretation).    |
| `CurrencyCode`    | `CHAR(3)`          | No    | **ASSUMPTION**, `USD` for this prototype.                        |
| `SourceVersion`   | `BIGINT`           | No    | **OPS**, monotonically increasing version for projection upsert. |
| `UpdatedAtUtc`    | `DATETIME2(3)`     | No    | **OPS**, last source update timestamp.                           |

**Keys:** `PRIMARY KEY (TenantId, LoanId)`, `UNIQUE (TenantId, LoanNumber)`,
`FOREIGN KEY (TenantId, BorrowerId) REFERENCES analytics.Borrowers (TenantId, BorrowerId)`. The generated Mendix model may
implement equivalent associations differently; these are logical constraints for owned tables and projections.

### 3.4 `analytics.PaymentHistory` (owned payment facts)

The assessment says **Payment History**, but does not specify its structure. This row-per-payment model is a **prototype
assumption** made necessary by the suggested rule involving the last six payments.

| Column          | SQL type           | Null? | Classification / meaning                                               |
| --------------- | ------------------ | ----- | ---------------------------------------------------------------------- |
| `TenantId`      | `UNIQUEIDENTIFIER` | No    | **OPS**, tenant boundary / composite PK.                               |
| `PaymentId`     | `UNIQUEIDENTIFIER` | No    | **OPS**, payment PK with tenant.                                       |
| `LoanId`        | `UNIQUEIDENTIFIER` | No    | **OPS**, tenant-qualified FK to loan.                                  |
| `PaymentDate`   | `DATE`             | No    | **ASSUMPTION**, posted payment date.                                   |
| `PaymentAmount` | `DECIMAL(18,2)`    | No    | **ASSUMPTION**, nonnegative posted amount.                             |
| `IsLate`        | `BIT`              | No    | **ASSUMPTION**, upstream/contract-defined late-payment flag.           |
| `PostedAtUtc`   | `DATETIME2(3)`     | No    | **OPS**, deterministic ordering with `PaymentId` as final tie-breaker. |

**Key:** `PRIMARY KEY (TenantId, PaymentId)`, FK `(TenantId, LoanId)` → `Loan`. **Last six payments** = six most recent
_posted_ rows, ordered by `PaymentDate DESC, PostedAtUtc DESC, PaymentId DESC`. Reversed/refunded payments, if they
exist, need an approved rule and are **out of scope**. With fewer than six posted payments, count only available rows
(prototype assumption); record the count for audit.

### 3.5 `analytics.LoanPortfolio` (SQL Server reporting projection)

**One row per `(TenantId, LoanId)`**, populated from `Loan` + `Borrower`, optionally joined to the latest published risk
run for reads. The materialized columns are:

| Column               | SQL type           | Source                                           |
| -------------------- | ------------------ | ------------------------------------------------ |
| `TenantId`           | `UNIQUEIDENTIFIER` | Loan — **required on every row**.                |
| `LoanId`             | `UNIQUEIDENTIFIER` | Loan.                                            |
| `LoanNumber`         | `NVARCHAR(50)`     | Loan.                                            |
| `BorrowerId`         | `UNIQUEIDENTIFIER` | Loan.                                            |
| `BorrowerName`       | `NVARCHAR(200)`    | Borrower.                                        |
| `BorrowerType`       | `VARCHAR(20)`      | Borrower.                                        |
| `Industry`           | `NVARCHAR(100)`    | Borrower.                                        |
| `BorrowerRiskRating` | `VARCHAR(10)`      | Borrower (input rating; not scored loan rating). |
| `PrincipalAmount`    | `DECIMAL(18,2)`    | Loan.                                            |
| `CurrentBalance`     | `DECIMAL(18,2)`    | Loan.                                            |
| `InterestRate`       | `DECIMAL(7,4)`    | Loan.                                            |
| `Status`             | `VARCHAR(20)`      | Loan.                                            |
| `Division`           | `NVARCHAR(100)`    | Loan.                                            |
| `LoanOfficer`        | `NVARCHAR(150)`    | Loan.                                            |
| `OriginationDate`    | `DATE`             | Loan.                                            |
| `MaturityDate`       | `DATE`             | Loan.                                            |
| `DaysPastDue`        | `INT`              | Loan.                                            |
| `LastPaymentDate`    | `DATE`             | Loan.                                            |
| `CurrencyCode`       | `CHAR(3)`          | Loan.                                            |
| `SourceVersion`      | `BIGINT`           | Loan.                                            |
| `LastSyncedUtc`      | `DATETIME2(3)`     | Projection writer.                               |

`LoanRiskRating` (calculated) is **exposed by the reporting query** via an authorized join to `analytics.RiskScoreStage`
using the published `RunId`, rather than updated piecemeal on every operational row. The group-by dimension `riskRating`
explicitly means **published LoanRiskRating**, not `BorrowerRiskRating`. Until the first successful run, loans group
under `key: null` (label: `Unrated`).

**Key:** `PRIMARY KEY (TenantId, LoanId)`. An upsert only accepts a `SourceVersion` newer than the currently persisted
projection. The prototype may seed the projection directly without claiming production-grade cross-system
synchronization.

### 3.6 `analytics.RiskJob` (durable prototype job queue)

| Column           | SQL type           | Meaning                                                       |
| ---------------- | ------------------ | ------------------------------------------------------------- |
| `TenantId`       | `UNIQUEIDENTIFIER` | Tenant boundary, included in **every** query.                 |
| `JobId`          | `UNIQUEIDENTIFIER` | Job identity; unique per tenant.                              |
| `JobType`        | `VARCHAR(30)`      | `RECALCULATE_LOAN_RISK` (prototype).                          |
| `Status`         | `VARCHAR(15)`      | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`.                   |
| `IdempotencyKey` | `NVARCHAR(120)`    | Deduplicate equivalent on-demand requests within tenant.      |
| `RunId`          | `UNIQUEIDENTIFIER` | Proposed score run ID, assigned to the job.                   |
| `Attempts`       | `INT`              | Retry counter.                                                |
| `LeaseUntilUtc`  | `DATETIME2(3)`     | Worker lease expiration, nullable.                            |
| `CreatedAtUtc`   | `DATETIME2(3)`     | Submission time.                                              |
| `StartedAtUtc`   | `DATETIME2(3)`     | First start, nullable.                                        |
| `CompletedAtUtc` | `DATETIME2(3)`     | Completion/failure time, nullable.                            |
| `ProcessedLoans` | `INT`              | Progress counter.                                             |
| `TotalLoans`     | `INT`              | Eligible loan count from a fixed source snapshot.             |
| `ErrorCode`      | `VARCHAR(60)`      | Safe operational error code, nullable; no PII or stack trace. |

**Key:** `(TenantId, JobId)`; uniqueness `(TenantId, IdempotencyKey)` for non-null keys within the intended request
lifetime. All updates tenant-scoped. No user-facing endpoint may select another tenant's job.

### 3.7 `analytics.RiskScoreStage` (calculation results, not yet published)

| Column                  | SQL type           | Meaning                                                                     |
| ----------------------- | ------------------ | --------------------------------------------------------------------------- |
| `TenantId`              | `UNIQUEIDENTIFIER` | Tenant isolation.                                                           |
| `RunId`                 | `UNIQUEIDENTIFIER` | Calculation batch/run.                                                      |
| `LoanId`                | `UNIQUEIDENTIFIER` | Scored loan.                                                                |
| `LoanRiskRating`        | `VARCHAR(10)`      | `HIGH`, `MEDIUM`, `LOW`.                                                    |
| `PolicyVersion`         | `VARCHAR(40)`      | `risk-demo-v1`.                                                             |
| `InputSourceVersion`    | `BIGINT`           | Source version used for scoring.                                            |
| `DaysPastDueUsed`       | `INT`              | Audit value.                                                                |
| `BalancePrincipalRatio` | `DECIMAL(18,8)`    | Derived ratio at score time.                                                |
| `LatePaymentsLastSix`   | `INT`              | Number of late payments among available last six.                           |
| `PaymentRowsInspected`  | `INT`              | 0–6; prevents silently interpreting missing history as six timely payments. |
| `CalculatedAtUtc`       | `DATETIME2(3)`     | Score completion timestamp.                                                 |

**Key:** `(TenantId, RunId, LoanId)`. Retry same run with the same inputs via upsert, not duplicate inserts. Do not
expose staged results in portfolio groups.

### 3.8 `analytics.RiskPublication` (atomic pointer to current completed run)

| Column                  | SQL type           | Meaning                                                  |
| ----------------------- | ------------------ | -------------------------------------------------------- |
| `TenantId`              | `UNIQUEIDENTIFIER` | PK, exactly one current publication per tenant.          |
| `PublishedRunId`        | `UNIQUEIDENTIFIER` | Current successful score run; nullable before first run. |
| `PublishedAtUtc`        | `DATETIME2(3)`     | Publication timestamp, nullable.                         |
| `PolicyVersion`         | `VARCHAR(40)`      | Policy used by the published run.                        |
| `SourceSnapshotVersion` | `BIGINT`           | Fixed input watermark.                                   |
| `LoanCount`             | `INT`              | Number of active loans verified for publication.         |

Publication occurs in **one SQL transaction after the full run succeeds** and the expected loan count matches. Readers
use the last published `RunId` while a new job runs. A failed run must never replace the last successful publication.

## 4. Enumerations and business meanings

| Enum                 | Values                                     | Status and important notes                                                                                                                                |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BorrowerType`       | `INDIVIDUAL`, `CORPORATE`                  | **REQ** (assessment says Individual/Corporate); uppercase encoding is **ASSUMPTION**.                                                                     |
| `LoanStatus`         | `ACTIVE`, `CLOSED`, `DEFAULTED`            | **ASSUMPTION**; the assessment gives no status values. Only `ACTIVE` is eligible for scheduled risk scoring. A loan may be past due while still `ACTIVE`. |
| `LoanRiskRating`     | `HIGH`, `MEDIUM`, `LOW`                    | **REQ** levels (assessment uses High/Medium/Low); exact code casing is **ASSUMPTION**. Null = not scored, **not** an enum value.                          |
| `BorrowerRiskRating` | `HIGH`, `MEDIUM`, `LOW`, or null           | **ASSUMPTION** for the separately stored borrower input; no implication it equals a loan score.                                                           |
| `RiskJobStatus`      | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED` | **OPS**, job lifecycle.                                                                                                                                   |
| `RiskJobType`        | `RECALCULATE_LOAN_RISK`                    | **OPS**, prototype.                                                                                                                                       |

Do not add additional enum values in code without editing this contract and its tests. Distinguish `CLOSED` from
`DEFAULTED` according to the placeholder rules only; lender-specific lifecycle rules require confirmation.

## 5. Exact demonstration risk policy — `risk-demo-v1`

**Important:** This is the user's proposed **prototype example adapted into a precise algorithm**. It is **not**
prescribed by the assessment, and must **never** be described as an approved underwriting or credit-risk model.

### 5.1 Inputs and preprocessing

For each loan with `Status = ACTIVE` in a fixed input snapshot:

- `dpd = DaysPastDue` (nonnegative integer, non-null).
- `ratio = CurrentBalance / PrincipalAmount` using decimal arithmetic with at least 8-digit fractional precision.
  `PrincipalAmount` **must be > 0**; no division-by-zero fallback and no silent reclassification as `LOW`.
- `lateCount = count(IsLate = true)` among **up to the last six posted payments**, ordered as in §3.4.
  `PaymentRowsInspected` captures the actual number available; missing history is a prototype data-quality limitation,
  not proof of on-time payment.
- Reject/quarantine scoring for rows with invalid monetary inputs, missing `dpd`, unrecognized statuses, or unresolvable
  history; mark the run `FAILED` with a non-sensitive error code and keep the prior publication. The prototype must not
  publish a partial run.

### 5.2 Evaluation order (first matching rule wins)

| Priority | Condition                                               | Rating   |
| -------- | ------------------------------------------------------- | -------- |
| 1        | `dpd >= 60` **OR** (`dpd >= 30` **AND** `ratio > 0.90`) | `HIGH`   |
| 2        | `15 <= dpd <= 59` **OR** `lateCount >= 2`               | `MEDIUM` |
| 3        | Otherwise                                               | `LOW`    |

**Precedence matters:** A loan with `dpd = 45` and `ratio = 0.95` is `HIGH`, **not** `MEDIUM`; a loan with `dpd = 65` is
`HIGH` regardless of its ratio or payment history. Exactly `ratio = 0.90` does **not** satisfy the high-ratio condition.
`dpd = 14` with 2 late payments is `MEDIUM`. `dpd = 0` with fewer than two observed late payments is `LOW` **under this
demo rule**, subject to documented payment-history completeness limitations.

### 5.3 Reference pseudocode

```python
from decimal import Decimal

def score_loan(days_past_due: int, principal: Decimal,
               balance: Decimal, late_payments_last_six: int) -> str:
    if days_past_due < 0 or principal <= 0 or balance < 0:
        raise ValueError("invalid loan scoring input")
    if not (0 <= late_payments_last_six <= 6):
        raise ValueError("invalid payment history count")

    ratio = balance / principal
    if days_past_due >= 60 or (days_past_due >= 30 and ratio > Decimal("0.90")):
        return "HIGH"
    if days_past_due >= 15 or late_payments_last_six >= 2:
        return "MEDIUM"
    return "LOW"
```

`>= 15` in the second branch is sufficient **only because** all `dpd >= 60` cases already matched the high-priority
branch. The implementation must preserve this precedence.

### 5.4 Required deterministic test cases

| DPD | Principal | Balance | Late / inspected | Expected  | Reason                                         |
| --: | --------: | ------: | ---------------- | --------- | ---------------------------------------------- |
|   0 |   1000.00 |  500.00 | 0 / 6            | `LOW`     | No thresholds reached.                         |
|  14 |   1000.00 |  500.00 | 1 / 6            | `LOW`     | Below 15 DPD, fewer than 2 late.               |
|  14 |   1000.00 |  500.00 | 2 / 6            | `MEDIUM`  | Payment-history rule.                          |
|  15 |   1000.00 |  500.00 | 0 / 6            | `MEDIUM`  | Lower DPD threshold.                           |
|  29 |   1000.00 |  950.00 | 0 / 6            | `MEDIUM`  | High ratio alone is insufficient below 30 DPD. |
|  30 |   1000.00 |  900.00 | 0 / 6            | `MEDIUM`  | Exactly 0.90 is **not** greater than 0.90.     |
|  30 |   1000.00 |  900.01 | 0 / 6            | `HIGH`    | Crosses ratio threshold.                       |
|  45 |   1000.00 |  950.00 | 3 / 6            | `HIGH`    | High rule wins before medium.                  |
|  59 |   1000.00 |  800.00 | 0 / 6            | `MEDIUM`  | DPD 15–59.                                     |
|  60 |   1000.00 |  200.00 | 0 / 6            | `HIGH`    | Absolute high DPD threshold.                   |
|   0 |   1000.00 |  500.00 | 2 / 3            | `MEDIUM`  | Fewer than six payments: count available.      |
|   0 |      0.00 |    0.00 | 0 / 6            | **ERROR** | Invalid principal; do not score.               |

Only `ACTIVE` loans are scored/published for a run; non-active statuses remain outside the active risk run. The
treatment of existing historical ratings for closed loans requires a business decision.

## 6. Aggregation contract

### 6.1 Allowed grouping values

| API value      | SQL projection / published join        | Allowed? |
| -------------- | -------------------------------------- | -------- |
| `division`     | `analytics.LoanPortfolio.Division`     | Yes      |
| `loanOfficer`  | `analytics.LoanPortfolio.LoanOfficer`  | Yes      |
| `borrowerType` | `analytics.LoanPortfolio.BorrowerType` | Yes      |
| `riskRating`   | **published** `LoanRiskRating`         | Yes      |

Group identifiers must be resolved through a **server-side allowlist**, never interpolated from arbitrary user input.
One primary group is required; at most one secondary group for prototype; cannot select the same dimension twice.
Filters and group paths are SQL parameters. The prototype defaults to `status=ACTIVE`.

### 6.2 Mathematical definitions

For each group, within the **same tenant, authorized division scope, filters, currency and published snapshot**:

- `loanCount = COUNT(*)` across included loan rows (including zero balances).
- `totalBalance = SUM(CurrentBalance)` as an exact decimal; when no rows, return `"0.00"`.
- `averageInterestRate = AVG(InterestRate)` as the **simple, unweighted average of non-null rates**; when no valid
  rates, return `null`. Return the rate as a fractional decimal string (e.g., `"0.07250000"`). An amount-weighted rate
  could be a later approved requirement; do not silently switch.
- Root-group totals must reconcile with a sum of all child-group totals under a common `snapshotVersion`; the total
  number of groups can be paged. Differences across source versions must trigger a UI refresh instead of silently mixing
  snapshots.
- SQL aggregates `COUNT`, `SUM`, `AVG`; do **not** download all loans to React to compute them. Lazy-load root groups,
  then children, then paged loan details.

### 6.3 Shared request conventions

- Base path: `/api/v1/portfolio`; JSON `Content-Type: application/json`.
- Authentication: bearer token accepted only after Spring Boot validates issuer, audience, signature, expiration and
  authorized scopes; exact Mendix token integration is still a deployment task.
- **Forbidden caller input:** `TenantId` or arbitrary raw SQL/column names.
- Dates: `YYYY-MM-DD`. Enum parameters: exact case from §4. Bounded `limit` default `50`, max `100`.
- Errors: `{ "error": { "code": "INVALID_GROUP_BY", "message": "...", "requestId": "..." } }`. Do not expose SQL,
  tokens, payment history or PII in errors.
- Pagination: opaque `cursor` (no tenant information trusted from it). Stable ordering and tenant-scoped
  signed/validated cursor in production.
- Every aggregate result includes `snapshotVersion`, `riskRunId`, `asOfUtc`, `currency`, `rateUnit`, `requestId`.
  `riskRunId` is `null` before initial publication.
- Tenant isolation applies to **all** root groups, child groups, loan details and jobs; permitted divisions may further
  restrict results.

### 6.4 `GET /api/v1/portfolio/groups`

**Query parameters**

| Name              | Type           | Required | Contract                                                        |
| ----------------- | -------------- | -------- | --------------------------------------------------------------- |
| `groupBy`         | enum           | Yes      | One of `division`, `loanOfficer`, `borrowerType`, `riskRating`. |
| `subgroupBy`      | enum           | No       | Same allowlist but different from `groupBy`.                    |
| `status`          | LoanStatus     | No       | Defaults to `ACTIVE`.                                           |
| `division`        | string         | No       | Exact authorized division filter.                               |
| `borrowerType`    | BorrowerType   | No       | Exact borrower type filter.                                     |
| `riskRating`      | LoanRiskRating | No       | Filter by published loan risk rating (non-null values).         |
| `originationFrom` | ISO date       | No       | Inclusive lower bound.                                          |
| `originationTo`   | ISO date       | No       | Inclusive upper bound; must be >= `originationFrom`.            |

**Example**

```http
GET /api/v1/portfolio/groups?groupBy=division&subgroupBy=loanOfficer&status=ACTIVE
Authorization: Bearer <verified-user-token>
```

**200 JSON** (illustrative fixture values, not assessment source data):

```json
{
  "groupBy": "division",
  "subgroupBy": "loanOfficer",
  "snapshotVersion": 1042,
  "riskRunId": "46f8b7b4-80fd-49fe-84cf-36d9f589af5b",
  "asOfUtc": "2026-10-30T03:00:00Z",
  "currency": "USD",
  "rateUnit": "fractionPerYear",
  "requestId": "req-example-001",
  "groups": [
    {
      "key": "Commercial",
      "label": "Commercial",
      "loanCount": 320,
      "totalBalance": "52800000.00",
      "averageInterestRate": "0.07250000",
      "hasChildren": true
    },
    {
      "key": null,
      "label": "Unassigned",
      "loanCount": 12,
      "totalBalance": "400000.00",
      "averageInterestRate": null,
      "hasChildren": true
    }
  ]
}
```

### 6.5 `GET /api/v1/portfolio/groups/children`

**Query:** all applicable filters from `/groups`, plus:

| Name              | Type    | Required    | Contract                                                                  |
| ----------------- | ------- | ----------- | ------------------------------------------------------------------------- |
| `groupBy`         | enum    | Yes         | Primary grouping used by parent.                                          |
| `subgroupBy`      | enum    | Yes         | Child grouping.                                                           |
| `parentKey`       | string  | Conditional | Primary key value; percent-encoded by client.                             |
| `parentKeyIsNull` | boolean | Conditional | `true` to select a null primary key. Mutually exclusive with `parentKey`. |

**Example**

```http
GET /api/v1/portfolio/groups/children?groupBy=division&subgroupBy=loanOfficer&parentKey=Commercial&status=ACTIVE
```

**200 JSON** — same metadata/aggregate types as root groups, with `parent: {"dimension":"division","key":"Commercial"}`
and `groups` containing `loanOfficer` values, each `hasChildren: false` in the two-level prototype. Always derive child
filtering from the typed validated parent dimension, not untrusted arbitrary SQL.

### 6.6 `GET /api/v1/portfolio/loans`

**Query:** `groupBy` (required), `groupKey` or `groupKeyIsNull=true` (exactly one), optional `subgroupBy` with matching
`subgroupKey` or `subgroupKeyIsNull=true`, `status` (default `ACTIVE`), `limit` (1–100, default 50), `cursor` (opaque),
and the same top-level filters. Child path must match an allowed grouping pair.

**Example**

```http
GET /api/v1/portfolio/loans?groupBy=division&groupKey=Commercial&subgroupBy=loanOfficer&subgroupKey=Alex%20Kim&limit=50
```

**200 JSON** (illustrative):

```json
{
  "snapshotVersion": 1042,
  "riskRunId": "46f8b7b4-80fd-49fe-84cf-36d9f589af5b",
  "asOfUtc": "2026-10-30T03:00:00Z",
  "currency": "USD",
  "requestId": "req-example-002",
  "loans": [
    {
      "loanId": "bca33f24-2462-4b8e-9ec7-bdf7527c8b99",
      "loanNumber": "LN-1001",
      "borrowerName": "Example Borrower LLC",
      "borrowerType": "CORPORATE",
      "industry": "Manufacturing",
      "division": "Commercial",
      "loanOfficer": "Alex Kim",
      "principalAmount": "1000000.00",
      "currentBalance": "925000.00",
      "interestRate": "0.07250000",
      "status": "ACTIVE",
      "originationDate": "2024-05-10",
      "maturityDate": "2029-05-10",
      "daysPastDue": 30,
      "lastPaymentDate": "2026-09-15",
      "borrowerRiskRating": "MEDIUM",
      "loanRiskRating": "HIGH"
    }
  ],
  "nextCursor": null
}
```

`PaymentHistory` details are **not** included in grouping or loan-list responses; expose only through a separately
authorized detail endpoint if a later requirement justifies it. Never expose `TenantId` as a client-selectable scope.

### 6.7 Risk run endpoints

| Method | Path                                  | Request                                                                       | Response                                                                                                                                                                                                                |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/portfolio/risk-runs`         | Empty `{}` body; `Idempotency-Key` header required; authorized operator only. | `202 Accepted`: `{ "jobId": "<uuid>", "status": "QUEUED", "requestId": "..." }` (or current matching job).                                                                                                              |
| `GET`  | `/api/v1/portfolio/risk-runs/latest`  | No body.                                                                      | `200`: `{ "runId": "<uuid-or-null>", "policyVersion": "risk-demo-v1", "publishedAtUtc": "<timestamp-or-null>", "jobStatus": "RUNNING", "lastRequestedAtUtc": "<timestamp-or-null>" }`. `jobStatus` may be null if none. |
| `GET`  | `/api/v1/portfolio/risk-runs/{jobId}` | UUID route value.                                                             | `200`: `{ "jobId": "<uuid>", "status": "RUNNING", "processedLoans": 500, "totalLoans": 1500, "requestId": "..." }`.                                                                                                     |

Status codes: `400` invalid parameters, `401` unauthenticated, `403` unauthorized, `404` unknown/not-in-tenant resource,
`409` conflicting snapshot/request when applicable, `429` throttled, `503` unavailable dependency. Keep error bodies
sanitized and consistent. Nightly scheduler uses a privileged internal path, not a public unprotected endpoint.

## 7. Refresh behavior, consistency and caching

1. The widget queries root groups first. Expanding a root queries children; expanding a leaf queries **only one page**
   of loans.
2. Query keys include grouping, filters, parent path, user authorization scope, `snapshotVersion`, and `riskRunId`;
   never cache or reuse another tenant's data.
3. Loan edits are reflected after reporting projection synchronization and carry an `asOfUtc` / `snapshotVersion`. The
   prototype's seeded/simplified sync may lag and must say so in README/UI.
4. Risk ratings always come from the **last completely published run**; the UI displays `publishedAtUtc` and a separate
   queued/running/failed status while the worker processes the next run.
5. Inconsistent versions across expanded nodes trigger an explicit refresh. No promise of perfectly pinned multi-request
   snapshot behavior is made for the timeboxed prototype.
6. Redis is **not required** in the prototype. If caching is added later, keys contain tenant + authorization scope +
   query + snapshot + published run version; invalidate on source updates and run publication.

## 8. Tests to write before considering the contract implemented

- SQL/API: both grouping levels, `COUNT/SUM/AVG`, exact decimals, null groups, null interest rate, tenant-qualified
  joins, duplicate loan numbers across _different_ tenants, invalid dimensions, wrong `subgroupBy`, pagination and
  consistent filters.
- Worker: every boundary case in §5.4, deterministic last-six ordering, fewer-than-six payments, invalid principal,
  duplicate job idempotency, partial-run failure, atomic publication, calculation isolation between tenants.
- API security: forbid client-supplied `TenantId`; deny unauthorized divisions and foreign `jobId`; verify tenant A/B
  with overlapping group keys; validate OIDC/JWT and CORS as configured.
- React: root fetch, lazy expand, group change cancellation, stale/error/empty/refresh status, accessible buttons and
  correct decimal formatting without client-side regrouping.
- Mendix: actual embedded widget and loan create/view workflow (manual Studio Pro smoke check if runtime automation
  unavailable).

## 9. Open decisions / non-goals

**Needs explicit stakeholder approval before production:** final status lifecycle, risk formula and version governance,
origin/meaning of borrower-level rating, handling missing payment history, interest-rate unit, currency and
weighted-average semantics, charge-offs/refunds/reversals, payment posting vs due dates, effective-dated rate changes,
source-of-truth balance refresh, division-level authorization, reporting projection update protocol, guaranteed read
snapshot and retention rules.

**Not required for the 6–8-hour prototype:** multi-currency financial normalization, arbitrary-depth group trees,
distributed queue/broker, external cache infrastructure, production underwriting approval workflow, full financial
ledger, or direct cross-service access to Mendix's internal SQL schema. **Do not silently implement these as if they
were specified.**

## 10. SQL implementation mapping (2026-10-30)

This section governs the `/sql` implementation and supersedes older illustrative physical names in architecture.md.
It changes no API routes, JSON keys, enum values, risk thresholds or decimal-string serialization. Money storage is
`DECIMAL(18,2)`; annual fractional interest storage is `DECIMAL(7,4)`. API rates may retain the illustrated eight
fractional digits by decimal formatting/casting; SQL AVG must be cast to sufficient scale before averaging.
`BalancePrincipalRatio` remains `DECIMAL(18,8)` because it is neither money nor an interest rate.

### 10.1 Physical schema and relationships

All ten tables are application-owned `analytics` tables, never Mendix-generated internals: `Tenants`, `Divisions`,
`LoanOfficers`, `Borrowers`, `Loans`, `PaymentHistory`, `LoanPortfolio`, `RiskJob`, `RiskScoreStage`, `RiskPublication`.
`Divisions`: `(TenantId, DivisionId)` PK, `DivisionName NVARCHAR(100) NOT NULL`.
`LoanOfficers`: `(TenantId, LoanOfficerId)` PK, `LoanOfficerName NVARCHAR(150) NOT NULL`.
Both IDs are UNIQUEIDENTIFIERs, both tables reference Tenants; no officer-to-division exclusivity is assumed.
Loans use nullable DivisionId/LoanOfficerId composite FKs; the reporting projection keeps the existing nullable
Division/LoanOfficer labels. Labels need not be unique; they are reporting dimensions, not authorization identifiers.
Every tenant-owned relationship uses TenantId in its FK. LoanPortfolio references Loans and Borrowers. RiskJob has
unique `(TenantId, RunId)`; scores reference that run and the projection loan. Publication references the tenant's run.
All TenantId columns are NOT NULL and indexed. Loan numbers are unique per tenant in Loans and LoanPortfolio.

### 10.2 Publication and access boundary

`analytics.PublishRiskRun(@TenantId, @RunId, @SourceSnapshotVersion)` is the only publication entry point for the worker
role. It runs one transaction, locks the tenant publication row and job, validates a RUNNING job with a current lease,
progress and exact score/active-loan counts, policy version and per-loan input versions, then updates publication and
marks the job SUCCEEDED atomically. It rejects a regressing watermark or an older job than the published job. A retry
of the currently successful publication is a no-op. Validation failure rolls back and retains the old publication;
the worker separately records FAILED. The caller supplies its captured MAX(SourceVersion) watermark; the procedure
requires that it still matches the current active projection. Source writers must increment each affected loan's
SourceVersion in the same transaction as any changed scoring input, including payment facts. Concurrent source/stage writes are blocked during
validation by HOLDLOCK; a changed snapshot must be retried, not partially published.
Published/successful score rows are immutable. A trigger prevents later stage edits; the worker role cannot write
RiskPublication directly. Database owners/admins remain trusted. This phase provides publication SQL, not a scheduler,
HTTP service or scoring implementation.

`analytics.PublishedLoanPortfolio` LEFT JOINs the tenant's publication and scores by TenantId, RunId and LoanId.
No publication or no score gives SQL NULL LoanRiskRating: API detail `loanRiskRating: null`, grouping `key: null`,
label `Unrated`. Seed creates no scores/jobs/publication pointer. Borrower ratings never supply missing loan ratings.

Tenant-qualified FKs prevent cross-tenant references; indexes do not authorize reads. RLS is deferred (ADR-008).
Every application SELECT/UPDATE/DELETE must use identity-derived TenantId, including queries of the reporting view.
SQL roles separate reporting reads from stage/job writes; external authentication/connection integration is future work.

### 10.3 Seed and rerun semantics

`--count` is total loans across two fixture tenants, at least two; odd counts give tenant A one extra loan.
There are five divisions and twenty officers per tenant. `--seed` controls local PRNG, UUIDs and values; dates use the
fixed 2026-10-30 fixture date, never the machine clock. Money/rates use Decimal. Fixtures include null groups/rates,
zero balances, INDIVIDUAL/CORPORATE borrowers, all statuses and payment histories of zero to twelve posted rows.
Distributions are synthetic demo choices, not underwriting/lifecycle rules. IDs/loan numbers/group labels overlap
between tenants to exercise composite keys. Batch insertion uses parameterized statements, an enclosing transaction,
and tenant-qualified insert-if-absent checks; reruns never overwrite existing source records or published results.
Changing count/seed against an occupied fixture namespace is rejected rather than silently mixing datasets. Use a fresh
database for a different dataset. Migration reruns create missing objects without dropping or rewriting existing data;
these initial scripts are not a general drift-repair/migration framework.

## 11. Flask risk service (2026-10-30)

This implementation adds analytics-flask; it does not alter the existing SQL tables, procedure, enums or Spring Boot
routes. The pure scorer returns High/Medium/Low and the repository explicitly maps them to HIGH/MEDIUM/LOW for SQL.
Its input is LoanInput: PrincipalAmount and CurrentBalance are finite Decimal values, DaysPastDue is a nonnegative
integer, Status must be ACTIVE, and LatePaymentsLastSix/PaymentRowsInspected are integers with
0 <= late <= inspected <= 6. Missing history is represented by inspected=0, never an invented six payments. The risk
threshold uses unrounded Decimal division (precision 50); only the audit ratio is rounded to SQL DECIMAL(18,8).

### 11.1 Internal HTTP contract

- POST /risk/runs: bearer authentication, risk:run permission, empty JSON object, Idempotency-Key required (1-120
  printable ASCII characters without surrounding whitespace). Returns 202 {runId,status,requestId}; same key returns
  that existing run without creating another, including terminal runs. A new key is required for a new calculation.
- GET /risk/runs/{runId}: risk:read permission; returns runId, jobId, status, processedLoans, totalLoans,
  startedAtUtc, completedAtUtc, errorCode, requestId. Null timestamps/errors remain null. Foreign/unknown runs: 404.
- GET /health: 200 {status:ok}, liveness only. Request/validation/auth errors use the existing error envelope.
- Strict UUID validation; no request may select tenantId. Other responses: 400 invalid, 401 unauthenticated,
  403 insufficient permission/tenant outside configured allowlist, 409 another QUEUED/RUNNING run, 429 submission
  cooldown, 503 dependency/lock timeout. Submit and status return JSON, no SQL/exception/financial details.
- Development authentication is explicitly enabled by RISK_AUTH_MODE=development-jwt, a >=32-byte HS256 secret,
  fixed issuer/audience, mandatory exp/iat/sub/tenantId/permissions claims and a configured tenant allowlist. Algorithm
  is pinned; expiry and issuer/audience/signature are verified. Only risk:run/risk:read permissions are accepted.
  No production authentication mode is implemented; production requires a trusted issuer, asymmetric keys/rotation,
  HTTPS and a reviewed service delegation/OIDC integration. HTTP is localhost-only for the demo; CORS is not enabled.

### 11.2 Ownership and publication protocol

All service mutations (submit, claim/reclaim, reset, stage/progress, heartbeat, failure and publication) acquire the
same short SQL session application lock for the tenant, public DB principal, resource risk-service:{TenantId}.
Session locks are released before returning the connection. Claim increments existing Attempts, sets RUNNING and a
lease using SQL UTC time. Every owned mutation locks/checks the job's TenantId, RunId, Attempts, RUNNING status and
unexpired lease before changing anything. Reclaim increments Attempts; old claim handles can no longer mutate/publish.
Publication holds that same lock across ownership verification and an autocommit PublishRiskRun call. Reclaim cannot
interleave in the ownership-check/procedure gap. No lock is held for the entire computation, so expired claims recover.
The existing procedure still owns completion and the atomic pointer change. Its direct EXECUTE privilege is trusted
service infrastructure; a malicious process using worker credentials can bypass application fencing (production
hardening would require an owner-aware stored-procedure contract, which this phase intentionally does not change).

A fresh attempt clears only its unpublished stage rows and resets progress. A serializable read transaction captures
active input values, versions, MAX(SourceVersion), and SQL-ordered last-six payment counts; it releases source locks
before scoring. The small prototype keeps this minimal input snapshot in memory, reads with fetchmany(batch size),
and heartbeats while capturing. Source writers must honor section 10.2's same-transaction version protocol. Publication
rejects a subsequent change; changed snapshots/permanent validation errors fail, never auto-reclassify or partially
publish. Recovery takes a fresh snapshot rather than mixing attempts. TotalLoans is populated by the worker; queued
jobs initially have zero total/processed counts. Empty active populations publish a valid empty run with watermark 0.

Default operational settings: batch 1000, lease 120 seconds, poll 2 seconds, max claim attempts 3, transient SQL tries 3,
statement timeout 15 seconds, login timeout 5 seconds, submission cooldown 10 seconds. Settings are bounded and
configurable. Heartbeat at least once per batch and periodically during scoring. SIGTERM/SIGINT request a safe stop;
owned jobs fail with WORKER_STOPPED where cleanup succeeds; hard termination/DB outage leaves an expiring lease.
Each transient retry uses a fresh connection and bounded backoff. Uncertain stage commits replay idempotently;
uncertain publication is reconciled against SUCCEEDED/publication, never overwritten as FAILED. Lost ownership stops
processing without modifying the new owner's job. Attempts exhausted on recovery become FAILED. Failed jobs remain
visible; retry with a new idempotency key. Successful jobs and historical scores remain immutable.

### 11.3 Deployment and scheduling

Dedicated API login: SELECT/INSERT RiskJob only plus standard application-lock execution. Worker login: existing
analytics_worker role; neither is an owner or SA. Administrative provisioning is a separate environment-driven command.
SQL credentials and signing secrets are injected; Docker runs non-root. Public worker/HTTP logs contain requestId,
verified tenantId, runId, state, batch/progress, duration and fixed error codes, never tokens or loan/payment fields.

Worker and scheduler operate only on operator-configured authorized tenant IDs; no unscoped all-tenant job discovery.
The standalone scheduler --once command uses the same submission path and a UTC interval bucket idempotency key.
Its optional loop defaults to 86400-second intervals; host cron can instead invoke --once at an explicitly chosen time.
It is not embedded in Flask workers and is not an extra always-on Compose service. The selected nightly time and
upstream balance-refresh ordering remain operator responsibilities; scheduling does not recalculate balances.

## 12. Spring reporting service (2026-10-31)

The Spring Boot application lives in spring-boot and uses Java 17 / Spring JDBC. Existing SQL tables, indexes,
PublishedLoanPortfolio and PublishRiskRun remain unchanged. Every reporting data query reads PublishedLoanPortfolio
with a verified tenant predicate; job/publication metadata reads also bind that tenant. No staging table is queried
by Java. A separate account belongs only to the existing analytics_reader role.

### 12.1 Authentication and endpoint additions

The explicitly enabled development-jwt contract is shared: HS256, existing issuer/audience/tenant allowlist, required
exp/iat/sub/tenantId/permissions claims. The known permission vocabulary adds portfolio:read; risk:read and risk:run
checks are unchanged. Existing token-tool defaults remain risk:read + risk:run; portfolio:read must be requested
explicitly. Portfolio permission alone never grants risk submission or risk-status access.

- GET /api/v1/portfolio/metadata requires portfolio:read. Response: dimensions [{value,label}], maxDepth:2,
  defaultStatus:ACTIVE, defaultLimit:50, maxLimit:100, currency:USD, rateUnit:fractionPerYear. Dimension values are
  division, loanOfficer, borrowerType and riskRating (not loanRiskRating).
- Existing groups/children/loans routes and JSON fields in section 6 require portfolio:read. Filters use exact enums,
  bounded labels and ISO dates. Unknown/repeated parameters, tenant overrides, unsupported sorting and invalid parent
  paths return 400. hasChildren describes a second grouping level; leaves fetch loans, including primary-only leaves.
- GET risk-runs/latest and GET risk-runs/{jobId} require risk:read. POST risk-runs requires risk:run, empty JSON and
  Idempotency-Key. POST forwards the original verified bearer token to the configured internal Flask URL, then resolves
  the tenant-qualified RunId to JobId. No unrestricted delegation credential or caller-selected tenant is used.
- Health-only Actuator liveness/readiness endpoints are anonymous and expose status only. Other API errors retain the
  section 6 envelope with a generated requestId; no SQL, tokens or connection details are exposed.

Group results are returned for the selected level only. The prototype's low-cardinality dimensions have a safety cap
of 100 groups; a larger result returns GROUP_LIMIT_EXCEEDED (400), never silently truncates. Group paging is deferred;
loan paging is implemented with the existing 50 default / 100 maximum. Null keys remain null; only presentation labels
use Unassigned or Unrated. Rates serialize as eight-place fractional decimal strings; money as two-place strings.

### 12.2 Response consistency and cursors

snapshotVersion is the current tenant-wide MAX(SourceVersion), or 0 for no source rows. It is a source watermark,
not a risk version or a globally unique portfolio revision. asOfUtc is MAX(LastSyncedUtc), null before any source row.
riskRunId is the current tenant publication UUID, null before first publication (including for empty populations).
Readers display current source facts with the last successful loan-risk publication, as in the existing view.

A reporting response executes one SQL statement containing both metadata and the requested aggregates/page. At startup
Java inspects the existing RCSI setting. With RCSI enabled this uses one versioned READ COMMITTED statement; when it is
disabled, HOLDLOCK hints on the source view and publication metadata provide statement-duration serializable reads.
Autocommit and a bounded query timeout release locks as soon as that statement completes. No database isolation option
is changed; no read transaction encloses an HTTP call or spans frontend requests. HTTP latency and publication visibility are exercised in integration tests; no claim of zero publication contention
is made.

Loan order is LoanNumber ASC, LoanId ASC (SQL Server comparison rules). Opaque HMAC-SHA256 cursors contain tenant,
canonical filter/group-path fingerprint, position, source watermark/as-of, publication UUID and expiration. A separate
>=32-byte environment key signs them. Defaults: cursor lifetime 900 seconds, max 3600. Malformed/expired/foreign-scope
cursors return INVALID_CURSOR (400); changed source/as-of/publication returns SNAPSHOT_CHANGED (409), requiring refresh.
Data may change between requests; watermark/as-of cannot prove a permanently pinned snapshot or detect nonconforming
upstream writes. Source writers must advance versions and refresh LastSyncedUtc. No snapshot-management tables are added.

### 12.3 Operational limits

Default read query timeout 5 seconds, JDBC login/connect timeout 5 seconds, Hikari pool maximum 5 connections, per-tenant
in-process request limit 120/minute. Limits are configurable and bounded; the per-instance limiter is not distributed.
CORS defaults to no allowed cross-origin access and uses an explicit configured origin list when enabled. Development
HTTP binds localhost only; production still requires HTTPS/OIDC/secret rotation and reviewed tenant/division scopes.
