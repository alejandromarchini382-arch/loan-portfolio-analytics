# browser demonstration - Mendix integration handoff

The repository includes widget source and the official MPK. No real Mendix application exists in this checkout; mendix-app/
contains a placeholder only. Import, runtime rendering and trusted Mendix-to-Spring authentication have NOT been tested.
The CLI baseline is Mendix SDK 11.16.0/React 19.3.1/tools 11.15.0. Start with compatible Studio Pro 11.16.x/React client,
record its exact version, and verify compatibility rather than treating this target as certification.

## 1. Import and place the package

1. Open/create the authorized assessment app in compatible Studio Pro. Record version and runtime prerequisites.
2. Build/verify using widget/README.md; the artifact is widget/releases/axis.loanportfolio.AxisLoanPortfolio.mpk.
3. Copy it into the actual app's widgets directory. Keep the filename/ZIP structure; do not unpack or rename it.
4. Use App > Synchronize App Directory (F4 where available). Confirm AXIS Loan Portfolio appears in the toolbox.
5. Create a protected analytics page with a Data View around the widget. The widget XML needs an entity context.
6. Configure the properties below. Enable React client compatibility; avoid deprecated global mx APIs.
7. Run the app locally and inspect browser console/network for runtime/import errors before claiming success.

Example copy from repository root (replace only the actual app directory):

```powershell
Copy-Item widget/releases/axis.loanportfolio.AxisLoanPortfolio.mpk '<actual-app-directory>/widgets/'
```

## 2. Provide a trusted session context - REQUIRED, NOT IMPLEMENTED

Create a small nonpersistent AnalyticsSession context entity, with these suggested attributes:

| Attribute | Mendix type | Purpose |
| --- | --- | --- |
| AccessToken | String | Short-lived bearer token for the verified logged-in caller |
| SessionScope | String | Opaque user/tenant/authorization/login scope identity for cache ownership |
| CanReadRisk | Boolean | UI hint derived from actual authorized roles |
| CanRunRisk | Boolean | UI hint derived from actual authorized roles |
| TokenExpiresAt | DateTime, optional | Host-side renewal scheduling |

Protect the page/context with appropriate module/entity/microflow access and the actual application roles. Never share
one global session object or bearer across users. Supply it through an authorized Data View source flow. Do not expose
tokens as editable page fields or persist them in a database, localStorage or a widget constant.

The source/renewal flow must derive tenant and permissions from authenticated SERVER context and a reviewed lender-user
association. Ignore browser-submitted TenantId, Can* flags, SessionScope or requested permissions when minting/delegating
claims. The actual Mendix role/tenant mapping remains an application security decision.
A guessed session scope is never accepted by Spring as authorization. The API verifies the token on every call.

For the development-only HS256 backend, a separately reviewed server-side bridge must issue/delegate a short-lived token
using the existing configured issuer/audience and permitted claims. No unrestricted issuer or public token endpoint is
provided. Signing secrets belong only in trusted server configuration. Production requires a proper OIDC/token exchange
integration, including corresponding backend verification work; the current development verifier is not an OIDC claim.
For isolated development, inject an authorized test provider in a harness; never bake shared bearer tokens into the MPK.

## 3. Bind widget properties

Inside the AnalyticsSession Data View:

| Widget property | Binding/example |
| --- | --- |
| apiBaseUrl | Trusted HTTPS API base; local example http://127.0.0.1:8081 |
| title | Loan Portfolio Analytics |
| primary | division |
| secondary | loanOfficer or none |
| pageSize |50 (maximum 100) |
| showRisk |true only when this page should show eligible controls |
| accessToken | String expression $currentObject/AccessToken |
| sessionScope | String expression $currentObject/SessionScope |
| canReadRisk | Boolean expression $currentObject/CanReadRisk |
| canRunRisk | Boolean expression $currentObject/CanRunRisk |
| renewSession | Authorized flow/action that updates this object's bound token/session fields |

Use the expression editor's actual context variable if it differs from $currentObject. The generated SDK passes these
as DynamicValue<string/boolean>. The renewal action returns no token to JavaScript; the host updates the object and
Mendix rerenders with new values. Same-session token renewal preserves pending idempotency intent. Login/logout, tenant
association or role/scope changes must clear AccessToken and rotate SessionScope; this tears down all cached data,
polling and pages before the new identity is displayed. Permission hints are presentation only and may not authorize
API calls. Missing session bindings show a configuration message and make no requests.

## 4. Connectivity and CORS

Both browser and API must be reachable from the user's machine. Browser localhost means THAT browser's machine;
container service names such as spring-boot-api are not browser URLs. Real deployments require HTTPS and a trusted origin.
Set PORTFOLIO_CORS_ORIGINS in ignored local environment to the exact Mendix origin, such as http://localhost:8080.
http://127.0.0.1:8080 is a different origin; allow it only if actually used. No wildcard or browser signing secret.
Then apply the existing Spring service configuration without deleting data:

```powershell
docker compose --profile risk --profile backend up -d --no-build --wait spring-boot-api
docker compose ps
Invoke-RestMethod http://127.0.0.1:8081/actuator/health/readiness
```

Configure the actual Mendix origin before using these commands. The browser demonstration does not verify Mendix-origin CORS.
Current SQL host port is11433 due Windows reservations; this does not affect widget HTTP requests. Never delete the SQL
volume, rotate existing credentials casually or reseed a published fixture for frontend integration.

## 5. Manual acceptance and evidence

Record each as PASS/FAIL/NOT RUN with exact app/Studio Pro/browser versions:

- Package import/toolbox discovery and recognized properties.
- Runtime rendering inside the real Mendix page, including a loading and empty/error state.
- Trusted login token delivery, renewal, logout and user/tenant change without cached-data leakage.
- Browser metadata/groups requests from the actual Mendix origin with Authorization and no caller-selected tenant.
- Four dimensions, distinct secondary grouping, keyboard expansion, null groups, leaf loans and Previous/Next cursors.
- Decimal display, complete-root totals and separate source/publication timestamps; no fabricated overall rate.
-401 session renewal,403 forbidden reporting/risk controls, cross-tenant job404 and cursor rejection.
- Authorized risk submission with a new idempotency key; preserve the same key for ambiguous retries. Do not trigger
  jobs automatically from setup. Observe QUEUED/RUNNING, old publication retained, success refresh and failure retention
  using explicitly authorized or isolated fixtures. Existing latest jobs have no invented jobId.
- Responsive layout, visible focus, table headers and screen-reader expansion/status announcements.

Capture actual screenshots/network evidence with tokens/borrower data redacted. Record browser CORS separately from
Node HTTP tests. Complete Mendix loan CRUD and any synchronization as part of the operational application implementation; the reporting
fixture is not proof of operational-to-analytics synchronization. Export/package the actual Mendix app when it works.
CLI packaging checks do not establish Mendix runtime compatibility; record actual application-level acceptance results separately.
