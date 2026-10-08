# GitHub source update — 8 October 2026

## Where we're at

This is the current application source, tests and database migrations. It brings
GitHub forward from the August version. It is a source backup, not a new hosted
release or a byte-for-byte copy of the production deployment.

The app now opens the workspace at its normal URL. Course setup has four steps:
describe the course, choose learning materials, add context, then review and
create. Sign-in is requested when a guest chooses Create, not at the beginning.
New courses are saved to the signed-in account.

Generation keeps curriculum and research review checkpoints, then writes lessons
and the selected learning checks. The Visual Designer refines learner-facing
copy, decides where illustrations help, and generates and inserts those images
before final checks. Images are part of creation, not a separate required task.
Text-only lessons are intentional when an image would not help.

## What's included

- Browser and server source, dependency manifests and lockfiles.
- Database migrations through `24-visual-designer.sql`.
- Public bundled course content and assets; existing GitHub README cover/history.
- Source tests, synthetic fixtures and reusable development/build helpers.
- Disabled-by-default environment examples with empty secret fields.

Private account/course exports, personal feedback, local credentials, frozen
deployment packages and operational receipts are not part of the public source
snapshot. Some historical release operators require those private local artifacts
and are not general installation instructions. Do not run deployment/migration
commands just to inspect the app.

## Run the offline checks

Use Node.js 22.13 or later in the 22.x line, and npm. Install the locked root
dependencies with `npm ci --ignore-scripts`; install the web dependencies with
`npm --prefix web ci --ignore-scripts` if working on its separate deployment root.

```sh
npm run verify:cloud-architecture
npm run test:grouped-functions
npm run test:course-description
npm run test:long-brief-presentation
npm run test:setup-generation
npm run test:document-sources
npm run test:standard-course-materials
npm run test:integrated-visuals
npm run test:integrated-generation-runner
npm run test:visual-designer
```

These use source assertions and mocked boundaries. They do not certify a hosted
sign-in/email flow, actual AI output, device behavior or expert content accuracy.
Do not run every file named `test-*` blindly: historical release tests can need
private artifacts, and disposable database tests can create/drop a test database.

## Development and deployment

For the isolated local preview, copy `.env.preview.example` to the ignored
`.env.preview.local`, configure your own local/separate Supabase project and read
`db/SETUP.md` before applying migrations. `npm run dev:setup` refuses the app's
existing live database; it is not a production server. Merely installing
dependencies does not configure auth, storage or generation.

Course text/research uses the creator's connected Claude account. Helpful images
use their connected OpenAI account. Keys are encrypted on the server; a stable
provider-vault encryption key and appropriate access policies are prerequisites.
Generation and retries can cost money. No provider calls are needed for the
offline checks above.

Hosted releases use reviewed, grouped function packages for the non-commercial
Vercel Hobby target. Frozen build receipts and deployment credentials stay outside
Git. Do not assume that deploying the raw `web/` directory reproduces the checked
production package or fits the platform's function limits. A fresh clone-to-hosted
build is a separate unverified task, not an outcome of this source backup.

## What's next

Review the source-sync pull request before merging. A merge may trigger connected
hosting integrations, so keep it separate from production promotion. Remaining
product checks include fresh hosted email return and long-description account
saving, physical-phone/cellular/audio and full accessibility testing. This update
does not mark those checks passed or publish any private course.
