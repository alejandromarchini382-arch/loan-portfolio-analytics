# Submission checklist and readiness

Final executed evidence: [validation report](final-validation.md), [compact results](validation-results.json),
[requirements matrix](assessment-requirements.md), [setup](setup.md) and [five-minute walkthrough](demo-walkthrough.md).
Publication readiness is tracked separately from implementation and validation.

## Independent decisions

| Evaluation | Decision | Reason |
| --- | --- | --- |
| Engineering deliverable | READY WITH LIMITATIONS | Implemented analytics/widget/browser path tested and reproducible within disclosed development limits |
| Original assessment | INCOMPLETE | Required Mendix application, operational management, embedded runtime and application MPK missing |

The official widget MPK is built/validated, not an app export. Studio Pro import/runtime is NOT RUN. The browser demo
is not Mendix. The supplied PDF explicitly requires the app and its package; only the reviewer can accept a substitute.

## Review-ready artifacts

- SQL migrations/indexes, deterministic generator, Flask worker/API, Spring reporting and their source/tests.
- Actual widget source, XML/typings/editor assets, pinned dependencies and official releases/ MPK.
- Restricted browser host, real/mocked/synthetic tests, reviewed masked screenshots and exact fresh evidence.
- Safe .env.example, complete setup, architecture, requirements matrix, demo/interview walkthroughs and limitations.

Fresh validation: 72 Jest cases, 12 proxy/server cases, 6 launcher unit cases, 22 Node HTTP scenarios and 22 Playwright
cases (14 mocked / 7 real / 1 synthetic). Do not present these as a completed Mendix application test or add historical
backend reruns to make a larger number. Current SQL volume/publications and credentials were preserved.

## Necessary before submission

1. Decide with the reviewer whether widget MPK + browser demo is accepted in place of the mandatory Mendix app/export.
   If not, the missing app must be delivered under a separate approved scope; do not claim it already exists.
2. Review setup verification limits: isolated frontend install/build succeeded, full new backend installation/initial
   publication was not rerun. Current fixture is 1,500 total / 1,334 active, not the stated 1,500+ active context.
3. Resolve confidentiality/visibility and repository licensing. Generated widget Apache declaration is not a root
   ownership grant. Source third-party notices are included; public distribution still needs review.
4. Review the historical AGENTS.md presence. It is currently untracked/ignored; no secret was detected in history.
   History rewriting requires explicit separate approval and was not performed.
5. Review Git diff/status and all intended files, ignore exclusions, package metadata and evidence. Nothing is staged.
   Then authorize the desired commit/publication explicitly. Do not use git add . without file review.

## Runtime and remaining limitations

Use setup.md's existing-environment path, build preview and run demo.py --mode real --port 3099 with fresh restricted
credentials. Stop with Ctrl+C. Never expose the demo publicly, publish access files, enable risk mutation for routine
checks, reset data or rotate the SQL volume password. Production identity/HTTPS, RLS, hostile-credential isolation,
operational synchronization, installed nightly scheduling and load/accessibility certification remain future work.
[Deferred Mendix instructions](mendix-integration.md) are unverified integration guidance, not a delivered application.

Recommended commit message after review: `docs: finalize AXIS analytics assessment submission`.
Provide a GitHub repository link only after candidate authorization and visibility/confidentiality review; do not create
an automatic public release. The reviewer disclosure draft is in demo-walkthrough.md and has not been sent.
