# Group browsing implementation

## Review follow-up: 2026-10-27

All 15 findings in `REVIEW_other-additions_2026-10-27.md` are addressed.
Scope and Review Status filters are now included, following the user's updated
decision. The stage notes below record the original implementation and its
earlier deferrals; this section describes the current behavior.

Group issues receive bounded, cancellable custom-field enrichment by project,
including missing values in existing caches. Oversized GraphQL batches split
adaptively when GitLab rejects their complexity. Facets use the complete index.
Scope labels match case-insensitively; Review Status uses the custom field.
Both support multi-selection, empty values, grouping, shared URLs and presets.

All issues is the default lens. Lists include the full indexed selection; graphs
start at 200 nodes with progressive expansion and explicit Render all confirmation.
Project/subgroup browsing works within the loaded index. Explorer visibility is
persisted, project names are relative to the selected group, and containment
arrows have an independent toggle, hidden by default.

Older GitLab schemas discover epics through bounded, paginated descendant-group
enumeration and per-namespace Work Item queries. Partial coverage is reported
when a namespace is inaccessible or a request budget is exhausted. Normal group
incremental and closed-history refreshes avoid per-project request fanout.

Issue and relationship caches are partitioned by a token fingerprint and verified
account, with access checks and periodic full synchronization. Plaintext tokens
are not cache keys. Completed link observations survive cancellation; link
retrieval follows pagination. Coverage distinguishes fresh observations from
unscanned issues, and context issues distinguish outside-group membership from
absence in the index.

Validation: 305 tests passed, one existing test skipped; production build and
standalone bundle/hash smoke checks passed. A Chromium integration test exercises
the built HTML with a mocked API, cross-project IID collisions, custom fields,
both new filters, relative project paths and Explorer visibility. Live internal
browser testing against the configured test group loaded 255 indexed issues across 21
projects and confirmed populated Priority, Scope and Review Status menus without
custom-field warnings. Credentials remained in the browser. Root `index.html`
matches `dist/index.html`.

The new push/PR validation workflow runs tests, build, bundle/hash verification
and the mocked Chromium test, then uploads the HTML and checksum. Remote GitHub
Actions execution has not been observed in this local work session.

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
the configured test group loaded 254 issues, kept Graph on switching to Group, restored
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
Live localhost testing against the configured test group indexed 254 of 254 issues,
reported 39 dependency-blocked issues and zero unknown states or request
failures, and preserved these counts after reload in the main view and Kiosk.
A narrow graph selection displayed directed cross-project blocking arrows.
Scope and Review Status filters remain deferred by request.

## Stage 3 — epic and Work Item hierarchy

Group mode now offers an on-demand epic index and recursive descendant loading.
The Work Item GraphQL adapter probes capabilities, supports cached complete
introspection schemas, paginates index and child connections, and keeps Work
Item GIDs separate from legacy Epic IDs and REST issue IDs. Existing group
issues are reused by project path and IID. The optional task toggle traverses
issue children. Graphs show epics and direct contains links; lists show issues
and tasks. New and external descendants are read-only and external items carry
qualified references.

Unsupported Work Item capabilities fall back explicitly to legacy Epic REST
endpoints with a compatibility warning. Requests are cancellable; source changes
and late responses cannot restore a stale hierarchy. Bounded results, missing
permissions, pagination problems, and partial expansion produce warnings.
Clearing the epic restores the current group dataset and view. Scope and Review
Status filters remain deferred. Stage 4 explorer controls are not included.

Validation: 266 tests passed, one skipped; production build passed and regenerated
root index.html. Automated fixtures cover three projects, a subgroup epic, an
external-group child, direct parentage without sibling import, task expansion,
pagination, limits, legacy fallback, ID separation, invalid responses and
cancellation races. Live internal-browser testing on localhost against
the configured test group discovered epics through Work Items and loaded a test epic:
five closed issues and one epic, with five
contains links. List and graph views, task toggle and clearing were exercised.
The live example has no external descendants; those are fixture-tested. This
GitLab schema lacks explicit subgroup-discovery control; the UI reports that
limitation. No credentials were copied from browser storage.

