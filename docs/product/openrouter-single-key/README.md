# One OpenRouter connection for course creation

The private-pilot implementation is ready for a bounded staging trial. It uses
one server-owned OpenRouter key for the course plan, source research, lessons,
Designer review and illustrations. Learner credits and payments remain parked.
**The paused one-key build is now on [staging](https://learnable-staging.vercel.app).**
Migrations 27/28 and hosted access checks passed. The Sensitive OpenRouter key
is now included in the new staging deployment. Generation remains paused pending
bounded pilot activation; the full course test still needs to run. No allowance or
model call was made in this rollout; no production write was performed.

Work is isolated on `codex/openrouter-single-key`, in
[draft PR #6](https://github.com/productdave/learnable-learn-anything/pull/6).
The existing dirty main checkout, parked credit branch and frozen releases are
preserved. This extends the earlier saved-job routing slice; its historical
[verification record](verification.json) remains separate.

## Pilot activation candidate — not deployed

Current staging still serves the verified key refresh with generation paused.
A new candidate fixes a gap in the actual setup flow: original PDFs now reach
OpenRouter planning and research, alongside extracted source text. Files are
loaded from owner-scoped storage and checked against their reviewed byte count
and SHA256 before any model reservation. Resume uses the saved source manifest.
Existing legacy PDF thumbnails remain; this change does not create thumbnails
for setup-source PDFs.

The fresh package preserves current browser/Admin assets and changes only the
runner and its new PDF resolver in two function bundles. It passes 165 focused
source cases, 47 actual-package cases, 218 imports and seven direct-provider
guards. Ten real disposable PostgreSQL operator checks passed, as did 50 document
parser checks and the three existing PDF/heartbeat regression scripts.

Current catalog review confirms the pinned routes/prices. A four-lesson course
fixture includes an original three-page PDF, notes and all selected materials.
One pilot is prepared with a shared USD 5 ceiling and a USD 3.90 estimate including
correction contingency; no enrollment, allowance, deployment or provider call
was made in this preparation. CLI authorization for remaining staging deployment
is pending after the earlier one-upload exception. Live acceptance is still open.

See [pilot preparation evidence](pilot-preparation-verification.json).

## What changed

| Course work | Candidate route | Role |
| --- | --- | --- |
| Plan and source research | Claude Sonnet 5.5 through Anthropic | Frontier reasoning, native PDFs and cited evidence |
| Lesson drafts | DeepSeek V4.1 Flash through Parasail FP8 | Open-weight cost/performance candidate |
| Course and lesson design review | Claude Sonnet 5.5 through Anthropic | Preserve factual meaning, sources and learning checks |
| New illustrations | FLUX.2 Klein 4B through Black Forest Labs | Open-weight raster generation with stored assets |

These are candidate selections, not a quality or latency benchmark. Qwen remains
a comparison option. Requests pin catalog endpoint tags; receipts validate the
provider's display name. There is no automatic provider fallback.

PDF bytes stay native. Research first gathers evidence with at most one native
search, saves its notes/citations under the owned runner lease, then makes a
separate structured submission. This avoids Claude's incompatible citation/JSON
combination. A time-slice resume reads the saved evidence without repeating the
search. The original application validators still enforce constraints after
Claude's transport schema is simplified.

Designer proposals are validated by the existing Designer stage, which retains
its one bounded correction against the original saved lesson. Known paid invalid
outputs retain usage; uncertain requests retain their dollar reservation. Image
bytes, receipts and additive `generated_by: openrouter` provenance are validated
before durable attachment. Existing OpenAI assets remain readable.

Account and Create use the current layout with one connection status and no
personal API key forms in managed mode. Shared image help across Experience,
Review and Create no longer describes separate Claude/OpenAI accounts. Sources,
materials, confirmations, both human reviews and the Admin entry remain. The
legacy tutor and post-course AI editing are separate, unmigrated flows; this
candidate's server package blocks direct paid Claude/OpenAI generation.

## Funding and configuration

This is operator-funded admission, not a customer credit wallet. Migration
`db/27-platform-ai-spend.sql` is the earlier dollar ledger renamed from 25 to
avoid the newer Admin migration. `db/28-openrouter-pilot-admission.sql` adds
private pilot admission and the research evidence checkpoint. Installation
creates no enrollment or spending allowance. Service-only RPCs authorize owned
jobs against pool, owner and job limits; the runner re-reads the immutable binding.

Required server settings for an explicitly activated trial:

- `OPENROUTER_API_KEY`: Sensitive server variable in the **learnable-staging**
  Vercel project. Never put it in browser config, source control or chat.
- `LEARNABLE_GENERATION_PROVIDER=openrouter` and `LEARNABLE_OPENROUTER_ENABLED=1`.
- Existing setup-generation and continuation settings, plus one operator-created
  reviewed policy and bounded pilot allowance.

The fresh package sets the public `MANAGED_COURSE_GENERATION` display flag. It
confers no server permission. All actual model work still requires an owned job,
current policy and atomic dollar reservation. Explicit Restart and review
revision use the persisted `run_id` to authorize a new operation scope; a new
lease or Resume does not. Policies expire after at most 24 hours. Long-review
renewal remains an operator gate; there is no automatic renewal or reload.

## What has been checked

[Staging candidate verification](staging-verification.json) records:

- 422 combined offline Node tests, including actual runner and handler paths.
- 41 real disposable PostgreSQL ledger checks and 23 admission checks.
- 18 supporting regression scripts passed during this phase.
- Actual mixed-model runner with three lessons, frontier review/refinement,
  two synthetic PNG assets, bounded correction and duplicate-free resume.
- Actual research runner interrupted between evidence and submission, then
  resumed with its citations and no repeated search.
- Local Chromium checks of actual Account/Create components at desktop and
  mobile sizes with synthetic readiness; no key fields or horizontal overflow,
  paused state cannot start, image help closes with Escape, zero console errors.
- Fresh eight-function Hobby package: 216 module imports and seven direct-provider
  guards passed without network access. Accepted Admin assets remain in the parent.

Replay core gateway checks with `npm run test:openrouter`; the larger combined
command and evidence hashes are in the verification JSON. Local screenshots are
under `output/playwright/openrouter/`. The packaged candidate is
`output/staging/2026-10-11-openrouter/release-Vcuz5U`, SHA256 of packaging report
`dc69bd2a3e3b512f65005775c9d16da6656d68dbc310e26a74c9381dc447eeee`.
Earlier packages from this phase are superseded and must not be deployed.

## Current deployment: key refresh verified

The key is configured and deployment `dpl_GsMWjKLYyrgHGrcNprWecDkzTaxe` is Ready
at [Learnable staging](https://learnable-staging.vercel.app). Vercel confirms the
new deployment includes `OPENROUTER_API_KEY`; its secret value was never revealed.
David approved a CLI upload after Vercel rejected browser redeployment of the
prebuilt package. All 4,866 output files match the newer accepted Admin staging
package. Eight functions, 216 offline imports and seven direct-provider guards
passed. Six hosted assets match; health/authentication checks and eight
signed-in API/access checks passed. The temporary session was revoked.

[Key refresh verification](key-refresh-verification.json) records the current
result. The four pilot/funding tables remain empty. Model calls, validity of the
key against OpenRouter, complete-course QA and authenticated browser course flow
are still untested. Production was not written by this rollout.

Artifact: `output/staging/2026-10-12-openrouter-key-refresh/release-NOtRHg`;
report SHA256 `76a4e0311519f0e37a9fa84e82ab53aa168106b2c0e9ed5d20403e892b4cd72f`.

## Earlier hosted staging result

[Hosted verification](hosted-verification.json) records the staging-only migration
and deployment `dpl_6tWED2eWPe1XRP1t2qLCY4SqirCD`. Existing data and permissions
are preserved. All four new funding/admission tables are empty, with no grants
or enrollment. Eight authenticated API/access checks passed: managed paused
readiness, rejection of personal-key setup, preserved owner Admin access and
private ledger/RPC boundaries. The temporary owner session was revoked.

Six migration-wrapper checks passed on disposable local PostgreSQL before the
hosted migration. The deployed derivative passed 216 module imports and seven
direct-provider guards. Six served assets match their frozen hashes; health and
unauthenticated route checks passed. Signed-out Home and Account sign-in were
viewed in hosted Chromium at desktop/mobile sizes with no overflow or console
errors. Authenticated Account/Create UI evidence remains local, as described above.

Deployed artifact: `output/staging/2026-10-11-openrouter/release-Kk1xFu`, report
SHA256 `64a13cf8db9b729a96f9c648e87711da9824adb63a16375916e10d91c9edcacd`.
The `release-Vcuz5U` package above is its frozen source, not the current deployment.
Rollout receipts are under `output/staging/2026-10-12-openrouter-closed/`.

## What's next

1. The key configuration/deployment step is complete. Keep its value server-only.
   Live key validity and selected-model access still need the bounded course test.
2. Re-read current staging state, review catalog pricing/access and check for
   newer accepted runtime work. Migrations 27/28 are installed; do not reapply.
   Create one explicit pilot enrollment with a whole-run US$5 ceiling. Keep old
   allowances closed.
3. Activate a fresh verified candidate on staging. Test a small PDF/source-backed
   course through plan review, research review, lessons, Designer, images and
   reopen/resume. Check actual receipts, course quality and mobile behavior.
4. Record remaining funds/holds, staging results and any required repairs before
   saying David can test the complete flow. Production release is a later action.

Current logical QA run `openrouter-staging-20261011`: text, search, images and
retries each US$0. Cumulative recorded assistant QA baseline is US$19.259934 plus one
archived unpriced text charge. The US$5 cap includes every stage and retry.

Protocol references: [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
[OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[native search](https://openrouter.ai/docs/guides/features/server-tools/web-search),
[image generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation),
and [BFL image pricing](https://bfl.ai/pricing?category=flux.2).
