# Changelog

All notable changes to Luke are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [3.0.0-rc.1] - 2026-10-05

### Added
- **storage**: Generalize MinIO provider to S3, swap stack to SeaweedFS ⚠️ **BREAKING**
- **storage**: Add automatic asset derivative pipeline (thumb/card/export)
- **calendar**: Brand-scoped visibility for calendar reads and notifications ⚠️ **BREAKING**
- **auth**: Admin bypass for LDAP/OIDC accounts disabled or deleted by AD
- **web**: Show last login instead of creation date in the users table
- **web**: Fail the build on a dialog input with no form around it
- Require a typed confirmation to delete a brand, season, vendor or user
- **web**: Fail the build on a raw useQueryClient
- **api**: Make the configured password policy authoritative everywhere
- **web**: Show the password rules the server will actually apply
- **agent**: Establish canonical documentation governance
- **tools**: Enforce documentation reachability
- **tools**: Enforce documentation anchors and index ownership
- **tools**: Enforce workspace README presence
- **rbac**: Derive parent sections from their children
- **calendar**: Count deadlines in the business time zone
- **api**: Run the backup schedule in the business time zone
- **api**: Validate and resolve each user's time zone
- **api**: Send each calendar digest at 07:00 in the recipient's zone
- **api**: Export the season calendar in the requester's zone
- **api**: Stamp exports in the requester's time zone
- **api**: Recover an administrator from the command line
- **tools**: Enforce ADR citations in the documentation checker
- **api**: Tell which field each input error belongs to
- **tools**: Add the canonical-language check to the docs checker

### CI
- **release**: Enforce release provenance and support rc trains
- Build the web app on every push
- Route documentation-only pushes to drift checks
- Add aggregate CI gate
- Add pre-merge security gate
- **release**: Add a checker binding the tagged tree to its tag
- **release**: Verify manifests and CHANGELOG in the provenance job
- Treat AGENTS.md as documentation-owned
- Retire the stale genoma PDF and its docs allowlist pattern
- **semgrep**: Catch typed raw Prisma calls and pdfmake 0.3 usage
- Fix stale gate comments, translate workflow prose, drop dead env
- **security**: Test every semgrep rule against its fixtures
- Prove what the runtime images contain
- **release**: Check each image before it is pushed

### Changed
- **core**: Extract the feedback submit schema from the router
- **core**: Extract the real vendor closure upsert schema from the router
- **core**: Drop the dead vendor closure schema and two stale claims
- **web**: Remove the ConfirmDialog prop nothing read
- **core**: Extract the calendar digest range schema from the router
- Let the restore form derive from its schema again
- **web**: Fold ConfigDeleteDialog into the shared ConfirmDialog
- **core**: Move UserIdSchema where the other four already live
- **web**: Mount a single TooltipProvider for the whole app
- **core**: Share the row-completion input schema with its dialog
- **core**: Share the milestone reason rule with the calendar dialog
- **web**: Derive the user form schemas from the create input
- **core**: Share the google and storage config schemas with their forms
- **api**: Stop treating the storage bucket list as configuration
- **core**: Narrow the storage config schemas to what actually reads them
- Apply the review pass on the schema-sharing batches
- **core**: Give the password rules one floor and one set of symbols
- **web**: Retire the user form's own copy of the password rules
- **api**: Retire the last hand-written copies of shared rules
- **core**: Express the password rule once, and derive its default
- **config**: Declare AppConfig fallbacks once and read them typed
- **config**: Declare config bounds and audit-metadata shape in one place
- **agent**: Remove cross-skill governance overlap
- **agent**: Make luke-test the monorepo QA control plane
- **agent**: Route findings by owner and drop the invented health score
- **auth**: Make cross-user updates default-deny
- **tsconfig**: Establish runtime-neutral configuration
- **api**: Publish a built type contract behind an exports map
- **web**: Stop shipping API source in the production image
- **about**: Remove the dependency version panel
- **db**: Split the Prisma schema into domain files
- **web**: Resolve actionable React hook warnings
- **release**: Make the git tag the sole release identity
- **core**: Drop the dead app.version AppConfig key ⚠️ **BREAKING**
- **web**: Remove the unused appConfig module
- **tools**: Translate documentation integrity checks
- **tools**: Translate skill integrity checker
- **api**: Remove dead exports and leftovers
- **api**: Remove unused JWT and secret-reading helpers
- **web**: Remove dead components, hooks and exports
- **core**: Remove dead exports and orphan modules
- **web**: Reuse shared download, phase sentinel and margin labels
- **api**: Remove the unused auth.logout, logoutAll and me procedures
- **api**: Remove the unused users.changeEmail procedure
- **api**: Remove the integrations.storage placeholder router
- **api**: Remove unused getById, exists and health.context queries
- **api**: Derive reaper buckets and import the token cache directly
- Bind LDAP strategies and edit-lock types to one source
- Use core types instead of re-spelled unions
- **api**: Drop the CORS AppConfig tier nothing fed
- **api**: Boot through the tested bootstrap check
- **web**: Send every server-side API call through forwardedFor
- **api**: Declare own-data procedures with selfProcedure
- Write developer-only error messages in English
- **api**: Check permissions, not role names, for maintenance, config and scope
- **web**: Drop unused role helpers, read the maintenance bypass from permissions
- **web**: Mount a single TooltipProvider
- **core**: Add zone-free calendar date helpers
- **api**: Share the all-day midnight rule between guard and clone
- **web**: Read each event's date once and share the Gantt geometry
- Reuse date formatters and compute each deadline day once
- **api**: Stop spelling storage buckets in the temp-file cleanup
- **web**: Compose ConfigKeyBadge classes with cn()
- **calendar**: Compute an all-day end in one place
- **core**: Drop the unused security.cors.developmentOrigins AppConfig key ⚠️ **BREAKING**
- **api**: Declare the LDAP resilience defaults once
- **core**: Declare the landed-cost chain and margin status once
- **core**: Give every pricing mode one implementation
- **core**: Leave the LDAP resilience bounds to the registry
- **pricing**: Give margin mode, SKU weighting and the default target one implementation
- **web**: Read each menu entry from its own section
- **api**: Recover administration through settings.users alone
- **api**: Read the administrators once per kill-switch write
- **tools**: Ask the release tree for one path
- **api**: Name the one recovery section
- **api**: Drop the log serializers nothing wired in
- **core**: Keep one rule for the brand name
- **web**: Drop the Next config nothing uses
- **web**: Drop the maintenance placeholder page
- **web**: Link the sidebar routes without casts
- **web**: Call sonner directly instead of useToast
- **web**: Format config dates in the user's zone
- **core**: Remove the unused getConfigValue reader
- **core**: Remove the unused LDAP and NAV config response schemas
- **web**: Drop the unused canAll and canAny permission helpers
- **web**: Check brand permissions through usePermission

### Dependencies
- **deps**: Bump dependencies within existing majors
- **deps**: Bump remaining safe majors, revert @fastify/multipart regression
- **deps**: Remove the unrestricted bulk-upgrade command
- **deps**: Drop unused dependencies and inert overrides
- **deps**: Drop the one-shot URL codemod and ts-morph
- **deps**: Ignore the braces advisory until it has a fix

