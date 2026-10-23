# One OpenRouter connection for course creation

The one-key course build is active on [Learnable staging](https://learnable-staging.vercel.app).
It uses a server-owned OpenRouter key for the plan, source research, lessons,
Designer review and illustrations. The implementation, image-loading states and
owner-funded mode are committed on `codex/openrouter-single-key`. Customer credits
and payments remain parked.

**Production rollout is pending.** The latest recorded check, at
2026-10-23 02:02 UTC (22 October Pacific), found no saved `OPENROUTER_API_KEY` in
the production Vercel project `learnable`. The combined production package is
prepared locally, but has not been uploaded or promoted. The redesigned public
Meta course is already live in a separate production release.
[Release status](release-status.json) records the observed deployments, prepared
artifact and remaining gates without credentials or private account data.

This Git branch contains the OpenRouter implementation. The combined production
package also preserves later course and recovery work prepared in the primary
checkout; it is not a build of this branch alone. Do not deploy an old staging
package over the current production app.

The funded four-lesson staging course is complete and reopens with all four
illustrations, 14 quiz questions, four checklists and 24 flashcards. Native PDF,
cited research, both approvals and mixed-model generation passed live. All
31 dispatches are settled at **USD 1.016872**, including failures/corrections and
the one lost-asset image charge. [Live evidence](live-course-verification.json)
separates transport/accounting success from content quality.

**The quality gate remains open.** The lighting lesson confuses apparent shadow
position with physical movement, and its illustration has garbled labels. This
synthetic draft is available for product testing, not approved for teaching or
publishing. FLUX is not yet accepted for labelled instructional diagrams. The
next model comparison should test a frontier image route or simpler briefs.

Work is isolated on `codex/openrouter-single-key`, in
[draft PR #6](https://github.com/productdave/learnable-learn-anything/pull/6).
The dirty primary checkout, parked credit branch and frozen releases are preserved.

## Verified staging activation on 17 October

Deployment `dpl_BYRtrYVoUL4NREUT1D7ZhCRnoSze` removed the testing-allowance
requirement for David's staging account, following his explicit 17 October request.
The saved Subway draft shows **Ready to create** and an enabled **Create course →**;
the final paid action is left for David. [Owner-funded verification](owner-funded-verification.json)
records 143 packaged cases, 85 real local PostgreSQL checks, 15 UI/recovery cases,
218 offline imports, the 86-module graph and hosted/browser checks. No new model
request was made. Package: `output/staging/2026-10-17-owner-funded/release-2Ig0u6`,
5,157 files, eight Hobby functions, SHA256
`953e377a522b3e39055a95ac12bbbe4eee1ea97bfa33850ddb68708b88a897f7`.

Migration 29 adds explicit `owner_funded` accounting scopes with no app test-dollar
limit, call-count allowance or expiry. Only operator provisioning can enable an
account; the server also requires `LEARNABLE_OWNER_FUNDED_ENABLED=1`. The new policy
`openrouter-owner-v3` pins the accepted routes without a daily testing renewal.
Per-request limits, immutable owned jobs, receipts, duplicate protection, unknown
charge holds and pause controls remain. Provider billing/credit availability still
applies; auto-top-up is off. Other accounts remain unenrolled. The migration alone
enables nobody, and existing capped policies retain every limit.

This deployment preserves the visible image-loading placeholder and same-file
retry from `dpl_6sHVyzoakQRKZN2PvT4GCVmN2j4W`.
[Loading-state verification](image-loading-verification.json) records desktop,
phone and live checks. The generation acceptance below used
`dpl_2Fv5qsGPcvxhu1Qac1wjRQoKSVcy` with the Sensitive key,
OpenRouter, setup generation and continuation enabled. The final repair preserved
all staging table counts/full row digests, funding, settings, access and eight
served assets. The earlier activation changed `user_state` during browser sync;
its full pre-upload payload was not retained, so exact preservation of that
particular earlier row is not claimed. This rollout made no production writes.

The earlier USD 5 / 40-call pilot expired `2026-10-14T01:10:14.222Z` and is now
retired. Its original capped budgets, 31 settled receipts and USD 1.016872 total
remain unchanged. A separate owner-funded enrollment supports David's new manual
staging courses; it does not reset or reopen that old test run. Routine assistant
QA outside this authorization retains the standing budget. Reviewing saved content
still makes no AI calls. This change made no production writes.

Original PDF bytes reach the model through owned storage, with size and SHA256
checks. The browser retains the five selected materials and both review gates.
[Source fixture evidence](hosted-fixture-verification.json) records hosted
extraction, private original download and anonymous denial.

Final package `output/staging/2026-10-13-openrouter-image-repair/release-2yNIvR`
has 4,964 files and eight Hobby functions; report SHA256
`b961b167613da862ebd75143a6dceb8b0cda5f1fd7b600a307330a876832415c`.
Unrelated assets/Admin are preserved and the temporary receipt diagnostic is gone.
The lesson writer owns normalization/full validation and its bounded correction.
Seven receipt GET attempts tolerate indexing delay without repeating a paid POST.
The initial image failure is consistent with indexing delay; its original error
body was not retained, so that cause is not proven. The known USD 0.014 charge was
reconciled before an explicit replacement. No uncertain holds remain.

All **177 source cases**, 84 Designer UI assertions, 43 workspace assertions,
59 actual-package cases, 218 offline imports and seven provider guards pass.
Account, completed workspace, all four lesson images and 24-card review passed
live browser checks. Reopening kept the request count at 31. Human content review
found the quality issues above; no broad quality or latency benchmark is claimed.
Private activation/QA receipts are under
`output/staging/2026-10-13-openrouter-activation/`.

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

Required server settings for an explicitly activated environment:

- `OPENROUTER_API_KEY`: Sensitive server variable in the intended Vercel project
  and environment. Staging uses **learnable-staging**; production uses
  **learnable**, with the **Production** environment selected. A key saved in
  staging does not configure production. Never put it in browser config, source
  control or chat.
- `LEARNABLE_GENERATION_PROVIDER=openrouter` and `LEARNABLE_OPENROUTER_ENABLED=1`.
- Existing setup-generation and continuation settings, plus an operator-created
  reviewed policy and enrollment.
- Owner-funded enrollment additionally requires migration 29 and
  `LEARNABLE_OWNER_FUNDED_ENABLED=1`. Capped trials retain their bounded allowance.

The fresh package sets the public `MANAGED_COURSE_GENERATION` display flag. It
confers no server permission. All actual model work still requires an owned job,
current policy and atomic dollar reservation. Explicit Restart and review
revision use the persisted `run_id` to authorize a new operation scope; a new
lease or Resume does not. Capped pilot policies expire after at most 24 hours;
their renewal remains an operator gate. The separately provisioned owner-funded
mode has no app testing expiry. There is no automatic renewal or credit reload.

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

## Earlier key-refresh deployment

The key is configured and deployment `dpl_GsMWjKLYyrgHGrcNprWecDkzTaxe` is Ready
at [Learnable staging](https://learnable-staging.vercel.app). Vercel confirms the
new deployment includes `OPENROUTER_API_KEY`; its secret value was never revealed.
David approved a CLI upload after Vercel rejected browser redeployment of the
prebuilt package. All 4,866 output files match the newer accepted Admin staging
package. Eight functions, 216 offline imports and seven direct-provider guards
passed. Six hosted assets match; health/authentication checks and eight
signed-in API/access checks passed. The temporary session was revoked.

[Key refresh verification](key-refresh-verification.json) records that earlier
result. At that point, the four pilot/funding tables were empty. Model calls, key
validity and complete-course acceptance had not yet been tested. Production was not written by this rollout.

Artifact: `output/staging/2026-10-12-openrouter-key-refresh/release-NOtRHg`;
report SHA256 `76a4e0311519f0e37a9fa84e82ab53aa168106b2c0e9ed5d20403e892b4cd72f`.

## Earlier hosted staging result

[Hosted verification](hosted-verification.json) records the staging-only migration
and deployment `dpl_6tWED2eWPe1XRP1t2qLCY4SqirCD`. Existing data and permissions
are preserved. At that point, all four new funding/admission tables were empty, with no grants
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

Complete the production credential handoff, then follow the current after-course
rollout README in the primary checkout at
`output/diagnostics/2026-10-22-openrouter-after-course/README.md`. The approved
sequence is final baseline, candidate upload without moving the public domain,
exact uploaded-file verification, candidate course/access checks, signed-in owner
readiness with unchanged spending records, promotion and canonical verification.
Candidate Account → Check status uses `GET /api/providers/connection` without
starting generation. Configuration readiness does not prove provider credential
acceptance; a paid production generation test has not run.

The original bounded course is complete. Its logical QA run,
`openrouter-staging-20261011`, is closed at US$1.016872 across 31 settled requests.
Do not reopen the pilot, reapply migrations or repeat an uncertain paid call.
The photography sample's teaching and labelled-image quality issues remain open;
they are separate from the revised public Meta course's acceptance.

This documentation update makes no provider calls. Recorded cumulative provider
QA is US$22.665710 plus historical unpriced items. Routine assistant QA still has
a US$5 cap across each whole logical run, including text, search, images and
retries. The requested US$250 provider-key limit does not expand that permission.

Protocol references: [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
[OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[native search](https://openrouter.ai/docs/guides/features/server-tools/web-search),
[image generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation),
and [BFL image pricing](https://bfl.ai/pricing?category=flux.2).
