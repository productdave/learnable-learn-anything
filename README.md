<div align="center">

# Learnable

**Generate a course on anything. Then learn it.**

An adaptive learning prototype that turns a learner's goal and context into a structured, research-backed course — then keeps the learning tools in the same place.

</div>

## The product bet

Most online courses are built for an average learner who does not really exist. Learnable starts with **what you want to learn, why you need it, and what you already know**, then generates a course around that brief.

The goal is not another chat window that returns a long answer. The goal is a durable learning product with a course map, lessons, practice, progress, and an AI tutor that understands the material.

## What the prototype includes

- **Structured course generation** from a topic, learner level, goal, and constraints
- **Staged research and writing** rather than a single one-shot prompt
- **Resumable module generation** so a failed request does not lose completed work or repeat API spend
- **A learning player** with topic navigation, progress, full-course search, and themes
- **Practice tools** including flashcards and course-specific exercises
- **Text-to-speech** for listening to lessons
- **An AI tutor** for questions about the current topic
- **Context ingestion** from pasted notes, URLs, and PDFs
- **Optional accounts and sync** backed by Supabase

## How it works

```text
Learning goal
    ↓
Intake + course brief
    ↓
Module research
    ↓
Lessons + examples + practice
    ↓
Course player + tutor + progress
```

The generator writes each module independently. If generation stops midway, the `--resume` path checks what already exists and completes only the missing topics.

## Stack

- **Course generator:** Node.js, Anthropic SDK, Zod
- **Learning experience:** vanilla JavaScript, HTML, and modular CSS
- **Content tools:** Readability, Linkedom, PDF extraction
- **Accounts and sync:** Supabase
- **Hosting:** Vercel-compatible serverless functions

## Generate a course locally

**Requirements:** Node.js 20+ and an Anthropic API key.

```bash
git clone https://github.com/deewang/learnable-learn-anything.git
cd learnable-learn-anything
npm install
cp .env.example .env
```

Add `ANTHROPIC_API_KEY` to `.env`, then run one of the example briefs:

```bash
npm run generate -- briefs/coffee.json --out output
```

Resume an interrupted course without regenerating completed modules:

```bash
npm run generate -- --resume <course-id> --out output
```

## Status

Learnable is a **working product prototype**, not a production learning platform. The repository includes the current generator and learning interface as well as a more ambitious agentic product specification for future iterations.