### Documentation
- Translate CLAUDE.md, lessons.md and luke-* skills to English
- **lessons**: Archive fully-enforced lessons, add archival policy
- Add ADR-013 for the asset derivative pipeline
- Add /luke-deps skill for dependency and toolchain updates
- Record that a Radix close-button cannot be a form's submit button
- Record what the dialog migration taught, and three places to apply it
- **web**: Translate a smoke-test comment left in Italian
- Note that writing a rule down is not applying it everywhere
- Note that a green hook is not a green pipeline
- Restore the v2.0.0 export hotfixes dropped from the CHANGELOG
- State when a permission tooltip is grouped, and when it is not
- Record the payload seam the schema move cannot reach
- Scope B5, the batch for what is not a schema move
- Fold the review findings into B5
- **test**: Record why the brand logo specs fail under load
- **governance**: Close agent platform audit v3
- **audit**: Track monorepo architecture audit source document
- **audit**: Record monorepo audit disposition baseline
- **audit**: Record SEC-A remediation
- **platform**: Remove stale operational assertions
- **audit**: Record cycle 2 remediation
- **audit**: Record ESLint activation
- **audit**: Record BUG-B remediation
- **audit**: Record runtime globals hardening
- **audit**: Record BUG-B retrospective remediation
- **audit**: Record module contract closure
- **audit**: Record turbo graph closure
- **audit**: Record neutral tsconfig architecture
- **release**: Reserve breaking labels for supported contracts
- **audit**: Record release-control closure
- **audit**: Record v2.1.4 publication
- **audit**: Record Cycle 9 package-contract closure
- **audit**: Record Cycle 10 dependency-boundary closure
- Point the Prisma workflow at packages/db
- **audit**: Record Cycle 11 Prisma ownership closure
- **audit**: Record Cycle 12 Prisma schema split
- **audit**: Record H1 web warning closure
- Document the documentation-only CI path
- **audit**: Record path-aware CI closure
- **audit**: Record H2 hygiene closure
- **platform**: Record pnpm Catalogs hold
- **release**: Document the tree checker as the release authority
- **release**: Document explicit targets and minimum bumps
- **audit**: Record release provenance hardening
- **lessons**: Record the inline arguments rendering trap
- **lessons**: Correct skill probe evidence counts
- **audit**: Record skill mode isolation closure
- **agent**: Add Codex project instructions
- **audit**: Record release identity consolidation
- **audit**: Record app.version removal
- Remove stale AppConfig documentation
- **adr**: Define documentation architecture and canonical language
- **tools**: Translate shared checker comments
- Rebuild documentation navigation
- Connect repository documentation hubs
- **audit**: Close S-01 aggregate gate enforcement
- Refresh repository readme
- **db**: Document database package
- **api**: Refresh generated readme sections
- **web**: Refresh generated readme sections
- **core**: Refresh generated readme sections
- **nav**: Refresh generated readme sections
- **calendar**: Refresh generated readme sections
- **eslint**: Refresh generated readme sections
- **adr**: Supersede ADR-006 with ADR-016
- **adr**: Supersede ADR-007 with ADR-017
- **adr**: Supersede ADR-008 with ADR-018
- **adr**: Supersede ADR-009 with ADR-019
- **skills**: Retire pending ADR 006–009 status notes
- **adr**: Translate ADR-001 to English
- **adr**: Translate ADR-002 to English
- **adr**: Translate ADR-003 to English
- **adr**: Translate ADR-004 to English
- **adr**: Translate ADR-005 to English
- **adr**: Translate ADR-010 to English
- **adr**: Translate ADR-011 to English
- **adr**: Translate ADR-012 to English
- **adr**: Supersede ADR-001 with ADR-020
- **ops**: Correct master-key rotation guidance
- **api**: Clarify backup key rotation limits
- **adr**: Supersede ADR-010 with ADR-021
- **rbac**: Correct section-access guidance
- **adr**: Supersede ADR-003 with ADR-022
- **adr**: Supersede ADR-004 with ADR-023
- **config**: Correct viewValue access guidance
- **adr**: Supersede ADR-005 with ADR-024
- Retire obsolete integrations roadmap
- Archive historical setup status
- Retire obsolete AppConfig guide
- Retire obsolete API setup guide
- Reduce operations guide to verified runtime protections
- **agent**: Add session economy and review contract to Codex instructions
- Translate Prisma migration and RC clone runbooks
- Correct Google Calendar setup to the AppConfig flow
- Translate architecture docs and retire the brand flow map
- Archive the TARIC classifier proposal
- Retire consumed task files and document country-aware working days
- Retire stale Markdown outside docs/
- **api**: Fix stale comments and dangling references
- **web**: Fix stale comments and dangling references
- Fix stale references in core and eslint-plugin-luke
- **db**: Fix stale Prisma schema comments
- Add lessons postscript on evidence-to-verdict drift
- **api**: Point the error-formatter note at OPERATIONS.md
- **api**: Describe the in-memory stores as FIFO, the rate-limit cascade without env
- Archive the rate-limit maps lesson now that a test enforces it
- **adr**: Supersede ADR-016 with ADR-026
- **skills**: List every test tier and toolchain config
- **api**: Document the repair of all-day dates stored off midnight
- **lessons**: Claim only what holds by construction over an external system
- **rbac**: Record section access in ADR-027
- Record that runtime images carry runtime dependencies only
- **readme**: Use the template headings in three package READMEs
- **nav**: Correct the NAV package README and integration guide
- **nav**: Translate the remaining Italian comments in the NAV package
- **db**: List the analytics entities on NavSyncFilter.entity
- **web**: Move the frontend guides into the web README
- **api**: Rewrite the API README in English and correct its drift
- **ops**: Correct the rate-limit notes and add three operator runbooks
- **readme**: Slim the root README into an English landing page
- **audit**: Append Appendix Y closing two backlog items
- **lessons**: Add the caffeinate rule and a cd recurrence note
- Correct six statements the phase-11 review found
- **adr**: Supersede ADR-015 with ADR-030 for historical records and errata
- Retire the Italian brand management audit report
- Retire the Italian setup snapshot from the archive
- Retire the Italian what-if engine and solver records
- Translate the archived TARIC classifier proposal
- **changelog**: Translate the Italian entries of past releases
- **adr**: Supersede ADR-017 with ADR-031 for presigned upload buckets
- **adr**: Supersede ADR-023 with ADR-032 for decrypted config reads
- **adr**: Append errata to ADR-018, ADR-024 and ADR-027
- **adr**: Fix three statements in the unpushed ADR texts
- **adr**: Append errata to ADR-011, ADR-012 and ADR-013
- **adr**: Append errata to ADR-018, ADR-019, ADR-020 and ADR-029
- Correct drift the full documentation audit found (NAV, API, web)
- Correct drift the full documentation audit found (ops, README)
- Correct drift the full documentation audit found (guides)
- Archive the implemented Collection Genome analysis
- Quote the remaining product UI labels as code
- Correct ten statements the 11b review found
- **adr**: Record release identity, versioning contract and trains
- **audit**: Open Appendix Z for the cycle closure
- Retire a train branch at its stable tag, remotely by the owner
- Slim the AppConfig and env sections of CLAUDE.md
- Point CLAUDE.md and the RC clone doc to ADR-020 for derived secrets
- Slim the remaining CLAUDE.md sections to their rules
- Reduce the CLAUDE.md release section to its rules
- Split the Claude Code and Codex sides of their collaboration
- **audit**: Close the cycle in Appendix Z

