# Agentic AI Foundations public release

- Course commit: `964efc7`
- Creator: David Wang
- Previous production deployment: `dpl_EbCfcoPE6yATBgT6Jm5HnnLaWnfk`
- Preview deployment: `dpl_GFpMT3jxjtN8fwhoT1x9oiVXLrc8`
- Production deployment: `dpl_AfMynr2dL98jEe9PDumEyvYwEr3Q`
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

The public catalog endpoint continued serving stale content after promotion. The final build uses `catalog-dinner-release.json`, refreshes module versions again, and disables the build cache for this deployment. Three already-public courses absent from the older source manifest were preserved by fetching their public JSON and referenced assets.

The cached `js/course-loader.js` response persisted despite query version changes. Final packaging copies the patched `js/` tree to `js-dinner-release/` and points the HTML entry script there, giving the entire shared module graph a fresh physical URL. Preserve the original tree for older open clients.

Final production verification: the homepage shows the course with “By David Wang”; all six modules returned HTTP 200 and contain 24 topics; the lab ZIP returned HTTP 200; the course opens from its public catalog card.
