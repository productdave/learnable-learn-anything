<div align="center">

<img src="assets/readme-cover.png" width="100%" alt="Learnable turns any learning goal into a structured, adaptive course" />

# Learnable

**Turn any goal into a course built around you—then learn it in the same place.**

An AI course builder and learning workspace combining researched lessons, hands-on practice, progress tracking, and an AI tutor.

</div>

## What it does

Learnable starts with what you want to learn, why it matters, what you already know, and how deep you want to go. It designs a curriculum, researches each module, and turns the result into an interactive course you can study immediately.

Instead of returning another long AI answer, Learnable creates a durable learning path with modules, lessons, practice, review, search, and progress.

## Key features

- **Personalized curricula** based on your goal, starting point, and preferred depth
- **Source-aware generation** from pasted notes, web pages, and up to five PDFs
- **Live research** for current concepts, examples, and common misconceptions
- **Human review gates** before research and lesson writing begin
- **Structured lessons** with concepts, examples, takeaways, and relevant visuals
- **Five quiz formats** plus optional applied exercises
- **Spaced-repetition flashcards** for ongoing review
- **Context-aware AI tutor** for the current topic or selected lesson text
- **Text-to-speech** with voice, speed, seek, and playback controls
- **Course-wide search, progress tracking, and light and dark themes**
- **Retry and resume tools** that preserve completed work
- **Optional cross-device sync** through Supabase magic-link authentication

## How to use

1. Select **New course**.
2. Enter a topic or provide notes, URLs, or PDFs.
3. Add your goal, starting point, and preferred depth.
4. Add an Anthropic API key when prompted.
5. Review the proposed curriculum and provide any corrections or extra context.
6. Review the research direction before lesson writing begins.
7. Open the completed course from your library.
8. Work through lessons, answer quizzes, review flashcards, ask the tutor questions, and mark topics complete.
9. Optionally sign in to sync generated courses and learning progress across devices.

Keep the browser tab open while the current human-review generation workflow is running.

## Run locally

### Requirements

- Node.js 20+
- npm
- An Anthropic API key

Clone the repository and install both sets of dependencies:

```bash
git clone https://github.com/productdave/learnable-learn-anything.git
cd learnable-learn-anything
npm install
npm --prefix web install
```

Run the complete web app, including its serverless URL-extraction endpoint:

```bash
cd web
npx vercel dev --listen 8765
```

Open [http://localhost:8765](http://localhost:8765). Learnable will ask for your Anthropic API key when you create your first course.

Bundled courses and browser-local progress do not require a Supabase account. Authentication, cross-device sync, and cloud generation require a configured Supabase project and the corresponding Vercel environment variables.

### CLI generator

The repository also includes a resumable command-line course generator. From the repository root:

```bash
cp .env.example .env
```

Add `ANTHROPIC_API_KEY` to `.env`, then generate an example course:

```bash
npm run generate -- briefs/coffee.json --out output
```

Resume an interrupted course without regenerating completed topics:

```bash
npm run generate -- --resume COURSE_ID --out output
```

## Tech stack

| Layer | Technology |
|---|---|
| Learning experience | Vanilla JavaScript modules, HTML, modular CSS |
| Course generation | Node.js, Anthropic Messages API, Claude, Zod |
| Research and source processing | Anthropic web search, Mozilla Readability, Linkedom, PDF.js |
| Learning tools | Web Speech API, localStorage, service workers |
| Accounts and data | Supabase Auth, Postgres, Storage, Realtime, row-level security |
| Backend | Vercel-compatible Node.js serverless functions |
| Hosting | Vercel |

## Status and limitations

Learnable is a working product prototype, not a production learning platform. It includes bundled example courses, browser-based course creation, and a separate resumable CLI generator.

The current human-review workflow keeps its intermediate review state in the open browser tab, so refreshing before generation finishes can interrupt the run. Research is best-effort and can fall back to model knowledge when a source cannot be reached; the player does not yet present a complete source bibliography.

Without an account, generated courses, progress, and the Anthropic key remain in that browser. In the current signed-in prototype, the key is also stored in the user's row-level-security-protected Supabase state so cloud generation can access it. Self-hosted sync requires additional Supabase configuration, and the repository does not currently include an automated test suite.
