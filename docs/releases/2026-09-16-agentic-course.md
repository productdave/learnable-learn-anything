# Agentic AI Foundations public release

- Course commit: `964efc7`
- Creator: David Wang
- Previous production deployment: `dpl_EbCfcoPE6yATBgT6Jm5HnnLaWnfk`
- New deployment: `dpl_GFpMT3jxjtN8fwhoT1x9oiVXLrc8`
- Public URL: https://learnable-tau.vercel.app/?course=agentic-ai-dinner

## Release construction

Production included source changes not present on Git main. To avoid reverting existing functionality or publishing unrelated workspace changes, this release recovered the previous deployment’s 100 source files through the authenticated Vercel files API and verified each SHA-1 against its deployment manifest. It then added the committed course directory and its catalog entry.

The adjacent patch records the additional changes against that production baseline: guided practice rendering and local persistence, medium illustration sizing, an escaped public author byline, catalog revalidation, consistent browser module cache versions, and the workspace’s daily cron schedule. Apply with `git apply` from the recovered deployment source root after adding the course. Existing backend source and other courses were preserved.

Vercel rejected the baseline’s five-minute cron on the current Hobby plan. The release uses `0 0 * * *` for `/api/gen/sweep`, matching the workspace configuration.

## Validation

- All 24 lessons, 72 quizzes, and 120 flashcards passed course validation.
- Sample-data lab core and release practice persistence tests passed.
- Browser verified lesson rendering, a loaded 360px illustration, and check-in persistence after reload.
- Vercel build succeeded; preview was promoted using the existing project.

Ordering exercises remain simulations. No database migration was applied.
