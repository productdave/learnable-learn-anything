export default {
  "story-metrics": {
    id: "story-metrics",
    moduleId: "pitch-preparation",
    title: "Story, Metrics & Objections",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "The Pitch Narrative Arc",
        content: `<p>Every AI product pitch follows the same underlying arc, whether you're presenting to your CEO, a customer, or a venture partner. The arc isn't about impressing people with technology — it's about making them feel the problem, believe in the approach, and trust the evidence.</p>
<p>Start with the <strong>problem, grounded in data</strong>. "Our support team handles 4,200 tickets per week. Average resolution time is 47 hours. Customer satisfaction on support interactions is 3.1 out of 5." Numbers make the problem real. Without them, you're just complaining.</p>
<p>Then explain <strong>why AI is the right approach</strong> — not "because AI is hot," but because the problem has specific characteristics that AI handles well: unstructured input, pattern recognition at scale, or tasks where 90% accuracy beats 0% automation. Be specific about why traditional software or more people wouldn't solve it better.</p>
<p>Walk through <strong>how it works, simplified</strong>. Your audience doesn't need to understand transformer architecture. They need to understand the flow: "Customer submits ticket, our system classifies intent, retrieves relevant knowledge base articles, drafts a response, and routes to a human if confidence is below our threshold." Keep it to one diagram, three to five steps.</p>
<p>Show <strong>results with metrics</strong>. Always before-and-after. "Resolution time dropped from 47 hours to 11 hours. CSAT went from 3.1 to 4.2. We handled 30% more tickets with the same team." If you don't have production data yet, show eval results, pilot data, or A/B test outcomes.</p>
<p>Close with <strong>what's next</strong>. This signals you're thinking beyond the demo. "Phase 2 adds proactive outreach for common issues. Phase 3 integrates with our product telemetry to auto-detect bugs before customers report them."</p>`,
        expandable: true,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "n1", label: "Problem\n(with data)", type: "start" },
              { id: "n2", label: "Why AI?\n(fit argument)", type: "process" },
              { id: "n3", label: "How It Works\n(simplified)", type: "process" },
              { id: "n4", label: "Results\n(before/after)", type: "process" },
              { id: "n5", label: "What's Next\n(roadmap)", type: "end" }
            ],
            edges: [["n1", "n2"], ["n2", "n3"], ["n3", "n4"], ["n4", "n5"]]
          }
        }
      },
      {
        type: "callout",
        variant: "key-insight",
        title: "The 30-Second Rule",
        content: `<p>If someone interrupts you 30 seconds into your pitch, they should already understand what problem you're solving and why it matters. Front-load the pain. The technology reveal comes later.</p>`
      },
      {
        type: "concept",
        title: "Metrics That Resonate",
        content: `<p>Not all metrics land equally with every audience. The trick is choosing metrics that connect to what your audience actually cares about — and always presenting them as a before-and-after comparison.</p>
<p><strong>Cost savings</strong> resonate with finance and executives. "We reduced cost-per-ticket from $12.40 to $3.80" is immediately understandable. Multiply by volume for annual impact: "At 218,000 tickets per year, that's $1.87M in annual savings." Always show your math — audiences trust you more when they can verify.</p>
<p><strong>Time savings</strong> resonate with operational leaders and end users. "Document review went from 3 hours to 12 minutes" is visceral. People immediately imagine getting three hours of their day back. Where possible, translate time savings into capacity: "That freed our legal team to handle 4x the contract volume without hiring."</p>
<p><strong>Accuracy improvements</strong> matter to technical audiences and quality-focused stakeholders. "Classification accuracy went from 71% (rule-based) to 94% (AI-assisted)" — but always pair this with what accuracy means in practice: "That's 2,300 fewer misrouted tickets per month."</p>
<p><strong>User satisfaction</strong> is the universal metric. Everyone cares about whether people actually like using the thing. NPS, CSAT, task completion rates, time-on-task — these bridge the gap between technical achievement and human impact. "Users rated the AI-assisted flow 4.6 out of 5, compared to 3.2 for the manual process."</p>`,
        expandable: true
      },
      {
        type: "callout",
        variant: "tip",
        title: "The Metric Sandwich",
        content: `<p>Structure every metric claim as: <strong>what changed</strong> (metric name), <strong>from what to what</strong> (before/after), and <strong>so what</strong> (business impact). "Resolution time dropped from 47 hours to 11 hours, which means customers get answers the same business day instead of waiting two days."</p>`
      },
      {
        type: "concept",
        title: "Common Objections and How to Handle Them",
        content: `<p>If you've pitched an AI product, you've heard these objections. The key is not to be defensive — acknowledge the concern, then redirect with evidence.</p>
<p><strong>"Is it just a wrapper around ChatGPT?"</strong> This is the most common dismissal in 2025-2026. The response: "The model is one component. The value is in the retrieval pipeline, the domain-specific evaluation framework, the guardrails, and the integration with our existing systems. We built 14 custom eval tests, integrated with 3 data sources, and designed fallback logic for 7 edge case categories. That's the product — the model is the engine, not the car."</p>
<p><strong>"What about hallucinations?"</strong> Never say "we solved hallucinations." Instead: "We measure hallucination rate weekly using our eval pipeline. Current rate is 2.3% on production queries. Every response includes source citations. When confidence is below our threshold, the system escalates to a human. We also run automated fact-checking against our knowledge base before any response goes to a user."</p>
<p><strong>"What about cost?"</strong> Show unit economics: "Cost per query is $0.03. At our current volume of 8,000 queries per day, that's $7,200 per month in API costs — versus $45,000 per month in additional headcount to handle the same volume manually. We've also implemented caching and prompt optimization that reduced per-query cost by 40% over three months."</p>
<p><strong>"What about privacy?"</strong> Be specific about architecture: "No customer data is sent to external APIs. We run our model on our own infrastructure within our VPC. All data is encrypted at rest and in transit. We completed SOC 2 Type II audit in Q1. Here's the data flow diagram showing exactly where data goes."</p>
<p><strong>"Will it scale?"</strong> Answer with evidence, not promises: "We load-tested to 50x current volume. Response latency stays under 800ms at 10x. We've designed the architecture to scale horizontally — adding capacity is a configuration change, not a re-architecture. Here are the load test results."</p>`,
        expandable: true
      },
      {
        type: "callout",
        variant: "warning",
        title: "Never Dismiss an Objection",
        content: `<p>The worst thing you can do is say "that's not really an issue" or "we've totally solved that." Stakeholders hear this as "I haven't thought about this carefully." Instead, acknowledge the concern is legitimate, then show your specific evidence for how you've addressed it.</p>`
      },
      {
        type: "quiz",
        id: "sm-quiz-1",
        variant: "drag-match",
        question: "Match each stakeholder objection with the strongest response strategy.",
        pairs: [
          { left: "Is it just a wrapper?", right: "Detail the custom pipeline, evals, guardrails, and integrations beyond the base model" },
          { left: "What about hallucinations?", right: "Share measured hallucination rate, citation system, confidence thresholds, and human escalation" },
          { left: "What about cost?", right: "Show unit economics with per-query cost vs. manual alternative at current volume" },
          { left: "What about privacy?", right: "Explain data architecture, encryption, compliance certifications, and data flow diagram" },
          { left: "Will it scale?", right: "Present load test results with latency at multiples of current volume" }
        ],
        explanation: "Each objection requires a specific, evidence-based response. Generic reassurances ('don't worry about it') always backfire. The pattern is: acknowledge the concern, then show concrete data or architecture decisions that address it."
      },
      {
        type: "exercise",
        id: "sm-exercise-1",
        title: "Elevator Pitch",
        prompt: "Write a 60-second elevator pitch for your AI product (real or hypothetical). It must follow the narrative arc: Problem (with one key data point), Why AI (specific fit argument), How It Works (3-5 step simplified flow), Results (one before/after metric), What's Next (one sentence on Phase 2). Time yourself reading it aloud — it should be under 60 seconds.",
        template: `PROBLEM:
[What's the pain? Include one specific data point.]

WHY AI:
[Why is AI the right approach vs. more people or traditional software?]

HOW IT WORKS (simplified):
1. [Step 1]
2. [Step 2]
3. [Step 3]

RESULTS:
Before: [metric]
After: [metric]
Business impact: [so what?]

WHAT'S NEXT:
[One sentence on the next phase]`,
        hints: [
          "Start with a number that makes people wince — the bigger the pain, the more compelling the pitch.",
          "For 'Why AI,' focus on what makes this problem unsuitable for rule-based software: ambiguity, scale, or unstructured data.",
          "Your 'How It Works' should be understandable by someone with zero technical background. If you're using jargon, simplify.",
          "The best 'What's Next' connects to a larger strategic vision, not just incremental improvements."
        ]
      },
      {
        type: "takeaway",
        points: [
          "Every AI pitch follows: Problem (data) -> Why AI -> How It Works (simplified) -> Results (before/after) -> What's Next.",
          "Always present metrics as before-and-after with business impact translation — raw numbers without context don't persuade.",
          "Handle objections by acknowledging the concern first, then presenting specific evidence — never dismiss or over-promise."
        ]
      }
    ],
    flashcards: [
      { front: "What are the five stages of an AI pitch narrative arc?", back: "Problem (with data), Why AI (fit argument), How It Works (simplified), Results (before/after metrics), What's Next (roadmap)." },
      { front: "What is the 'metric sandwich' structure?", back: "What changed (metric name) + From what to what (before/after) + So what (business impact). Example: 'Resolution time dropped from 47h to 11h, meaning same-day answers instead of two-day waits.'" },
      { front: "How should you respond to 'Is it just a wrapper around ChatGPT?'", back: "Detail the custom pipeline beyond the base model: retrieval logic, domain-specific evals, guardrails, system integrations, and fallback handling. The model is the engine, not the car." },
      { front: "Why should you never say 'we solved hallucinations'?", back: "Because it's not true for any system and it destroys credibility. Instead, share your measured hallucination rate, citation system, confidence thresholds, and human escalation path." }
    ]
  },

  "demos-narrative": {
    id: "demos-narrative",
    moduleId: "pitch-preparation",
    title: "Demos & Compelling Narrative",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "Demo Design: The Three-Act Structure",
        content: `<p>A great AI demo isn't a feature tour — it's a story in three acts. Each act builds on the last, and together they answer the three questions every stakeholder has: "Does it work?", "What happens when it fails?", and "How do I know it's working over time?"</p>
<p><strong>Act 1: The Happy Path.</strong> Show the product doing exactly what it's supposed to do, end to end. Pick your most compelling use case — the one where the AI's output is clearly better than the alternative. Use real data, not lorem ipsum. Walk through it at a pace your audience can follow. Narrate what's happening: "Notice the system identified that this is a billing dispute, not a general inquiry — that classification drives which knowledge base it searches." The happy path should take 60% of your demo time.</p>
<p><strong>Act 2: Graceful Failure.</strong> This is where you win or lose sophisticated audiences. Deliberately trigger a scenario where the AI doesn't have a great answer — an ambiguous query, an edge case, a request outside scope. Show the guardrails working: "Watch what happens when I ask something outside our domain. The system recognizes it can't answer confidently, says so transparently, and routes to a human specialist. That's not a bug — we designed this." Showing you've thought about failure modes builds more trust than a perfect demo.</p>
<p><strong>Act 3: The Eval Dashboard.</strong> Pull up your monitoring dashboard. Show real metrics: accuracy over time, query volume, latency, user feedback scores. "Here's our eval pipeline running daily. You can see accuracy has been stable at 93-95% over the past 6 weeks. This spike in query volume on March 12 was a product launch — the system scaled without degradation." This proves the product isn't a parlor trick; it's an operational system.</p>`,
        expandable: true,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "n1", label: "Act 1:\nHappy Path\n(60% of time)", type: "start" },
              { id: "n2", label: "Act 2:\nGraceful Failure\n(guardrails)", type: "process" },
              { id: "n3", label: "Act 3:\nEval Dashboard\n(ongoing proof)", type: "end" }
            ],
            edges: [["n1", "n2"], ["n2", "n3"]]
          }
        }
      },
      {
        type: "callout",
        variant: "key-insight",
        title: "The Counter-Intuitive Demo Move",
        content: `<p>Showing failure on purpose is the most powerful thing you can do in an AI demo. It signals you understand the technology's limitations, you've built systems to handle them, and you're not trying to hide anything. Audiences who see you handle failure gracefully trust you more than audiences who only see perfection.</p>`
      },
      {
        type: "concept",
        title: "Artifact Packaging for Different Audiences",
        content: `<p>Your demo is one moment in time. The artifacts you leave behind continue selling your product when you're not in the room. Package them in layers so different audiences get what they need.</p>
<p><strong>Executive Summary (1-2 pages).</strong> Problem statement, solution overview, key metrics, timeline, and ask. This is what gets forwarded to the person who actually makes the decision. Write it so someone with zero context can understand the value proposition in under 2 minutes. No technical jargon. Lead with the business outcome.</p>
<p><strong>Technical Deep-Dive (5-10 pages).</strong> Architecture overview, model selection rationale, retrieval pipeline design, evaluation methodology, guardrail implementation, scaling plan. This is for the engineering lead or architect who needs to validate your technical choices. Include diagrams. Be specific about trade-offs you made and why.</p>
<p><strong>Appendix with Eval Data.</strong> Raw evaluation results, test case breakdowns, error analysis, latency benchmarks, cost projections at scale. This is for the skeptic who wants to verify your claims. The more transparent you are with data, the more credible everything else becomes. Include methodology so they can understand how you measured things.</p>
<p>The key principle: every claim in the executive summary should be traceable to data in the appendix. If you say "94% accuracy," someone should be able to find the eval run, the test set, and the methodology in the appendix.</p>`,
        expandable: true
      },
      {
        type: "concept",
        title: "Narrative Structure: The Learning Story",
        content: `<p>The most compelling AI product narratives follow a learning journey: "We tried X, we learned Y, we built Z, here's what happened." This structure works because it's honest, it shows rigor, and it demonstrates that your current solution is the result of iteration, not lucky guessing.</p>
<p><strong>"We tried X"</strong> — Start with what you attempted first. Maybe it was a rules-based system, maybe it was an off-the-shelf model, maybe it was a simpler architecture. "We initially tried using keyword matching to classify support tickets. It handled about 60% of cases correctly, but anything with ambiguous language or multiple intents fell apart."</p>
<p><strong>"We learned Y"</strong> — What did that first attempt teach you? "We learned that customer language is incredibly varied. The same intent gets expressed in dozens of ways, and many tickets contain multiple requests. We needed a system that understood semantic meaning, not just keywords."</p>
<p><strong>"We built Z"</strong> — What did you build based on those learnings? "So we built a retrieval-augmented pipeline with intent decomposition. The system first breaks multi-part tickets into individual requests, classifies each one, retrieves relevant documentation, and generates a draft response for each component."</p>
<p><strong>"Here's what happened"</strong> — Results, tied back to the original problem. "Classification accuracy went from 60% to 94%. But more importantly, the multi-intent handling means we now resolve 78% of complex tickets on first touch, compared to 31% before — those were the tickets driving the most customer frustration."</p>`,
        expandable: true
      },
      {
        type: "callout",
        variant: "example",
        title: "Making AI Tangible",
        content: `<p>Abstract explanations of AI don't stick. Make it tangible: <strong>before/after screenshots</strong> showing the old workflow vs. the new one, <strong>video walkthroughs</strong> of real users completing tasks (with their permission), and <strong>interactive demos</strong> where stakeholders can type their own queries and see results live. The interactive demo is the most powerful — when someone types their own question and gets a great answer, they sell themselves.</p>`
      },
      {
        type: "quiz",
        id: "dn-quiz-1",
        variant: "multiple-choice",
        question: "In a well-structured AI demo, what should you show AFTER the happy path but BEFORE the eval dashboard?",
        options: [
          { id: "a", text: "The technical architecture diagram" },
          { id: "b", text: "A graceful failure scenario showing guardrails working" },
          { id: "c", text: "Customer testimonials and case studies" },
          { id: "d", text: "A competitive analysis against similar products" }
        ],
        correct: "b",
        explanation: "The three-act demo structure is: Happy Path (it works), Graceful Failure (what happens when it doesn't), Eval Dashboard (proof it keeps working). Showing graceful failure in Act 2 builds trust with sophisticated audiences — it proves you've thought about edge cases and built systems to handle them, rather than hiding the technology's limitations."
      },
      {
        type: "exercise",
        id: "dn-exercise-1",
        title: "Demo Script",
        prompt: "Write a demo script for your AI product following the three-act structure. For each act, specify: what you'll show, what you'll say (narration), and what the audience should take away. Include the specific 'failure scenario' you'll trigger in Act 2 and why you chose it.",
        template: `ACT 1: HAPPY PATH (60% of demo time)
What I'll show:
[Describe the specific use case and data you'll use]

Narration (key lines):
[Write 3-4 sentences you'll actually say while demonstrating]

Audience takeaway:
[What should they conclude from this act?]

---

ACT 2: GRACEFUL FAILURE (20% of demo time)
Failure scenario I'll trigger:
[What edge case or limitation will you demonstrate?]

Why this scenario:
[Why did you choose this particular failure mode?]

Narration (key lines):
[Write 2-3 sentences explaining the guardrails at work]

Audience takeaway:
[What should they conclude about your approach to safety?]

---

ACT 3: EVAL DASHBOARD (20% of demo time)
Metrics I'll show:
[List 3-4 specific metrics on your dashboard]

Narration (key lines):
[Write 2-3 sentences connecting dashboard data to business value]

Audience takeaway:
[What should they conclude about operational maturity?]`,
        hints: [
          "For Act 1, use real data that's representative of your most common use case — not a cherry-picked best case.",
          "For Act 2, choose a failure that's realistic and that your audience would worry about. Showing you've anticipated their concerns is powerful.",
          "For Act 3, focus on metrics that prove stability over time, not just peak performance. Trends matter more than snapshots.",
          "Practice the transitions between acts — they should feel like a natural story, not three separate presentations."
        ]
      },
      {
        type: "takeaway",
        points: [
          "Structure demos as three acts: Happy Path (it works), Graceful Failure (guardrails in action), Eval Dashboard (ongoing proof).",
          "Package artifacts in layers — executive summary, technical deep-dive, eval appendix — so every audience gets what they need.",
          "Use the 'We tried X, learned Y, built Z, here's what happened' narrative to show your solution emerged from rigorous iteration."
        ]
      }
    ],
    flashcards: [
      { front: "What are the three acts of an effective AI demo?", back: "Act 1: Happy Path (60% of time, show it working end-to-end). Act 2: Graceful Failure (show guardrails catching edge cases). Act 3: Eval Dashboard (show operational metrics proving sustained quality)." },
      { front: "Why is showing failure on purpose powerful in an AI demo?", back: "It signals you understand the technology's limitations, you've built systems to handle them, and you're not hiding anything. Sophisticated audiences trust presenters who show failure handling more than those who show only perfection." },
      { front: "What three artifact layers should you prepare for a pitch?", back: "1) Executive Summary (1-2 pages, business-focused, no jargon). 2) Technical Deep-Dive (5-10 pages, architecture and trade-offs). 3) Appendix with Eval Data (raw results, methodology, benchmarks for verification)." },
      { front: "What is the 'learning story' narrative structure?", back: "'We tried X (first approach), we learned Y (what it taught us), we built Z (what we did differently), here's what happened (results).' This shows rigor and iteration, not lucky guessing." }
    ]
  },

  "rehearsal-dashboards": {
    id: "rehearsal-dashboards",
    moduleId: "pitch-preparation",
    title: "Rehearsal & Dashboards",
    estimatedMinutes: 20,
    sections: [
      {
        type: "concept",
        title: "The Rehearsal Framework: Five Rounds of Hostile Questions",
        content: `<p>Most people rehearse a pitch by running through their slides alone in a quiet room. That prepares you for a presentation, not a pitch. A pitch involves interruptions, skepticism, and questions you didn't anticipate. You need to rehearse for that.</p>
<p><strong>Round 1: The Friendly Run.</strong> Present to someone who knows your product and will give encouraging feedback. This round is about getting comfortable with the flow, finding where you stumble on transitions, and identifying sections that run too long. Time it. If your 15-minute pitch takes 22 minutes, you need to cut.</p>
<p><strong>Round 2: The Technical Skeptic.</strong> Present to an engineer or technical PM who will challenge your architecture, your eval methodology, and your scaling claims. Prepare for: "How does your RAG pipeline handle conflicting sources?", "What's your p99 latency?", "Show me your eval test set — how do you know it's representative?" This round exposes technical hand-waving.</p>
<p><strong>Round 3: The Business Skeptic.</strong> Present to someone in a business role — sales, marketing, finance. They'll challenge your market sizing, your ROI claims, and your competitive positioning. Prepare for: "How is this different from what [competitor] launched last month?", "What's the payback period?", "Who's the buyer?" This round exposes business-case gaps.</p>
<p><strong>Round 4: The Hostile Stakeholder.</strong> Present to someone who will actively try to derail you. They'll interrupt mid-sentence, ask questions about things you haven't covered yet, and challenge your fundamental assumptions. This round builds composure and teaches you to say "Great question — let me address that in three slides, but the short answer is..." without losing your place.</p>
<p><strong>Round 5: The Final Polish.</strong> Present to someone who represents your actual audience as closely as possible. Ask them not just for feedback on content but on impression: "Would you fund this?", "Would you buy this?", "What's your biggest remaining concern?" This round gives you your final adjustments.</p>`,
        expandable: true
      },
      {
        type: "callout",
        variant: "tip",
        title: "The Question Bank",
        content: `<p>After each rehearsal round, write down every question you were asked. By Round 5, you should have a bank of 30-50 questions with prepared responses. The real magic isn't knowing the answers — it's the confidence that comes from having been surprised five times in practice so nothing surprises you on stage.</p>`
      },
      {
        type: "concept",
        title: "Dashboard Design for Stakeholder Audiences",
        content: `<p>A dashboard that tries to serve everyone serves no one. Different audiences need different views of the same underlying data. The metrics are the same; the framing, visualization, and emphasis should be completely different.</p>
<p><strong>Engineering dashboards</strong> focus on system health and technical quality. Latency percentiles (p50, p95, p99), error rates by category, model version comparison, embedding quality metrics, retrieval precision and recall, cache hit rates, and infrastructure costs. Engineers want to see anomalies, drill into root causes, and track improvements over time. Use line charts for trends, heatmaps for error distributions, and tables for detailed breakdowns.</p>
<p><strong>Executive dashboards</strong> focus on business outcomes. Revenue impact, cost savings, user adoption rates, customer satisfaction scores, and ROI. Keep it to 4-6 metrics maximum. Use large numbers with directional arrows (up/down), simple bar charts for comparisons, and green/yellow/red status indicators. Executives glance at dashboards — if they can't get the story in 10 seconds, the dashboard has failed.</p>
<p><strong>Compliance dashboards</strong> focus on risk and regulatory adherence. Guardrail trigger rates, content policy violations, data handling audit logs, access patterns, bias metrics across protected categories, and incident response times. Compliance teams need evidence of controls working, not just outcomes. Use audit trails, pass/fail test results, and trend lines showing consistency over time.</p>
<p>The common mistake is building one dashboard and showing it to everyone. When you show an executive a p99 latency chart, you've lost them. When you show a compliance officer only business metrics, they think you're hiding something.</p>`,
        expandable: true,
        diagram: {
          type: "comparison",
          data: {
            columns: [
              {
                title: "Engineering",
                items: [
                  "Latency percentiles (p50/p95/p99)",
                  "Error rates by category",
                  "Model version comparisons",
                  "Retrieval precision & recall",
                  "Cache hit rates & infra costs"
                ],
                color: "#3B82F6"
              },
              {
                title: "Executive",
                items: [
                  "Revenue impact & ROI",
                  "Cost savings (dollar amounts)",
                  "User adoption rate",
                  "Customer satisfaction (CSAT/NPS)",
                  "4-6 metrics max, 10-second scan"
                ],
                color: "#F59E0B"
              },
              {
                title: "Compliance",
                items: [
                  "Guardrail trigger rates",
                  "Policy violation counts",
                  "Data handling audit logs",
                  "Bias metrics by category",
                  "Incident response times"
                ],
                color: "#10B981"
              }
            ]
          }
        }
      },
      {
        type: "concept",
        title: "Guardrail Evidence and Building Confidence",
        content: `<p>In any AI pitch, the unspoken question is: "Can I trust this?" You build trust not with promises but with evidence — specifically, evidence that you've tested extensively, thought about edge cases, and built systems that catch problems before they reach users.</p>
<p><strong>Show tests run, not just results.</strong> "We've run 12,400 eval test cases across 8 categories" is more convincing than "accuracy is 94%." The former tells the audience you're rigorous. Share the breakdown: how many tests per category, what types of edge cases you covered, how you generated test data, and how often you run the suite. Ideally, show the eval running — even a screenshot of a passing test suite builds confidence.</p>
<p><strong>Show edge cases caught.</strong> Prepare 3-4 specific examples of edge cases your guardrails caught in production or testing. "A user submitted a prompt injection attempt disguised as a support ticket. Our input filter caught it, logged it, and returned a safe response. Here's the log entry." Specificity builds trust; generality breeds skepticism.</p>
<p><strong>Show regulatory compliance achieved.</strong> If you've completed SOC 2, GDPR assessment, HIPAA compliance, or any other audit, show the certification or summary. If you're working toward it, show the progress and timeline. "We completed SOC 2 Type II in January. Our GDPR Data Protection Impact Assessment is filed. Here's our compliance dashboard showing 100% of required controls are in place."</p>
<p><strong>Know your limitations and say them first.</strong> The most confidence-building move in any pitch is voluntarily disclosing a limitation before someone asks about it. "Our system handles English and Spanish well — 94% and 91% accuracy respectively. We're not yet supporting other languages because our eval data isn't sufficient. That's on the Q3 roadmap." This signals you're aware, honest, and have a plan.</p>`,
        expandable: true
      },
      {
        type: "callout",
        variant: "warning",
        title: "The Dashboard Credibility Trap",
        content: `<p>If every metric on your dashboard is green, your audience won't trust it. A dashboard that shows some metrics in yellow — areas where you're improving but not yet at target — is far more credible. It shows you're measuring honestly, not just painting a rosy picture.</p>`
      },
      {
        type: "quiz",
        id: "rd-quiz-1",
        variant: "multiple-choice",
        question: "You're presenting an AI product dashboard to the CFO. Which set of metrics is most appropriate?",
        options: [
          { id: "a", text: "p95 latency, cache hit rate, embedding quality score, retrieval recall" },
          { id: "b", text: "Cost savings per transaction, ROI, user adoption rate, customer satisfaction score" },
          { id: "c", text: "Guardrail trigger rate, policy violations, audit log completeness, bias metrics" },
          { id: "d", text: "Model accuracy, F1 score, confusion matrix, token usage per query" }
        ],
        correct: "b",
        explanation: "The CFO cares about business outcomes: how much money is being saved, what the return on investment is, whether users are actually adopting the tool, and whether customers are happy. Technical metrics (A, D) belong on engineering dashboards. Compliance metrics (C) belong on compliance dashboards. The executive dashboard should have 4-6 business-outcome metrics that tell the story in under 10 seconds."
      },
      {
        type: "exercise",
        id: "rd-exercise-1",
        title: "Dashboard Design",
        prompt: "Design three dashboard views for your AI product: one for engineering, one for executives, and one for compliance. For each, specify the 4-6 most important metrics, the visualization type for each metric, and one sentence explaining why that metric matters to that specific audience.",
        template: `ENGINEERING DASHBOARD
Metric 1: [name] | Viz: [chart type] | Why: [reason]
Metric 2: [name] | Viz: [chart type] | Why: [reason]
Metric 3: [name] | Viz: [chart type] | Why: [reason]
Metric 4: [name] | Viz: [chart type] | Why: [reason]

EXECUTIVE DASHBOARD
Metric 1: [name] | Viz: [chart type] | Why: [reason]
Metric 2: [name] | Viz: [chart type] | Why: [reason]
Metric 3: [name] | Viz: [chart type] | Why: [reason]
Metric 4: [name] | Viz: [chart type] | Why: [reason]

COMPLIANCE DASHBOARD
Metric 1: [name] | Viz: [chart type] | Why: [reason]
Metric 2: [name] | Viz: [chart type] | Why: [reason]
Metric 3: [name] | Viz: [chart type] | Why: [reason]
Metric 4: [name] | Viz: [chart type] | Why: [reason]`,
        hints: [
          "Engineering metrics should enable debugging — can someone look at this dashboard and figure out why something broke?",
          "Executive metrics should tell a business story — would the CEO forward this dashboard to the board?",
          "Compliance metrics should provide evidence of controls — would a regulator accept this as proof of responsible AI?",
          "Choose visualization types that match the data: trends need line charts, comparisons need bars, pass/fail needs status indicators."
        ]
      },
      {
        type: "takeaway",
        points: [
          "Rehearse five times with different 'hostile' audiences: friendly, technical skeptic, business skeptic, hostile, and representative of your real audience.",
          "Build separate dashboards for engineering (system health), executives (business outcomes), and compliance (risk evidence) — one dashboard for all audiences serves none.",
          "Proactively disclose limitations before someone asks — it builds more trust than a flawless presentation."
        ]
      }
    ],
    flashcards: [
      { front: "What are the five rehearsal rounds and what does each test?", back: "1) Friendly Run (flow and timing), 2) Technical Skeptic (architecture and evals), 3) Business Skeptic (ROI and market), 4) Hostile Stakeholder (composure under pressure), 5) Final Polish (overall impression and remaining concerns)." },
      { front: "How many metrics should an executive dashboard have?", back: "4-6 metrics maximum. If they can't get the story in 10 seconds, the dashboard has failed. Use large numbers with arrows, simple bar charts, and green/yellow/red status indicators." },
      { front: "Why should some dashboard metrics be yellow rather than all green?", back: "A dashboard where every metric is green looks dishonest. Showing some yellow metrics — areas of active improvement — signals you're measuring honestly and have a realistic view of the system's current state." },
      { front: "What's the most confidence-building move in an AI pitch?", back: "Voluntarily disclosing a limitation before someone asks. It signals you're aware, honest, and have a plan. Example: 'We handle English and Spanish at 94%/91% accuracy — other languages are on the Q3 roadmap.'" }
    ]
  },

  "presenting-feedback": {
    id: "presenting-feedback",
    moduleId: "pitch-preparation",
    title: "Presenting & Customer Feedback",
    estimatedMinutes: 20,
    sections: [
      {
        type: "concept",
        title: "Demo Day Prep: Time Management and Hooks",
        content: `<p>Demo day is a performance, and performances need structure. The single biggest mistake presenters make is running long on the demo and rushing through metrics and Q&A — which are often the parts that actually close the deal.</p>
<p><strong>The 60/20/20 Rule.</strong> Allocate 60% of your time to the live demo, 20% to metrics and evidence, and 20% to Q&A. For a 30-minute slot, that's 18 minutes of demo, 6 minutes of metrics, and 6 minutes of Q&A. Set a timer. Practice until you can reliably hit these marks. If you're at 22 minutes of demo in practice, cut something — don't plan to "talk faster on the day."</p>
<p><strong>Hooks that win.</strong> Your first 30 seconds determine whether people lean in or check their phones. The best hooks are specific, surprising, and connected to something your audience already cares about. "Last quarter, our support team spent 12,000 hours on ticket classification alone — that's 6 full-time employees doing work a model can do in milliseconds" is better than "We built an AI-powered support tool." Start with the human cost or the missed opportunity, not the technology.</p>
<p><strong>The backup plan.</strong> Live demos fail. Networks go down, APIs time out, staging environments break. Always have a recorded video of your demo as backup. If the live demo fails, switch without apology: "Let me show you the recorded walkthrough — same functionality, guaranteed to work." Having a backup makes you calmer, which ironically makes the live demo less likely to fail.</p>
<p><strong>Handling unexpected questions during the demo.</strong> If someone asks a question during your demo that you plan to cover later, say: "That's exactly what I'll show in two minutes — hold that thought." If they ask something you won't cover, give a 10-second answer and offer to go deep in Q&A. Never let an unexpected question derail your flow — the audience loses confidence when you visibly scramble.</p>`,
        expandable: true
      },
      {
        type: "callout",
        variant: "key-insight",
        title: "The Q&A Goldmine",
        content: `<p>The Q&A section isn't something to survive — it's your best signal for what matters to your audience. After every pitch, write down every question you were asked. Over time, the pattern of questions tells you exactly what concerns your market has, what messages aren't landing, and what features to build next.</p>`
      },
      {
        type: "concept",
        title: "Getting Early Customer Feedback That's Actually Useful",
        content: `<p>The most common mistake when seeking customer feedback is asking "What do you think?" This produces polite, vague, useless responses. Structured feedback sessions with specific questions produce insights you can actually act on.</p>
<p><strong>Task-based sessions, not opinion sessions.</strong> Instead of showing people the product and asking what they think, give them a real task: "Using this tool, find the answer to this customer's question about their billing dispute." Then observe. Where do they hesitate? Where do they look confused? Where do they try to click something that isn't clickable? The behavior tells you more than the opinion.</p>
<p><strong>Specific questions, not general ones.</strong> Instead of "Was that easy?", ask: "On a scale of 1-5, how confident are you that the answer the system gave was correct?" Instead of "Would you use this?", ask: "If this were available tomorrow, which of your current workflows would you use it for first, and how many hours per week would it save you?" Specific questions get specific, actionable answers.</p>
<p><strong>The "Would You Pay For This?" test.</strong> The most honest feedback comes when money is on the table. "If this tool were available today at $X per month, would you sign up?" The pause before they answer tells you everything. If they say "I'd need to check with my manager," ask "What would your manager need to see to say yes?" Now you're designing your pitch for the actual decision-maker.</p>
<p><strong>Structured follow-up.</strong> After the session, send a brief survey within 24 hours. Three questions maximum: "What was the most useful thing about the tool?", "What was the most frustrating thing?", "What's one thing you wish it could do that it can't?" More than three questions and response rates plummet.</p>`,
        expandable: true
      },
      {
        type: "concept",
        title: "Paths to Paid Customers: Pilots and Pricing",
        content: `<p>Getting someone to say "that's cool" is easy. Getting them to pay for it is a completely different problem. The bridge between demo and revenue is the structured pilot.</p>
<p><strong>Pilot programs with success criteria.</strong> A good pilot has a defined scope (which use cases, which users, which data), a defined duration (typically 4-8 weeks), and explicit success criteria agreed upon before the pilot starts. "If the system achieves 90% accuracy on your ticket classification, reduces average resolution time by 30%, and your agents rate it 4+ out of 5, we'll move to a paid contract." Written success criteria prevent the "it was cool but we're not sure it worked" conversation at the end.</p>
<p><strong>Value-based pricing.</strong> Don't price based on what the AI costs you to run — price based on the value it delivers. If your tool saves a company 200 hours per month of analyst time and analysts cost $75/hour, you're saving them $15,000 per month. Pricing at $3,000/month (20% of value) is easy to justify and feels like a bargain. Per-seat pricing often undervalues AI products. Consider per-transaction, per-outcome, or value-share models.</p>
<p><strong>The pilot-to-paid transition.</strong> The most critical moment is the end of the pilot. Two weeks before it ends, schedule a review meeting. Come with the success criteria scorecard filled out with real data. Walk through each criterion: "We agreed on 90% accuracy — we achieved 94.2%. We agreed on 30% reduction in resolution time — we achieved 41%. Here are the detailed results." Make it easy to say yes by removing uncertainty.</p>`,
        expandable: true,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "n1", label: "Demo &\nFeedback", type: "start" },
              { id: "n2", label: "Define Pilot\nScope & Criteria", type: "process" },
              { id: "n3", label: "Run Pilot\n(4-8 weeks)", type: "process" },
              { id: "n4", label: "Success\nCriteria Met?", type: "decision" },
              { id: "n5", label: "Paid Contract\n(value-based)", type: "end" },
              { id: "n6", label: "Iterate &\nRe-pilot", type: "process" }
            ],
            edges: [["n1", "n2"], ["n2", "n3"], ["n3", "n4"], ["n4", "n5"], ["n4", "n6"], ["n6", "n3"]]
          }
        }
      },
      {
        type: "callout",
        variant: "example",
        title: "Pricing Anchoring in Practice",
        content: `<p>When presenting pricing, always lead with the value, not the cost. "This tool saves your team 200 hours per month — at your loaded analyst cost, that's $15,000 in monthly savings. The tool costs $3,000 per month, so you net $12,000 per month in savings from day one." The customer is now negotiating against the $15,000 anchor, not evaluating $3,000 in a vacuum.</p>`
      },
      {
        type: "concept",
        title: "Post-Launch Feedback Loops",
        content: `<p>Launching is the beginning, not the end. The AI products that succeed long-term are the ones with robust feedback loops that continuously improve quality based on real usage data.</p>
<p><strong>Usage analytics.</strong> Track what users actually do, not just what they say. Which features get used? Where do users drop off? What queries produce low-confidence responses? How often do users edit AI-generated outputs (and what do they change)? Usage data reveals the gap between your mental model of how the product works and how it actually gets used in the wild.</p>
<p><strong>Explicit feedback mechanisms.</strong> Build thumbs-up/thumbs-down into every AI response. Make it effortless — one click, no form. For thumbs-down, optionally ask "What went wrong?" with pre-set categories: "Wrong answer," "Right answer but poorly written," "Took too long," "Didn't understand my question." This gives you labeled data for improving both the model and the product experience.</p>
<p><strong>Continuous eval pipeline.</strong> Your evaluation suite shouldn't be something you run before launch and forget about. Set up daily automated eval runs against your production system using a curated test set. Track accuracy, latency, and cost over time. Set alerts when metrics drift below thresholds. "Our accuracy dropped from 94% to 89% over two weeks" should trigger an investigation, not be discovered in a quarterly review.</p>
<p><strong>The feedback flywheel.</strong> The best feedback loops compound: usage data reveals failure modes, which become new eval test cases, which drive model improvements, which improve user experience, which drives more usage. The product gets better because it's being used, and it gets used more because it's getting better. Building this flywheel is the single most important thing you do after launch.</p>`,
        expandable: true
      },
      {
        type: "quiz",
        id: "pf-quiz-1",
        variant: "multiple-choice",
        question: "You're running a customer feedback session for your AI product. Which approach will produce the most actionable insights?",
        options: [
          { id: "a", text: "Show the product and ask 'What do you think? Any feedback?'" },
          { id: "b", text: "Give users a specific task to complete and observe where they struggle, then ask targeted follow-up questions" },
          { id: "c", text: "Send a 20-question survey covering every feature of the product" },
          { id: "d", text: "Ask users to compare your product to three competitors and rank them" }
        ],
        correct: "b",
        explanation: "Task-based feedback sessions produce the most actionable insights because you observe real behavior, not stated preferences. People are bad at articulating what they want but good at showing you through their actions. Watching where they hesitate, get confused, or make errors reveals problems that 'What do you think?' never surfaces. Long surveys (C) get low response rates, and competitive comparisons (D) tell you about positioning, not usability."
      },
      {
        type: "exercise",
        id: "pf-exercise-1",
        title: "Launch Plan",
        prompt: "Create a launch plan for your AI product covering the first 90 days post-launch. Include your pilot structure, feedback collection mechanisms, pricing strategy, and the continuous eval pipeline you'll set up. Be specific about timelines, success criteria, and what triggers a decision to expand, iterate, or stop.",
        template: `PILOT STRUCTURE (Weeks 1-6)
Scope: [Which use cases, users, and data are included?]
Success criteria:
  1. [Metric]: Target [value]
  2. [Metric]: Target [value]
  3. [Metric]: Target [value]
Timeline for review meeting: [date relative to pilot start]

FEEDBACK COLLECTION (Ongoing from Week 1)
In-product feedback: [mechanism and what you'll track]
User sessions: [frequency, format, key questions]
Follow-up survey: [timing and 3 key questions]

PRICING STRATEGY
Pricing model: [per-seat / per-transaction / value-share / other]
Price point: [amount and justification based on value delivered]
Pilot-to-paid transition: [what triggers the conversion conversation?]

CONTINUOUS EVAL PIPELINE (Set up by Week 2)
Test set: [size, categories, update frequency]
Run frequency: [daily/weekly]
Alert thresholds: [what metrics and at what levels?]
Drift response plan: [what happens when an alert fires?]

GO/NO-GO CRITERIA AT 90 DAYS
Expand if: [conditions]
Iterate if: [conditions]
Stop if: [conditions]`,
        hints: [
          "Success criteria should be agreed upon with the pilot customer BEFORE the pilot starts — never retroactively.",
          "Set up your eval pipeline in the first two weeks, not after the pilot. You need the data from day one.",
          "Your pricing justification should reference the customer's own cost data, not your infrastructure costs.",
          "The 'stop' criteria are as important as the 'expand' criteria — knowing when to kill a product is a PM superpower."
        ]
      },
      {
        type: "takeaway",
        points: [
          "Follow the 60/20/20 rule for demo day: 60% demo, 20% metrics, 20% Q&A — and always have a recorded backup.",
          "Get useful feedback by giving users specific tasks and observing behavior, not by asking 'What do you think?'",
          "Structure pilots with written success criteria agreed upon upfront, and use value-based pricing anchored to the customer's savings.",
          "Build a continuous feedback flywheel: usage data reveals failures, failures become eval tests, tests drive improvements, improvements drive adoption."
        ]
      }
    ],
    flashcards: [
      { front: "What is the 60/20/20 rule for demo day?", back: "60% of time on the live demo, 20% on metrics and evidence, 20% on Q&A. For a 30-minute slot: 18 min demo, 6 min metrics, 6 min Q&A. Always set a timer and practice until you hit these marks." },
      { front: "Why is 'What do you think?' a bad feedback question?", back: "It produces polite, vague, useless responses. Instead, give users a specific task, observe their behavior, and ask targeted questions like 'How confident are you the answer was correct?' or 'Which workflow would you use this for first?'" },
      { front: "What makes a good AI product pilot structure?", back: "Defined scope (use cases, users, data), defined duration (4-8 weeks), and explicit success criteria agreed upon BEFORE the pilot starts. Example: '90% accuracy, 30% faster resolution, 4+/5 agent rating.'" },
      { front: "What is the 'feedback flywheel' for AI products?", back: "Usage data reveals failure modes -> failures become new eval test cases -> tests drive model improvements -> improvements enhance user experience -> better UX drives more usage -> more usage reveals more failure modes. The product gets better because it's used, and gets used more because it's better." }
    ]
  }
};
