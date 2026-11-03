# AXIS — Accepted Decisions and Assumptions

**Decision register version:** `0.5.0` — assessment prototype.
**Detailed rationale:** [`architecture.md`](architecture.md).  
**Authoritative fields, API shapes, calculations and enums:** [`data-contract.md`](data-contract.md).

This file is the short, stable decision checklist for contributors. The assessment PDF takes
precedence over all internal documents. **If these files disagree, stop and resolve the conflict before implementing
behavior.** The field/API/risk definitions in `data-contract.md` supersede illustrative snippets in `architecture.md`.

| ID      | Decision                                                  | Status                   | Constraint                                                                                                                                                                                                               |
| ------- | --------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-001 | Aggregate in SQL Server                                   | Accepted                 | SQL `GROUP BY`, safe dimensions allowlist, exact decimal arithmetic; do not aggregate entire loan portfolio in React.                                                                                                    |
| ADR-002 | Lazy load group levels                                    | Accepted                 | Root groups → requested child groups → paged loans. Only two grouping levels in prototype.                                                                                                                               |
| ADR-003 | Use a thin Spring Boot API                                | Accepted                 | Verified identity, tenant scope, allowed parameters, SQL group queries; no bulk Java in-memory aggregation.                                                                                                              |
| ADR-004 | Separate Mendix records from reporting projection         | Accepted                 | No direct SQL against Mendix-generated tables. Seeded SQL projection acceptable for prototype; document sync gap.                                                                                                        |
| ADR-005 | Flask worker + SQL Server-backed job table                | Accepted                 | Nightly and authorized on-demand scoring; no CPU-heavy work in a UI HTTP request.                                                                                                                                        |
| ADR-006 | Atomic risk-run publication                               | Accepted                 | Publish only when full active-loan snapshot succeeds; old results remain available during a run.                                                                                                                         |
| ADR-007 | Tenant isolation on all layers                            | Accepted                 | `TenantId` on every table, identity-derived server side, tenant-qualified keys/joins, tests with two tenants.                                                                                                            |
| ADR-008 | SQL Server Row-Level Security                             | Future hardening         | Require safe verified per-connection tenant context (especially with pooling) before enabling.                                                                                                                           |
| ADR-009 | No Redis/RabbitMQ/Kubernetes in the prototype             | Accepted                 | Add only when workload and operating requirements justify them.                                                                                                                                                          |
| ADR-010 | `risk-demo-v1` explicit policy                            | **Prototype assumption** | **High:** DPD ≥60, or DPD ≥30 and balance/principal >0.90. **Medium:** otherwise DPD 15–59 or ≥2 late payments in last six. **Low:** otherwise. Full precedence and edge cases in data contract §5. Not lender-approved. |
| ADR-011 | Scoring does not fabricate balances                       | Accepted                 | Balance recalculation belongs to the authoritative upstream process; worker reads updated balances. The assessment provides no balance formula.                                                                          |
| ADR-012 | Simple interest-rate average, one currency                | **Prototype assumption** | Annual fractional rates; unweighted AVG of non-null rates; USD only. Confirm before production.                                                                                                                          |
| ADR-013 | Loan vs borrower ratings stay separate                    | Accepted                 | `riskRating` API dimension means **calculated loan** rating; `BorrowerRiskRating` remains a distinct field.                                                                                                              |
| ADR-014 | SQL Server 2022 / Java 17 / Spring Boot 3.x / Python 3.11 | Selected baseline        | Reconfirm exact patch/tool compatibility at project creation; record versions in README and lockfiles.                                                                                                                   |
| ADR-015 | Prototype scope                                           | Accepted                 | Deliver a functional Mendix app + real embedded widget + SQL aggregation + secured Spring Boot API + Flask risk path + tests and Docker Compose within the 6–8-hour coding timebox.                                      |

## Unresolved questions (do not silently answer in code)

1. Approval of the lender's true risk policy, source of borrower risk rating, treatment of missing or reversed payment
   history, and what happens to non-active loans.
2. Source and update frequency of authoritative balances and operational-to-reporting data synchronization.
3. Actual lender status taxonomy, currency mix, meaning of interest rate, and whether averages should be weighted.
4. Exact Mendix authentication/OIDC token exchange and authorized division scopes.
5. Whether source snapshot consistency is required across multiple lazy-loading requests.

**Implementation guidance:** When work is blocked by one of these unknowns, ask for clarification. If the work is explicitly a
demonstrator and a documented assumption is already provided in `data-contract.md`, implement **that exact assumption**,
label it clearly and test it; do not invent another one.

## SQL implementation decisions (2026-10-30)

- **ADR-016: Owned SQL layer in /sql.** Ten tables in analytics; normalized Divisions and
  LoanOfficers referenced by tenant-qualified FKs, plus the existing denormalized LoanPortfolio reporting contract.
  These are owned projection/fixture tables, not a second writer to Mendix internals. SQL storage uses DECIMAL(18,2)
  money and DECIMAL(7,4) annual fractional rates. Existing API/enums/risk-demo-v1 remain unchanged. See contract section 10.
- **ADR-017: Guarded atomic publication.** PublishRiskRun validates full active coverage and source versions in one
  locking transaction, switches the pointer and completes the job together. Immutable published scores and restricted
  SQL roles prevent worker writes bypassing the pointer procedure. Failed validation keeps the prior run. A real worker,
  snapshot capture, lease acquisition and scheduler are outside this SQL-only phase.
- **ADR-018: Reproducible fixtures.** Default 1,500 total loans across two tenants; 15,000 supported. Fixed dates,
  seeded UUIDs/PRNG and Decimal values. Insert missing identical fixture rows in batches in one transaction; reject
  different datasets in the same fixture namespace. Never reset existing scores/publication during seeding.
