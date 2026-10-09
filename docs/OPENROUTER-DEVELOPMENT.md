# OpenRouter implementation status

The first implementation slice adds a server adapter, fixed task routes, a durable
spending ledger and tests against the actual curriculum and lesson stages. It is
development infrastructure: the hosted job runner still uses the existing creator
connections. No setting in this slice switches a hosted job to OpenRouter.

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

1. Finish OR-02: one funding resolver across start, review, Resume, restart,
   credentials-ready, sweep/continuation and image recovery. Bind approved grants
   and the policy at job creation, construct task-specific clients from the saved
   snapshot, preserve creator-funded recovery, and add full endpoint tests.
2. Complete OR-03 with a server-side OpenRouter key: verify exact model/provider
   IDs, strict schema compatibility, native PDFs, search bounds and citation
   provenance. Account for evidence gathering and structured submission as
   separate requests when required.
3. Run the OR-04 paired course evaluation before accepting a default model mix.
   Compare factual quality, useful draft completeness, component preservation,
   total cost and latency. Model choices in this code remain hypotheses.
4. Implement OR-05 image request pricing, durable receipt/assets and recovery,
   then OR-06 server-granted test credits and the no-BYOK pilot interface.
5. Verify a fresh staging package before proposing a production migration.

An OpenRouter key alone is not an activation switch. No live model, research,
image, end-to-end platform funding or hosted acceptance is claimed here. Future
assistant QA shares one US$5 cap across a logical run, including all parallel
requests and retries. Real purchases and credit pricing remain separate work.

The canonical tracker is the existing
[Learnable roadmap](https://app.notion.com/p/3f471b32838481cb8c69fd30cafd18a7),
with OR-01–OR-06 linked under platform-funding task AD-08.