### Fixed
- **web**: Fix broken feedback dialog and add GitHub issue sync
- **docs**: Keep skill-check-ignore marker on the referenced line
- **api**: Restore fastify to 5.12.1, fix trustProxy hop-count regression
- **api**: Migrate deprecated @opentelemetry/instrumentation-fastify to @fastify/otel
- **api**: Update argon2 type usage for 0.45, drop now-redundant cast
- Attach cause to re-thrown errors, drop a dead null init
- **web**: Fix Docker build - drop stale api project reference, raise build heap
- **deps**: Sharp 0.35.4 bump had no effect - update the override too
- **api**: Update references to renamed vitest configs, drop __dirname in .mts
- **api**: Restore audit log metadata and attribute actor-less entries
- **api**: Serve raw browser-facing routes from proxied path prefixes
- **calendar**: Route season calendar exports through the proxied prefix
- **api**: Preserve the audit trail across a restore by merging it back
- **api**: Fail a restore that pg_restore only partially applied
- **api**: Check the pg_restore/server version pair before starting a restore
- **api**: Clear a redundant audit stash instead of dead-ending the restore
- **api**: Verify a backup is restorable before taking the instance down
- **web**: Stop nesting block elements inside the restore dialog description
- **api**: Keep a restore from overwriting the audit stash it just took
- **api**: Stop a restore from rolling back the state that describes it
- **api**: Close the gaps a review found in the restore work
- **web**: Keep confirmation dialogs from closing mid-mutation
- **web**: Focus the action on reversible confirmation dialogs
- **web**: Submit backup, digest and function dialogs as real forms
- **web**: Tag reversible confirmations as disable, not delete
- **web**: Restore dialog spacing lost when fields moved into a form
- **web**: Submit the backup export, import and config-delete dialogs on Enter
- **web**: Make the config delete dialog actually delete
- **web**: Stop reporting the config upsert probe as an error
- **web**: Submit the feedback, apply-template and clone dialogs on Enter
- **web**: Submit the planning-group and restore dialogs on Enter
- **web**: Submit the phase, catalog and vendor-closure dialogs on Enter
- **web**: Stop the vendor closure rows failing to render
- **web**: Submit the context gate's inline brand and season forms on Enter
- **web**: Submit the team and specsheet dialogs on Enter
- **web**: Submit the LDAP search-test dialog on Enter
- **web**: Submit the calendar event dialog and its sub-flows on Enter
- **web**: Report the missing reason instead of greying out the button
- **web**: Refresh the config list after a mutation
- **web**: Invalidate the alert thresholds after saving them
- **web**: Stop the specsheet gallery buttons submitting the whole form
- **web**: Surface a team's name error from whichever tab is open
- Align the TypeScript lib with the ES2022 target
- **api**: Drop an undecodable export photo instead of re-embedding it
- **web**: Make the tooltip on a disabled control reachable by keyboard
- **api**: Finish removing the storage bucket configuration
- **web**: Reject a date/time pair that does not describe an instant
- **web**: Close the holes the review found in the user form net
- **core**: Make a boolean config setting switchable off
- **rbac**: Take config permissions away from editor and viewer
- **web**: Make the password checklist agree with itself, and stop retyping the rule
- **config**: Make AppConfig writes answer to the registry
- **api**: Make audit metadata drift fail loudly instead of storing [REDACTED]
- **security**: Make local SAST chain fail closed
- **agent**: Align governance files after the refactor
- **agent**: Bind invocation arguments explicitly in scoped skills
- **auth**: Protect privileged user identity changes
- **calendar**: Acquire wizard locks only after targets resolve
- **web**: Pre-bundle deps the PlanningWizard browser test needs
- **deps**: Patch mysql2 decompression vulnerability
- **web**: Preserve wizard lock across query refetches
- **core**: Make module exports format-correct
- **release**: Correct the graduation path and close the gate's fail-open
- **deps**: Update qs, raise the fast-uri floor, declare @fastify/proxy-addr
- **api**: Validate the proxy address instead of trusting a hop count
- **build**: Rebuild every emitting workspace from a clean state
- **build**: Capture dist-scripts in the turbo build outputs
- **build**: Order db typecheck after client generation
- **calendar**: Preserve local dates across timezones
- **collection**: Preserve row drawer state across sessions
- **settings**: Make Google OAuth callback handling idempotent
- **release**: Prepare explicit targets from the topological base
- **agent**: Isolate luke-docs modes and bind invocation arguments
- **release**: Bake the normalized release version into both images
- **deps**: Raise js-yaml and nodemailer past GHSA-2883-xcg3-v3hh and GHSA-8m3c-c648-2xjj
- **tools**: Handle deleted documentation in integrity checks
- **agent**: Audit working-tree changes before staging
- **api**: Derive S3 buckets from shared list
- **api**: Remove the unauthenticated integrations.test mutation
- **web**: Use PermissionTooltip for the brand dialog's locked fields
- **api**: Remove the unused raw backup download route
- **api**: Remove the legacy generic storage flow
- **api**: Remove config.get and merchandisingPlan.addImage
- **api**: Report unexpected backup preflight failures as server errors
- **api**: Let 4xx tRPC messages reach clients in production
- **web**: Show a rate-limit message instead of the server diagnostic
- **config**: Share the config-key rules between API and settings UI
- **config**: Keep config.delete inside the router prefixes
- **config**: Accept a named SMTP sender on save again
- **api**: Validate LDAP search and template inputs with core schemas
- **api**: Weight PDF export margins by SKU like the web
- **api**: Enforce brand scope on merchandising plan procedures
- **auth**: Fall back to local login when LDAP cannot complete
- **api**: Stop caching failed mutations under an idempotency key
- **core**: Count working days with the calendar-days convention
- **api**: Copy photos into the revisions bucket for automatic revisions
- **api**: Repair the photos of existing automatic revisions
- **api**: Keep client uploads out of the revisions bucket
- **seed**: Stop marking every unverified user as verified
- **api**: Audit failed mutations as FAILURE
- **api**: Drop the environment tier of rate-limit policies
- **api**: Keep the Google OAuth connection whole when no email returns
- **api**: Serialize a manual NAV sync with the scheduled one
- **auth**: Validate LDAP settings against the registry on save
- **api**: Surface incomplete integration settings as preconditions
- **web**: Show readable messages where production masks a 5xx
- **api**: Check what a merchandising row points at
- **web**: Count calendar days by date, not by 24-hour spans
- **api**: Share the LDAP circuit breaker across logins
- **calendar**: Let the template dialog clear a description
- **api**: Check brand scope on collection row picture uploads
- **core**: Create the master key atomically
- **calendar**: Send all-day events with an exclusive end date
- **api**: Resolve the local storage root once, reaper included
- **api**: Keep one trace id per request
- **web**: Forward the client IP on the authed server-side tRPC client
- **web**: Forward the client IP on the image proxy and token refresh
- **web**: Drop links to routes that do not exist
- **deps**: Let fast-json-stringify resolve fast-uri 4, range the jaeger pin
- **api**: Require company_profile:update for presigned uploads
- **rbac**: Require read permissions on shared-data queries
- **api**: Report missing Google OAuth settings as a precondition failure
- **rbac**: Reserve hard delete of brands, seasons and vendors to admins
- **deps**: Bump fast-uri and ip-address past new advisories
- **web**: Place calendar events on their own dates in every time zone
- **web**: Read all-day dates as dates in the event form and wizard
- **web**: Give an evening event with no end an end after its start
- **api**: Name phase-alert deadlines as calendar dates
- **api**: Refuse all-day dates off midnight and stale date writes
- **api**: Escape user text in email HTML
- **api**: List motivated reschedules in the calendar digest
- **api**: Keep one out-of-range audit date from failing a digest
- **api**: Record the old all-day kind in update audit rows
- **api**: Compare phase deadlines by day in the order warning
- **db**: Hold calendar dates to the years the date helpers read
- **core**: Store and read time zones in the case Intl spells them
- **api**: Refuse a calendar move based on dates that changed meanwhile
- **web**: Reload the calendar list on every stale-write refusal
- **api**: Run one tick per scheduler lock per process
- **auth**: Keep the stored LDAP bind DN when the form sends it empty
- **auth**: Classify LDAP failures by origin and guard only the service bind
- **web**: Tell an unavailable or throttled login from wrong credentials
- **auth**: Answer an LDAP outage as unavailable, and audit it as one
- **auth**: Let local administrators in under ldap-only when LDAP does not
- **api**: Write audit rows for callers with no request
- **api**: Let a process that imports the SSE store exit
- **deps**: Bump nodemailer 9 -> 10.0.12
- **deps**: Clear the next, fastify, grpc-js and brace-expansion advisories
- **api**: Guard the storage settings on settings.storage
- **rbac**: Migrate parent-section overrides and validate role defaults
- **web**: Edit section access without hidden or stale writes
- **api**: Save each settings form as one transaction
- **api**: Reserve an idempotency key while its request runs
- **merch**: Serialize writes to a specsheet's images
- **merch**: Answer a row write naming a deleted parameter set with 400
- **merch**: Answer an upload racing its specsheet's deletion with 404
- **api**: Tell a missing storage object from a failed read
- **api**: Snapshot a layout whose row photo is gone
- **api**: Carry no release identity in an untagged image
- **release**: Retire a train that can no longer graduate
- **release**: Graduate a train only from its last candidate's tree
- **release**: Re-prove a graduation's tree on the tag it publishes
- **release**: Refuse to prepare a version whose notes are committed
- **api**: Write the photo-repair audit through logAudit
- **api**: Stop 4xx messages naming routes, limits and permissions
- **pricing**: Give every margin view one formula and one status rule
- **pricing**: Undo tools before QC in the inverse calculation
- **pricing**: Compute the BT with the multiplier the prices are made with
- **pricing**: Accept a retail multiplier to the cent
- **api**: Name the full path of every input issue
- **pricing**: Report how many variants a season copy actually created
- **api**: Name the photo-repair keys for that flow alone
- **api**: Say which bucket tripped the rate limit
- **deps**: Bump @fastify/busboy to 3.2.2
- **api**: Ship only production dependencies in the API image
- **web**: Ship the standalone Next server in the web image
- **api**: Keep the unit tests out of the build output
- **ci**: Harden the image check after review
- **web**: Show the pricing and collection layout links only with their sections
- **tools**: Read the release CHANGELOG only from a regular file
- **core**: Trim brand, season and vendor names before checking them
- **web**: Search vendors on the server in the row drawer
- **api**: Make db:bootstrap run on Prisma 7
- **tools**: Prompt for the backup passphrase instead of reading argv
- **core**: Store a cleared vendor nickname as no nickname
- **web**: Take a picked vendor's parameter sets from the pick
- **tools**: Open the backup before asking, ignore control keys
- **storage**: Stop sending the S3 secret key to the browser
- **storage**: Keep the S3 secret within the write and audit the save
- **deps**: Range the protobufjs override, drop sharp's and valibot's
- **tools**: Judge overrides by what is installed, read their file as YAML does
- **auth**: Prove the password before answering for a pending account
- **auth**: Tell a proven login its email is still unverified
- **auth**: Request email verification only for the signed-in account
- **auth**: Run argon2 for unknown users too
- **api**: Change the email only through me.changeEmail
- **rbac**: Log every permission and section refusal the same way
- **rbac**: Retire adminProcedure
- **auth**: Review follow-ups on the block D auth flows
- **auth**: Let a login refused for an unverified email ask for a new link
- **tools**: Tighten the canonical-language check after review

