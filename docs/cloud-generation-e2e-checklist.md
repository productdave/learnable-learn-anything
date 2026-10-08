# Cloud Generation E2E Checklist

Use this before calling the agentic cloud architecture done. These checks need a deployed Vercel app with Supabase env vars, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` configured.

## Deploy Readiness

- `npm run check:cloud-deploy` passes from the repo root.
- `/api/health/cloud` returns `200` with `ok: true`.
- Supabase has run `db/04-agentic-workflow.sql` after the older schema/RLS migrations.

## Account Gate

- Signed-out user clicks **New course**.
- Account modal opens.
- Course form does not open until the user is signed in.

## Curriculum Checkpoint

- Signed-in user starts a course with topic, goal, source text, at least one URL, and optionally a PDF.
- `generation_jobs` row is created with `owner_id`, `user_brief`, and `status = running`.
- Job pauses at `status = review_curriculum`.
- Closing and reopening the browser shows the same curriculum review.
- Submitting feedback with **Revise curriculum** returns to `running`, then pauses again at `review_curriculum`.
- **Approve curriculum** moves to the research stage.

## Research Checkpoint

- Research completes and pauses at `status = review_research`.
- Closing the browser or switching devices shows the same research review.
- **Rerun research** keeps the curriculum, clears previous research, and returns to `review_research`.
- **Approve research** starts lesson writing.

## Timeout Recovery

- Force a job lease into the past while it is `running`.
- `/api/gen/sweep` marks it `timed_out`, claims it, and returns it to `running`.
- The job resumes from the latest checkpoint instead of restarting completed work.
- A timed-out intake job returns to `review_curriculum`.
- A timed-out research job returns to `review_research`.
- A timed-out lesson-writing job resumes missing lessons and saves the course.
- After repeated automatic recovery attempts, cron leaves the job recoverable instead of spending tokens forever.
- **Restart** on a failed/timed-out job clears generated checkpoints, keeps the original brief/PDF refs/source URL extraction, and returns to `review_curriculum`.

## Cancel And Delete

- Cancelling a running job marks the durable row `cancelled`.
- Cron sweep does not resume cancelled or cancelling jobs.
- Deleting a failed, partial, or review-paused job removes the `generation_jobs` row so it does not reappear on another device.

## Course Sync

- Completed course is upserted into `user_courses` under the signed-in owner.
- Course appears in the dashboard after refresh and on a second browser.
- Deleting the course removes it locally and remotely.

## Regression Commands

```bash
npm run verify:cloud-architecture
npm run check:cloud-deploy
node --check web/api/gen/sweep.js
node --check web/api/_lib/gen-runner.mjs
```
