# Assessment requirements and implementation traceability

Authority: **AIO_Logic_-_Senior_Full-Stack_Developer_Technical_Assessment.pdf**, six pages, supplied assessment located
outside the repository and reviewed locally. Page numbers below are PDF page numbers. The supplied PDF is not copied
into Git; permission to redistribute it or make this assessment repository public has not been established.
This matrix distinguishes explicit prototype requirements, discovery/design context and optional architectural choices.
Internal contracts explain implementation assumptions; they do not supersede the assessment.

Status meanings: COMPLETE = implemented with applicable recorded evidence; PARTIAL = only part of the requirement is
implemented; NOT IMPLEMENTED = required implementation absent; NOT VERIFIED = evidence insufficient; NOT APPLICABLE =
not required for this implementation, with a reason. Historical evidence is labelled; the final report records fresh runs.

| Requirement | Assessment requirement | Implementation evidence | Status | Gap |
| --- | --- | --- | --- | --- |
| Mendix core web application | Mandatory, pp.1,4 | mendix-app/.gitkeep only | NOT IMPLEMENTED | Acceptance blocker; browser demo is not Mendix |
| Manage and view loans in Mendix | Mandatory, p.4; exact CRUD operations not enumerated | No operational Mendix model/pages/microflows | NOT IMPLEMENTED | Acceptance blocker; SQL fixtures and read-only reporting do not supply loan management |
| React widget embedded in Mendix | Mandatory, pp.1,3-4 | widget/src, XML, generated typings, official tooling | PARTIAL | Widget built; Studio Pro import and embedded runtime not verified |
| Mendix application package | Mandatory source deliverable, p.5 | Only widget/releases/axis.loanportfolio.AxisLoanPortfolio.mpk | NOT IMPLEMENTED | Acceptance blocker; widget MPK is not an application export |
| Custom React widget source | Mandatory, pp.4-5 | widget/src, typings, package-lock.json | COMPLETE | Runtime integration remains a separate incomplete requirement |
| SQL storage | Required with built-in Mendix HSQL concession, p.1 | sql/001_schema.sql, 002_indexes.sql, SQL Server 2022 Compose | COMPLETE | Mendix managed operational storage is absent |
| Loan, borrower, operational and performance fields | Data context, p.2 | docs/data-contract.md, SQL projection and deterministic generator | COMPLETE | Fictional data only; no operational synchronization |
| Dynamic grouping | Mandatory, pp.2,4 | Spring allowlist/JDBC and PortfolioDashboard | COMPLETE | Browser evidence, not embedded Mendix |
| Borrower type grouping | Explicit example, pp.1,4 | borrowerType API/UI dimension | COMPLETE | Same runtime caveat |
| Loan officer grouping | Explicit example, pp.1-2,4 | loanOfficer dimension | COMPLETE | Same runtime caveat |
| Division grouping | Explicit nesting example, pp.2,4 | division dimension | COMPLETE | Same runtime caveat |
| Risk-rating grouping | Mandatory client need, pp.1-2,4 | PublishedLoanPortfolio, riskRating dimension | COMPLETE | Uses documented prototype risk policy, not a lender-approved rule |
| Nested grouping | Mandatory, pp.2,4 | Two distinct dimensions, lazy child endpoint | COMPLETE | Two levels; deeper arbitrary nesting not required by supplied examples |
| Loan count totals | Mandatory, pp.2-4 | SQL COUNT and response/UI tests | COMPLETE | Recorded tests are not a production capacity certification |
| Current balance totals | Mandatory, pp.2-4 | SQL SUM, DECIMAL(18,2), decimal strings | COMPLETE | USD-only prototype assumption |
| Average interest rates | Mandatory, pp.2-4 | SQL AVG of non-null annual fractions | COMPLETE | Unweighted average is an explicit assumption |
| Expand/collapse drill-down | Mandatory, pp.2,4 | GroupTable, LoanDetails, component/browser tests | COMPLETE | Mendix runtime still unverified |
| Loan pagination | Chosen means of efficient drill-down, not an explicit prescribed mechanism | Tenant-bound signed keyset cursor and limits 50/100 | COMPLETE | Data may change between requests; no permanent snapshot |
| Loan risk process | Mandatory, p.4 | Flask Decimal risk-demo-v1, separate worker, tests | COMPLETE | Policy thresholds were not supplied; demo assumption labelled |
| Nightly OR on-demand execution | Mandatory alternatives, p.4 | Authenticated on-demand API; standalone scheduler command | COMPLETE | On-demand exercised historically; nightly OS/cron installation not verified |
| Automated nightly deployment | Design discussion, p.3; implementation choice | risk.scheduler --once and configurable standalone loop | PARTIAL | No cron/scheduled task installed or demonstrated here |
| Asynchronous state and publication | Design question, p.3; chosen reliability mechanism | SQL queue, leases, staging, atomic PublishRiskRun | COMPLETE | Historical integration evidence; no live mutation in final audit |
| Balance recalculation | Design context, p.3; no formula supplied | Authoritative balances read, not recomputed | PARTIAL | Upstream ownership/formula unspecified; no invented lending rule |
| Operational-to-analytics communication | Design question, p.3 | Documented projection/source-version contract | PARTIAL | Live Mendix synchronization not implemented or verified |
| Tenant isolation | Explicit design question, p.3 | Verified claims, parameterized tenant queries, composite FKs, A/B tests | PARTIAL | Implemented service boundaries tested; entire Mendix stack absent; no RLS or malicious-service-credential isolation claim |
| Authentication/API protection | Explicit design expectations, pp.3-4 | Development JWT verifier, permissions, limited proxy | PARTIAL | Production identity/HTTPS/Mendix integration absent |
| 1,500+ active loans | Scale context, pp.1,3 | Existing demo: 1,500 total, 1,334 active; historical larger-fixture tests | PARTIAL | Demo does not contain 1,500+ active loans; do not reseed it to hide this |
| Approximately 10x growth | Design question, p.3 | Historical 15,000-total SQL/Flask/HTTP tests, limited sequential timings | PARTIAL | No production concurrency/capacity proof; tests are not load certification |
| Automated tests | Mandatory engineering expectation, p.4 | Python, Java, SQL, Jest, proxy, HTTP and Playwright suites | COMPLETE | Fresh versus historical results separated in final-validation.md |
| UI errors/backend logging | Mandatory expectation, p.4 | Safe errors/retry/cancellation, JSON risk logs | COMPLETE | No exhaustive production observability claim |
| Docker services and Compose | Mandatory when Python/Java services are used, p.4 | Existing Dockerfiles and docker-compose.yml | COMPLETE | Fresh-install verification has defined limits |
| Setup/design/trade-off README | Mandatory, p.5 | Root/component READMEs, setup and architecture docs | COMPLETE | Full clean-machine backend installation remains NOT RUN, explicitly disclosed |
| GitHub repository link | Mandatory submission method, p.5 | Local Git repository; repository publication not verified | NOT VERIFIED | Candidate must review and submit authorized link; visibility/confidentiality undecided |
| Flask microservice | Optional architecture component, pp.1,5 | analytics-flask implementation | COMPLETE | Optional choice does not replace Mendix requirement |
| Spring Boot middleware | Optional architecture component, pp.1,5 | spring-boot JDBC/reporting implementation | COMPLETE | Optional choice does not replace Mendix requirement |
| Redis/message broker/production OIDC | No mandated product; design alternatives, p.3 | Intentionally omitted, SQL queue and development verifier used | NOT APPLICABLE | Production hardening is future work, not a new assessment feature |

## Acceptance and next action

The required Mendix app, loan-management functionality, embedded runtime demonstration and application export remain
acceptance blockers. Engineering review of the browser/backend/widget slice is distinct from full assessment compliance.
The smallest legitimate next action is to disclose these gaps and request the reviewer's explicit acceptance of the
widget MPK plus browser demonstration as a substitute. Without that acceptance, do not call the original assessment
complete. The current deliverable does not include a Mendix application or application export.

Important disclosed limitations include development authentication, unverified clean installation, current fixture size
and synchronization. Production OIDC/HTTPS/RLS, distributed rate limits, retention and capacity testing are future
hardening choices. The final audit may refine evidence/status, but cannot waive mandatory requirements.