### Maintenance
- **docker**: Publish SeaweedFS filer UI port in dev compose
- **infra**: Bump pnpm to 11.24.0, Node to 24 (Active LTS)
- Rename vitest configs to .mts, sync next-env.d.ts
- Anchor semgrep path filters to the repo root
- **api**: Add the test:integration:local script its own docs referenced
- Typecheck before push, including the projects the build skips
- Drop the sharp type shim, obsolete since 0.35.4 ships its own types
- **web**: Reject a tooltip a keyboard cannot reach
- **agent**: Define platform governance and skill ownership
- **agent**: Harden skill execution contracts
- **infra**: Put the deterministic control plane under lint and typecheck
- **infra**: Add deterministic platform drift gate
- **docs**: Index every ADR and make completeness deterministic
- **lint**: Activate Next and React framework rules
- **lint**: Scope globals by runtime
- **web**: Drop the @luke/calendar dependency the runtime policy forbids
- **tools**: Enforce workspace dependency direction as a layer and runtime policy
- **lint**: Make workspace imports match their declarations
- **web**: Classify proxy.ts as Node and correct stale route comments
- **db**: Move Prisma ownership and runtime packaging into @luke/db
- **core**: Remove the unused Prisma client dependency
- **workspace**: Remove the inert tools workspace glob
- **agent**: Enforce canonical skill argument binding
- Prune dead ignore, lint and turbo configuration
- Translate developer-facing tool messages to English
- Finish half-translated comments
- Translate config, shell and CI comments to English
- **api**: Translate lib diagnostics and scheduler logs to English
- **api**: Translate backup pipeline logs to English
- **api**: Translate service logs to English
- **api**: Translate router logs to English
- **api**: Translate server lifecycle and bootstrap logs to English
- **api**: Translate operator script and seed output to English
- **web**: Translate lib and hooks comments, debug logs and test titles to English
- **web**: Translate component comments and debug logs to English
- **web**: Translate product page comments to English
- **web**: Translate settings and calendar page comments to English
- **web**: Translate remaining app comments and debug logs to English
- **nav**: Translate sync logs and comments to English
- Translate core, db and tools comments and test titles to English
- **api**: Translate the last Italian log messages
- Translate the Italian comments the language sweep missed
- Refuse emitting builds while pnpm dev runs in the worktree
- **husky**: Lint before a push and allow one release tag per push
- **husky**: Reject a Co-Authored-By trailer
- Remove the unused root docker-compose.yml
- **security**: Enforce rule 13 with a semgrep rule
- **security**: Semgrep rules for API URLs, confirm, env, Prisma.raw
- **security**: Block procedures without requirePermission
- **platform**: Check every Prisma relation for onDelete and a leading index
- **web**: Require an explicit type on native buttons
- **lint**: Forbid @prisma/client outside @luke/db
- **platform**: Check that an emitting Turbo watch task waits for its own build
- **lint**: Refuse a JSDoc block stacked on another one
- **security**: Refuse citations of gitignored planning items
- **security**: Make the tRPC error-cause rule blocking
- Drop duplicate and hazardous package scripts
- **security**: Pin that the error-cause rule covers a bare catch
- Ignore the agent files next dev writes into apps/web
- **tools**: Refuse an exact or unexplained pnpm override
- **tools**: Refuse an override capped below a consumer

### Performance
- **build**: Simplify turbo task graph
- **db**: Index the 16 foreign keys that had none
- **api**: Stop rebuilding a settled digest cohort every tick
- **web**: Declare the channel arguments after the shared layers

### Tests
- **api**: Align the me-router uncovered-procedure count with reality
- **api**: Ensure the schema exists before seeding the restore spec
- **web**: Catch a permanent delete shipped without its confirmation
- **web**: Pin the user form's behaviour before its rules change
- **api**: Cover the motivated milestone reschedule and cancel
- **api**: Move the five hand-rolled calendar fixtures onto the shared helper
- **api**: Harden the calendar fixture and finish the reason coverage
- Close the five gaps mutation testing found in the password work
- **web**: Add typed browser component test tier
- **agent**: Add regression fixtures for skill integrity checker
- **tools**: Gate the @luke/api package contract and the dev bootstrap
- **api**: Make procedure coverage teardown fail closed
- **rbac**: Cover section access fallback
- **web**: Pre-bundle next/image for the browser test suite
- **api**: Translate the procedure-coverage gate to English
- **api**: Translate test titles and comments to English (1/4)
- **api**: Translate test titles and comments to English (2/4)
- **api**: Translate test titles and comments to English (3/4)
- **api**: Translate test titles and comments to English (4/4)
- **web**: Translate smoke suite comments and titles to English
- **calendar**: Translate test titles and comments to English
- **api**: Translate the remaining Italian test text
- Translate the remaining Italian test text in web and packages
- **web**: Pre-bundle the popover and command libraries for browser tests

## [2.1.6] - 2026-09-12

### Fixed
- **web**: Build API declarations before the web image

### Other
- Merge pull request #42 from brail/hotfix/web-docker-api-declarations

fix(web): build API declarations before the web image

## [2.1.5] - 2026-09-12

### CI
- Add aggregate pull request gates

### Fixed
- **deps**: Patch Next.js unauthenticated RCE advisories
- **deps**: Patch sharp, nodemailer, and js-yaml advisories
- **deps**: Patch vitest and hono advisories

### Other
- Merge pull request #35 from brail/hotfix/next-rce-advisories

fix(deps): patch Next.js unauthenticated RCE advisories
- Merge pull request #37 from brail/hotfix/high-dependency-advisories

fix(deps): patch sharp, nodemailer, and js-yaml advisories
- Merge pull request #38 from brail/hotfix/medium-dependency-advisories

fix(deps): patch vitest and hono advisories
- Merge pull request #39 from brail/ci/aggregate-gates-main

ci: add aggregate pull request gates

## [2.1.4] - 2026-09-02

### CI
- **security**: Scan active release train weekly
- **security**: Match release trains by pattern instead of by name

