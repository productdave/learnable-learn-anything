# Funded access and Account — F-01

## Where we're at

The first credits feature is built on `codex/openrouter-credits`, on top of the
OpenRouter foundation in `codex/openrouter-generation` / draft PR #4. Local tests
pass. F-01 stays **In progress** until integration with the newer app and the
remaining acceptance checks are complete. This branch is not a release candidate.

Learners can see their credit access and complimentary balance without setting
up a provider key. New funded creation remains unavailable until quotes, holds,
debits and the funded runner are ready. Production has not been changed by this work.

## What changed

- A verified-user `GET /api/account/access` returns server-owned eligibility and
  balance. It ignores client-supplied owner IDs and does not cache private data.
- Migration 26 adds enrollment and complimentary grants. PostgreSQL enforces
  owner-scoped reads and exact, concurrent-safe grant replay. Only the database
  operator can enroll or grant; browser and application service roles cannot.
- Account and Create show included, empty, not invited, paused, revoked, expired
  and unavailable states. Unknown balances are never shown as zero. Expired or
  paused balances are labelled Unspent rather than Available.
- Account keeps identity, sign-out, native dialog behavior and conditional older
  course connections. Refresh clears stale values and restores focus. Account
  changes/close discard late responses. Existing saved-course/default workflows
  are unchanged in this baseline; the newer Admin entry needs integration.
- Direct and setup-based new starts check server funding before reading provider
  keys, inspecting source URLs or dispatching work. Existing owned jobs still
  reattach. The remaining paid entry points keep their existing legacy behavior;
  the complete funded resolver belongs to F-03 and must precede funded dispatch.
- Add credits and Usage history are visible, disabled placeholders with an
  explanation. They do not buy credits or show fabricated history. P-01 and
  H-01 deliver those features separately.

These are **Learnable credits**, not model tokens or provider dollars. This is a
grant-only schema: available is the sum of complimentary grants; reserved and
used are zero because no hold/debit operation exists. Do not enable spending
against this projection. F-02 must replace it with atomic learner accounting.
No bundle price, markup, expiry policy or revenue claim has been adopted.

## Local evidence

`node scripts/verify-funded-access.mjs /absolute/path/to/.env.preview.local`
ran successfully against the loopback-only Learnable Supabase stack.

| Check | Result |
| --- | --- |
| New backend/client and DOM behavior tests | 39 passed |
| Disposable PostgreSQL grant/RLS/concurrency checks | 23 passed |
| Real local Auth/PostgREST checks | 20 passed: two temporary users and a second session |
| Preserved Account and setup tests | 14 + 44 passed |
| Generation request deadline tests | 71 passed |
| Grouped route tests | 56 passed; 27 routes remain within 8 function groups |
| OpenRouter adapter/stage tests | 41 passed with synthetic provider responses |
| Provider USD ledger tests | 41 passed in a disposable database |
| Browser cache and module syntax | Passed; 83 reachable browser modules |
| Browser fixture | 19 passing assertions; 375/1280px screenshots, light/dark |

The real Auth test applies the identical migration under unique test table and
function names in local PostgreSQL. It calls the real Auth service and uses JWT
scoped PostgREST/RLS; it removes only its temporary objects and users. The raw
migration is also tested separately in a disposable database. This is not a full
shared-schema migration replay, hosted test, or browser sign-in journey.

Artifacts: `output/qa/2026-10-11-funded-access/automated-results.json`, individual
suite logs, `browser-verification.json`, `account-desktop.png`,
`account-mobile.png`, and `account-mobile-dark.png`. A small portable summary is
saved beside this file as `verification.json`.

The initial packaging test expected 26 routes and was updated for the new read
endpoint. Browser locator evaluations for focus/geometry timed out; focus was
read from DOM snapshots and layout inspected in screenshots. An immediate
last-to-first Tab assertion was not confirmed. Refresh focus, the next Tab and
Escape passed; complete native focus-boundary and screen-reader acceptance stay
open. No AI calls occurred: text/search/images/retries US$0. Cumulative recorded
QA remains US$14.355246 plus one archived unpriced text charge.

## Configuration and release gates

1. Apply migration 26 before serving these handlers. A missing/broken schema
   fails closed; new legacy creation also waits for access to be readable.
   Migration 25 in this branch and the newer observability migration in the
   primary checkout have a numbering collision to resolve before a full replay.
2. `LEARNABLE_FUNDED_ACCESS=legacy` is the default: unenrolled users keep the
   legacy path. Persisted platform enrollment is always read; switching the flag
   off pauses an enrolled account and never converts it back to BYOK.
   `pilot` makes unenrolled users not invited. Explicit legacy enrollment keeps
   older creators on their existing path. Neither value enables funded generation.
3. Enroll only through an authorized operator process. Complimentary grant calls
   require an operator role, a stable UUID grant key, integer amount and reason.
   Runtime service credentials cannot mint. There is no public grant endpoint.
   This change creates no default balances or invitations.
4. Reconcile the newer reviewed Account/Admin, continuation, recovery and cache
   changes from the primary checkout. Preserve its dirty work and frozen releases.
   Test the merged result; do not deploy this older branch over the current app.
5. Complete full local migration replay, connected browser sign-in/account switch,
   assistive technology/focus boundary checks, actual package and staging QA.
   Hosted migration, activation and release need their own authorization.

## What's next

Finish F-01 integration and acceptance, then F-02 quotes, consent and atomic
credit holds/debits. H-01 usage reporting must land before F-03 funded outline
creation. Research, mixed-model lessons, images, recovery, operator economics and
test checkout follow. Revalidate model choices/prices before any live OpenRouter
QA; this phase did not benchmark or accept a new model route.

Start a local synthetic Account preview with `node scripts/preview-funded-account.mjs`.
It prints a loopback URL and has no API credentials, payments or provider calls.
