# OpenRouter first: saved provider routing

The one-key migration is back ahead of learner credits. This slice connects the
existing OpenRouter text adapter to the real course runner and recovery routes.
It is locally tested; a complete illustrated course through one key is **not yet
ready**. Research, PDFs, Designer routing and image generation still need their
own integration and live acceptance.

Work is on `codex/openrouter-single-key`, based on `codex/openrouter-generation`.
Credit work remains on `codex/openrouter-credits` in [draft PR #5](https://github.com/productdave/learnable-learn-anything/pull/5).
The primary dirty checkout and frozen release artifacts are preserved.

## What changed

- An owned job's immutable policy chooses its gateway and model routes. The
  runner re-reads this binding; a caller's key or current model environment cannot
  silently move a saved job to another provider.
- Approved saved OpenRouter jobs resolve `OPENROUTER_API_KEY` on the server. Their
  outline uses the frontier route and their lessons use the selected open-weight
  route. Existing schema validation, human review and saved course workflow remain.
- Review, Resume, restart, sweep and timed continuation use one credential and
  capability resolver. Errors keep review/checkpoint state and ask for operator
  attention when appropriate. Saving a legacy Claude key cannot revive or rewrite
  an OpenRouter job.
- The runner connects the existing scoped dollar ledger to every supported call.
  Three approved budget scopes, a current reviewed policy and the active job lease
  remain required. This adds no credit wallet, grants or automatic top-ups.
- New starts selected for OpenRouter stop before source extraction or personal
  key lookup. Existing starts can still reattach. Native research/PDF and image
  requests fail before paid dispatch, rather than dropping sources or using OpenAI.
- Legacy jobs retain their direct-provider path, including image-only recovery.
  The explicit credential-save endpoint now checks job ownership before looking
  for a key, returning 404 for an inaccessible job.

## Configuration and limits

`LEARNABLE_OPENROUTER_ENABLED=1` permits the resolver to consider **already
provisioned** OpenRouter jobs. `OPENROUTER_API_KEY` is server-only. Neither variable
creates a job, allowance, policy or enrollment. Missing key, disabled routing,
expired/corrupt policy or missing budget binding stops dispatch without fallback.

`LEARNABLE_GENERATION_PROVIDER=openrouter` selects the future public start path;
it currently reports that integration is incomplete and buys no work. Leave new
starts on the existing configuration until the remaining gates pass. No hosted
environment variable was set by this implementation.

The policy's current 24-hour price window is deliberately enforced. A long human
review cannot silently refresh its policy or receive another allowance. Append-only
operator renewal and safe new-job admission remain OR-02 work. Identical settled
operation replay remains blocked by the existing ledger; deliberate regeneration
needs explicit operation/cycle authorization before general pilot use.

## Verification

32 new offline tests exercise the actual runner and HTTP handlers with synthetic
provider responses and database I/O. They cover an outline saved at curriculum
review; three open-weight lessons with quizzes/flashcards saved as one course;
review/restart/Resume/sweep/continuation; unchanged funding binding; missing or
expired authorization; no legacy key reads; image/PDF/search gates; public-start
checks and duplicate reattachment.

The combined core suite passes **240 tests** (32 new plus 208 existing provider,
runner, deadline and continuation checks). Fourteen supporting regression scripts
also pass, including source retention, legacy key recovery, setup generation,
Hobby function packaging, module syntax and the Designer spending guard. Earlier
source-string assertions were updated to the new resolver/client names while
retaining their ordering and heartbeat checks. The owner-isolation expectation
was updated for the deliberate earlier 404 check; no access check was removed.

Replay the new gateway tests with `npm run test:openrouter`. Exact commands and
results are in [verification.json](verification.json). Full logs are under
`output/qa/2026-10-11-openrouter-single-key/` in this checkout.

These are offline runtime tests, not actual model-quality or hosted tests. This
phase ran no browser application QA, live model calls, shared/hosted migrations,
or manual deployments. The existing 41 disposable PostgreSQL ledger checks are
prior foundation evidence; they were not rerun or counted in this phase.

## What's next

1. OR-03: native PDF and bounded search/citation transport, with faithful evidence
   and structured research submission through the same OpenRouter key.
2. OR-04: compare frontier and open-weight drafting on identical source fixtures;
   wire and verify both Designer tasks without losing protected content.
3. OR-05: integrate a conservatively priced image route, receipts, durable assets
   and additive provenance; retain readable historical OpenAI assets.
4. Complete operator admission and long-review renewal, reconcile newer primary
   runtime changes/migration numbering, then test a small complete course in a
   fresh staging package. Production activation requires separate authorization.
5. Return to learner credits, usage reporting and checkout after this works.

OpenRouter's official [Messages API](https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages),
[web search](https://openrouter.ai/docs/guides/features/server-tools/web-search) and
[image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
were rechecked as integration references. They do not prove Learnable's native
citations, selected endpoint access, image price bound or accepted output quality.
The candidate model prices were not freshly accepted for paid use in this phase.

## QA spending

Logical run: `openrouter-single-key-20261011`. Text US$0; provider search US$0;
images US$0; retries US$0. Total **US$0**. Cumulative recorded assistant QA remains
**US$14.355246 plus one archived unpriced text charge**. No allowance was opened,
subscription upgraded or credit auto-reload enabled.
