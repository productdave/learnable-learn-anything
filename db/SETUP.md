# Supabase setup and migration history

## Read this first — 8 October 2026

The current source inventory runs from `01-schema.sql` through
`24-visual-designer.sql`. The dated sections below are historical rollout notes,
not a statement of current hosted settings or a fresh-install acceptance result.
The existing hosted databases must not be initialized again from this guide.

For a new isolated development project, read migrations in numeric order, inspect
their prerequisites and apply them deliberately. Start with `db/01-schema.sql`,
`db/02-rls.sql`, `db/03-user-state.sql` and `db/04-agentic-workflow.sql`, then review
05–24. Some later migrations replace functions/policies created earlier; do not
apply a random subset or use a production target for experimentation.

Use [the source snapshot guide](../docs/SOURCE-SNAPSHOT.md) for the current app,
offline test commands and boundaries. Environment examples deliberately leave
generation and image flags off. Server credentials and the provider-vault key
belong in an ignored local file or server environment, never frontend config.
Provider keys are connected by the signed-in creator. No fresh database install,
schema operation or hosted configuration change was tested during the GitHub sync.

## Historical deployment state (18 September 2026)

The original setup and historical local-only notes below are retained for context.
The current ordered inventory is **01–21**, pinned in
`docs/upgrade/staging-migrations-2026-09-18.json`. It is applied to Docker-local
Supabase and the **isolated staging project** `dmnwkrybgggbpqpetuub`, not production.
Do not rerun initial migrations against an existing database or push local auth
defaults to a hosted project. Use the reviewed forward inventory and exact target.

- `20-hosted-course-conflict.sql` preserves the revision guard and changes its
  deliberate rejection code to `PT409`/HTTP 409, avoiding hosted serialization
  retries. The local revision regression passes 26 checks.
- `21-private-legacy-job-archive.sql` enables RLS and revokes browser/public
  privileges on the preserved archive. It neither deletes nor rewrites history.
  A nonempty replay/privilege regression passes six local transaction checks.
- Original 01–19 hashes are unchanged. The isolated hosted database/Auth/Storage
  regression passes 28 checks. The deployed eight-function API passes 56 hosted
  checks including private PDF/DOCX/TXT extraction and owner isolation.
- Staging Auth points only to `https://learnable-staging.vercel.app`, with that
  origin's redirect paths allowed. Only those two properties changed; eleven
  unrelated remote properties were preserved. Actual email delivery is not tested.
- Generation, images, publishing and moderation remain disabled in staging.
  Do not infer paid-provider or production readiness from migration/health checks.

See [the current handoff](../docs/upgrade/SESSION-HANDOFF.md) for exact receipts and
the next bounded acceptance phase. Keep credentials out of chat and deploy output.

What you do once, while I keep building. After this is done, paste me the project URL + anon key and I'll wire the client.

## 1. Create the project

1. Go to https://supabase.com/dashboard
2. Click **New Project**
3. Settings:
   - **Name:** `learnable`
   - **Database password:** pick something secure (save it to your password manager)
   - **Region:** pick closest to you (e.g. Sydney for AU)
   - **Plan:** Free tier is fine for MVP
4. Wait ~2 minutes for provisioning.

## 2. Run the schema

1. In your project, go to **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `db/01-schema.sql` from this repo. Copy the entire file. Paste into the editor. Click **Run** (or ⌘+Enter).
4. You should see "Success. No rows returned" for each statement.
5. Create another new query. Open `db/02-rls.sql`. Copy/paste/run.
6. Create one more query. Open `db/03-user-state.sql`. Copy/paste/run. (This is the per-user progress-sync table.)
7. Create one more query. Open `db/04-agentic-workflow.sql`. Copy/paste/run. (This aligns the course-builder agent with durable job state, generated-course storage, and PDF uploads.)
8. Verify: in the left sidebar, click **Table Editor**. You should see these tables under `public`:
   - `courses`
   - `generation_jobs`
   - `learner_profiles`
   - `learning_events`
   - `modules`
   - `progress`
   - `topics`
   - `user_courses`
   - `user_state`

