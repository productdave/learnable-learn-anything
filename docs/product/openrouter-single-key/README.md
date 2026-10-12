# One OpenRouter connection for course creation

The private-pilot implementation is ready for a bounded staging trial. It uses
one server-owned OpenRouter key for the course plan, source research, lessons,
Designer review and illustrations. Learner credits and payments remain parked.
**Hosted acceptance is still open:** the key is missing from `learnable-staging`.
No shared migration, manual staging deployment or live model call was made in
this phase. Production remains unchanged.

Work is isolated on `codex/openrouter-single-key`, in
[draft PR #6](https://github.com/productdave/learnable-learn-anything/pull/6).
The existing dirty main checkout, parked credit branch and frozen releases are
preserved. This extends the earlier saved-job routing slice; its historical
[verification record](verification.json) remains separate.

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

## What's next

1. Confirm the sensitive key exists in the staging project's Production and
   Preview environments. Those names refer to environments inside the staging
   project; do not change the live Learnable project.
2. Re-read current staging state, review catalog pricing/access and check for
   newer accepted runtime work. Apply migrations 27/28, then create one explicit
   pilot enrollment with a whole-run US$5 ceiling. Keep closed allowances closed.
3. Deploy a fresh verified candidate to staging. Test a small PDF/source-backed
   course through plan review, research review, lessons, Designer, images and
   reopen/resume. Check actual receipts, course quality and mobile behavior.
4. Record remaining funds/holds, staging results and any required repairs before
   saying David can test the complete flow. Production release is a later action.

Current logical QA run `openrouter-staging-20261011`: text, search, images and
retries each US$0. Cumulative recorded assistant QA is US$14.592942 plus one
archived unpriced text charge. The US$5 cap includes every stage and retry.

Protocol references: [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
[OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[native search](https://openrouter.ai/docs/guides/features/server-tools/web-search),
[image generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation),
and [BFL image pricing](https://bfl.ai/pricing?category=flux.2).