## Stage 4 — slice explorer

Added epic, scope-label, blocked-work and full-group issue-search slices without
replacing the group index. Slices support zero to two dependency hops and
upstream, downstream or both directions. Facet filtering retains dimmed,
read-only dependency context unless Strict filters is enabled. Hierarchy,
dependency and combined layers hide related links. Epic collapse summarizes
issue states, projects and active blockers and projects boundary edges.
Project lanes are enabled by default; the alternative layout remains available.
Node and edge budgets disclose truncation and allow showing more nodes.
Parent breadcrumbs, relationship freshness and coverage, cancellation, retained
positions and refresh-preserved epic selection/collapse are included. Dedicated
Scope and Review Status facet filters remain deferred as requested.

Validation: 278 tests passed, one skipped. Production build regenerated both
dist/index.html and root index.html. Live internal-browser testing against
the configured test group covered a test epic (five closed issues), collapse/expand and
refresh retention, layer switching, two-hop enrichment, list and graph views,
full-group search across projects, scope slices, and blocked work (59 issues
across 12 projects, 39 actively blocked in the loaded snapshot). A title filter
retained three graph nodes with dependency context and one with Strict filters.
Dimmed context and directed blocking links were visually checked. Coverage is
reported as partial when relationships are not fully scanned or are bounded;
existing GitLab schema capability warnings remain visible. Credentials stayed
in the browser.


## Stage 5: hardening

REST pagination validates forward progress and malformed responses. The project
directory has a 500-page budget, the shared group index/fallback budget is 1,000
pages, and epic loading has a 300-request budget. Each request has at most four
attempts; 429/Retry-After and transient errors back off. Abort interrupts both
requests and retry delays. Source changes abort index loads; selecting another
slice cancels relationship work. Late cancelled scans cannot overwrite newer
observations or their cache.

Relationship scans retain four workers, at most 100 issues per visible scan and
2,000 per explicit group scan, with a 15-minute freshness TTL. Larger groups
can run another bounded scan to continue stale coverage. Permission failures
invalidate the affected cached observation; partial index state survives reload
and appears as a warning. The index has its own incremental refresh; link
refresh is independent because link edits need not change issue timestamps.

The default graph presentation is capped at 200 nodes and 400 edges, with
visible omissions and progressive Show more. The position cache retains at most
2,000 entries. Browser Configuration / Cache / Clear site data clears IndexedDB,
local storage, session storage, settings and API keys, after confirmation. This
control is browser-only; its destructive path was verified with mocked storage.

Validation: 290 tests passed, one skipped. The synthetic scale test loads 200
projects and 10,000 issues in 102 successful REST page requests, then verifies
that only 200 nodes and 400 edges are presented. A graph regression exercises
fit, reset, slice replacement and unmount at that size. These are deterministic
regression checks, not a hardware performance benchmark. Other tests cover 429
backoff, cancellation during retry, 403 responses, pagination budgets, corrupt
caches, revoked access and late scan races.

The rebuilt standalone page was checked in the internal browser at localhost
against the configured test group: index refresh, blocked-work graph, visible-link refresh,
full scan cancellation/resumption, and cache restoration after reload. The final
snapshot had 254 indexed issues, 254 fresh relationship observations and 39
actively blocked issues. The graph remained usable while scanning. Credentials
remained in the browser. Production build succeeds and root index.html matches
dist/index.html.

Deployment-specific Work Item hierarchy/custom-field availability, permission
coverage and cross-origin policy still depend on the GitLab installation. The
existing capability/partial-data warnings remain visible; unsupported hierarchy
widgets do not imply complete group coverage. Scope and Review Status were
deferred at this stage and were added in the review follow-up above.
