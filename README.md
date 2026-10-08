<div align="center">

<img src="assets/readme-cover.png" width="100%" alt="Learnable turns a learning goal into a structured course" />

# Learnable

Describe what you want to learn or teach, create a course draft, then learn from it.

</div>

## What it does

Learnable turns your goal, starting point and source material into an interactive
course. The aim is a complete, useful draft for human review—not a one-shot final
product or a guarantee that every generated detail is correct.

The workspace is the default experience. Community Courses are separate from
Your Courses, which has filters for work in progress and courses needing attention.

## Create a course

1. Describe the course, learner and intended outcome.
2. Choose the learning materials, such as checklists, quizzes and flashcards.
3. Add context: notes, transcripts or raw text, URLs, and PDF/DOCX/TXT files.
4. Review the setup and choose **Create course**. If you're not signed in, this
   is when Learnable asks you to sign in. New generation is saved to your account.

You review the curriculum and research direction before lessons are written.
After lessons and learning checks are saved, the Visual Designer refines the copy
and presentation, chooses where images help, and generates and inserts them before
final checks. Images belong to the creation flow; not every lesson needs one.

Progress and review checkpoints are shown in the course workspace. Resume keeps
completed work rather than starting a new course. Creator-funded generation uses
connected Claude and OpenAI accounts; provider keys are encrypted on the server.
Starting or resuming generation can incur provider charges.

## Learning tools

- Structured lessons, examples, takeaways and relevant instructional images.
- Selected checklists, quizzes and flashcards.
- Course navigation, search, progress, text-to-speech and light/dark themes.
- Account-owned courses and cross-device sync, with recovery for interrupted work.

Guided practice and an AI tutor are not part of the current MVP creation flow.
Self-publishing and moderation have guarded implementations but are disabled by
default; their presence in source does not mean they are enabled on a deployment.

## Work on the source

Use Node.js 22.13 or later in the 22.x line, and npm:

```sh
git clone https://github.com/productdave/learnable-learn-anything.git
cd learnable-learn-anything
npm ci --ignore-scripts
npm --prefix web ci --ignore-scripts
npm run verify:cloud-architecture
npm run test:course-description
npm run test:visual-designer
```

For an isolated preview, configure your own local/separate Supabase project using
`.env.preview.example` and read [the database guide](db/SETUP.md), then use
`npm run dev:setup`. It deliberately refuses the app's existing live database.
Server secrets belong in the ignored preview file or server environment, never
in frontend config or a commit. All paid-generation flags are off in the examples.

The old local CLI generator is retired. The supported course-creation workflow
uses authenticated server-side generation and durable checkpoints.

See [the source snapshot guide](docs/SOURCE-SNAPSHOT.md) for more offline tests,
setup boundaries and what is intentionally excluded from this public repository.

## Stack

| Layer | Technology |
|---|---|
| Experience | Vanilla JavaScript modules, HTML and modular CSS |
| Text and research | Anthropic Messages API, Claude and Zod |
| Images | Creator-funded OpenAI image generation |
| Source processing | Readability, Linkedom, PDF.js and Mammoth |
| Account data | Supabase Auth, Postgres, Storage, Realtime and row-level security |
| Backend | Node.js serverless functions, grouped for reviewed Vercel releases |

## Status

This October source snapshot is newer than GitHub's August app. It is not a
byte-for-byte archive of production or permission to redeploy it. Production
releases were built from scoped, verified packages; their private receipts,
credentials, account courses and generated user data are kept outside Git.

Descriptions allow 5,000 Unicode characters; individual notes allow 12,000.
Long text stays available in expandable, bounded review regions. Sources and AI
output still need human review, particularly for high-stakes teaching.

Offline source/mock checks do not prove fresh hosted email return, account saving,
actual provider output, physical-phone behavior or full accessibility acceptance.
A fresh clone-to-hosted deployment and those remaining checks need separate review.