## 3. Configure auth

For MVP, just enable **Email magic-link** auth (no password, no Google OAuth yet — those are Phase 3 upgrades).

1. In the left sidebar, click **Authentication** → **Providers**.
2. **Email** should already be enabled. Keep "Confirm email" turned on.
3. Scroll down. **Anonymous sign-ins** — leave OFF.
4. Optional now / later: **Google OAuth** under Providers → Google. Requires creating a Google Cloud OAuth client. Skip for first MVP — magic-link is enough for you + 3-5 testers.

### Restrict signups to an allowlist (private MVP)

Until you want public signups, lock it down:

1. **Authentication** → **Policies** → toggle **Enable sign-ups** OFF.
2. To add yourself + testers: **Authentication** → **Users** → **Add user** → enter their email, check "Auto-confirm user". They can then sign in via magic link.

## 4. Grab the keys I need

In **Project Settings** → **API**:

- **Project URL** — e.g. `https://xyzabcde.supabase.co`
- **anon public key** — long string starting with `eyJ...`

These two values go into the frontend as plain config — they're safe to expose publicly (RLS protects everything).

Also grab (but DO NOT share publicly):

- **secret key** — used only by Vercel serverless functions, never sent to the browser. Required for cloud generation, timeout recovery, and the cron sweeper. Prefer the newer `sb_secret_...` key from **Secret keys**. The legacy `service_role` JWT still works as a fallback, but do not use it for new setup.

## 5. Send them to me

Paste in the next chat message:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJI...
```

In Vercel, set these environment variables:

```bash
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJI...
SUPABASE_SECRET_KEY=sb_secret_...
CRON_SECRET=<a long random value>
```

`CRON_SECRET` protects `/api/gen/sweep`, which is what lets timed-out cloud jobs resume even when the learner has closed the browser.

I'll write the Supabase client wrapper, plumb auth into the library page (magic-link login), and have the existing learners-progress logic mirror to Supabase.

## What lands after this

- Magic-link login on the library page
- A returning user lands on the library logged in, their progress restored across devices
- Generated courses get saved to their account through `user_courses`
- Cloud generation timeouts are detected through `generation_jobs.lease_expires_at`; the app calls `/api/gen/watchdog` for the signed-in user and marks expired jobs resumable.
- Vercel Cron calls `/api/gen/sweep` once daily (`0 0 * * *`, matching the current Hobby-compatible configuration) to mark expired jobs and automatically resume eligible timed-out cloud work from the latest checkpoint. This is not a five-minute background-recovery guarantee.
- `learning_events` rows start landing on every quiz answer, topic completion, flashcard review — building the substrate for Phase 3.5 recommendations

## Server-side timeout recovery

### Safe time-slice continuation rollout

Migration 22 was installed on isolated staging on 30 September 2026, with existing
data and access controls verified unchanged. Its exact runtime package is deployed
READY on staging as `dpl_4nYWsPfT9y7ersKLpoeJejEx7ptG`; automatic continuation
remains off pending the hosted handoff gate. Production is untouched. See
`docs/upgrade/M3-STAGING-CONTINUATION-2026-09-30.md` for the current rollout receipt.
Apply `db/22-generation-continuation.sql` before deploying that code elsewhere: watchdog/sweep
reads include its nullable, server-owned `generation_jobs.continuation` field.
The cloud health endpoint requires this column even while continuation is disabled;
without it, readiness fails. The schema contract records migration 22 as its owner.
No RLS policy or spending permission is added. Keep frozen migration inventories
unchanged; include migration 22 in a fresh reviewed rollout record.

After package checks and a non-spending staging handoff test, the deployment can
set `LEARNABLE_GENERATION_CONTINUATION=1` and
`LEARNABLE_GENERATION_ORIGIN=https://your-staging-project.vercel.app`. The origin
must be a bare HTTPS Vercel hostname, never a value from an incoming request.
The existing sweep secret authenticates a job-specific POST. This flag is not a
paid-generation flag or budget approval. It defaults off.

