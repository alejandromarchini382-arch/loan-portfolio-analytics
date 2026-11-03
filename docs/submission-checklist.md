# Submission checklist and integration handoff

The implemented browser demonstration deliverable is a localhost real-backend browser demonstration of the actual widget components.
See [executed evidence](browser-demo-validation.md), [reviewer instructions](../widget/README.md#browser-demonstration)
and the [official widget package](../widget/releases/axis.loanportfolio.AxisLoanPortfolio.mpk).
It is not a Mendix application. Studio Pro was intentionally excluded from browser demonstration.

## Ready to review

- Existing SQL/Flask/Spring services and persistent fixture were preserved; four Docker services healthy.
- Real browser SQL-backed grouping, nested expansion, signed pagination, filtering and published-risk display.
- Server-side JWTs, opaque expiring sessions, fixed proxy allowlist, CSRF, tenant and permission checks.
- 72 existing widget tests, 12 demo-server cases, 22 browser cases (7 real / 14 mocked / 1 synthetic),
  and 22 real backend HTTP scenarios passed in the recorded runs.
- Official MPK validated, production widget payloads unchanged; redacted local screenshots and setup instructions.

## Required before claiming the original assessment complete

1. Use an authorized real Mendix app and compatible Studio Pro; record exact versions and prerequisites.
2. Implement/verify actual operational loan CRUD and app security/tenant associations under approved app scope.
3. Import the official widget and bind a trusted nonpersistent session context. Browser demo codes/proxy are not the
   production Mendix integration. Follow [deferred Mendix handoff](mendix-integration.md); retain server-derived tenant
   and permissions, and test renewal/logout/user changes without cached-data leakage.
4. Demonstrate runtime rendering, origin/HTTPS/CORS, all grouping/pagination/filter flows and authorized risk behavior
   in that app. Use isolated data for mutation/failure scenarios; never reset the persistent fixture for screenshots.
5. Implement/verify operational-to-analytics synchronization and SourceVersion updates if required by the actual app.
   Existing fixture/reporting evidence does not prove synchronization.
6. Export the actual Mendix app deliverable, keep it distinct from the pluggable-widget MPK, and record real acceptance
   results. Do not describe an untested application or export as complete.
7. Review repository contents and package artifacts, licenses/setup docs, secrets/PII exclusions and known limitations.
   Run relevant regression checks after any later code changes. Publish/commit/push only with explicit authorization.

## Current operational notes

Start the backend without replacing data, build preview and launch `widget/scripts/demo.py --mode real --port 3099` as
shown in widget/README.md. Open the private code file locally and authenticate at http://127.0.0.1:3099. Credentials expire
within 15 minutes of startup; relaunch as needed. Default profiles cannot submit risk jobs. Stop with Ctrl+C; do not
expose the listener publicly, upload raw reports/access files or store tokens in browser storage. Synthetic mode is
separate and clearly marked. All screenshot captures are local; any later publication requires an explicit review.

Final readiness: browser demonstration, widget package and backend slice ready for assessment review. Complete Mendix
application integration and final submission remain outstanding. Repository publication is a separate release step.