- **ADR-019: Minimal local SQL infrastructure.** Docker Compose adds SQL Server 2022 only, persistent storage and
  environment-injected credentials. Explicit initialization commands; no automatic destructive database reset.
  RLS remains deferred: FK isolation is enforced, all application queries still require verified tenant scope.

## Flask implementation decisions (2026-10-30)

- ADR-020: Flask endpoints are internal service routes, separate from the preserved Spring Boot contract. Pure scoring
  uses title-case labels; an explicit boundary mapping preserves SQL enums and risk-demo-v1 without policy changes.
- ADR-021: Reuse Attempts plus leases as claim fencing, with short per-tenant SQL session application locks around
  every mutation and the ownership-check/publication sequence. No table/procedure changes. See contract 11.2 for the
  trusted-worker boundary and fresh-snapshot recovery; no claim of protection from malicious worker credentials.
- ADR-022: Development-only HS256 JWT validation is explicitly enabled and fails closed on bad configuration. Tenant
  and permissions come from verified claims and operator allowlists. Production identity integration remains deferred.
- ADR-023: Separate least-privilege API/worker logins, explicit admin provisioning, environment-injected secrets,
  standalone worker/scheduler, existing SQL queue and atomic publication. No broker, Celery, Redis or new tables.
- ADR-024: Keep only required input fields in a consistent in-memory snapshot for the 1,500/15,000-row prototype;
  process/stage configurable batches after releasing source locks. Large-scale persistent snapshots are deferred.

## Spring reporting decisions (2026-10-31)

- ADR-025: Java 17, Spring Boot 3.5.x, JDBC and a read-only reporting login; no JPA/entities, new risk calculation,
  database objects, cache or background job system. Maven Wrapper and Java 17 build tooling leave host Java 23 unchanged.
- ADR-026: Explicit portfolio:read vocabulary addition with unchanged risk:read / risk:run boundaries and legacy token
  defaults. Public risk POST delegates the verified token to Flask; job/run IDs are mapped in tenant-qualified SQL.
- ADR-027: One SQL statement per reporting response combines metadata and data. Use existing RCSI when enabled,
  otherwise bounded statement-duration HOLDLOCK; no new database snapshot setting or cross-request transaction.
- ADR-028: HMAC cursor binds tenant, group path, filters, position, expiry and source/publication metadata. Watermark
  and published risk identity stay distinct; no guaranteed multi-request portfolio snapshot is claimed.
- ADR-029: Keep two levels and existing routes; add metadata for the widget. Bound groups at 100 with an explicit error
  on overflow, paginate loans at 50/100. Larger group pagination and production OIDC/RLS remain deferred.

## Mendix widget decisions (2026-11-03)

- ADR-030: Use the real official Mendix web widget generator in widget/, retaining entrypoint, XML, generated typings,
  preview and official packaging commands. Generator 11.13.0's template accepts tools ^11.11.0 and React ^19; tools
  11.15.0 satisfies that range. Both declare Node ^22.18.0, but the resolved native packaging dependency requires >=22.20 within Node22.
  Validation uses a checksum-verified local Node22.23.4 and npm11.20.0, leaving host Node22.18 unchanged. Pin installed direct versions
  and retain package-lock.json. Initial target is the Mendix 11 React client; runtime compatibility remains unverified
  until a compatible Studio Pro application is available. Prove minimal MPK packaging before dashboard implementation.
- ADR-031: Small React hooks own query-scoped state, cancellation and version checks; no Redux or extra cache framework.
  Use official Jest/React Testing Library tooling instead of the previously proposed Vitest setup. Test commands and
  README follow the actual generated layout. Cached data and pending operations are cleared on identity changes.
- ADR-032: Authentication is an injectable provider, adapted from supported dynamic Mendix expressions for runtime
  access token/session scope and permission hints. An optional action requests renewal by updating bound properties;
  ActionValue.execute does not return a token. No signing/issuing tokens or persistent token storage in the widget.
  Permission hints affect UI only; Spring remains authoritative. Trusted Mendix authentication integration remains outstanding.
- ADR-033: Exact sums of complete root aggregate counts/balances are permitted for summary presentation; group rates
  remain authoritative API values. No overall average is invented without non-null-rate counts. Use decimal-safe
  arithmetic/formatting. Existing routes, enums, NULL flags, job/run distinction and publication rules stay unchanged.

## Browser demonstration decisions (2026-11-03)

- ADR-034: Extend the existing preview with explicitly separated synthetic and real modes. Both reuse PortfolioDashboard;
  the browser demonstration is not a Mendix application. Preserve the production widget authentication interface/MPK.
- ADR-035: A loopback-only demonstration server holds pre-authorized 15-minute JWTs in memory, obtained at startup through
  the existing local operator helper. Profile access codes protect opaque expiring HttpOnly/SameSite sessions. Browser
  memory holds a CSRF proof and opaque scope, never JWTs/signing secrets. No network endpoint mints arbitrary tokens.
- ADR-036: The demo-only fetch adapter removes the production client's internal Authorization header and uses same-origin
  session/CSRF transport. A strict route/method proxy attaches the JWT bound to that session; Spring still verifies tenant,
  signature, issuer/audience/expiry and permissions. No backend/CORS changes. Real-mode errors never become mock results.
- ADR-037: Chromium Playwright suites distinguish intercepted/mocked browser scenarios from real backend browser tests.
  Screenshots are redacted; bearer-bearing traces, HAR and authentication storage state are excluded. Existing backend data
  stays intact, risk mutations require explicit startup opt-in plus a separately authorized operator profile.
