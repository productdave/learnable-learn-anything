# Matching quizzes production release

- Production URL: https://learnable-tau.vercel.app/
- Deployment: `dpl_6gi1JA1dH4qwBuV8d4a392cCHLyv`
- Deployment URL: https://learnable-2ci0k5xgv-david-davidwangcos-projects.vercel.app
- Previous deployment / rollback target: `dpl_AfMynr2dL98jEe9PDumEyvYwEr3Q`
- Vercel project: `prj_2iuG1sUqsi96APgCca4lUW866yvr`
- Scope: matching quiz UI only; no backend, database, or course-content changes.

## Experience

Matching quizzes support clicking either side first and dragging from connection dots. Persistent lines, dots, borders, and pair numbers share colours from the website's CSS tokens. Incorrect answers show red “Try another match” text and remain editable. Draft and checked pairs restore on reload using the existing storage format. Keyboard interaction, cancellation, occupied-match replacement, and mobile columns are supported.

## Release construction

The workspace contains unrelated unfinished changes, and production has a separate source baseline. As with the September 16 release, this release used the current deployment as its baseline, rather than deploying the whole workspace or merging unrelated Git history.

Recovered all 195 source files from the authenticated Vercel deployment files API; each file's SHA-1 matched its manifest UID. Copied `js-dinner-release/` to `js-matching-release/` and `styles/components.css` to `styles/components-matching-release.css`, then applied the adjacent patch. The new physical asset paths prevent recurrence of the cache issue documented in the previous release. Existing assets remain available to older open clients.

The new shared module is the same as `web/js/components/match-quiz.js`. The release adapter uses production's existing `store.saveQuizAnswer` API; the workspace adapter uses its newer scoped `store.bind()` API. No storage migration was introduced.

To reproduce, recover the previous deployment, make the two copies described above, then run `git apply` with `2026-09-17-matching-quizzes.patch` from the recovered source root. This process was verified to reproduce the release files byte-for-byte. All original files except the HTML entry page remain byte-for-byte unchanged.

Built using the existing Vercel project with production environment settings, disabled build cache, and `--skip-domain`; verified the uploaded entry HTML and matching module; then promoted the deployment with explicit team scope. This is a direct Vercel release, not a GitHub merge or CI-triggered deployment.

## Verification

- All 73 matching quizzes across eight bundled courses passed render, connection, and grading checks against the release module and production course JSON.
- Regression checks cover quoted/literal text, saved wrong answers, retries, displaced matches, reverse-direction clicks, stale-context writes, pointer preview/drop/cancellation, and keyboard selection immediately after dragging.
- Browser tested the release locally and on the public production site: wrong answers, red retry text, pointer drag, keyboard correction, all-correct result, and restoration after reload.
- Mobile layout checked at 375px and 320px; no horizontal overflow. Light and dark palette variants verified.
- Live browser reported no console errors. Reload navigation load event: approximately 148ms (single cached sample, not a performance benchmark).
- 60 active/public release files, including all course JSON other than the unused legacy index, entry HTML, new module, and new stylesheet matched uploaded bytes.
- `data/courses/index.json` still serves the pre-existing stale cached index documented in the September 16 release. The app reads `catalog-dinner-release.json`, which matches the release. This update did not change either catalog.
- Workspace syntax, cache-version graph, learning isolation (32 checks), and optional-component checks (93) passed before packaging.

## Rollback

Use `vercel rollback dpl_AfMynr2dL98jEe9PDumEyvYwEr3Q --scope team_ONTVy4HempTg7uINmG0C8P3N` if a rollback is authorized. No rollback was needed.
