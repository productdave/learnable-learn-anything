# AI Foundations for PM — Interactive Learning

A [Product Academy](https://productacademy.io) interactive self-paced course on AI Product Management. No build tools, no dependencies — just open `index.html` in a browser.

> **Looking for the deployment workshop?** See [storylingo-demo](https://github.com/deewang/storylingo-demo) — a hands-on exercise where you clone a voice AI app, configure environment variables, and deploy it to Railway.

## What's inside

**5 modules, 20 topics** covering the full AI PM skill stack:

| Module | Topics |
|--------|--------|
| 1 · AI Foundations | AI ecosystem & landscape, neural networks & learning paradigms, prompt engineering, history of agentic AI |
| 2 · Business Translation | Finding AI opportunities, RAG (vanilla vs agentic), feature prioritization, writing AI PRDs |
| 3 · Evaluation & Deployment | LLM-as-judge evaluation, responsible AI & guardrails, MCP & tool integrations, deployment patterns |
| 4 · Portfolio Building | AI-first PRDs & case studies, agent KPIs, fine-tuning & SLMs, portfolio presentation |
| 5 · Pitch Preparation | Story & metrics, demos & narrative, rehearsal & dashboards, presenting to judges & customers |

## Features

- **Interactive quizzes** — multiple choice and drag-to-match, with explanations and saved answers
- **Exercises** — structured templates with hints and auto-save to localStorage
- **Flashcards** — SM-2 spaced repetition across all 80 cards, with flip animation and difficulty rating
- **AI Learning Assistant** — highlight any text in a lesson, click "Ask AI", and get a context-aware deep-dive via Claude
- **Full-text search** — instant search across all topics with highlighted snippets
- **Progress tracking** — per-topic completion, module progress rings, overall dashboard
- **Dark mode** — persistent theme toggle
- **Mobile responsive** — sidebar collapses, chat panel slides up from bottom

## Running locally

```bash
python3 -m http.server 8765 -d "/path/to/ai-pm-learning"
```

Then open [http://localhost:8765](http://localhost:8765).

> **Why a server?** ES modules require HTTP — `file://` won't work.

## AI chat setup

The AI Learning Assistant uses the [Anthropic API](https://www.anthropic.com) (Claude Haiku). Your key is stored in your browser's localStorage and sent directly to Anthropic — it never touches any other server.

1. Get an API key at [console.anthropic.com](https://console.anthropic.com)
2. Click the ✦ sparkle button in the top nav (or highlight any text in a lesson)
3. Enter your key when prompted — it's saved for all future sessions

To reset the key: open the chat panel → click the settings icon → enter a new key.

## How to use

**Learning a topic:**
1. Navigate any module from the sidebar or dashboard
2. Read the expandable concept sections — click headers to expand
3. Complete the quizzes and exercise before moving on
4. Click "Mark as Complete" to track progress

**Going deeper:**
- Highlight any sentence or paragraph → click the "Ask AI" popup → the assistant explains it in PM terms with concrete examples
- Continue the conversation with follow-up questions
- Click the rotate icon in the chat header to start a fresh conversation

**Reviewing:**
- Click the cards icon (⊞) in the header to start a flashcard session
- Cards due for review are shown first; rate each as Again / Hard / Good / Easy
- The SM-2 algorithm schedules the next review based on your rating

## File structure

```
├── index.html                  # SPA shell
├── styles/
│   ├── tokens.css              # Design tokens
│   ├── base.css                # Layout & reset
│   ├── components.css          # All component styles
│   └── themes.css              # Dark theme overrides
├── js/
│   ├── app.js                  # Router & init
│   ├── store.js                # localStorage state
│   ├── search.js               # Full-text search
│   ├── flashcards.js           # SM-2 engine & UI
│   ├── chat.js                 # AI assistant
│   └── components/
│       ├── sidebar.js          # Module nav & progress rings
│       ├── topic-view.js       # Content renderer
│       ├── quiz.js             # Quiz components
│       ├── exercise.js         # Exercise component
│       └── diagram.js          # Diagram renderer
├── data/
│   ├── curriculum.js           # Module & topic structure
│   └── modules/
│       ├── module-1.js         # AI Foundations content
│       ├── module-2.js         # Business Translation content
│       ├── module-3.js         # Evaluation & Deployment content
│       ├── module-4.js         # Portfolio Building content
│       └── module-5.js         # Pitch Preparation content
└── assets/
    └── icons.svg               # SVG sprite
```

## Updating content

All content lives in `data/modules/module-N.js`. Each topic follows this structure:

```js
'topic-id': {
  title: 'Topic Title',
  estimatedMinutes: 20,
  sections: [
    { type: 'concept', title: '...', content: '...', expandable: true },
    { type: 'callout', variant: 'key-insight', title: '...', content: '...' },
    { type: 'quiz', variant: 'multiple-choice', ... },
    { type: 'exercise', title: '...', prompt: '...', template: '...' },
    { type: 'takeaway', points: ['...', '...'] }
  ],
  flashcards: [
    { front: 'Question?', back: 'Answer.' }
  ]
}
```

No rebuild needed — edit the file and refresh the browser.