Only confirmed safe pauses hand off. Human reviews, failures, cancellation and
unknown paid outcomes do not. Pending delivery uses the existing daily recovery
as a fallback, not a promise of immediate delivery. A claimed request that ends
without a confirmed checkpoint requires review; no automatic paid replay.

Local, non-persistent database check:
`node scripts/verify-local-generation-continuation.mjs`. It requires the existing
`supabase_db_learnable-setup-local` container and rolls its transaction back.

### Existing daily recovery

The app checks its own signed-in user's stale jobs every minute. The deployed app also has a Vercel Cron entry for `/api/gen/sweep`, which resumes timed-out jobs in the cloud without waiting for the user to reopen the browser.

Set one of these in Vercel:

- `CRON_SECRET` (Vercel Cron's standard bearer token)
- or `GEN_SWEEP_SECRET`
- or `GEN_WATCHDOG_SECRET` for backwards compatibility

Manual sweep:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://YOUR_DOMAIN/api/gen/sweep"
```

Manual mark-only watchdog:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://YOUR_DOMAIN/api/gen/watchdog"
```

Deploy readiness check:

```bash
npm run check:cloud-deploy
curl "https://YOUR_DOMAIN/api/health/cloud"
```

## Troubleshooting

### Opt-in course setup backups (Slice C)

`06-course-setups.sql` is a prepared migration for the new workspace setup flow. It has
been applied to the isolated Docker-local `learnable-setup-local` database on 15 September
2026, not to production. For hosted environments, apply it only through an approved staging
release, then deploy `web/api/setups/store.js` with the existing Supabase server environment.
The private `setup-sources` bucket is separate from generation uploads. Do not make it
public or disable RLS to get the preview working.

Verify actual Storage metadata sizes, service-only commit execution, two-account RLS,
immutable uploads, repeat/ambiguous saves and magic-link redirect allowlisting. The static
localhost preview cannot run these server endpoints. Source cleanup/retention and account
deletion need an approved lifecycle policy before production enablement. See
[Slice C release gates](../docs/upgrade/SLICE-C-ACCOUNT-SETUP.md#required-before-enabling-cloud-backups).

### Creator-funded image connection (Phase 2B.1, local only)

`08-openai-provider-connection.sql` expands the server-only vault provider allowlist
from Claude to Claude + OpenAI. It was applied to the isolated Docker-local database
on 16 September 2026. It does not change browser grants/RLS, existing credentials,
course data or storage buckets. Earlier applied migration 07 remains unchanged.

Use `npm run local:migrate` for the guarded local migration runner, then
`node scripts/verify-local-creator-images.mjs` for disposable-account Auth/HTTP/RLS
checks with synthetic OpenAI responses. This does not send requests to OpenAI.

The image feature is off by default (`LEARNABLE_GPT_IMAGES=0`). Creator keys belong
only in the encrypted account vault; no environment/platform-key fallback is used.
Do not enable image UI or paid endpoints before durable request/assets, explicit
cost confirmation and UX/UI acceptance. Hosted application of this migration requires
the separately approved release; no production migration or rollout occurred.
See [the implementation and evidence](../docs/upgrade/CREATOR-FUNDED-IMAGES.md).

### Durable private course images (Phase 2B.2, local only)

`09-course-image-requests.sql` creates private server-written attempt receipts, a
transactional admission function, and a private `course-images` PNG bucket capped
at 8 MB per file. It was applied only to isolated Docker-local Supabase on
17 September 2026. No browser has direct receipt or bucket access, including the
owner; the authenticated server route resolves the owner/course/asset identity.

`npm run local:verify-image-requests` uses real local Auth/HTTP/Postgres/RLS/Storage
and synthetic image responses. It creates and removes only its own disposable data.
`npm run test:image-requests` runs the fault-injected request contract without a
database or provider connection. Paid actions remain disabled until both image
flags and creator UI/confirmation acceptance are in place. Do not enable them on
the live project just because this local slice passed.

Read the [scope, recovery guarantees and remaining gates](../docs/upgrade/CREATOR-FUNDED-IMAGES.md#2b2--durable-requests-and-private-images-17-september-2026)
before a hosted migration or integrating accepted/public image content.

### Atomic image acceptance (Phase 2B.3.1, local only)

`10-accept-course-image.sql` adds a protected acceptance marker and a service-only
transaction that updates the saved course and request receipt together. Applied
only to Docker-local Supabase on 17 September 2026. It checks the course timestamp,
candidate revision/currentness and build state; repeated acceptance is idempotent.
Previously accepted objects are not deleted by candidate cleanup, even after replacement.

Use `npm run local:verify-image-acceptance` for disposable-account DB/Storage tests.
Saved-image UI requires both `LEARNABLE_GPT_IMAGES=1` and
`LEARNABLE_IMAGE_REQUESTS=1` in the dedicated preview config. They remain off in
templates and production defaults. Opening the studio/connecting never generates;
explicit Generate can charge the creator's connected OpenAI account. Existing
asset reads and acceptance do not generate images. The later
`LEARNABLE_CREATION_IMAGES` flag enables the guided initial-creation option only
in the verified local preview; it needs no additional migration. No public bucket
has been enabled. See [UI/QA review](../docs/upgrade/IMAGE-STUDIO-QA.md) and
[creation-image scope](../docs/upgrade/CREATION-IMAGES.md).

### Draft deletion (focused workspace refinement, local only)

`11-delete-course-drafts.sql` adds content-free deletion markers, read-policy
filtering and a service-only revision-checked delete transaction. Existing saves
pass through a deletion-aware wrapper so late requests cannot recreate a removed
draft. Existing courses, jobs and uploaded source originals are preserved.

Applied only to isolated Docker-local Supabase on 17 September 2026. The local
migration runner includes migration 11, and preview readiness requires its column.
Apply it before deploying the new setup/delete routes through an approved hosted
release. Browser roles must not be granted access to either privileged function.
See [UX, retention scope and QA evidence](../docs/upgrade/DRAFT-DELETION.md).

### Reviewed public course images (Phase 4B.2, local only)

`12-course-publications.sql` provides private publication snapshots/reports and a service-only revision-checked publication transaction. `13-publication-images.sql` adds a separate **private** PNG bucket; never mark it public or add browser storage policies. Public image reads must check the current live snapshot through `/api/courses/public-image`. Private originals are retained. Interrupted staging objects are inaccessible; a reference-aware retention policy remains a hosted release prerequisite.

Both migrations are applied only to isolated Docker-local Supabase. The local server enables `LEARNABLE_PUBLIC_IMAGES` only alongside local self-publishing and the existing image capability. Hosted flags remain off. Run `node scripts/verify-local-publication-images.mjs` for disposable local accounts and synthetic PNG tests with no paid provider calls. See [UX, bounds and QA](../docs/upgrade/PUBLIC-COURSE-IMAGES.md).

`14-community-discovery.sql` adds generated public listing search metadata, a partial trigram search index and stable ordering index. It does not change publication visibility, snapshots, RLS or grants. The guarded local migration runner applies it only to isolated Docker-local Supabase. Hosted application and feature enablement remain separate release work. See [Community discovery](../docs/upgrade/COMMUNITY-DISCOVERY.md).

`15-report-moderation.sql` adds explicitly assigned moderator membership, version-bound public report evidence, decision audit and a database constraint preventing restricted publication. `16-moderation-audit-grants.sql` is required: Supabase default grants must be revoked so the service client has only SELECT on audit rows. The decision function appends as its database owner. Both migrations are local-only at this stage. No account is automatically assigned. Run `node scripts/verify-local-moderation.mjs` for isolated disposable role/report/image/replay checks. See [report review UX and security boundaries](../docs/upgrade/REPORT-MODERATION.md) before any hosted enablement.

### Mixed-version account-state protection (release audit, local only)

`17-preserve-versioned-account-state.sql` prevents older whole-blob saves from
erasing omitted course-scoped learning progress and material defaults. It also
advances the account-state revision for old/equal client timestamps, preserving
the upgraded client's conditional-write conflict detection. Applied only to
isolated Docker-local Supabase on 17 September 2026; no existing rows are rewritten.
It does not change ownership/RLS or infer course identity for legacy history.

Run `node scripts/verify-local-state-compatibility.mjs` for 22 disposable-account
Auth/Postgres/RLS checks. The same regression failed before this migration.
Apply this forward migration **before** enabling upgraded learner/preferences in
an approved hosted release. Do not edit applied migrations or reset the database.
Actual deployed-client compatibility and access to unscoped history remain open;
see [the precise guarantees and limits](../docs/upgrade/COURSE-PROGRESS-ISOLATION.md#17-september-compatibility-regression).

### User-reviewed generation checkpoints (release audit, local only)

`18-generation-action-checkpoints.sql` adds a service-only atomic deletion wrapper
that locks the owned generation row, validates the expected status/run, then calls
the existing deletion transaction. Applied only to isolated Docker-local Supabase
on 17 September 2026. No existing rows, retention settings or role memberships change.

Apply migration 18 **before** an approved deployment of the updated generation
endpoints/browser. Readiness checks require the new RPC. All five user actions
(review/cancel/resume/restart/delete) require `expected: { status, runId }`;
old clients without it receive 409 and must refresh. A missing delete RPC fails
closed rather than using the unversioned function. Do not grant browser roles
access or edit the applied migration. The old internal RPC remains for existing
server housekeeping, not for browser actions.

Run `node scripts/verify-local-stale-actions.mjs` for the 33-case Auth/API/DB
regression. See [UX contract, browser evidence and rollout limits](../docs/upgrade/RELEASE-ACCEPTANCE-AUDIT.md#stale-screen-consent-and-recovery).

### Revision-protected course saves (release audit, local only)

`19-course-write-revisions.sql` lazily upgrades a course on its first modern save.
It adds `write_revision`, a direct-write guard, and the owner-checked
`commit_user_course` RPC. The function runs as a dedicated NOLOGIN/NOINHERIT role;
browser and service roles are not members. Image acceptance uses the same commit
inside its transaction. Existing content is not backfilled or deleted.

Applied only to Docker-local Supabase on 18 September 2026. Run
`node scripts/verify-local-course-revisions.mjs` for disposable-account security,
concurrency and rollback checks. Before a hosted rollout, inventory applied SQL
and privileges, then apply approved missing forward migrations through 19 before
the matching APIs. Never edit migrations 01–19 after application. The ordinary
health endpoint does not replace checking this migration/role/trigger inventory.
Old APIs cannot directly update revision-managed rows; there is deliberately no
compatibility fallback. Preserve the guard during rollback and use a compatible
application or maintenance mode. See [guarantees and evidence](../docs/upgrade/COURSE-WRITE-COMPATIBILITY.md).

### Existing setup troubleshooting

- **"permission denied for schema public" when running SQL** — make sure you're using the SQL Editor (which runs as service role), not the Supabase JS client.
- **"role 'authenticated' does not exist"** — Supabase auto-creates this. If missing, your project might still be provisioning — wait a minute and retry.
- **RLS feels too strict** — for development, you can `alter table X disable row level security;` temporarily, but turn it back on before going live with multiple users.