### Dependencies
- **deps**: Bump google/osv-scanner-action in the actions-updates group (#26)

### Fixed
- **deps**: Patch mysql2 on stable line
- **deps**: Patch browserslist on stable line
- **deps**: Patch qs and fast-uri, move fastify to the 5.12.1 line
- **api**: Validate the proxy address instead of trusting a hop count

### Other
- Merge pull request #28 from brail/hotfix/mysql2-main

fix(deps): patch mysql2 and browserslist on the stable line

## [2.1.3] - 2026-08-25

### Fixed
- **api**: Await fire-and-forget logo cleanup in integration test

## [2.1.2] - 2026-08-25

### Fixed
- **api**: Preserve real Content-Type when migrating storage to MinIO

## [2.1.1] - 2026-08-25

### Documentation
- Add develop-2.1 staleness lesson to lessons.md

### Fixed
- **release**: Stop full-overwrite CHANGELOG regen, use prepend-only
- **api**: Compile db:* scripts for production instead of running raw TS


## [2.1.0] - 2026-08-25

### Added
- **api**: Add local→MinIO storage migration script

### Fixed
- **storage**: Validate all buckets, batch AppConfig reads, drop dead bucket form field
- **deps**: Bump deepmerge-ts to 8.0.2 via pnpm override — patches GHSA-ggr8-5vv4-36mx (CVE-2026-40345, CVSS 8.2 High) DoS vulnerability

### CI
- **security**: Notify on security.yml failure (#25)

## [2.0.0] - 2026-08-09

### Added
- **calendar**: Add SSE real-time calendar updates with ticket auth
- **calendar**: Custom date-range digest with net-change diff summary
- **web**: Add about page with stack and version info
- **collection**: Unify progress/eventType catalogs into Phase model
- **calendar**: Freeze/baseline snapshot for season calendars
- **calendar**: Row-scoped event anchoring for phase resolution
- **collection**: Full phase transition history for KPI tracking
- **auth**: Send verification email for LDAP users with a real address
- **collection**: On-demand alert engine for phase deadlines
- **collection**: Monitoring dashboards for saturation, bottleneck, stagnation
- **dashboard**: Daily greeting modal
- **product**: Merge saturazione/strozzatura/stagnazione into Controllo page with tabs
- **db**: Add EditLock session-lock table and MilestoneTemplateItem.allDay
- **calendar**: Multi-step planning wizard with row-fork, session lock, admin unfreeze
- **calendar**: Expose phase field on calendar events and milestone templates
- **collection-layout**: Show criticality badge in table view, not just row detail
- **calendar**: Replace CalendarEventAnchor with first-class PlanningGroup model
- **collection-layout**: Surface criticality detail, scheduling variance, and aggregate summary
- **calendar**: Batch vendor closures, richer tooltips, deep-linked notifications
- **calendar**: Working-days deadline countdown, planning/maintenance status badge
- **calendar**: Refresh alert-engine badges live, no reload needed
- **web**: Add compact size variants to Button, Select, Input
- **collection-layout,controllo**: Add pivot statistics dashboard, qtyForecast nullable
- **calendar**: Cancel/restore workflow, post-freeze lock, drop event type/owner
- **calendar**: Scope Google sync ACL to team membership, fix all-day dates, distinguish planning groups
- **calendar**: Add amend-freeze action for planning groups
- **calendar**: Add admin settings page for alert threshold config
- **maintenance**: Add backup/restore disaster-recovery + maintenance mode
- Add RC database refresh script
- **backup**: Add creation recap, cross-instance export/import, and schema migration bridge
- **audit**: Add audit log viewer and last-modified-by widget
- **calendar**: Block freeze on uncovered phases, warn on vendor-holiday overlaps
- **notifications**: Add notification center, soft-archive and per-event calendar overrides
- **web**: Support pasting images from clipboard in FileDropZone
- **api**: Add retention sweep for audit log and notifications
- **api**: Seed retention sweep AppConfig keys with their default values
- **core**: Add quotations/phaseChangeNote draft fields to collection layout row schema
- **api**: Buffer row-drawer phase/planning-group/quotation edits into one Save transaction ⚠️ **BREAKING**
- **web**: Buffer row-drawer edits until Save and redesign the phase/`Situazione` header
- **merch**: Automatic revisions on milestones, which cannot be forged by hand ⚠️ **BREAKING**
- **merch**: Alert band intensity and explicit row conclusion
- **nav**: Persist the outcome of each scheduled sync
- **rbac**: Guard against locking everyone out of the admin functions

### CI
- **security**: Add semgrep, gitleaks and osv-scanner workflow
- Fix lint/typecheck workflow targeting stale develop branch
- Bump actions to node24 runtime, silence Node 20 deprecation warning
- Gate on tests and migrations, escalate findings to semgrep rules
- Make skill and docs drift blocking
- Derive the version list from the workspace and guard it before tagging
- **semgrep**: Catch brand scope on resource-id inputs

### Changed
- **core,api,web**: Cleanup upgrade compromises
- **core,api,web**: Simplification pass on upgrade diff
- **web,api**: Move section access evaluation server-side
- **core**: Extract calcBackoffDelay utility to @luke/core
- **calendar**: Remove what-if solver and simplify event fields
- **nav**: Move kimo/portafoglio replica sync and PG queries into @luke/nav
- **api**: Dedupe getMasterKey into core/server and tighten config surface
- **collection**: Planning band + CatalogSelectField in row modal
- **web**: Adopt compact size variants across call sites
- **web**: Simplify residue from compact-size sweep
- **web**: Dedupe copy-to-clipboard boilerplate into useCopyToClipboard hook
- **collectionLayout**: Simplify revision creation, drop row eligibility gate
- **api**: Extract streamRawResponse helper
- **core**: Remove hasPermissionWithGrants dead code
- **api**: Rename the async test context and close the helper barrel
- **api**: Drop four copies of createContext in favour of the barrel
- **api**: Cut 1740 lines of duplicated test scaffolding and dead tooling
- **api**: Extract confirmPendingFile
- Eliminate `any` across the codebase and make it enforceable
- **rbac**: Rename product.controllo section key to product.control

### Dependencies
- **deps**: Phase 1 — safe bumps and config fixes
- **deps**: Phase 2 — fastify plugins, otel, lucide-react v1, vitest v4
- **deps**: Phase 3a — typescript 6
- **deps**: Phase 3b — zod 4
- **deps**: Phase 3c — prisma 7
- **deps**: Phase 3d-g — nodemailer 9, ldapts 8, mssql 12, pino 10
- **deps**: Phase 4a — tailwind css v4 + tailwind-merge v3
- **deps**: Phase 4b — next.js 16
- **deps**: Phase 4c — eslint 10 + flat config migration
- **deps**: Phase 4d+e — pnpm 11, sonner 2, workspace config

### Documentation
- Add readme to all workspaces and docs index [luke-docs]
- Add luke-docs markers to root and api README
- Update readme tree [luke-docs]
- Add inline JSDoc comments across packages and tRPC routers [luke-docs]
- **api**: Add inline JSDoc to lib/ services/ routes/ storage/ [luke-docs]
- **web**: Add inline JSDoc to hooks/ lib/ components/ app/ [luke-docs]
- Update readme tree, inline comments and adr validation [luke-docs]
- Add ADR-008/009/010 and update adr validation [luke-docs]
- **claude**: Add dependabot target-branch reminder on develop branch change
- Add Collection Genome planning notes
- Findings skipped by the simplify passes for the collection genome
- Refresh README/ADR index and mark storage refactor ADR stale
- **lessons**: Document prisma migrate deploy drift with db push workflow
- **calendar**: Add JSDoc to Google Calendar client accessors
- **calendar**: Record UX deferred-items backlog and working-days design doc
- Restructure CLAUDE.md, categorize lessons.md, extract prisma workflow
- **lessons**: Add rate-limit two-map drift lesson
- Add quality hardening plan and flag the NODE_ENV dev trap
- Record the integration test ordering lesson
- Record the second hardening round and the local integration setup
- Correct the stale LDAP entry in the hardening plan
- Record the semgrep probing and module-mock lessons
- Record single-instance scaling constraint (ADR-011)
- Update readme tree and adr validation [luke-docs]
- **api**: Normalize tRPC procedure and Prisma schema doc comments [luke-docs]
- Require English-only code comments (rule 14)
- **skills**: Align luke-docs language policy with CLAUDE.md rule 14
- Fix APP_VERSION env var drift in README and ADR-008
- **skills**: Extend luke-docs inline JSDoc target to web lib/hooks
- **api**: Translate all Italian code comments to English
- Log cd-cwd-leak lesson from this session verification bug
- Translate Italian comments to English across apps/web, packages/core, packages/nav

### Fixed
- **web**: Edge runtime compat for middleware auth + jwt cache
- **api,web,core**: Security hardening, bug fixes, and code cleanup
- **docs**: Correct JWT clock tolerance from ±30s to ±5s
- **web**: Resolve turbopack workspace root and middleware deprecation warnings
- **web**: Suppress hydration warning on login inputs
- **collection-alert**: Compare phase order with >= so the current phase deadline still counts
- **calendar**: Heartbeat planning wizard session lock instead of fixed TTL
- **collection-alert**: Count deadline against live event date, not frozen baseline
- **web**: Prevent Dialog/Sheet closing when nested Select dropdown closes
- **web**: Prevent Dialog/Sheet closing when a nested Dialog/Sheet/AlertDialog closes
- **calendar**: Invalidate planningGroup.list after freeze/unfreeze
- **web**: Route error logging through debugError and clean import order
- **auth**: Refresh API access token in NextAuth jwt callback
- **api**: Register navSyncTrigger in rate-limit DEFAULTS
- **web**: Unify scrollable modals to sticky header/footer layout
- **web**: Stop forced daily logout that survives re-login
- **security**: Remediate static analysis findings
- **security**: Pin osv-scanner-action to exact version, v2 tag does not exist
- **core**: Partial() re-injects default() values on omitted fields
- **calendar,api**: Reduce in-app notification noise, add read/unread counts
- **product**: Load pricePositioning value when editing collection row
- **collection-layout**: Restore revision UI wiring, redesign as centered dialog
- **deps**: Bump vulnerable transitive deps flagged by osv-scanner
- **web**: Add build-time placeholder for NEXTAUTH_SECRET
- **api**: Use pg adapter for zero-arg PrismaClient instances
- **api**: Copy prisma.config.ts into runner stage
- **api**: Correct pdfmake deep-import casing (macOS vs Linux)
- **scripts**: Drop+recreate schema instead of pg_restore --clean
- **api**: Require pdfmake's compiled js/Printer, not raw ESM src/Printer
- **web**: Fall back to non-crypto trace-id over plain HTTP
- **backup**: Loosen runCommand env type to allow partial overrides
- **api**: Bypass Fastify reply.send() for large streamed downloads
- **calendar**: Fix template duration semantics, visibility validation, freeze naming, linked date editing
- **api**: Default daily greeting to disabled for users
- **api**: Correct middleware ordering, idempotency hashing and error mapping
- **api**: Repair CLI scripts broken by Prisma 7
- **api**: Make test isolation an invariant, not a per-file convention
- **api**: Guarantee schema before every test fixture
- **deps**: Resolve 24 known vulnerabilities, 3 critical on the auth layer
- **ci**: Skip gitignored paths in the skill integrity check
- **ci**: Apply the gitignore rule to link targets too, and honour directory patterns
- **release**: Make the version bump a command, not a manual edit
- **api**: Migrate createPdfBuffer to pdfmake 0.3, repairing every PDF export
- **calendar**: Repair the PDF export, which killed the API process
- **api**: Enforce brand scope on 17 procedures that only checked the role ⚠️ **BREAKING**
- **auth**: Make session revocation and role demotion actually take effect
- **api**: Rate-limit export generation and constrain the company logo key
- **api**: Unify assertBrandAccess and unblock admins with no team
- **api**: Enforce brand scope on 23 procedures addressed by resource id ⚠️ **BREAKING**
- **api**: Scope reorder writes to their parent
- **api**: Scope revision exports to their own layout ⚠️ **BREAKING**
- **api**: Key the upload rate limit by user, not by IP
- **api**: Bind a confirmed upload to the slot the server allocated ⚠️ **BREAKING**
- **api**: Derive the company logo key from a verified FileObject ⚠️ **BREAKING**
- **api**: Bring brand logo handling up to the company profile's guarantees ⚠️ **BREAKING**
- **api**: Prevent concurrent scheduler execution across API instances
- **web**: Persist quotation edits when Enter closes the row drawer
- **api**: Persist notification dedup state to survive process restarts
- **web**: Correct post-deny redirect path in section access guard
- **pricing**: Persist countryCode on parameter set update
- **web**: Stop season selector value from truncating
- **api**: Derive phase catalog code from order instead of independent input
- **api**: Satisfy tsconfig.test.json in retention sweep specs
- **api**: Skip deactivated phases when resolving next phase
- **web**: Poll to keep the login page's backend status light current
- **web**: The tooltip on buttons without permission never appeared
- **api**: Release the scheduler lock by deleting its row
- **auth**: Fix a login rate-limit bypass (Strix pentest on RC)
- **test**: Narrow the specs left behind by the `any` sweep
- **deps**: Unpin fast-uri and js-yaml, resolve 4 known vulnerabilities
- **rbac**: Close the lockout path through settings.users
- **web**: Move trailing JSX comment out of ConfigTable header row
- **rbac**: Make SECTION_ACCESS_DEFAULTS the base, not dead code
- **api**: Unbreak nav CI build and pin vulnerable nanoid
- **api**: Import @fastify/cookie for reply.clearCookie type augmentation
- **web**: Guard crypto.randomUUID() in collection-control against non-secure contexts
- **web**: Restore XLSX/PDF export wiring in collection layout page
- **api**: Prevent OOM on large collection layout XLSX/PDF export
- **api**: Resize export images with sharp to prevent OOM on collection layout export
- **api**: Stop sharp types paths remap from hijacking tsx runtime resolution
- **web**: Make sharp type shim reachable from apps/web's own TS program
- **api**: Resolve vitest/globals + sharp types for typecheck:test

### Maintenance
- **husky**: Remove deprecated husky.sh source from post-checkout
- **core**: Remove stale compiled artifacts from src/schemas/
- **docs**: Remove access-porting from tracking
- **ci**: Set dependabot target-branch to develop-2.1
- Rename eslint.config.js to .mjs to silence module-type warning
- **web**: Update next-env type reference path
- **api**: Enable tsx watch for the dev script
- **security**: Add semgrep and gitleaks base configuration
- **security**: Add Luke custom semgrep rules
- **security**: Add pre-commit security gates to husky hook
- **security**: Simplify security-tooling diff (4-agent /simplify pass)
- **lint**: Add eslint-plugin-luke with no-bare-zod-partial gate
- Wire lint script into every package, clear accumulated lint debt
- **web**: Add unconditional console.error in session verification
- **web**: Log error.message/data instead of JSON.stringify(result)
- Track .claude/ skills, hooks and shared settings
- Sync eslint-plugin-luke to the monorepo version
- Add prod to RC clone script via backup/export/import pipeline
- **skills**: Scope luke-* skills to their own session
- Ignore luke-docs templates in prettier
- **skills**: Drop 91 ignore markers from the ADR template
- **web,api,nav**: Normalize filenames to camelCase, translate Italian names to English

### Other
- Scripts for the Prisma 7 migrations and a unit tier for apps/web

### Tests
- **api**: Revive the test tier and split unit from integration
- **calendar**: Cover sync engine, content hash, ACL, events and iCal
- **web**: Add Playwright smoke suite, drop the never-passing legacy one
- **api**: Exercise brand through appRouter, not the sub-router
- **api**: Gate tRPC procedure coverage on measured invocations
- **api**: Cover the pricing router and the price calculation engine
- **api**: Exhaust the brand-logo rate limit without touching the database
- **api**: Cover buffered row save, quotation sync, and phase alert changes
- **web**: Update quotation smoke test for buffered save flow
- **api**: Cover sectionAccess, including the procedure no UI can reach

## [1.10.0-rc.15] - 2026-08-09

### Fixed
- **web**: Restore XLSX/PDF export wiring in collection layout page

## [1.10.0-rc.14] - 2026-08-09

### Fixed
- **web**: Guard crypto.randomUUID() in collection-control against non-secure contexts

### Maintenance
- Bump version to 1.10.0-rc.14

## [1.10.0-rc.13] - 2026-08-09

### Fixed
- **api**: Import @fastify/cookie for reply.clearCookie type augmentation

### Maintenance
- Bump version to 1.10.0-rc.13

## [1.10.0-rc.12] - 2026-08-09

### Added
- **audit**: Add audit log viewer and last-modified-by widget
- **calendar**: Block freeze on uncovered phases, warn on vendor-holiday overlaps
- **notifications**: Add notification center, soft-archive and per-event calendar overrides
- **web**: Support pasting images from clipboard in FileDropZone
- **api**: Add retention sweep for audit log and notifications
- **api**: Seed retention sweep AppConfig keys with their default values
- **core**: Add quotations/phaseChangeNote draft fields to collection layout row schema
- **api**: Buffer row-drawer phase/planning-group/quotation edits into one Save transaction ⚠️ **BREAKING**
- **web**: Buffer row-drawer edits until Save and redesign the phase/`Situazione` header
- **merch**: Automatic revisions on milestones, which cannot be forged by hand ⚠️ **BREAKING**
- **merch**: Alert band intensity and explicit row conclusion
- **nav**: Persist the outcome of each scheduled sync
- **rbac**: Guard against locking everyone out of the admin functions

### CI
- Gate on tests and migrations, escalate findings to semgrep rules
- Make skill and docs drift blocking
- Derive the version list from the workspace and guard it before tagging
- **semgrep**: Catch brand scope on resource-id inputs

### Changed
- **api**: Extract streamRawResponse helper
- **core**: Remove hasPermissionWithGrants dead code
- **api**: Rename the async test context and close the helper barrel
- **api**: Drop four copies of createContext in favour of the barrel
- **api**: Cut 1740 lines of duplicated test scaffolding and dead tooling
- **api**: Extract confirmPendingFile
- Eliminate `any` across the codebase and make it enforceable
- **rbac**: Rename product.controllo section key to product.control

### Documentation
- Add quality hardening plan and flag the NODE_ENV dev trap
- Record the integration test ordering lesson
- Record the second hardening round and the local integration setup
- Correct the stale LDAP entry in the hardening plan
- Record the semgrep probing and module-mock lessons
- Record single-instance scaling constraint (ADR-011)
- Update readme tree and adr validation [luke-docs]
- **api**: Normalize tRPC procedure and Prisma schema doc comments [luke-docs]
- Require English-only code comments (rule 14)
- **skills**: Align luke-docs language policy with CLAUDE.md rule 14
- Fix APP_VERSION env var drift in README and ADR-008
- **skills**: Extend luke-docs inline JSDoc target to web lib/hooks
- **api**: Translate all Italian code comments to English
- Log cd-cwd-leak lesson from this session verification bug
- Translate Italian comments to English across apps/web, packages/core, packages/nav

### Fixed
- **api**: Bypass Fastify reply.send() for large streamed downloads
- **calendar**: Fix template duration semantics, visibility validation, freeze naming, linked date editing
- **api**: Default daily greeting to disabled for users
- **api**: Correct middleware ordering, idempotency hashing and error mapping
- **api**: Repair CLI scripts broken by Prisma 7
- **api**: Make test isolation an invariant, not a per-file convention
- **api**: Guarantee schema before every test fixture
- **deps**: Resolve 24 known vulnerabilities, 3 critical on the auth layer
- **ci**: Skip gitignored paths in the skill integrity check
- **ci**: Apply the gitignore rule to link targets too, and honour directory patterns
- **release**: Make the version bump a command, not a manual edit
- **api**: Migrate createPdfBuffer to pdfmake 0.3, repairing every PDF export
- **calendar**: Repair the PDF export, which killed the API process
- **api**: Enforce brand scope on 17 procedures that only checked the role ⚠️ **BREAKING**
- **auth**: Make session revocation and role demotion actually take effect
- **api**: Rate-limit export generation and constrain the company logo key
- **api**: Unify assertBrandAccess and unblock admins with no team
- **api**: Enforce brand scope on 23 procedures addressed by resource id ⚠️ **BREAKING**
- **api**: Scope reorder writes to their parent
- **api**: Scope revision exports to their own layout ⚠️ **BREAKING**
- **api**: Key the upload rate limit by user, not by IP
- **api**: Bind a confirmed upload to the slot the server allocated ⚠️ **BREAKING**
- **api**: Derive the company logo key from a verified FileObject ⚠️ **BREAKING**
- **api**: Bring brand logo handling up to the company profile's guarantees ⚠️ **BREAKING**
- **api**: Prevent concurrent scheduler execution across API instances
- **web**: Persist quotation edits when Enter closes the row drawer
- **api**: Persist notification dedup state to survive process restarts
- **web**: Correct post-deny redirect path in section access guard
- **pricing**: Persist countryCode on parameter set update
- **web**: Stop season selector value from truncating
- **api**: Derive phase catalog code from order instead of independent input
- **api**: Satisfy tsconfig.test.json in retention sweep specs
- **api**: Skip deactivated phases when resolving next phase
- **web**: Poll to keep the login page's backend status light current
- **web**: The tooltip on buttons without permission never appeared
- **api**: Release the scheduler lock by deleting its row
- **auth**: Fix a login rate-limit bypass (Strix pentest on RC)
- **test**: Narrow the specs left behind by the `any` sweep
- **deps**: Unpin fast-uri and js-yaml, resolve 4 known vulnerabilities
- **rbac**: Close the lockout path through settings.users
- **web**: Move trailing JSX comment out of ConfigTable header row
- **rbac**: Make SECTION_ACCESS_DEFAULTS the base, not dead code
- **api**: Unbreak nav CI build and pin vulnerable nanoid

### Maintenance
- Track .claude/ skills, hooks and shared settings
- Sync eslint-plugin-luke to the monorepo version
- Add prod to RC clone script via backup/export/import pipeline
- **skills**: Scope luke-* skills to their own session
- Ignore luke-docs templates in prettier
- **skills**: Drop 91 ignore markers from the ADR template
- **web,api,nav**: Normalize filenames to camelCase, translate Italian names to English
- Bump version to 1.10.0-rc.12

### Other
- Scripts for the Prisma 7 migrations and a unit tier for apps/web

### Tests
- **api**: Revive the test tier and split unit from integration
- **calendar**: Cover sync engine, content hash, ACL, events and iCal
- **web**: Add Playwright smoke suite, drop the never-passing legacy one
- **api**: Exercise brand through appRouter, not the sub-router
- **api**: Gate tRPC procedure coverage on measured invocations
- **api**: Cover the pricing router and the price calculation engine
- **api**: Exhaust the brand-logo rate limit without touching the database
- **api**: Cover buffered row save, quotation sync, and phase alert changes
- **web**: Update quotation smoke test for buffered save flow
- **api**: Cover sectionAccess, including the procedure no UI can reach

## [1.10.0-rc.11] - 2026-07-27

### Fixed
- **backup**: Loosen runCommand env type to allow partial overrides

### Maintenance
- Bump version to 1.10.0-rc.11
- Update CHANGELOG for v1.10.0-rc.11

## [1.10.0-rc.10] - 2026-07-27

### Added
- **backup**: Add creation recap, cross-instance export/import, and schema migration bridge

### Maintenance
- Bump version to 1.10.0-rc.10
- Update CHANGELOG for v1.10.0-rc.10

## [1.10.0-rc.9] - 2026-07-26

### Fixed
- **web**: Fall back to non-crypto trace-id over plain HTTP

### Maintenance
- Bump version to 1.10.0-rc.9
- Update CHANGELOG for v1.10.0-rc.9

## [1.10.0-rc.8] - 2026-07-26

### Maintenance
- **web**: Log error.message/data instead of JSON.stringify(result)
- Bump version to 1.10.0-rc.8
- Update CHANGELOG for v1.10.0-rc.8

## [1.10.0-rc.7] - 2026-07-26

### Maintenance
- **web**: Add unconditional console.error in session verification
- Bump version to 1.10.0-rc.7
- Update CHANGELOG for v1.10.0-rc.7

## [1.10.0-rc.6] - 2026-07-22

### Fixed
- **scripts**: Drop+recreate schema instead of pg_restore --clean
- **api**: Require pdfmake's compiled js/Printer, not raw ESM src/Printer

### Maintenance
- Bump version to 1.10.0-rc.6
- Update CHANGELOG for v1.10.0-rc.6

## [1.10.0-rc.5] - 2026-07-22

### Fixed
- **api**: Correct pdfmake deep-import casing (macOS vs Linux)

### Maintenance
- Bump version to 1.10.0-rc.5
- Update CHANGELOG for v1.10.0-rc.5

## [1.10.0-rc.4] - 2026-07-22

### Fixed
- **api**: Copy prisma.config.ts into runner stage

### Maintenance
- Bump version to 1.10.0-rc.4
- Update CHANGELOG for v1.10.0-rc.4

## [1.10.0-rc.3] - 2026-07-22

### Fixed
- **api**: Use pg adapter for zero-arg PrismaClient instances

### Maintenance
- Bump version to 1.10.0-rc.3
- Update CHANGELOG for v1.10.0-rc.3

## [1.10.0-rc.2] - 2026-07-22

### Fixed
- **web**: Add build-time placeholder for NEXTAUTH_SECRET

### Maintenance
- Bump version to 1.10.0-rc.2
- Update CHANGELOG for v1.10.0-rc.2

## [1.10.0-rc.1] - 2026-07-22

### Added
- **calendar**: Add SSE real-time calendar updates with ticket auth
- **calendar**: Custom date-range digest with net-change diff summary
- **web**: Add about page with stack and version info
- **collection**: Unify progress/eventType catalogs into Phase model
- **calendar**: Freeze/baseline snapshot for season calendars
- **calendar**: Row-scoped event anchoring for phase resolution
- **collection**: Full phase transition history for KPI tracking
- **auth**: Send verification email for LDAP users with a real address
- **collection**: On-demand alert engine for phase deadlines
- **collection**: Monitoring dashboards for saturation, bottleneck, stagnation
- **dashboard**: Daily greeting modal
- **product**: Merge saturazione/strozzatura/stagnazione into Controllo page with tabs
- **db**: Add EditLock session-lock table and MilestoneTemplateItem.allDay
- **calendar**: Multi-step planning wizard with row-fork, session lock, admin unfreeze
- **calendar**: Expose phase field on calendar events and milestone templates
- **collection-layout**: Show criticality badge in table view, not just row detail
- **calendar**: Replace CalendarEventAnchor with first-class PlanningGroup model
- **collection-layout**: Surface criticality detail, scheduling variance, and aggregate summary
- **calendar**: Batch vendor closures, richer tooltips, deep-linked notifications
- **calendar**: Working-days deadline countdown, planning/maintenance status badge
- **calendar**: Refresh alert-engine badges live, no reload needed
- **web**: Add compact size variants to Button, Select, Input
- **collection-layout,controllo**: Add pivot statistics dashboard, qtyForecast nullable
- **calendar**: Cancel/restore workflow, post-freeze lock, drop event type/owner
- **calendar**: Scope Google sync ACL to team membership, fix all-day dates, distinguish planning groups
- **calendar**: Add amend-freeze action for planning groups
- **calendar**: Add admin settings page for alert threshold config
- **maintenance**: Add backup/restore disaster-recovery + maintenance mode
- Add RC database refresh script

### CI
- **security**: Add semgrep, gitleaks and osv-scanner workflow
- Fix lint/typecheck workflow targeting stale develop branch
- Bump actions to node24 runtime, silence Node 20 deprecation warning

### Changed
- **core,api,web**: Cleanup upgrade compromises
- **core,api,web**: Simplification pass on upgrade diff
- **web,api**: Move section access evaluation server-side
- **core**: Extract calcBackoffDelay utility to @luke/core
- **calendar**: Remove what-if solver and simplify event fields
- **nav**: Move kimo/portafoglio replica sync and PG queries into @luke/nav
- **api**: Dedupe getMasterKey into core/server and tighten config surface
- **collection**: Planning band + CatalogSelectField in row modal
- **web**: Adopt compact size variants across call sites
- **web**: Simplify residue from compact-size sweep
- **web**: Dedupe copy-to-clipboard boilerplate into useCopyToClipboard hook
- **collectionLayout**: Simplify revision creation, drop row eligibility gate

### Dependencies
- **deps**: Phase 1 — safe bumps and config fixes
- **deps**: Phase 2 — fastify plugins, otel, lucide-react v1, vitest v4
- **deps**: Phase 3a — typescript 6
- **deps**: Phase 3b — zod 4
- **deps**: Phase 3c — prisma 7
- **deps**: Phase 3d-g — nodemailer 9, ldapts 8, mssql 12, pino 10
- **deps**: Phase 4a — tailwind css v4 + tailwind-merge v3
- **deps**: Phase 4b — next.js 16
- **deps**: Phase 4c — eslint 10 + flat config migration
- **deps**: Phase 4d+e — pnpm 11, sonner 2, workspace config

### Documentation
- Add readme to all workspaces and docs index [luke-docs]
- Add luke-docs markers to root and api README
- Update readme tree [luke-docs]
- Add inline JSDoc comments across packages and tRPC routers [luke-docs]
- **api**: Add inline JSDoc to lib/ services/ routes/ storage/ [luke-docs]
- **web**: Add inline JSDoc to hooks/ lib/ components/ app/ [luke-docs]
- Update readme tree, inline comments and adr validation [luke-docs]
- Add ADR-008/009/010 and update adr validation [luke-docs]
- **claude**: Add dependabot target-branch reminder on develop branch change
- Add Collection Genome planning notes
- Findings skipped by the simplify passes for the collection genome
- Refresh README/ADR index and mark storage refactor ADR stale
- **lessons**: Document prisma migrate deploy drift with db push workflow
- **calendar**: Add JSDoc to Google Calendar client accessors
- **calendar**: Record UX deferred-items backlog and working-days design doc
- Restructure CLAUDE.md, categorize lessons.md, extract prisma workflow
- **lessons**: Add rate-limit two-map drift lesson

### Fixed
- **web**: Edge runtime compat for middleware auth + jwt cache
- **api,web,core**: Security hardening, bug fixes, and code cleanup
- **docs**: Correct JWT clock tolerance from ±30s to ±5s
- **web**: Resolve turbopack workspace root and middleware deprecation warnings
- **web**: Suppress hydration warning on login inputs
- **collection-alert**: Compare phase order with >= so the current phase deadline still counts
- **calendar**: Heartbeat planning wizard session lock instead of fixed TTL
- **collection-alert**: Count deadline against live event date, not frozen baseline
- **web**: Prevent Dialog/Sheet closing when nested Select dropdown closes
- **web**: Prevent Dialog/Sheet closing when a nested Dialog/Sheet/AlertDialog closes
- **calendar**: Invalidate planningGroup.list after freeze/unfreeze
- **web**: Route error logging through debugError and clean import order
- **auth**: Refresh API access token in NextAuth jwt callback
- **api**: Register navSyncTrigger in rate-limit DEFAULTS
- **web**: Unify scrollable modals to sticky header/footer layout
- **web**: Stop forced daily logout that survives re-login
- **security**: Remediate static analysis findings
- **security**: Pin osv-scanner-action to exact version, v2 tag does not exist
- **core**: Partial() re-injects default() values on omitted fields
- **calendar,api**: Reduce in-app notification noise, add read/unread counts
- **product**: Load pricePositioning value when editing collection row
- **collection-layout**: Restore revision UI wiring, redesign as centered dialog
- **deps**: Bump vulnerable transitive deps flagged by osv-scanner

### Maintenance
- **husky**: Remove deprecated husky.sh source from post-checkout
- Bump version to 1.10.0-dev.0
- **calendar**: Align version to 1.10.0-dev.0
- **core**: Remove stale compiled artifacts from src/schemas/
- **docs**: Remove access-porting from tracking
- **ci**: Set dependabot target-branch to develop-2.1
- Rename eslint.config.js to .mjs to silence module-type warning
- **web**: Update next-env type reference path
- **api**: Enable tsx watch for the dev script
- **security**: Add semgrep and gitleaks base configuration
- **security**: Add Luke custom semgrep rules
- **security**: Add pre-commit security gates to husky hook
- **security**: Simplify security-tooling diff (4-agent /simplify pass)
- **lint**: Add eslint-plugin-luke with no-bare-zod-partial gate
- Wire lint script into every package, clear accumulated lint debt
- Bump version to 1.10.0-rc.1
- Update CHANGELOG for v1.10.0-rc.1

## [1.9.1] - 2026-07-13

### Fixed
- **api**: Register `navSyncTrigger` in rate-limit `DEFAULTS` map — fixed crash (`Cannot read properties of undefined (reading 'max')`) that blocked NAV vendor sync in production

## [1.9.0] - 2026-06-26

### Maintenance
- Merge develop-2.0 into main for v1.9.0 release
- Bump version to 1.9.0

## [1.9.0-rc.1] - 2026-06-26

### Added
- **calendar**: Add fullscreen expand mode
- **core**: Add company structure schemas and permissions
- **api**: Migrate to company structure model
- **api**: Add company.* router and team provisioning
- **web**: Add company settings page and migrate calendar to function model
- **api**: Assign real users to company teams in seed
- **company**: Add logo upload and export settings
- **company**: Ux overhaul profile/structure tabs and pdf company branding in footer
- **rbac**: Opt-in brand access via team scopes, drop UserSeasonAccess
- **notifications**: In-app notification system with SSE real-time delivery
- **collection**: Collection layout versioning + progress catalog refactor
- **calendar**: Month view by default, week numbers, advanced Gantt, drag-and-drop milestones
- **calendar**: Day-click to create milestone, bulk delete, per-brand edit guard
- **calendar**: Rename CalendarMilestone→CalendarEvent + configurable event types catalog
- **calendar**: Day view, brand colors, filter strip, UX overhaul
- **company**: Notify user of calendar access on team membership add
- **calendar**: What-if engine v2 — UI, holiday visualization, dependencies, simulate
- **collection**: Add collection progress + price positioning
- **api**: Collection layout revision export + season calendar updates
- **web**: Collection layout revision UI + calendar updates
- **collection**: Allow null skuForecast with double-confirm on save

### Changed
- **company**: Use useStorageUpload hook and fix logo removal bug
- **company**: Ux overhaul settings/company page
- **rbac**: Rename admin sections calendar and collection-catalog

### Fixed
- Pass MinIO credentials to minio-init container
- **api**: Refactor company router and improve team provisioning
- **web**: Fix lint errors in company settings page and sidebar
- **infra**: Provision company-assets MinIO bucket in all environments
- **company**: Close spec gaps in company structure implementation
- **company**: Soft-delete slug uniqueness + restore procedure
- Audit findings — security, bugs, and compliance fixes
- **web**: Fix ESLint import/order violations blocking CI build

### Maintenance
- Bump version to 1.9.0-dev.0
- Bootstrap release tooling and conventions
- Finalize changelog config and pre-1.9 history
- Bump version to 1.9.0-rc.1
- Update CHANGELOG for v1.9.0-rc.1

### Tests
- **api**: Company structure access and visibility tests
- **api**: Point tests to luke_test database

---

## Pre-1.9.0 history

Versions prior to 1.9.0 are not tracked commit-by-commit. The cycle delivered:

- **Season Calendar** (`@luke/calendar`): SeasonCalendar per brand+season, milestones with type/status/owner/visibility, multi-section visibility, personal notes, templates with offsetDays, calendar cloning with dateShift, Google Calendar 2-way sync with idempotent content hash, iCal export with signed token, PDF and XLSX export
- **Merchandising Plan**: SKU-level rows (color granularity), SpecsheetModal with BOM editing and image gallery, contextualized for brand+season, dedicated RBAC and storage bucket
- **Collection Catalog** (`admin.collection_catalog`): configurable items replacing hardcoded enums for Strategy, LineStatus, StyleStatus, Progress
- **CollectionRowQuotation**: pricing extracted from row, 1:N instead of 1:1
- **Dashboard widgets**: kpi-stats, season-progress, weekly-sales, tasks, forex, clocks — user-configurable
- **Sales section** (`sales.statistics`): NAV order portfolio via `NavKimoSalesLine`, XLSX export
- **Planning sections** (`planning.{sales,product,sourcing,merchandising}`): per-section calendar views
- **Settings: Google OAuth** (`settings.google`): authentication for Google Calendar sync
- **Pricing utility** extracted to `@luke/core/utils/pricing`

For commit-level detail through 1.6.3: `git log v1.0.0..v1.6.3`. From 1.7.0 to 1.8.2 commits weren't tagged; see develop-2.0 branch history.
