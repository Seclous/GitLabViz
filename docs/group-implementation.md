# Group browsing implementation

## Stage 0: baseline

The baseline includes the existing Priority custom-field and case-insensitive
Type-label fixes. Dedicated Scope and Review Status filters are deferred at the
user's request.

`fixtures/group-baseline.json` contains synthetic projects with colliding issue
IIDs, a subgroup, external context, reciprocal dependency records, a closed
blocker, same-name nested epics, and a permission-denied endpoint. It contains
no production data or credentials. Project-mode regression tests use its first
project; subsequent stages can reuse the cross-project records.

Configuration > GitLab > Group capability diagnostics runs read-only checks
using the configured connection. Results distinguish permission denials,
unavailable endpoints, rate limiting, transport failures, and an unconfirmed
GraphQL schema. Schema availability alone does not prove work-item access.
The probe does not switch data sources or persist its report or credentials.

The next stages are identity/group loading, cross-project links, epic hierarchy,
slice UI, and hardening. Each stage must be reported separately before continuing.

## Stage 1: identity and group index

Project/Group selection now loads a project directory and paginated group issues,
including optional subgroups and shared projects. Switching sources preserves
the selected view. Group link and epic enrichment follows in later stages.

Issue nodes use global REST IDs with a project/IID fallback. Project-local IIDs
remain display values; group views and search use full project references. Legacy
project selections migrate where unambiguous; ambiguous group IID selections clear.
Version 2 caches isolate host, source and membership settings, retain the project
directory and sync cursor, and reject legacy identity maps. Cache exports use
the same versioned record. In-flight loads cannot restore another source's data.

Validation: automated identity, migration, pagination, source-isolation, duplicate-IID,
search and JSON export round-trip coverage. Live localhost testing against
example-team/example-group loaded 254 issues, kept Graph on switching to Group, restored
the cache after reload, found three different project issues numbered #42, and
matched a single issue by its full reference. Scope/Review Status filters remain
deferred by request.

## Stage 2 — relationship indexing and dependency blocking

Issue links are fetched using each issue's project ID and IID. Reciprocal
responses produce one canonical relationship: `blocks` is directed from blocker
to blocked issue, and `relates` is undirected. Cross-project endpoints retain
their canonical identities. Actual linked issues outside the loaded set appear
as marked, one-hop external context, with a budget of 100 external issues and
10,000 edges. Missing endpoints and omitted links are reported.

Relationships use a separate source-specific cache with a 15-minute freshness
window. Narrow visible selections (up to 50 issues) load automatically. Manual
visible scans allow 100 requests; explicit full scans allow 2,000, with four
concurrent requests. Progress, cancel, forced refresh, retry, stale coverage,
cache failures and partial results remain visible. GitLab retry handling applies
to relationship requests, including rate limits.

Dependency-blocked means an open issue has an indexed incoming `blocks` link
from an open issue. Closed blockers do not count; missing states are reported as
unknown. Kiosk shows these counts separately from the renamed Critical /
attention heuristic. Relationship state also restores when Kiosk opens directly.

Validation: 253 automated tests passed, one skipped; production build passed.
Live localhost testing against `example-team/example-group` indexed 254 of 254 issues,
reported 39 dependency-blocked issues and zero unknown states or request
failures, and preserved these counts after reload in the main view and Kiosk.
A narrow graph selection displayed directed cross-project blocking arrows.
Scope and Review Status filters remain deferred by request.
