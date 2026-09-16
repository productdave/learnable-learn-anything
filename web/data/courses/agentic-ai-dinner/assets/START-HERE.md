# Product Builder Labs

These five labs implement a local, fictional dinner workflow. They do not place real orders or contact a model. The optional local-model.py script is a separate experiment.

## Run your editable copy

1. Unzip the bundle into a folder you can find.
2. Open Terminal in that folder. Ask your coding assistant to help you navigate there if needed.
3. Check Python with `python3 --version`. If unavailable, install Python from https://www.python.org/downloads/ before continuing.
4. Run `python3 -m http.server 8770 --bind 127.0.0.1`.
5. Open http://127.0.0.1:8770/builder-lab.html in your browser. Keep the terminal running while using the labs.
6. Press Control-C in that terminal to stop the server when finished.

Opening the HTML by double-clicking can block module imports; use the local server above.

## Files and first edits

- builder-core.mjs: the actual sample records, filtering, totals, state transitions, and evaluation checks.
- builder-ui.mjs: connects buttons and inputs to the shared core.
- builder-lab.html: layout and styling.
- local-model.py: optional live local-model extraction. See LIVE-MODEL.md.
- test-core.mjs: meaningful regression checks. With Node.js installed, run `node test-core.mjs`.

Start with one small change. In searchMenu, change the relevance weight. Predict the new ordering, save, refresh the browser, and confirm unavailable items still stay out. Next, add a fictional item with a missing delivery charge and verify it cannot be presented as a known all-in total.

For help, ask your coding assistant: “Explain searchMenu before changing it. Show where eligibility ends and ranking begins. Change one relevance weight and run a test proving unavailable records are still excluded.”

## What each lab demonstrates

- Retrieval: keyword scoring, hard filters, source labels, exclusions, explicit fixture prices.
- Workflow: draft versions, current approval, uncertainty after a simulated timeout, deduplication.
- Adaptation: decision scenarios with feedback, not benchmark claims.
- Evaluation: executable checks against baseline and deliberately broken variants.
- Safety: untrusted text has no authority to skip the action gate.

The same in-memory workflow remains available when switching Workflow and Safety tabs. Reloading clears it. Export evaluation reports and save learning reflections in Learnable. Standalone copies do not contain Learnable's account, progress, or course shell.

## Limits

The prices and tax rules are simplified fixtures, not a real pricing model. Vegetarian tags are not allergy guarantees. No embeddings, fine-tuning, or live checkout are performed by the browser labs. Client-side checks are for teaching; real consequential actions need authenticated server-side enforcement and durable operation records.
