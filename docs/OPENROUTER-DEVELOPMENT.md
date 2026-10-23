# OpenRouter implementation status

## 11 October — return to one-key provider integration

David has moved API consolidation ahead of further learner-credit work.
`codex/openrouter-single-key` now connects the saved OpenRouter policy to the
actual curriculum/lesson runner and the review, Resume, restart, sweep and
continuation entry points. The server key is resolved from `OPENROUTER_API_KEY`;
platform jobs never read an owner’s Claude key. New starts, research/PDF and
illustration work remain explicitly gated pending their acceptance.

32 new offline checks pass, including the actual runner saving an outline for
human review and three lessons using synthetic gateway receipts. The existing
provider/runner/deadline/continuation regression suite and 14 supporting scripts
also pass. See [this slice’s evidence and remaining gates](product/openrouter-single-key/README.md).

Credit F-01 is preserved on `codex/openrouter-credits` in draft PR #5. Customer
credit quotes, debits, bundles and payments are deferred. Internal provider-dollar
reservations remain required; no hosted activation or paid acceptance is implied.

## Historical foundation — 9 October

The first implementation slice adds a server adapter, fixed task routes, a durable
spending ledger and tests against the actual curriculum and lesson stages. That
foundation was development infrastructure. The 11 October routing slice above now connects the adapter to the actual runner for approved saved jobs;
public new-job activation is still gated.

Work is isolated on `codex/openrouter-generation`. The branch includes the deployed
Designer rationale repair as a separate baseline commit, so later packaging does
not accidentally discard that repair. Do not deploy this branch as a replacement
for the accepted production artifact without the remaining acceptance work.

## What is implemented

| Area | Behavior |
| --- | --- |
| Task policy | A frozen, fingerprinted policy records model, serving provider, reasoning settings, price ceilings, output limits and an explicitly reviewed price window of at most 24 hours. |
| Text transport | Server-only Chat Completions adapter requests JSON schema output and normalizes validated data into the existing named-tool response format. |
| Routing | Curriculum/research/Designer candidates use `anthropic/claude-sonnet-5.5`; lessons default to `deepseek/deepseek-v4.1-flash`, with `qwen/qwen3.6-35b-a3b` or the frontier model as explicit comparison policies. There is no automatic model/provider fallback. |
| Accounting | Reserve before dispatch, settle the returned OpenRouter cost before using content, retain pending reservations and halt bound allowances when the outcome is uncertain. |
| Database | Atomic pool, owner and job caps; active lease and policy expiry checks; immutable job bindings; duplicate operation and receipt protection; scoped, idempotent settlement. |
| Stage compatibility | Real curriculum and lesson functions work with synthetic OpenRouter responses. Invalid paid lessons can use the existing second attempt; both costs are retained. Refusals and uncertain charges do not trigger a correction. |

The fingerprint detects changes; it is not a cryptographic signature or an
entitlement. The trusted server must save the policy and approved budget IDs when
creating a new job. Migration 25 prevents later changes to that binding, including
changing an existing creator-funded job into a platform-funded job.

The schema request does not establish that every provider enforces strict output.
The adapter also requires a local result validator. Native PDF inputs, search,
citations, image generation, caching controls and unreviewed request fields are
rejected before reservation. Their capabilities are not silently approximated.

## Spending and recovery

Amounts are integer micro-US-dollars. A reservation includes the full model input
context at the configured ceiling plus the requested output limit. This is
deliberately conservative and may reduce concurrency within a small allowance.
No character-to-token estimate is used as a hard price guarantee. The gateway
request pins the serving provider and prompt/completion price ceilings.

`usage.cost` is the settlement source. Missing cost, unexpected provider/model,
invalid usage, a lost response or an unconfirmed database settlement retain the
reservation. A pending request from an earlier runner prevents automatic dispatch
under a new lease. The current pilot policy halts all three bound allowances on
uncertainty, including the shared pool. Reconciliation is an explicit future
operator workflow; settlement does not silently reopen a halted pool.

A known paid schema failure remains a charge. The lesson writer allows at most
two attempts in total and includes generic corrective feedback without copying
the rejected output into logs or the next prompt. This does not yet implement
quality-based frontier escalation or a job-wide attempt history.

Migration 25 creates no grants, balances or enabled jobs. The runtime service role
can execute the scoped accounting RPCs but cannot mint allowances or directly edit
ledger rows. It has been tested only in a disposable local PostgreSQL database,
not applied to the shared development, staging or production database.

## Run the local checks

Install the repository dependencies, then run:

```sh
npm run test:openrouter
```

These checks use synthetic receipts and the real course stages. They make no
network requests and require no provider key.

With the existing local Supabase Docker stack running:

```sh
npm run test:platform-ai-spend-db
```

The database test creates a uniquely named temporary database in
`supabase_db_learnable-setup-local`, applies migration 25 against a minimal job
table, runs actual SQL and concurrency checks, and removes only that temporary
database. It does not prove a full migration replay or hosted acceptance.

## Next implementation work

1. OR-03: preserve native PDF content and cited, bounded search through OpenRouter.
2. OR-04: compare the candidate open-weight lesson route against the frontier baseline, including selected tools, factual accuracy, source fidelity and cost of corrections.
3. OR-05: use the same key for illustrations; prove pricing bounds, gateway receipts, raster output, durable storage and uncertain-outcome recovery. Preserve existing OpenAI assets.
4. Finish operator admission for new jobs and renewal after a long review. Reconcile newer runtime changes and migration numbering, then use a fresh staging package for one small complete course.
5. Resume the funded learner experience and credit features after single-key course creation works. Keep the existing product definition and design; revise sequencing rather than rebuilding them.

The customer credit ledger is separate from provider-dollar spending controls.
The current routing slice deliberately does not need migration 26 or the Account
credit UI. No new OpenRouter job can be created through public endpoints yet.
An operator-seeded job needs migration 25, an immutable policy and three approved
budget scopes; this phase has not applied those to shared or hosted databases.

The [product delivery plan](product/openrouter-delivery/index.html) now leads with
this provider-first sequence. Existing credit work and tests remain in
[draft PR #5](https://github.com/productdave/learnable-learn-anything/pull/5).
OR-01–OR-06 remain the gateway engineering workstreams in the existing
[Learnable roadmap](https://app.notion.com/p/3f471b32838481cb8c69fd30cafd18a7).

No live quality, price, research, image or hosted acceptance is claimed. Future
assistant QA shares one US$5 cap across a whole logical run including text,
search, images, retries and parallel calls. Production release remains later.
