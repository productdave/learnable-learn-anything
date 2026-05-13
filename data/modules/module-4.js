export default {

  // ─────────────────────────────────────────────
  // TOPIC 1: AI-First PRDs & Case Studies
  // ─────────────────────────────────────────────
  "ai-first-docs": {
    id: "ai-first-docs",
    moduleId: "portfolio-building",
    title: "AI-First PRDs & Case Studies",
    estimatedMinutes: 30,
    sections: [
      {
        type: "concept",
        title: "What Makes a Document \"AI-First\"",
        expandable: false,
        content: `<p>A traditional PRD assumes deterministic software: you specify inputs, logic, and outputs, and the system behaves the same way every time. An AI-first PRD acknowledges that the system is probabilistic. Outputs vary across runs, quality degrades on edge cases, and the cost-per-request is a first-class constraint.</p>
<p>An AI-first artifact addresses five areas that traditional docs skip entirely:</p>
<ul>
  <li><strong>Model selection rationale</strong> &mdash; why you chose GPT-4o over Claude Sonnet, or a fine-tuned Llama 3.1 8B over a frontier model. This is not a tech decision; it is a product decision because it determines latency, cost, and quality ceilings.</li>
  <li><strong>Evaluation methodology</strong> &mdash; how you measure whether the AI is doing its job. Not just unit tests&mdash;rubric-based evals, LLM-as-judge pipelines, golden-set benchmarks, and regression suites.</li>
  <li><strong>Guardrail design</strong> &mdash; what the system does when the model produces harmful, off-topic, or low-confidence outputs. Input filters, output validators, confidence thresholds, and human escalation paths.</li>
  <li><strong>Cost modeling</strong> &mdash; tokens per request, requests per user per day, cache hit rates, and projected monthly spend at 10x scale. This is the section that kills projects that look great on paper.</li>
  <li><strong>Data strategy</strong> &mdash; where training or retrieval data comes from, how it stays fresh, who labels it, and what happens when the distribution shifts.</li>
</ul>`,
        diagram: {
          type: "comparison",
          data: {
            columns: [
              {
                title: "Traditional PRD",
                items: [
                  "Problem statement",
                  "User stories",
                  "Functional requirements",
                  "Technical architecture",
                  "Launch plan & rollback",
                  "Success metrics (KPIs)"
                ],
                color: "#6B7280"
              },
              {
                title: "AI-First PRD (adds these)",
                items: [
                  "Model selection rationale",
                  "Eval methodology & golden sets",
                  "Guardrail & fallback design",
                  "Cost model (tokens, cache, scale)",
                  "Data strategy & freshness plan",
                  "Confidence thresholds & escalation"
                ],
                color: "#8B5CF6"
              }
            ]
          }
        }
      },
      {
        type: "callout",
        variant: "key-insight",
        title: "The Eval Section Is Your Credibility",
        content: `<p>Hiring managers skim PRDs quickly. The single section that separates a junior PM's AI doc from a senior one is the evaluation plan. If you can articulate <em>how</em> you would measure whether a model is performing well&mdash;with specific metrics, thresholds, and test set design&mdash;you signal that you understand the core challenge of shipping AI.</p>`
      },
      {
        type: "concept",
        title: "Portfolio-Worthy PRD Structure",
        expandable: true,
        content: `<p>Here is a concrete outline you can use. Every section should be 1-3 paragraphs, not 10 pages. Concise beats comprehensive.</p>
<ul>
  <li><strong>1. Problem &amp; Opportunity</strong> &mdash; What pain exists today? What is the cost of the status quo? Who feels it most?</li>
  <li><strong>2. AI Approach</strong> &mdash; Why AI is the right tool (vs. rules, heuristics, or human labor). What type of AI (classification, generation, extraction, agent)?</li>
  <li><strong>3. Data Requirements</strong> &mdash; What data feeds the model? Volume, format, labeling needs, refresh cadence. PII considerations.</li>
  <li><strong>4. Model Selection</strong> &mdash; Which model(s) and why. Include the trade-off analysis: latency vs. quality vs. cost. Mention alternatives you considered.</li>
  <li><strong>5. Evaluation Plan</strong> &mdash; Golden test sets, metrics (accuracy, F1, BLEU, custom rubrics), pass/fail thresholds, regression strategy.</li>
  <li><strong>6. Guardrails &amp; Safety</strong> &mdash; Input validation, output filtering, confidence thresholds, human-in-the-loop triggers, content policy.</li>
  <li><strong>7. Cost Model</strong> &mdash; Per-request cost, projected monthly spend, scaling assumptions, cost optimization levers (caching, batching, model distillation).</li>
  <li><strong>8. Launch Plan</strong> &mdash; Phased rollout, shadow mode, A/B testing plan, rollback criteria, monitoring dashboards.</li>
</ul>`
      },
      {
        type: "concept",
        title: "Case Study Format That Lands Interviews",
        expandable: true,
        content: `<p>A case study is your proof of execution. Use this structure:</p>
<ul>
  <li><strong>Situation</strong> &mdash; Company context, team size, timeline. One paragraph max.</li>
  <li><strong>AI-Specific Challenges</strong> &mdash; What made this hard from an AI perspective? Data quality issues, latency constraints, hallucination risks, cost pressure, regulatory requirements.</li>
  <li><strong>Decisions Made</strong> &mdash; The 2-3 key product decisions you drove. Frame each as a trade-off: "We chose X over Y because Z." Examples: build vs. buy, fine-tune vs. prompt-engineer, synchronous vs. async processing.</li>
  <li><strong>Outcomes with Metrics</strong> &mdash; Hard numbers. Task completion rate improved from 62% to 89%. Cost per query dropped from $0.12 to $0.03 via model distillation. CSAT increased 18 points.</li>
  <li><strong>Lessons Learned</strong> &mdash; What you would do differently. This is where you show humility and growth. "We should have built evals before we built features."</li>
</ul>
<p>If you do not have production experience, write a case study about a personal project, a hackathon, or a hypothetical product where you did the research to make it realistic.</p>`
      },
      {
        type: "concept",
        title: "Decision Docs: Framing AI Trade-Offs",
        expandable: true,
        content: `<p>Decision documents are underrated portfolio pieces. They show you can think through ambiguity. Three trade-offs come up constantly in AI product work:</p>
<ul>
  <li><strong>Build vs. Buy</strong> &mdash; Build your own model pipeline vs. use an API (OpenAI, Anthropic, Google). Build when: you need data privacy, have unique training data, or need sub-10ms latency. Buy when: speed to market matters, the task is general-purpose, or your team lacks ML ops skills.</li>
  <li><strong>Fine-Tune vs. Prompt-Engineer</strong> &mdash; Fine-tuning changes how the model behaves; prompting changes what it knows per-request. Fine-tune when: you need consistent tone/format across thousands of outputs, you are replacing an expensive frontier model with a cheaper SLM, or domain reasoning requires internalized knowledge. Prompt-engineer when: requirements shift weekly, you have fewer than 100 examples, or latency budgets are tight.</li>
  <li><strong>SLM vs. Frontier Model</strong> &mdash; A fine-tuned Llama 3.1 8B or Mistral 7B can match GPT-4-class performance on narrow, well-defined tasks at 1/50th the cost. Use frontier models for open-ended reasoning, multi-step planning, and tasks where you cannot define a tight eval. Use SLMs when the task is constrained, throughput matters, and you have good training data.</li>
</ul>`
      },
      {
        type: "quiz",
        id: "ai-first-prd-sections",
        variant: "multiple-choice",
        question: "Which of the following is NOT an AI-specific section that distinguishes an AI-first PRD from a traditional PRD?",
        options: [
          { id: "a", text: "Model selection rationale with cost and latency trade-offs" },
          { id: "b", text: "User stories describing persona needs and workflows" },
          { id: "c", text: "Evaluation methodology with golden test sets and rubrics" },
          { id: "d", text: "Guardrail design including confidence thresholds and escalation" }
        ],
        correct: "b",
        explanation: "User stories are a standard part of any PRD, not AI-specific. Model selection rationale, evaluation methodology, and guardrail design are the sections that make a PRD 'AI-first.' These address the unique challenges of probabilistic systems: choosing the right model, measuring quality, and handling failure modes."
      },
      {
        type: "exercise",
        id: "ai-first-case-study",
        title: "AI-First Case Study",
        prompt: "Write a case study for an AI feature you have worked on, used, or would like to build. Use the five-section structure: Situation, AI-Specific Challenges, Decisions Made, Outcomes with Metrics, Lessons Learned. Even if the metrics are estimated or hypothetical, make them specific and realistic.",
        template: `## Case Study: [Feature/Product Name]

### Situation
[Company/context, team, timeline — 2-3 sentences]

### AI-Specific Challenges
- Challenge 1: [e.g., training data was sparse and noisy]
- Challenge 2: [e.g., latency budget was 200ms but model inference took 800ms]
- Challenge 3: [e.g., hallucination rate on edge cases was unacceptable]

### Decisions Made
1. [Decision]: We chose [X] over [Y] because [rationale with trade-off].
2. [Decision]: We chose [X] over [Y] because [rationale with trade-off].

### Outcomes with Metrics
- [Metric 1]: improved from [baseline] to [result]
- [Metric 2]: reduced from [baseline] to [result]
- [Business impact]: [revenue, cost savings, or user impact]

### Lessons Learned
1. [What you would do differently and why]
2. [What surprised you about shipping AI vs. traditional software]`,
        hints: [
          "Pick a real product you use daily — how would you add AI to it? What would break?",
          "For Decisions Made, frame every choice as a trade-off, not just a selection. 'We chose X' is weak. 'We chose X over Y because Z' is strong.",
          "Estimated metrics are fine, but make them plausible. If you claim 99% accuracy on a hard NLP task, reviewers will doubt your judgment.",
          "The Lessons Learned section is where senior PMs distinguish themselves. Show self-awareness."
        ]
      },
      {
        type: "takeaway",
        points: [
          "An AI-first PRD adds five sections traditional PRDs skip: model selection, eval methodology, guardrails, cost modeling, and data strategy.",
          "The evaluation plan is the highest-signal section for hiring managers — it shows you understand probabilistic systems.",
          "Case studies should use the Situation / AI Challenges / Decisions / Outcomes / Lessons structure, with specific metrics even if estimated.",
          "Decision docs showing trade-off reasoning (build vs. buy, fine-tune vs. prompt, SLM vs. frontier) are underrated portfolio pieces."
        ]
      }
    ],
    flashcards: [
      {
        front: "What five sections distinguish an AI-first PRD from a traditional PRD?",
        back: "1) Model selection rationale, 2) Evaluation methodology, 3) Guardrail design, 4) Cost modeling (tokens, cache, scale), 5) Data strategy (sourcing, labeling, freshness)."
      },
      {
        front: "What is the recommended five-section structure for an AI case study?",
        back: "Situation, AI-Specific Challenges, Decisions Made (framed as trade-offs), Outcomes with Metrics, Lessons Learned."
      },
      {
        front: "When should you choose fine-tuning over prompt engineering?",
        back: "Fine-tune when you need consistent tone/format at scale, are replacing an expensive frontier model with a cheaper SLM, or need internalized domain reasoning. Prompt-engineer when requirements change frequently, you have few examples, or latency budgets are tight."
      },
      {
        front: "When should you use a small language model (SLM) instead of a frontier model?",
        back: "Use SLMs when the task is narrow and well-defined, throughput matters, you have good training data, and you can define a tight eval. Use frontier models for open-ended reasoning, multi-step planning, and tasks without clear evaluation criteria."
      }
    ]
  },

  // ─────────────────────────────────────────────
  // TOPIC 2: KPIs for AI Agents
  // ─────────────────────────────────────────────
  "agent-kpis": {
    id: "agent-kpis",
    moduleId: "portfolio-building",
    title: "KPIs for AI Agents",
    estimatedMinutes: 30,
    sections: [
      {
        type: "concept",
        title: "Why Agent KPIs Are Different",
        expandable: false,
        content: `<p>Traditional software KPIs assume deterministic behavior. You measure uptime, response time, and error rate, and those numbers are stable across identical inputs. Agents break this assumption in three ways:</p>
<ul>
  <li><strong>Variable execution paths</strong> &mdash; An agent might solve the same task in 3 steps or 15 steps depending on the model's reasoning. Step count directly affects cost and latency.</li>
  <li><strong>Tool selection uncertainty</strong> &mdash; The agent decides which tools to call and in what order. A wrong tool call wastes tokens and time, and may produce incorrect results.</li>
  <li><strong>Compounding errors</strong> &mdash; Each step's output feeds the next step's input. A small hallucination in step 2 can cascade into a completely wrong answer by step 6.</li>
</ul>
<p>This means you need KPIs that track <em>how</em> the agent works, not just <em>whether</em> it works. Five categories cover the full picture.</p>`,
        diagram: {
          type: "comparison",
          data: {
            columns: [
              {
                title: "Reliability",
                items: [
                  "Task completion rate",
                  "Error rate (tool failures)",
                  "Tool selection accuracy",
                  "Retry rate"
                ],
                color: "#0239A8"
              },
              {
                title: "Performance",
                items: [
                  "Latency p50 / p95",
                  "Steps per task",
                  "Time-to-first-token",
                  "Thinking time ratio"
                ],
                color: "#F42A72"
              },
              {
                title: "Cost",
                items: [
                  "Cost per task",
                  "Tokens per session",
                  "Cache hit rate",
                  "Cost per successful task"
                ],
                color: "#F59E0B"
              },
              {
                title: "Quality",
                items: [
                  "Hallucination rate",
                  "Groundedness score",
                  "Tool call correctness",
                  "Answer faithfulness"
                ],
                color: "#1CE6D2"
              },
              {
                title: "User Impact",
                items: [
                  "CSAT / thumbs up rate",
                  "Human escalation rate",
                  "Task deflection rate",
                  "Time saved per user"
                ],
                color: "#8B5CF6"
              }
            ]
          }
        }
      },
      {
        type: "concept",
        title: "Reliability Metrics",
        expandable: true,
        content: `<p>Reliability answers the question: does the agent finish what it starts, and does it use its tools correctly?</p>
<ul>
  <li><strong>Task completion rate</strong> &mdash; Percentage of tasks where the agent produces a final answer or takes the requested action. Target: &gt;90% for production agents. Below 85% and users stop trusting the system.</li>
  <li><strong>Error rate</strong> &mdash; Percentage of tool calls that fail (API errors, malformed parameters, permission issues). Track separately from model errors. Target: &lt;5%.</li>
  <li><strong>Tool selection accuracy</strong> &mdash; Did the agent call the right tool for the job? Measured by comparing the agent's tool sequence against a golden set of correct sequences. This is hard to measure at scale, so start with manual review of 50-100 sessions per week.</li>
  <li><strong>Retry rate</strong> &mdash; How often the agent needs to retry a failed step. High retry rates inflate cost and latency. Target: &lt;10% of steps require retries.</li>
</ul>`
      },
      {
        type: "concept",
        title: "Performance Metrics",
        expandable: true,
        content: `<p>Performance tracks speed and efficiency. Users have strong latency expectations even for complex agent tasks.</p>
<ul>
  <li><strong>Latency p50 / p95</strong> &mdash; Median and 95th percentile end-to-end time from request to final response. p95 matters more than p50 because the worst experiences drive churn. Target depends on use case: &lt;5s for chat assistants, &lt;30s for research agents, &lt;2min for code generation agents.</li>
  <li><strong>Steps per task</strong> &mdash; Average number of reasoning + tool-call steps. Fewer steps means lower cost and faster results. Track the distribution, not just the mean&mdash;a bimodal distribution suggests the agent is taking wildly different paths for similar tasks.</li>
  <li><strong>Time-to-first-token</strong> &mdash; How quickly the user sees the agent is working. Streaming helps perception even when total latency is high.</li>
  <li><strong>Thinking time ratio</strong> &mdash; Proportion of total latency spent on model inference vs. tool execution. Helps identify whether to optimize the model (bigger cache, smaller model) or the tools (faster APIs, connection pooling).</li>
</ul>`
      },
      {
        type: "concept",
        title: "Cost Metrics",
        expandable: true,
        content: `<p>Cost is where AI agents differ most from traditional features. Every agent invocation burns tokens, and costs scale with usage in ways that server compute does not.</p>
<ul>
  <li><strong>Cost per task</strong> &mdash; Total token cost for one completed task. Include input tokens, output tokens, and any embedding or retrieval costs. A customer service agent might cost $0.02-$0.15 per resolved ticket depending on model and conversation length.</li>
  <li><strong>Tokens per session</strong> &mdash; Total tokens consumed across all LLM calls in a session. Track input and output separately because pricing differs (often 3-5x). Context window stuffing is the most common cost antipattern.</li>
  <li><strong>Cache hit rate</strong> &mdash; Percentage of requests served from prompt cache. Prompt caching (available in Claude, GPT-4, and others) can reduce input token costs by 50-90%. Target: &gt;40% for repetitive workflows.</li>
  <li><strong>Cost per <em>successful</em> task</strong> &mdash; Critical distinction from cost per task. If your agent fails 20% of the time, the effective cost is 25% higher than the raw per-task number. This is the metric that matters for unit economics.</li>
</ul>`
      },
      {
        type: "callout",
        variant: "warning",
        title: "The Cost Spiral Trap",
        content: `<p>Agents can enter cost spirals: a failed tool call triggers a retry, which adds context, which exceeds the context window, which triggers summarization, which loses information, which causes another failure. Monitor cost per task at p99, not just the mean. Set hard token budgets per session and kill the loop if exceeded.</p>`
      },
      {
        type: "concept",
        title: "Quality Metrics",
        expandable: true,
        content: `<p>Quality measures whether the agent's outputs are correct, grounded, and trustworthy.</p>
<ul>
  <li><strong>Hallucination rate</strong> &mdash; Percentage of responses containing claims not supported by the source data or tool results. Target: &lt;2% for production. Measured via LLM-as-judge (a second model evaluating the first) or human review on a sample.</li>
  <li><strong>Groundedness score</strong> &mdash; How well the agent's response is supported by the retrieved context. Scored 0-1 per response using NLI-based models or rubric-based LLM judges. Target: &gt;0.85 average.</li>
  <li><strong>Tool call correctness</strong> &mdash; Were the parameters passed to tools correct? Did the agent use the right API endpoint, pass valid IDs, and format requests properly? Measured by comparing against golden tool call sequences.</li>
  <li><strong>Answer faithfulness</strong> &mdash; Does the final answer accurately reflect the tool results? An agent might call the right tool, get the right data, and then summarize it incorrectly. Faithfulness catches this last-mile error.</li>
</ul>`
      },
      {
        type: "concept",
        title: "User Impact Metrics",
        expandable: true,
        content: `<p>User impact connects agent performance to business outcomes. These are the metrics your stakeholders care about most.</p>
<ul>
  <li><strong>CSAT / thumbs up rate</strong> &mdash; Direct user satisfaction signal. Thumbs up/down on agent responses gives you per-interaction quality data. Target: &gt;80% positive. Below 70% signals a trust problem.</li>
  <li><strong>Human escalation rate</strong> &mdash; Percentage of tasks where the agent hands off to a human because it cannot complete the task or confidence is below threshold. Target: &lt;15% for mature agents. Track the <em>reasons</em> for escalation&mdash;they tell you where to improve.</li>
  <li><strong>Task deflection rate</strong> &mdash; Percentage of tasks the agent handles that would otherwise require a human. This is the ROI metric. If your agent deflects 60% of tier-1 support tickets, that is a concrete headcount savings number.</li>
  <li><strong>Time saved per user</strong> &mdash; How many minutes the agent saves compared to the manual workflow. Measure via time-on-task studies or before/after comparisons.</li>
</ul>`
      },
      {
        type: "concept",
        title: "Setting Targets and Observability",
        expandable: true,
        content: `<p>Setting targets requires baseline data. Run your agent on 200-500 representative tasks before setting targets. Then use the 80th percentile as your initial target and iterate.</p>
<p>Common starting targets for production agents:</p>
<ul>
  <li>Hallucination rate: &lt;2%</li>
  <li>Task completion: &gt;90%</li>
  <li>Latency p95: &lt;30s (task-dependent)</li>
  <li>Cost per task: set based on value of task being automated</li>
  <li>Human escalation: &lt;15%</li>
</ul>
<p><strong>Observability tools</strong> to instrument these metrics:</p>
<ul>
  <li><strong>LangSmith</strong> &mdash; Tracing, evals, and dataset management. Best for LangChain-based stacks.</li>
  <li><strong>Langfuse</strong> &mdash; Open-source tracing with cost tracking and scoring. Framework-agnostic.</li>
  <li><strong>Arize Phoenix</strong> &mdash; Open-source tracing with strong hallucination detection and retrieval analysis.</li>
  <li><strong>Braintrust</strong> &mdash; Eval-focused platform with strong prompt management and A/B testing.</li>
  <li><strong>Datadog LLM Observability</strong> &mdash; Enterprise-grade, integrates with existing Datadog APM. Good for orgs already on Datadog.</li>
  <li><strong>Helicone</strong> &mdash; Lightweight proxy-based logging with cost dashboards. Easy to set up.</li>
</ul>`
      },
      {
        type: "quiz",
        id: "agent-kpi-classification",
        variant: "drag-match",
        question: "Match each metric to its KPI category.",
        pairs: [
          { left: "Tool selection accuracy", right: "Reliability" },
          { left: "Latency p95", right: "Performance" },
          { left: "Tokens per session", right: "Cost" },
          { left: "Hallucination rate", right: "Quality" },
          { left: "Task deflection rate", right: "User Impact" }
        ],
        explanation: "Tool selection accuracy measures whether the agent reliably picks the right tool (Reliability). Latency p95 tracks how long the slowest requests take (Performance). Tokens per session measures consumption and directly drives spend (Cost). Hallucination rate measures output correctness (Quality). Task deflection rate measures how many tasks the agent handles without human help (User Impact)."
      },
      {
        type: "exercise",
        id: "kpi-framework",
        title: "KPI Framework",
        prompt: "Design a KPI framework for an AI agent of your choice (customer support bot, code assistant, research agent, etc.). For each of the five categories, pick the two most important metrics, set specific targets, and explain how you would measure them.",
        template: `## KPI Framework: [Agent Type]

### Agent Description
[What does this agent do? Who uses it? 2-3 sentences]

### Reliability
- Metric 1: [name] — Target: [value] — Measurement: [how]
- Metric 2: [name] — Target: [value] — Measurement: [how]

### Performance
- Metric 1: [name] — Target: [value] — Measurement: [how]
- Metric 2: [name] — Target: [value] — Measurement: [how]

### Cost
- Metric 1: [name] — Target: [value] — Measurement: [how]
- Metric 2: [name] — Target: [value] — Measurement: [how]

### Quality
- Metric 1: [name] — Target: [value] — Measurement: [how]
- Metric 2: [name] — Target: [value] — Measurement: [how]

### User Impact
- Metric 1: [name] — Target: [value] — Measurement: [how]
- Metric 2: [name] — Target: [value] — Measurement: [how]

### Observability Stack
[Which tools would you use to measure these? Why?]`,
        hints: [
          "Start with user impact — what business outcome does this agent drive? Work backwards to the operational metrics that predict that outcome.",
          "Your targets should be realistic for an initial launch. You can always tighten them. Claiming <0.1% hallucination rate on a general-purpose agent is not credible.",
          "For measurement, specify whether it is automated (LLM-as-judge, log analysis) or manual (human review sample). Both are valid, but be explicit about sample sizes and cadence.",
          "Cost per successful task is more useful than cost per task — it accounts for failures and retries."
        ]
      },
      {
        type: "takeaway",
        points: [
          "Agent KPIs span five categories: reliability, performance, cost, quality, and user impact — each captures a dimension traditional software metrics miss.",
          "Cost per successful task (not just cost per task) is the metric that matters for unit economics because it accounts for failure rates.",
          "Set targets using baseline data from 200-500 representative tasks, starting at the 80th percentile.",
          "Observability tools like LangSmith, Langfuse, and Arize Phoenix let you trace agent behavior step-by-step to diagnose failures."
        ]
      }
    ],
    flashcards: [
      {
        front: "What are the five KPI categories for AI agents?",
        back: "Reliability (task completion, error rate), Performance (latency p50/p95, steps per task), Cost (cost per task, tokens per session), Quality (hallucination rate, groundedness), and User Impact (CSAT, human escalation rate, task deflection)."
      },
      {
        front: "Why is 'cost per successful task' more important than 'cost per task'?",
        back: "Cost per successful task accounts for failed attempts. If an agent fails 20% of the time, the effective cost per success is 25% higher than the raw per-task average. This is the number that matters for unit economics and ROI calculations."
      },
      {
        front: "What is a reasonable hallucination rate target for a production AI agent?",
        back: "Less than 2%. Measured via LLM-as-judge (a second model evaluating the first) or human review on a sample. Higher than 5% typically erodes user trust to the point where adoption stalls."
      },
      {
        front: "Name three observability tools for monitoring AI agents and their differentiators.",
        back: "LangSmith — tracing/evals, best for LangChain stacks. Langfuse — open-source, framework-agnostic, with cost tracking. Arize Phoenix — open-source with strong hallucination detection. Others: Braintrust (eval-focused), Datadog LLM Observability (enterprise), Helicone (lightweight proxy-based)."
      }
    ]
  },

  // ─────────────────────────────────────────────
  // TOPIC 3: Fine-Tuning & Continuous Learning
  // ─────────────────────────────────────────────
  "fine-tuning": {
    id: "fine-tuning",
    moduleId: "portfolio-building",
    title: "Fine-Tuning & Continuous Learning",
    estimatedMinutes: 30,
    sections: [
      {
        type: "concept",
        title: "Fine-Tuning vs. RAG: Two Different Levers",
        expandable: false,
        content: `<p>This is the single most important distinction to get right as a PM working with AI engineers:</p>
<ul>
  <li><strong>Fine-tuning changes HOW the model behaves.</strong> It adjusts the model's weights so it responds in a particular style, follows a specific format, or reasons about a domain in a particular way. The knowledge becomes part of the model itself.</li>
  <li><strong>RAG changes WHAT the model knows.</strong> It retrieves relevant documents at inference time and stuffs them into the context window. The model's behavior stays the same; it just has access to different information.</li>
</ul>
<p>Analogy: fine-tuning is like training a new employee to think like your team. RAG is like giving that employee a reference manual to look things up. Both are useful. They solve different problems. And you can use both at the same time.</p>
<p><strong>When to fine-tune:</strong></p>
<ul>
  <li>You need a consistent tone, voice, or output format that prompting cannot reliably achieve</li>
  <li>Domain-specific reasoning patterns (medical diagnosis logic, legal analysis frameworks)</li>
  <li>Cost reduction: replacing a $15/M-token frontier model with a $0.20/M-token fine-tuned SLM</li>
  <li>Latency: smaller fine-tuned models run faster</li>
</ul>
<p><strong>When to use RAG:</strong></p>
<ul>
  <li>The knowledge base changes frequently (daily, weekly)</li>
  <li>You need citation and source attribution</li>
  <li>The corpus is too large to fit into training data</li>
  <li>You want to avoid retraining costs</li>
</ul>`
      },
      {
        type: "callout",
        variant: "key-insight",
        title: "The Decision Framework",
        content: `<p>Ask yourself: "Am I trying to change what the model knows, or how it thinks?" If the answer is "what it knows," use RAG. If the answer is "how it thinks/writes/reasons," consider fine-tuning. If the answer is both, use both: fine-tune for behavior, RAG for knowledge.</p>`
      },
      {
        type: "concept",
        title: "LoRA: Practical Fine-Tuning",
        expandable: true,
        content: `<p><strong>LoRA (Low-Rank Adaptation)</strong> is the technique that made fine-tuning practical for product teams. Before LoRA, fine-tuning a 7B parameter model required updating all 7 billion parameters, which demanded multiple A100 GPUs and days of compute.</p>
<p>LoRA works by freezing the original model weights and inserting small trainable matrices (called adapters) at each layer. These adapter matrices have a low rank, meaning they have far fewer parameters than the original weight matrices.</p>
<p>The practical impact:</p>
<ul>
  <li><strong>10,000x fewer trainable parameters</strong> &mdash; A 7B model has ~7 billion parameters. A LoRA adapter might add only 1-10 million trainable parameters.</li>
  <li><strong>90-95% of full fine-tuning quality</strong> &mdash; On most benchmarks, LoRA matches or comes within a few points of full fine-tuning.</li>
  <li><strong>Single GPU training</strong> &mdash; You can LoRA-tune a 7B model on a single A100 or even an RTX 4090. Training takes hours, not days.</li>
  <li><strong>Swappable adapters</strong> &mdash; You can train multiple LoRA adapters for different tasks and swap them at inference time without reloading the base model.</li>
</ul>`
      },
      {
        type: "concept",
        title: "QLoRA: Fine-Tuning on a Budget",
        expandable: true,
        content: `<p><strong>QLoRA (Quantized LoRA)</strong> combines LoRA with 4-bit quantization of the base model. The base model is loaded in 4-bit precision (instead of 16-bit), reducing memory by ~75%, while the LoRA adapters train in full precision.</p>
<p>What this means in practice:</p>
<ul>
  <li><strong>75% memory savings</strong> &mdash; A 7B model that normally needs ~14GB of VRAM in fp16 fits in ~4GB with 4-bit quantization.</li>
  <li><strong>Fine-tune 70B models on consumer GPUs</strong> &mdash; QLoRA made it possible to fine-tune Llama 2 70B on a single 48GB A6000. Without QLoRA, you need 4-8 A100s.</li>
  <li><strong>Minimal quality loss</strong> &mdash; The quantization adds a small quality penalty (1-3% on benchmarks) compared to standard LoRA, but the cost savings usually outweigh this.</li>
</ul>
<p>For PMs, the key takeaway is: QLoRA turns fine-tuning from a "we need a cluster" discussion into a "we need one GPU for a weekend" discussion. That changes the build-vs-buy calculus significantly.</p>`,
        diagram: {
          type: "comparison",
          data: {
            columns: [
              {
                title: "Full Fine-Tuning",
                items: [
                  "Updates all parameters",
                  "Needs multi-GPU cluster",
                  "Days of training time",
                  "Best quality (baseline)",
                  "High cost ($1K-$50K+)",
                  "Cannot swap task adapters"
                ],
                color: "#6B7280"
              },
              {
                title: "LoRA",
                items: [
                  "1-10M trainable params",
                  "Single high-end GPU",
                  "Hours of training",
                  "90-95% of full FT quality",
                  "Low cost ($10-$500)",
                  "Swappable adapters"
                ],
                color: "#0239A8"
              },
              {
                title: "QLoRA",
                items: [
                  "Same as LoRA + 4-bit base",
                  "Single consumer GPU",
                  "Hours of training",
                  "88-93% of full FT quality",
                  "Lowest cost ($5-$200)",
                  "Swappable adapters"
                ],
                color: "#8B5CF6"
              }
            ]
          }
        }
      },
      {
        type: "concept",
        title: "Small Language Models (SLMs): The Cost Play",
        expandable: true,
        content: `<p>SLMs are models in the 1B-8B parameter range: Llama 3.1 8B, Mistral 7B, Phi-3 Mini (3.8B), Gemma 2 2B, Qwen 2.5 7B. The 2025-2026 insight that every PM should internalize:</p>
<p><strong>A fine-tuned SLM can match frontier model performance on narrow, well-defined tasks.</strong></p>
<p>This is not hypothetical. Teams are doing this in production right now:</p>
<ul>
  <li>A fine-tuned Llama 3.1 8B matching GPT-4 on entity extraction at 1/50th the cost per token</li>
  <li>A fine-tuned Mistral 7B matching Claude Sonnet on classification tasks with 5x lower latency</li>
  <li>A fine-tuned Phi-3 running on-device for real-time autocomplete with zero API costs</li>
</ul>
<p>The PM decision framework for SLMs:</p>
<ul>
  <li><strong>Task scope</strong> &mdash; Is the task narrow and well-defined? SLMs excel. Is it open-ended and reasoning-heavy? Use a frontier model.</li>
  <li><strong>Data availability</strong> &mdash; Do you have 1,000+ high-quality examples for fine-tuning? If not, start with a frontier model and collect data for future distillation.</li>
  <li><strong>Deployment constraints</strong> &mdash; Need on-device inference? Edge deployment? Air-gapped environments? SLMs are your only option.</li>
  <li><strong>Cost sensitivity</strong> &mdash; If the feature processes millions of requests per day, the cost difference between $15/M tokens and $0.20/M tokens is the difference between profitable and not.</li>
</ul>`
      },
      {
        type: "concept",
        title: "In-Context Learning (ICL)",
        expandable: true,
        content: `<p>In-context learning means providing examples in the prompt at inference time so the model learns the pattern on the fly. No training required. This is the fastest way to adapt a model's behavior.</p>
<ul>
  <li><strong>Zero-shot</strong> &mdash; Just the instruction, no examples. Works for well-understood tasks.</li>
  <li><strong>Few-shot</strong> &mdash; 3-10 examples in the prompt showing input/output pairs. Dramatic quality improvement on formatting, classification, and extraction tasks.</li>
  <li><strong>Many-shot</strong> &mdash; 50-200+ examples. Now feasible with 128K-1M context windows. Quality approaches fine-tuning on some tasks but with higher per-request cost due to large prompts.</li>
</ul>
<p>ICL vs. fine-tuning trade-off: ICL is faster to iterate (change examples, no retraining) but costs more at scale (every request includes the examples). Fine-tuning has upfront cost but lower per-request cost. The crossover point depends on volume: below ~10K requests/day, ICL is usually cheaper. Above that, fine-tuning starts winning.</p>`
      },
      {
        type: "quiz",
        id: "fine-tune-or-rag",
        variant: "multiple-choice",
        question: "Your company's customer support bot needs to answer questions about products that change weekly with new releases, seasonal promotions, and updated pricing. Which approach is most appropriate?",
        options: [
          { id: "a", text: "Fine-tune the model on historical product data so it internalizes product knowledge" },
          { id: "b", text: "Use RAG to retrieve current product information at query time from a regularly updated knowledge base" },
          { id: "c", text: "Use many-shot ICL with 200 examples of product Q&A pairs in every prompt" },
          { id: "d", text: "Train a custom SLM from scratch on your product catalog" }
        ],
        correct: "b",
        explanation: "The key signal is 'change weekly.' Fine-tuning bakes knowledge into the model at training time, so it goes stale as soon as products change. RAG retrieves current information at query time, so the model always has access to the latest data. ICL with 200 examples would be expensive per-request and still would not capture weekly changes unless you update the examples constantly. Training from scratch is overkill and has the same staleness problem as fine-tuning."
      },
      {
        type: "exercise",
        id: "fine-tuning-business-case",
        title: "Fine-Tuning Business Case",
        prompt: "Build a business case for fine-tuning a small language model to replace a frontier model API on a specific task in your product. Include the task description, current costs, projected savings, quality requirements, data plan, and risks.",
        template: `## Fine-Tuning Business Case

### The Task
[What specific task are you replacing? Be narrow and concrete.]
[Current model: e.g., GPT-4o / Claude Sonnet 4]
[Current cost per request: $X.XX]
[Daily request volume: X,XXX]

### Proposed Approach
- Target SLM: [e.g., Llama 3.1 8B, Mistral 7B]
- Fine-tuning method: [LoRA / QLoRA]
- Training data: [source, size, labeling approach]

### Cost Analysis
- Current monthly cost: [volume x cost per request]
- Projected monthly cost: [self-hosted or managed inference cost]
- Fine-tuning upfront cost: [compute + data labeling]
- Break-even timeline: [months]

### Quality Requirements
- Minimum acceptable quality: [metric and threshold]
- How quality will be measured: [eval approach]
- Fallback plan if quality is insufficient: [e.g., route hard cases to frontier model]

### Risks
1. [Risk 1 and mitigation]
2. [Risk 2 and mitigation]`,
        hints: [
          "Pick the narrowest task possible. 'All customer inquiries' is too broad. 'Classifying support tickets into 12 categories' is the right scope.",
          "Self-hosted inference costs include GPU rental, ops overhead, and on-call burden — not just the GPU hours.",
          "A hybrid approach (SLM for easy cases, frontier model for hard cases) often has the best economics. Model routing is a powerful pattern.",
          "Quality degradation on edge cases is the #1 risk. Plan for ongoing eval, not just launch-day eval."
        ]
      },
      {
        type: "takeaway",
        points: [
          "Fine-tuning changes HOW the model behaves (style, format, reasoning). RAG changes WHAT it knows (retrieving current information). They solve different problems and can be combined.",
          "LoRA reduces trainable parameters by 10,000x and enables single-GPU fine-tuning with 90-95% of full fine-tuning quality.",
          "Fine-tuned SLMs (1B-8B) can match frontier model performance on narrow, well-defined tasks at 1/50th the cost — this is the key cost optimization lever for high-volume features.",
          "The fine-tune vs. ICL crossover point depends on volume: below ~10K requests/day, in-context learning is usually cheaper; above that, fine-tuning starts winning."
        ]
      }
    ],
    flashcards: [
      {
        front: "What is the core difference between fine-tuning and RAG?",
        back: "Fine-tuning changes HOW the model behaves (adjusts weights for style, format, reasoning patterns). RAG changes WHAT the model knows (retrieves relevant documents at inference time). Fine-tuning is for behavior; RAG is for knowledge."
      },
      {
        front: "What is LoRA and why does it matter for product teams?",
        back: "LoRA (Low-Rank Adaptation) freezes original model weights and inserts small trainable adapter matrices. It reduces trainable parameters by 10,000x, enables single-GPU training in hours instead of days, achieves 90-95% of full fine-tuning quality, and produces swappable adapters for different tasks."
      },
      {
        front: "How does QLoRA differ from LoRA?",
        back: "QLoRA loads the base model in 4-bit precision (vs. 16-bit), reducing memory by ~75%. The LoRA adapters still train in full precision. This lets you fine-tune 70B models on a single consumer GPU. Quality loss is 1-3% compared to standard LoRA."
      },
      {
        front: "When should a PM choose a fine-tuned SLM over a frontier model API?",
        back: "Choose SLMs when: the task is narrow and well-defined, you have 1,000+ quality training examples, the feature processes high volume (cost savings at scale), or you need on-device/edge deployment. Stick with frontier models for open-ended reasoning, multi-step planning, or when you lack training data."
      }
    ]
  },

  // ─────────────────────────────────────────────
  // TOPIC 4: Portfolio Presentation
  // ─────────────────────────────────────────────
  "portfolio-presentation": {
    id: "portfolio-presentation",
    moduleId: "portfolio-building",
    title: "Portfolio Presentation",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "Portfolio Structure: Quality Over Quantity",
        expandable: false,
        content: `<p>Your AI PM portfolio should contain 3-5 artifacts. Not 10, not 15. Hiring managers spend 5-10 minutes on a portfolio before an interview. Every piece needs to earn its place.</p>
<p><strong>What to include (pick 3-5):</strong></p>
<ul>
  <li><strong>One AI-first PRD</strong> &mdash; Shows you can spec an AI product with model selection, evals, guardrails, and cost modeling.</li>
  <li><strong>One case study</strong> &mdash; Shows you can ship and learn. Metrics and lessons learned are non-negotiable.</li>
  <li><strong>One KPI framework or dashboard design</strong> &mdash; Shows you know what to measure and can hold an AI system accountable.</li>
  <li><strong>One decision doc or trade-off analysis</strong> &mdash; Shows you can navigate ambiguity and make reasoned calls under uncertainty.</li>
  <li><strong>One technical deep-dive</strong> &mdash; Could be a fine-tuning business case, an evaluation methodology, or an agent architecture doc. Shows you can go deep.</li>
</ul>
<p><strong>Range matters.</strong> If all five artifacts are PRDs, you look one-dimensional. Mix the formats to show you can operate across the PM spectrum: strategy (PRD, roadmap), execution (case study, metrics), and technical depth (architecture, eval).</p>`
      },
      {
        type: "callout",
        variant: "tip",
        title: "The 30-Second Test",
        content: `<p>Open each portfolio piece and read only the first paragraph and the headings. In 30 seconds, can someone understand what the artifact is about, what decisions you made, and what the outcome was? If not, restructure. Hiring managers skim. Your artifact needs to work for skimmers and deep readers both.</p>`
      },
      {
        type: "concept",
        title: "Presentation Principles",
        expandable: true,
        content: `<p>Four principles for presenting AI PM work, whether in a portfolio doc, an interview, or a stakeholder review:</p>
<ul>
  <li><strong>Lead with business outcome, not technology.</strong> Wrong: "We implemented a RAG pipeline with hybrid search and reranking." Right: "We reduced support ticket resolution time by 40% using an AI assistant that pulls answers from our knowledge base." The technology is the how. The outcome is the what. Start with the what.</li>
  <li><strong>Show AI-specific decisions.</strong> Generic PM skills (prioritization, stakeholder management, roadmapping) are table stakes. What makes you an AI PM is the ability to make decisions that only arise in AI products: model selection trade-offs, eval methodology design, guardrail thresholds, cost-quality-latency optimization. Highlight these explicitly.</li>
  <li><strong>Demonstrate evaluation rigor.</strong> Anyone can say "we built an AI feature." Fewer can say "we built a 200-example golden test set, measured accuracy at 92%, set a regression threshold at 88%, and caught three quality regressions before they reached production." The eval story is your credibility story.</li>
  <li><strong>Quantify ruthlessly.</strong> Every claim should have a number. Not "we improved accuracy" but "accuracy improved from 74% to 91% on our held-out test set of 500 examples." Not "we reduced costs" but "cost per query dropped from $0.08 to $0.02 by distilling to Llama 8B."</li>
</ul>`
      },
      {
        type: "concept",
        title: "What Hiring Managers Look For",
        expandable: true,
        content: `<p>Based on conversations with AI PM hiring managers at companies ranging from startups to FAANG, here is what separates the top candidates:</p>
<ul>
  <li><strong>Cross-functional collaboration signals.</strong> Did you work with ML engineers, data scientists, and designers? Can you describe disagreements and how they were resolved? PMs who only talk about their own decisions raise red flags.</li>
  <li><strong>Data-driven decision making.</strong> Not just "we looked at the data" but "the data showed X, which led us to change our approach from A to B, which resulted in Z." The chain from observation to action to outcome is what matters.</li>
  <li><strong>Responsible AI awareness.</strong> Can you identify bias, fairness, and safety risks in your own work? Did you build guardrails proactively, or only after something went wrong? Bonus: can you articulate the tension between safety and capability, and how you navigated it?</li>
  <li><strong>Intellectual humility.</strong> The "Lessons Learned" section of your case study matters more than you think. Saying "we underestimated the importance of eval infrastructure and paid for it with two quality regressions" shows more maturity than claiming everything went perfectly.</li>
  <li><strong>Systems thinking.</strong> Can you explain how your AI feature interacts with the broader product ecosystem? How does it affect adjacent features, data pipelines, support workflows, and business metrics beyond the ones you directly own?</li>
</ul>`
      },
      {
        type: "concept",
        title: "Common Mistakes to Avoid",
        expandable: true,
        content: `<p>These are the patterns that weaken AI PM portfolios. If you find yourself doing any of these, fix them before sharing your portfolio.</p>
<ul>
  <li><strong>Too much tech, not enough business.</strong> A page of architecture diagrams with no mention of user impact or business outcomes. Engineers write architecture docs. PMs write business cases that include the right amount of technical context. Know the difference.</li>
  <li><strong>No metrics.</strong> "We launched an AI chatbot and users liked it." This tells the reviewer nothing. What was the baseline? What improved? By how much? If you do not have real metrics, use reasonable estimates and label them as such.</li>
  <li><strong>No lessons learned.</strong> A case study without a "what I would do differently" section reads as either dishonest or unreflective. Every project has things that could have gone better. Naming them shows maturity.</li>
  <li><strong>Buzzword soup.</strong> "We leveraged cutting-edge transformer architectures to deliver paradigm-shifting AI-driven experiences." This communicates nothing. Use plain language. Say what you built, why, and what happened.</li>
  <li><strong>Hypothetical-only portfolio.</strong> If every piece is "I would do X," it is hard to demonstrate execution ability. If you lack production experience, build something real even if small&mdash;a weekend project with a deployed prototype, a fine-tuning experiment with measured results, an eval pipeline you actually ran.</li>
  <li><strong>Ignoring responsible AI.</strong> If your portfolio mentions no guardrails, no bias considerations, and no safety measures, it signals a blind spot. Every AI artifact should address how you handled the risk of incorrect, biased, or harmful outputs.</li>
</ul>`
      },
      {
        type: "quiz",
        id: "portfolio-evaluation",
        variant: "multiple-choice",
        question: "Which portfolio description would be most compelling to an AI PM hiring manager?",
        options: [
          { id: "a", text: "Built a RAG pipeline using LangChain, Pinecone, and GPT-4 with hybrid search and reranking for a customer support application" },
          { id: "b", text: "Led the launch of an AI support assistant that deflected 45% of tier-1 tickets, reducing average resolution time from 12 hours to 2 hours, while maintaining a <2% hallucination rate through a 300-example eval suite" },
          { id: "c", text: "Designed an innovative AI-powered solution leveraging cutting-edge LLM technology to transform the customer support experience" },
          { id: "d", text: "Managed a cross-functional team of 8 engineers to build an AI chatbot on time and under budget" }
        ],
        correct: "b",
        explanation: "Option B leads with business outcomes (45% ticket deflection, 12h to 2h resolution), shows AI-specific rigor (hallucination rate tracking, eval suite size), and quantifies results. Option A is too technical with no business context. Option C is pure buzzwords with no substance. Option D focuses on project management without any AI-specific decisions or outcomes."
      },
      {
        type: "exercise",
        id: "portfolio-outline",
        title: "Portfolio Outline",
        prompt: "Draft an outline for your AI PM portfolio. Select 3-5 artifacts, give each a title and a one-paragraph summary that passes the 30-second test: business outcome, AI-specific decisions, and metrics (real or estimated).",
        template: `## My AI PM Portfolio

### Artifact 1: [Type — e.g., AI-First PRD]
**Title:** [Descriptive title]
**Summary:** [One paragraph: What was the business problem? What AI approach did you take? What decisions did you make? What were the outcomes? Include at least one metric.]

### Artifact 2: [Type — e.g., Case Study]
**Title:** [Descriptive title]
**Summary:** [One paragraph following the same structure]

### Artifact 3: [Type — e.g., KPI Framework]
**Title:** [Descriptive title]
**Summary:** [One paragraph following the same structure]

### Artifact 4 (optional): [Type — e.g., Decision Doc]
**Title:** [Descriptive title]
**Summary:** [One paragraph following the same structure]

### Artifact 5 (optional): [Type — e.g., Technical Deep-Dive]
**Title:** [Descriptive title]
**Summary:** [One paragraph following the same structure]

### Portfolio Narrative
[2-3 sentences: What story do these artifacts tell together? What range of skills do they demonstrate?]`,
        hints: [
          "Variety of artifact types matters more than volume. A PRD, a case study, and a KPI framework show more range than three PRDs.",
          "Each summary should pass the 30-second test: a skimmer should understand the business problem, your AI-specific contribution, and the outcome.",
          "If you lack real production metrics, use estimates and label them as projections. This is honest and still demonstrates analytical thinking.",
          "The portfolio narrative at the end ties everything together — it should explain why these specific pieces were chosen and what they collectively say about you as a PM."
        ]
      },
      {
        type: "callout",
        variant: "example",
        title: "Strong vs. Weak Portfolio Narrative",
        content: `<p><strong>Weak:</strong> "This portfolio shows my experience with AI products and my skills in product management."</p>
<p><strong>Strong:</strong> "These five artifacts trace the lifecycle of an AI feature from opportunity identification through production monitoring. The PRD shows how I scoped an ambiguous problem into a shippable AI solution. The case study demonstrates execution under constraints, including a pivot from fine-tuning to RAG when data quality proved insufficient. The KPI framework shows how I held the system accountable post-launch, catching a quality regression at week 3 that would have eroded user trust."</p>`
      },
      {
        type: "takeaway",
        points: [
          "A strong AI PM portfolio has 3-5 artifacts showing range across strategy, execution, and technical depth — not 10 similar PRDs.",
          "Lead every portfolio piece with business outcomes, then show AI-specific decisions (model selection, eval design, guardrails, cost trade-offs).",
          "Hiring managers look for cross-functional collaboration, data-driven decisions, responsible AI awareness, and intellectual humility.",
          "The most common mistakes are too much tech without business context, no metrics, no lessons learned, and ignoring responsible AI considerations."
        ]
      }
    ],
    flashcards: [
      {
        front: "What is the ideal number of artifacts in an AI PM portfolio, and what types should they include?",
        back: "3-5 artifacts showing range: an AI-first PRD (strategy), a case study (execution with metrics), a KPI framework (measurement), and optionally a decision doc (trade-off reasoning) and/or a technical deep-dive (depth). Variety of types matters more than volume."
      },
      {
        front: "What is the '30-second test' for portfolio artifacts?",
        back: "Open the artifact and read only the first paragraph and the headings. In 30 seconds, a reader should understand what the artifact is about, what decisions you made, and what the outcome was. If they cannot, the artifact needs restructuring."
      },
      {
        front: "What four things do AI PM hiring managers look for that differ from general PM hiring?",
        back: "1) AI-specific decisions (model selection, eval design, guardrails), 2) Evaluation rigor (golden test sets, regression thresholds, quality metrics), 3) Responsible AI awareness (bias, safety, guardrails built proactively), 4) Honest lessons learned showing intellectual humility."
      },
      {
        front: "What are the top three mistakes that weaken an AI PM portfolio?",
        back: "1) Too much technical detail without business context or outcomes, 2) No metrics — claims like 'users liked it' with no quantification, 3) No lessons learned — omitting what went wrong or what you would do differently signals lack of self-awareness."
      }
    ]
  }

};
