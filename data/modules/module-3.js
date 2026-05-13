export default {

  // ─────────────────────────────────────────────────────────────
  // TOPIC 1: AI Evaluation & LLM-as-Judge
  // ─────────────────────────────────────────────────────────────
  "ai-evaluation": {
    id: "ai-evaluation",
    moduleId: "evaluation-deployment",
    title: "AI Evaluation & LLM-as-Judge",
    estimatedMinutes: 30,
    sections: [
      {
        type: "concept",
        title: "Why AI Evaluation Is Different",
        expandable: false,
        content: `<p>Traditional software testing asks a binary question: did the function return the expected output? AI evaluation doesn't have that luxury. When you ask an LLM to summarize an article, there's no single correct answer. Two perfectly good summaries can look completely different.</p>
<p>This creates three problems PMs need to internalize:</p>
<ul>
  <li><strong>Non-determinism:</strong> The same prompt can produce different outputs across runs. Temperature, sampling, and model updates all introduce variance. You can't just snapshot a golden output and diff against it.</li>
  <li><strong>Subjective quality:</strong> "Good" is contextual. A customer support response might be factually correct but have the wrong tone. A code generation might work but be unidiomatic. You need rubrics, not assertions.</li>
  <li><strong>Regression is silent:</strong> A model update or prompt change can degrade quality in ways that don't throw errors. Your system keeps running, but users start complaining. Without structured evals, you're flying blind.</li>
</ul>
<p>The bottom line: you need a fundamentally different evaluation mindset. Think of it less like QA testing and more like grading essays &mdash; you need clear criteria, multiple evaluators, and statistical thinking.</p>`
      },

      {
        type: "concept",
        title: "The Evaluation Pyramid",
        expandable: true,
        content: `<p>Structure your evals in three layers, from fast and cheap at the bottom to slow and comprehensive at the top:</p>
<ul>
  <li><strong>Unit Evals (base layer):</strong> Test individual components in isolation. Does your retrieval step return relevant documents? Does your prompt produce outputs in the right format? These run in seconds, cost pennies, and belong in CI. Think of them as smoke tests for AI &mdash; they catch obvious regressions fast.</li>
  <li><strong>Integration Evals (middle layer):</strong> Test components working together. Does retrieval + generation produce a coherent answer? Does the agent correctly chain tool calls? These take longer and cost more, but they catch interaction failures that unit evals miss. Run them nightly or on PRs.</li>
  <li><strong>System Evals (top layer):</strong> End-to-end evaluation of the full user experience. Does the chatbot actually solve the customer's problem? These often involve human evaluators or sophisticated LLM-as-judge setups. Run them weekly or before releases.</li>
</ul>
<p>A common mistake is skipping straight to system evals. That's like testing a car by only driving it &mdash; you'll catch some problems, but you'll have no idea which component is failing. Start from the bottom and build up.</p>`,
        diagram: {
          type: "stack",
          data: {
            layers: [
              { label: "Unit Evals", items: ["Format checks", "Retrieval relevance", "Prompt output validation", "Latency bounds"], color: "#1CE6D2" },
              { label: "Integration Evals", items: ["RAG pipeline accuracy", "Tool-call sequencing", "Multi-step reasoning"], color: "#F42A72" },
              { label: "System Evals", items: ["End-to-end task success", "User satisfaction proxy", "LLM-as-judge scoring"], color: "#0239A8" }
            ]
          }
        }
      },

      {
        type: "callout",
        variant: "key-insight",
        title: "The 80/20 of Evals",
        content: `<p>Most teams get 80% of their eval value from 20 well-chosen unit evals that run in CI. Don't let the perfect eval suite be the enemy of shipping <em>any</em> evals. Start with format validation and a handful of golden-answer comparisons, then layer on sophistication.</p>`
      },

      {
        type: "concept",
        title: "LLM-as-Judge: Using AI to Evaluate AI",
        expandable: true,
        content: `<p>When human evaluation is too slow or expensive, you can use a strong LLM to grade the outputs of your system. This is the LLM-as-judge pattern, and it's become the default approach for scaling AI evaluation.</p>
<p><strong>How it works:</strong></p>
<ul>
  <li>Define a rubric with specific criteria (relevance, accuracy, tone, completeness)</li>
  <li>Break each criterion into yes/no or 1-5 scale questions &mdash; avoid vague "rate the quality" prompts</li>
  <li>Provide the judge LLM with the input, output, and (optionally) a reference answer</li>
  <li>Collect scores, aggregate, and track over time</li>
</ul>
<p><strong>Practical rubric design:</strong> Instead of asking "Rate this response from 1-10," break it down. "Does the response directly answer the user's question? (yes/no)" "Does the response contain any factual claims not supported by the provided context? (yes/no)" "Is the tone appropriate for a customer support interaction? (yes/no)." Binary questions produce more reliable scores than Likert scales.</p>
<p><strong>When to use a reference answer:</strong> If you have a gold-standard answer, provide it. The judge can compare rather than evaluate in a vacuum, which dramatically improves reliability. But don't block on creating reference answers for everything &mdash; reference-free judging still beats no evaluation.</p>`
      },

      {
        type: "concept",
        title: "Four Biases That Undermine LLM Judges",
        expandable: true,
        content: `<p>LLM judges are useful but not neutral. As a PM, you need to know these biases so you can design around them:</p>
<ul>
  <li><strong>Position bias:</strong> When comparing two responses, LLMs tend to prefer whichever appears first (or sometimes last, depending on the model). Fix: randomize the order across eval runs and average the results. If response A wins when shown first but loses when shown second, the comparison is unreliable.</li>
  <li><strong>Verbosity bias:</strong> Longer responses get higher scores, even when the extra length adds no value. A 500-word answer that rambles will often outscore a crisp 100-word answer that nails the point. Fix: explicitly instruct the judge that conciseness is a virtue, or add a separate "conciseness" criterion.</li>
  <li><strong>Self-preference bias:</strong> Models tend to rate outputs from their own model family higher. GPT-4 rates GPT-4 outputs more favorably; Claude rates Claude outputs more favorably. Fix: use a different model family as your judge than the one generating your outputs. Or use multiple judges and look for consensus.</li>
  <li><strong>Authority bias:</strong> If you mention that a response came from an expert or a specific model, the judge will rate it higher regardless of actual quality. Fix: strip all metadata and attribution before sending outputs to the judge. The judge should see only the content.</li>
</ul>`
      },

      {
        type: "callout",
        variant: "warning",
        title: "Don't Trust a Single Judge",
        content: `<p>A single LLM judge is like a single code reviewer &mdash; better than nothing, but not sufficient for high-stakes decisions. For production eval suites, use a panel: two LLM judges from different model families plus periodic human spot-checks. When judges disagree, that's signal &mdash; flag those examples for human review.</p>`
      },

      {
        type: "quiz",
        id: "eval-bias-quiz",
        variant: "multiple-choice",
        question: "Your LLM-as-judge consistently rates Response A higher than Response B. When you swap the order and present Response B first, it now rates B higher. Which bias is this?",
        options: [
          { id: "a", text: "Verbosity bias — one response is longer than the other" },
          { id: "b", text: "Position bias — the judge prefers whichever response appears first" },
          { id: "c", text: "Self-preference bias — the judge prefers outputs from its own model family" },
          { id: "d", text: "Authority bias — the judge was told one response came from an expert" }
        ],
        correct: "b",
        explanation: "This is classic position bias. The judge isn't evaluating content quality — it's favoring whichever response it sees first. The fix is to randomize presentation order across runs and average the results. If A only wins when shown first, you can't trust that A is actually better."
      },

      {
        type: "concept",
        title: "Evaluation Tooling Landscape",
        expandable: true,
        content: `<p>The eval tooling space has matured rapidly. Here are the tools that matter for PMs in 2026:</p>
<ul>
  <li><strong>DeepEval:</strong> Open-source framework with 50+ pre-built metrics (faithfulness, relevance, hallucination, toxicity, bias, and more). Integrates directly into CI/CD pipelines with pytest-style syntax. Strong choice if your team already uses Python testing frameworks. The breadth of built-in metrics means you can get a comprehensive eval suite running fast.</li>
  <li><strong>RAGAS:</strong> Purpose-built for evaluating RAG systems. Measures context relevance (did you retrieve the right documents?), faithfulness (is the answer grounded in the context?), and answer relevance (did you actually answer the question?). If your product is RAG-based, RAGAS gives you the specific metrics that matter. Don't try to use generic eval tools for RAG-specific problems.</li>
  <li><strong>Braintrust:</strong> Combines eval capabilities with production tracing. You can run offline evals against datasets AND monitor live production quality in the same platform. The scoring and dataset management are particularly well-designed. Good fit for teams that want one tool instead of stitching together eval + observability.</li>
  <li><strong>Langfuse:</strong> Open-source LLM observability platform that includes eval capabilities. Strong on tracing (seeing exactly what happened in a multi-step chain) and cost tracking. The open-source model means you can self-host if data residency matters. Growing eval features but primarily an observability tool.</li>
</ul>`
      },

      {
        type: "quiz",
        id: "eval-tools-match",
        variant: "drag-match",
        question: "Match each evaluation tool to its primary strength:",
        pairs: [
          { left: "DeepEval", right: "50+ pre-built metrics with CI/CD integration" },
          { left: "RAGAS", right: "RAG-specific metrics (context relevance, faithfulness)" },
          { left: "Braintrust", right: "Combined eval + production tracing in one platform" },
          { left: "Langfuse", right: "Open-source observability with cost tracking" }
        ],
        explanation: "Each tool has a distinct sweet spot. DeepEval excels at breadth of metrics and CI integration. RAGAS is the specialist for RAG pipelines. Braintrust uniquely combines offline evals with production monitoring. Langfuse is the go-to open-source option with strong tracing. Many teams use two or three of these together."
      },

      {
        type: "exercise",
        id: "eval-framework-exercise",
        title: "Design an Eval Framework",
        prompt: "You're the PM for a customer support chatbot that uses RAG to answer questions from your company's knowledge base. Design an evaluation framework covering all three layers of the evaluation pyramid. For each layer, specify: what you're testing, which metrics you'll use, which tools you'd choose, and how often you'd run them.",
        template: `## Eval Framework: Customer Support Chatbot

### Unit Evals (CI — every commit)
- What we're testing:
- Metrics:
- Tools:
- Pass/fail criteria:

### Integration Evals (nightly)
- What we're testing:
- Metrics:
- Tools:
- Alerting threshold:

### System Evals (weekly / pre-release)
- What we're testing:
- Metrics:
- Judge setup:
- Human review cadence:

### Eval Dataset Strategy
- How we source test cases:
- How often we refresh:
- Edge cases we specifically cover:`,
        hints: [
          "For unit evals, think about retrieval quality separately from generation quality. Can you test whether the right documents were retrieved before worrying about the answer?",
          "RAGAS is purpose-built for RAG evals — consider using its context_relevancy and faithfulness metrics at the integration layer.",
          "For system evals, consider using real anonymized customer conversations as test cases. The best eval dataset is one that reflects actual usage patterns.",
          "Don't forget to eval for things that aren't correctness: response latency, cost per query, and whether the bot correctly escalates to a human when it should."
        ]
      },

      {
        type: "takeaway",
        points: [
          "AI evaluation requires rubrics and statistical thinking, not binary pass/fail assertions. Start with unit evals in CI and build up to system evals.",
          "LLM-as-judge scales evaluation but introduces biases (position, verbosity, self-preference, authority). Mitigate with order randomization, multi-judge panels, and periodic human calibration.",
          "Match your eval tools to your architecture: RAGAS for RAG systems, DeepEval for broad metric coverage, Braintrust for combined eval + monitoring, Langfuse for open-source observability.",
          "The most common eval mistake is not having any evals at all. Twenty well-chosen unit evals in CI will catch more regressions than a quarterly manual review."
        ]
      }
    ],

    flashcards: [
      { front: "What are the three layers of the AI evaluation pyramid?", back: "Unit evals (individual components, run in CI), integration evals (components working together, run nightly), and system evals (end-to-end user experience, run weekly or pre-release)." },
      { front: "Name the four biases that affect LLM-as-judge evaluations.", back: "Position bias (prefers first/last response), verbosity bias (prefers longer answers), self-preference bias (prefers own model family's outputs), and authority bias (prefers responses attributed to experts)." },
      { front: "What is the key design principle for LLM-as-judge rubrics?", back: "Break criteria into binary yes/no questions rather than vague Likert scales. 'Does the response answer the user's question? (yes/no)' produces more reliable scores than 'Rate quality from 1-10.'" },
      { front: "When should you use RAGAS vs. DeepEval for evaluation?", back: "RAGAS is purpose-built for RAG systems (context relevance, faithfulness, answer relevance). DeepEval is broader with 50+ metrics and CI/CD integration. Use RAGAS when evaluating retrieval pipelines; use DeepEval for general LLM output evaluation." }
    ]
  },

  // ─────────────────────────────────────────────────────────────
  // TOPIC 2: Responsible AI & Guardrails
  // ─────────────────────────────────────────────────────────────
  "responsible-ai": {
    id: "responsible-ai",
    moduleId: "evaluation-deployment",
    title: "Responsible AI & Guardrails",
    estimatedMinutes: 30,
    sections: [
      {
        type: "concept",
        title: "Responsible AI Principles",
        expandable: false,
        content: `<p>Responsible AI isn't a compliance checkbox &mdash; it's a design constraint that shapes every product decision. These five principles form the foundation:</p>
<ul>
  <li><strong>Fairness:</strong> Your AI system should perform comparably across demographic groups. This means testing for disparate impact, not just average accuracy. A resume screening tool that works great overall but systematically disadvantages certain groups is not fair, even if the aggregate metrics look fine.</li>
  <li><strong>Transparency:</strong> Users should understand when they're interacting with AI, what data is being used, and how decisions are made. This doesn't mean exposing model weights &mdash; it means clear disclosure ("This response was generated by AI"), explainable outputs when possible, and honest communication about limitations.</li>
  <li><strong>Accountability:</strong> Someone owns the outcomes. When your AI system makes a mistake, there's a clear escalation path, a way to appeal the decision, and a human who is responsible for the system's behavior. "The AI did it" is never an acceptable answer to a customer.</li>
  <li><strong>Safety:</strong> The system should not produce harmful outputs &mdash; misinformation, dangerous instructions, hate speech, or content that could cause real-world harm. This requires both proactive guardrails and reactive monitoring.</li>
  <li><strong>Privacy:</strong> User data used for AI should follow data minimization principles. Collect only what's needed, retain only as long as necessary, and never use conversation data for model training without explicit consent. PII handling in AI systems needs special attention because LLMs can memorize and regurgitate training data.</li>
</ul>`
      },

      {
        type: "callout",
        variant: "key-insight",
        title: "Responsible AI Is a PM Skill",
        content: `<p>Engineers build the guardrails, but PMs define the requirements. You need to specify what "safe" means for your product. A children's education app and an adult creative writing tool have radically different safety requirements. Your job is to articulate those boundaries clearly enough that engineering can implement them.</p>`
      },

      {
        type: "concept",
        title: "AI Risks Every PM Must Know",
        expandable: true,
        content: `<p>These are the risks that will wake you up at night if you ship AI without guardrails:</p>
<ul>
  <li><strong>Hallucination:</strong> The model confidently states things that are factually wrong. In a customer support bot, this means giving incorrect refund policies. In a medical context, it could be dangerous. Hallucination rates vary by domain and are higher for specific factual claims than for general knowledge.</li>
  <li><strong>Bias amplification:</strong> LLMs trained on internet data inherit societal biases &mdash; and can amplify them. A hiring tool might associate certain names with lower quality. A content moderation system might flag African-American Vernacular English as toxic more often. These biases are subtle and require targeted testing to detect.</li>
  <li><strong>Data leakage:</strong> Users might input proprietary information into an AI system that sends data to a third-party API. Or your RAG system might retrieve and surface documents a user shouldn't have access to. Data leakage can be an IP problem, a compliance problem, or both.</li>
  <li><strong>Adversarial attacks:</strong> Prompt injection (getting the model to ignore its system instructions), jailbreaking (bypassing safety training), and data poisoning (corrupting the knowledge base). These aren't theoretical &mdash; they happen in production every day.</li>
  <li><strong>Regulatory non-compliance:</strong> The EU AI Act, NIST AI RMF, and ISO/IEC 42001 all impose requirements on AI systems. Shipping without awareness of these frameworks can result in fines, forced shutdowns, or legal liability.</li>
</ul>`
      },

      {
        type: "concept",
        title: "Guardrail Architecture",
        expandable: true,
        content: `<p>Guardrails are runtime checks that validate inputs before they reach the model and outputs before they reach the user. Think of them as middleware for AI:</p>
<ul>
  <li><strong>Input rails:</strong> Check user inputs for prompt injection attempts, PII that shouldn't be sent to the model, off-topic queries, and content that violates your acceptable use policy. These fire before the LLM processes anything.</li>
  <li><strong>Output rails:</strong> Check model outputs for hallucinations (compare against source documents), harmful content, PII leakage, format compliance, and factual accuracy. These fire after the LLM responds but before the user sees the result.</li>
  <li><strong>Retrieval rails:</strong> In RAG systems, validate that retrieved documents are relevant, that the user has permission to access them, and that they're not stale or deprecated.</li>
  <li><strong>Dialog rails:</strong> Manage the conversation flow &mdash; prevent topic derailing, enforce conversation boundaries, and handle edge cases like the user trying to get the bot to roleplay as a different persona.</li>
</ul>
<p>The key insight is that guardrails are <strong>layered</strong>. No single rail catches everything. You need input AND output validation, just like you need both client-side and server-side validation in web apps.</p>`,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "n1", label: "User Input", type: "start" },
              { id: "n2", label: "Input Rails", type: "process" },
              { id: "n3", label: "Safe?", type: "decision" },
              { id: "n4", label: "LLM / Agent", type: "process" },
              { id: "n5", label: "Output Rails", type: "process" },
              { id: "n6", label: "Clean?", type: "decision" },
              { id: "n7", label: "User Response", type: "end" }
            ],
            edges: [["n1","n2"],["n2","n3"],["n3","n4"],["n4","n5"],["n5","n6"],["n6","n7"]]
          }
        }
      },

      {
        type: "concept",
        title: "Guardrail Tooling",
        expandable: true,
        content: `<p>Three tools dominate the guardrail space in 2026:</p>
<ul>
  <li><strong>NVIDIA NeMo Guardrails:</strong> The most comprehensive open-source guardrail framework. Uses Colang, a purpose-built language for defining conversational rules. Supports five rail types: input, output, dialog, retrieval, and execution rails. The Colang approach means you can express complex guardrail logic without writing Python &mdash; PMs can actually read and contribute to the rules. Best for: production systems that need flexible, multi-layered guardrails.</li>
  <li><strong>Guardrails AI:</strong> Focuses on structured output validation using "validators." You define a schema for what valid output looks like, and Guardrails AI ensures the model conforms. Particularly strong at enforcing output formats (JSON schema compliance, field-level validation, type checking). Think of it as Pydantic for LLM outputs. Best for: systems where output format matters as much as content quality.</li>
  <li><strong>Constitutional AI (Anthropic):</strong> A training-time approach rather than runtime guardrails. The model is trained with a "constitution" &mdash; a set of principles it should follow. It learns to self-critique and revise outputs that violate those principles. This is why Claude-family models tend to be more cautious out of the box. Best for: baseline safety behavior. Complement it with runtime guardrails for production systems.</li>
</ul>`
      },

      {
        type: "concept",
        title: "Enterprise Guardrail Patterns",
        expandable: true,
        content: `<p>Beyond individual tools, these architectural patterns show up repeatedly in enterprise AI deployments:</p>
<ul>
  <li><strong>Dual-stage validation:</strong> Run a fast, cheap check first (keyword blocklist, regex for PII, format validation). Only if the input passes the fast check, run the expensive LLM-based content analysis. This keeps latency low for 95% of requests while still catching sophisticated attacks.</li>
  <li><strong>Decision boundaries:</strong> Define clear lines between what the AI can decide autonomously, what requires human review, and what is completely off-limits. For a financial services chatbot: answering FAQs is autonomous, providing personalized advice requires human review, executing trades is off-limits. Document these boundaries in your PRD.</li>
  <li><strong>Human-in-the-loop (HITL):</strong> Route low-confidence outputs to human reviewers. The key metric is your HITL rate &mdash; too high means the AI isn't useful (you're just building an expensive queue), too low means risky outputs are slipping through. Most teams target a 5-15% HITL rate for customer-facing applications.</li>
</ul>`
      },

      {
        type: "callout",
        variant: "warning",
        title: "Guardrails Add Latency",
        content: `<p>Every guardrail check adds latency to your response. An input rail + output rail can add 200-500ms each if they use LLM-based checks. For real-time applications, budget for this in your latency requirements and use the dual-stage pattern (fast check first, LLM check only when needed).</p>`
      },

      {
        type: "concept",
        title: "Regulatory Landscape: What PMs Need to Know",
        expandable: true,
        content: `<p>The regulatory environment for AI is tightening fast. Here's what matters:</p>
<ul>
  <li><strong>EU AI Act:</strong> The world's first comprehensive AI law. Uses a risk-based approach with four tiers: unacceptable risk (banned &mdash; social scoring, real-time biometric surveillance), high risk (strict requirements &mdash; hiring tools, credit scoring, medical devices), limited risk (transparency obligations &mdash; chatbots, deepfake generation), and minimal risk (no requirements &mdash; spam filters, video games). High-risk system obligations take full effect in August 2026, including mandatory conformity assessments, human oversight requirements, and detailed technical documentation.</li>
  <li><strong>NIST AI Risk Management Framework (AI RMF):</strong> A voluntary US framework that provides a structured approach to identifying and managing AI risks. Organized around four functions: Govern (establish policies), Map (understand context and risks), Measure (assess risks), and Manage (mitigate risks). Not legally binding, but increasingly expected by US enterprise customers and used as a reference in procurement decisions.</li>
  <li><strong>ISO/IEC 42001:</strong> The international standard for AI management systems. Think of it as ISO 27001 but for AI. Provides a certifiable framework for establishing, implementing, and improving AI governance. Certification is becoming a market differentiator for B2B AI products, similar to SOC 2 compliance.</li>
</ul>
<p>As a PM, you don't need to be a regulatory lawyer, but you need to know which tier your product falls into under the EU AI Act, and whether your enterprise customers will require NIST AI RMF alignment or ISO 42001 certification.</p>`
      },

      {
        type: "quiz",
        id: "eu-ai-act-quiz",
        variant: "multiple-choice",
        question: "Under the EU AI Act, which of the following would be classified as a 'high-risk' AI system?",
        options: [
          { id: "a", text: "A spam filter for email" },
          { id: "b", text: "An AI-powered resume screening tool used in hiring" },
          { id: "c", text: "A chatbot that helps users find recipes" },
          { id: "d", text: "An AI feature that recommends songs on a music app" }
        ],
        correct: "b",
        explanation: "AI systems used in employment and hiring decisions (including resume screening, candidate ranking, and interview analysis) are classified as high-risk under the EU AI Act. High-risk systems must undergo conformity assessments, maintain human oversight, provide detailed documentation, and meet transparency requirements. The other options are minimal or limited risk."
      },

      {
        type: "exercise",
        id: "guardrail-design-exercise",
        title: "Guardrail Design",
        prompt: "You're building an internal AI assistant for a financial services company. Employees will use it to look up policies, draft client communications, and summarize meeting notes. Design the guardrail architecture, specifying input rails, output rails, decision boundaries, and your HITL strategy.",
        template: `## Guardrail Architecture: Financial Services AI Assistant

### Input Rails
- PII detection:
- Prompt injection defense:
- Topic boundary enforcement:
- Data classification check:

### Output Rails
- Hallucination prevention:
- Compliance language check:
- PII/confidential data leakage:
- Tone and brand voice:

### Decision Boundaries
- Autonomous (no human review):
- Human review required:
- Off-limits (AI will not attempt):

### HITL Strategy
- Target HITL rate:
- Routing criteria:
- Reviewer SLA:
- Feedback loop to improve guardrails:

### Regulatory Considerations
- EU AI Act classification:
- NIST AI RMF alignment:
- Data residency requirements:`,
        hints: [
          "Financial services have strict compliance requirements. Think about what happens if the AI drafts a client communication that contains a performance guarantee — that could violate securities regulations.",
          "For the HITL strategy, consider that not all human reviewers are equal. A policy lookup review might need a compliance officer, while a tone review might need a communications specialist.",
          "Decision boundaries should be granular. 'Draft a client email' is too broad — break it down into drafting vs. sending, routine communications vs. those involving financial advice.",
          "Consider data residency: if you're using a cloud LLM API, where is the data being processed? Some financial regulators require data to stay within specific jurisdictions."
        ]
      },

      {
        type: "takeaway",
        points: [
          "Responsible AI is a design constraint, not a post-launch checklist. Fairness, transparency, accountability, safety, and privacy should shape your PRD from day one.",
          "Guardrails are layered runtime checks on inputs and outputs. Use the dual-stage pattern (fast check first, LLM check only when needed) to balance safety and latency.",
          "Know your regulatory exposure: the EU AI Act high-risk requirements take effect August 2026, and enterprise customers increasingly expect NIST AI RMF alignment or ISO 42001 certification.",
          "Human-in-the-loop is not a sign of failure — it's a design choice. Target a 5-15% HITL rate for customer-facing apps and explicitly document your decision boundaries."
        ]
      }
    ],

    flashcards: [
      { front: "What are the five core responsible AI principles?", back: "Fairness (comparable performance across groups), Transparency (clear disclosure of AI use and limitations), Accountability (clear ownership of outcomes), Safety (no harmful outputs), and Privacy (data minimization, no PII leakage)." },
      { front: "What are the four risk tiers in the EU AI Act?", back: "Unacceptable risk (banned: social scoring, real-time biometric surveillance), High risk (strict requirements: hiring, credit, medical), Limited risk (transparency obligations: chatbots, deepfakes), and Minimal risk (no requirements: spam filters, games)." },
      { front: "What is the dual-stage validation pattern for guardrails?", back: "Run a fast, cheap check first (keyword blocklist, regex PII detection, format validation). Only if the input passes the fast check, run the expensive LLM-based content analysis. This keeps latency low for 95% of requests." },
      { front: "What are the five rail types in NVIDIA NeMo Guardrails?", back: "Input rails (validate user inputs), Output rails (validate model responses), Dialog rails (manage conversation flow), Retrieval rails (validate retrieved documents), and Execution rails (validate tool/action execution)." }
    ]
  },

  // ─────────────────────────────────────────────────────────────
  // TOPIC 3: Tool Usage & MCP
  // ─────────────────────────────────────────────────────────────
  "mcp-tools": {
    id: "mcp-tools",
    moduleId: "evaluation-deployment",
    title: "Tool Usage & MCP",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "How AI Agents Use Tools",
        expandable: false,
        content: `<p>An LLM by itself can only generate text. To do anything useful in the real world &mdash; query a database, send an email, check the weather &mdash; it needs tools. Tool use is what turns a chatbot into an agent.</p>
<p>The mechanism is straightforward:</p>
<ul>
  <li><strong>Function calling:</strong> You define a set of available tools (functions) with their names, descriptions, and parameter schemas. The LLM doesn't execute these functions &mdash; it generates a structured call (function name + arguments) when it decides a tool would help answer the user's request.</li>
  <li><strong>Tool execution:</strong> Your application code receives the function call, executes it against the real API or database, and returns the result to the LLM.</li>
  <li><strong>Result integration:</strong> The LLM incorporates the tool's output into its response to the user. It might call multiple tools in sequence, use one tool's output as input to another, or decide no tools are needed.</li>
</ul>
<p>The critical insight for PMs: <strong>tool descriptions are product copy</strong>. The LLM decides which tools to use based on their text descriptions. A poorly described tool won't get called even if it's the right one. Write tool descriptions the way you'd write a feature description for a user &mdash; clear, specific, and with examples of when to use it.</p>`
      },

      {
        type: "callout",
        variant: "tip",
        title: "Tool Descriptions Are UX",
        content: `<p>Treat your tool descriptions like microcopy. "search_db: searches the database" is as useless as a button labeled "Click here." Instead: "search_db: Query the customer database by name, email, or account ID. Use this when the user asks about a specific customer's account, order history, or subscription status. Returns customer profile and recent activity." The LLM needs context to make good tool-use decisions.</p>`
      },

      {
        type: "concept",
        title: "The N*M Problem and Why MCP Exists",
        expandable: true,
        content: `<p>Before MCP, every AI application had to build custom integrations for every external tool. If you had 5 AI apps and 10 tools, you needed 50 custom integrations. Each one had its own authentication, data format, error handling, and maintenance burden.</p>
<p>This is the N&times;M problem: N applications times M tools equals an explosion of integration work. It's the same problem the language server protocol (LSP) solved for code editors &mdash; before LSP, every editor needed a custom plugin for every programming language.</p>
<p><strong>Model Context Protocol (MCP)</strong> solves this the same way. It's an open standard that defines a universal interface between AI applications (clients) and external tools/data sources (servers). Build one MCP server for your tool, and every MCP-compatible AI application can use it. Build one MCP client in your app, and it can use any MCP server.</p>
<p>The math changes from N&times;M to N+M. Instead of 50 custom integrations, you need 5 clients + 10 servers = 15 components. That's a fundamentally different scaling curve.</p>`,
        diagram: {
          type: "comparison",
          data: {
            columns: [
              {
                title: "Before MCP (N×M)",
                items: [
                  "Every app builds custom integrations",
                  "50 connectors for 5 apps × 10 tools",
                  "Each connector has unique auth, format, errors",
                  "Maintenance scales quadratically",
                  "New tool = rebuild for every app"
                ],
                color: "#F42A72"
              },
              {
                title: "After MCP (N+M)",
                items: [
                  "Apps implement one MCP client",
                  "15 components for 5 apps + 10 tools",
                  "Standardized protocol for all connections",
                  "Maintenance scales linearly",
                  "New tool = one MCP server, works everywhere"
                ],
                color: "#1CE6D2"
              }
            ]
          }
        }
      },

      {
        type: "concept",
        title: "MCP Architecture: Client-Server Model",
        expandable: true,
        content: `<p>MCP uses a client-server architecture. Understanding the pieces:</p>
<ul>
  <li><strong>MCP Host:</strong> The AI application the user interacts with &mdash; Claude Desktop, an IDE with AI features, a custom chatbot. The host manages the user experience and orchestrates interactions between the LLM and MCP servers.</li>
  <li><strong>MCP Client:</strong> A protocol client embedded in the host. It maintains a 1:1 connection with an MCP server, handling the protocol handshake, capability negotiation, and message exchange. Each host can have multiple clients connected to different servers simultaneously.</li>
  <li><strong>MCP Server:</strong> A lightweight service that exposes tools, resources, or prompts via the MCP protocol. Each server focuses on a specific domain &mdash; a GitHub server, a Slack server, a database server. Servers can run locally (as a subprocess) or remotely (over HTTP with SSE).</li>
</ul>
<p>MCP servers expose three types of capabilities:</p>
<ul>
  <li><strong>Tools:</strong> Functions the LLM can call (e.g., "create a GitHub issue," "query the database"). The LLM decides when to call them based on the user's request.</li>
  <li><strong>Resources:</strong> Data the application can read (e.g., file contents, database records). Similar to GET endpoints in a REST API. Resources provide context to the LLM without requiring a function call.</li>
  <li><strong>Prompts:</strong> Pre-built prompt templates that the server provides. These are reusable interaction patterns for the server's domain &mdash; a "summarize PR" prompt for a GitHub server, for instance.</li>
</ul>`,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "n1", label: "MCP Host (AI App)", type: "start" },
              { id: "n2", label: "MCP Client", type: "process" },
              { id: "n3", label: "MCP Protocol", type: "process" },
              { id: "n4", label: "MCP Server", type: "process" },
              { id: "n5", label: "Tools / Resources / Prompts", type: "end" }
            ],
            edges: [["n1","n2"],["n2","n3"],["n3","n4"],["n4","n5"]]
          }
        }
      },

      {
        type: "concept",
        title: "MCP Ecosystem and Adoption",
        expandable: true,
        content: `<p>MCP's adoption trajectory tells you a lot about where the industry is heading:</p>
<ul>
  <li><strong>Origin:</strong> Anthropic created MCP and released it as an open specification in November 2024, with SDKs for TypeScript and Python.</li>
  <li><strong>Open governance:</strong> In December 2025, Anthropic donated MCP to the AI Alliance Interoperability Foundation (AAIF) under the Linux Foundation. This was a deliberate move to make MCP a true industry standard, not an Anthropic-controlled protocol.</li>
  <li><strong>Industry adoption:</strong> By mid-2026, MCP has been adopted by all major AI platforms. OpenAI integrated MCP support into ChatGPT and their Agents SDK. Google added MCP support to Gemini and ADK (Agent Development Kit). Microsoft integrated MCP across Copilot products. This broad adoption means building an MCP server is a genuine "write once, run everywhere" investment.</li>
  <li><strong>Ecosystem growth:</strong> There are now thousands of community-built MCP servers covering databases, SaaS tools, developer platforms, and enterprise systems. The ecosystem has package registries and discovery tools, making it increasingly easy to find and use existing servers rather than building from scratch.</li>
</ul>
<p>For PMs, MCP matters because it changes the build-vs-buy calculus for integrations. If a tool your product needs already has an MCP server, you can connect to it in hours instead of building a custom integration in weeks.</p>`
      },

      {
        type: "callout",
        variant: "example",
        title: "MCP in Practice",
        content: `<p>Imagine you're building an AI assistant for project managers. Without MCP, you'd need custom integrations for Jira, Slack, Google Calendar, GitHub, and Confluence &mdash; each with their own auth flow, API pagination, error handling, and data mapping. With MCP, you implement one MCP client in your app, then connect to existing MCP servers for each tool. Your engineering effort shifts from "build 5 integrations" to "configure 5 connections." And when your users ask for Notion support, you just connect another MCP server.</p>`
      },

      {
        type: "concept",
        title: "Building Custom MCP Servers",
        expandable: true,
        content: `<p>When no existing MCP server covers your use case, you'll need to build one. Here's what PMs should know about the process:</p>
<ul>
  <li><strong>Scope it tightly:</strong> One MCP server should handle one domain. Don't build a "company super-server" that wraps every internal API. Build a server for your CRM, a server for your analytics, a server for your knowledge base. This keeps them maintainable and reusable.</li>
  <li><strong>Design tools for the LLM:</strong> Each tool should do one thing clearly. Prefer specific tools ("get_customer_by_email") over generic ones ("query_database"). The LLM needs to understand when to use each tool from its description alone.</li>
  <li><strong>Handle auth properly:</strong> MCP supports OAuth 2.0 for remote servers. For local servers (running as a subprocess), the server typically inherits the user's credentials or uses API keys from environment variables. Don't hardcode secrets.</li>
  <li><strong>Implement resource endpoints:</strong> Resources let the LLM pull context without the user explicitly asking. A CRM server might expose a "recent_interactions" resource that the LLM reads automatically when a customer is mentioned.</li>
  <li><strong>Test with real AI apps:</strong> An MCP server that works in your unit tests might confuse the LLM in practice. Test with actual AI applications (Claude Desktop, your IDE) to verify the LLM uses your tools correctly.</li>
</ul>`
      },

      {
        type: "quiz",
        id: "mcp-architecture-quiz",
        variant: "multiple-choice",
        question: "What is the primary problem that MCP (Model Context Protocol) solves?",
        options: [
          { id: "a", text: "It makes LLMs generate faster responses by optimizing token throughput" },
          { id: "b", text: "It standardizes the interface between AI applications and external tools, reducing N×M integrations to N+M" },
          { id: "c", text: "It provides a way to fine-tune LLMs on domain-specific data without retraining" },
          { id: "d", text: "It encrypts all communication between AI models and users for security compliance" }
        ],
        correct: "b",
        explanation: "MCP solves the N×M integration problem. Without a standard protocol, every AI application needs custom integrations for every tool it wants to use. MCP provides a universal interface so each app implements one client and each tool implements one server, reducing the total integration effort from N×M to N+M. It's analogous to how LSP (Language Server Protocol) standardized code editor integrations."
      },

      {
        type: "exercise",
        id: "mcp-integration-exercise",
        title: "MCP Integration Plan",
        prompt: "You're the PM for an AI-powered customer success platform. Your product needs to integrate with your customers' CRM (Salesforce), support ticketing (Zendesk), communication tools (Slack), and analytics dashboards (Looker). Write an MCP integration plan: which MCP servers would you use or build, what tools and resources would each expose, and what's your build-vs-use-existing decision framework?",
        template: `## MCP Integration Plan: Customer Success AI Platform

### Integration Inventory
| System | Existing MCP Server? | Build / Use Existing | Priority |
|--------|----------------------|---------------------|----------|
| Salesforce CRM | | | |
| Zendesk | | | |
| Slack | | | |
| Looker | | | |

### MCP Server: Salesforce CRM
- Tools to expose:
  -
  -
  -
- Resources to expose:
  -
  -
- Auth approach:

### MCP Server: Zendesk
- Tools to expose:
  -
  -
  -
- Resources to expose:
  -
  -
- Auth approach:

### MCP Server: Slack
- Tools to expose:
  -
  -
- Resources to expose:
  -

### MCP Server: Looker
- Tools to expose:
  -
  -
- Resources to expose:
  -

### Build vs. Use Existing Decision Framework
- When we build custom:
- When we use existing:
- When we fork and extend:

### Rollout Plan
- Phase 1 (week 1-2):
- Phase 2 (week 3-4):
- Phase 3 (week 5-6):`,
        hints: [
          "Check the MCP ecosystem for existing servers first. Popular tools like Slack, GitHub, and databases often have well-maintained community servers.",
          "For Salesforce, think about what tools the LLM would need: search contacts, get opportunity details, log activities, update fields. Keep each tool focused and well-described.",
          "Resources are great for ambient context. A Salesforce 'recent_opportunities' resource means the LLM automatically knows about deals without the user having to ask.",
          "Auth is critical for enterprise. Salesforce and Zendesk will need OAuth 2.0 flows, while Slack might use bot tokens. Plan for multi-tenant auth if your customers each have their own instances."
        ]
      },

      {
        type: "takeaway",
        points: [
          "Tool use is what turns LLMs into agents. Tool descriptions are product copy — write them clearly because the LLM decides which tools to call based on descriptions alone.",
          "MCP (Model Context Protocol) standardizes AI-tool integrations, reducing N×M custom connectors to N+M components. Adopted by Anthropic, OpenAI, Google, and Microsoft under Linux Foundation governance.",
          "MCP servers expose three capability types: tools (functions the LLM can call), resources (data it can read), and prompts (reusable templates). Scope each server to a single domain.",
          "Before building a custom MCP server, check the ecosystem. Thousands of community servers exist. Your engineering effort is better spent on servers for your unique internal systems."
        ]
      }
    ],

    flashcards: [
      { front: "What are the three steps in how an AI agent uses tools?", back: "1) Function calling: the LLM generates a structured tool call (name + arguments). 2) Tool execution: your application runs the function against the real API. 3) Result integration: the LLM incorporates the result into its response to the user." },
      { front: "What problem does MCP solve, and how?", back: "MCP solves the N×M integration problem. Without MCP, N AI apps × M tools = N×M custom integrations. With MCP, each app implements one client and each tool one server, reducing total effort to N+M. Analogous to how LSP standardized code editor integrations." },
      { front: "What are the three capability types an MCP server can expose?", back: "Tools (functions the LLM can call, like 'create_issue'), Resources (data the app can read, like file contents or database records), and Prompts (reusable prompt templates for the server's domain)." },
      { front: "What is MCP's governance history?", back: "Anthropic created MCP and released it as an open specification in November 2024. In December 2025, they donated it to the AI Alliance Interoperability Foundation (AAIF) under the Linux Foundation. By mid-2026, it's adopted by OpenAI, Google, Microsoft, and the broader ecosystem." }
    ]
  },

  // ─────────────────────────────────────────────────────────────
  // TOPIC 4: Deploying AI Products
  // ─────────────────────────────────────────────────────────────
  "deployment": {
    id: "deployment",
    moduleId: "evaluation-deployment",
    title: "Deploying AI Products",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "Pre-Deployment Checklist",
        expandable: false,
        content: `<p>Before any AI feature goes live, you need four things confirmed. This isn't bureaucracy &mdash; each item directly prevents a category of production incidents:</p>
<ul>
  <li><strong>Evals documented and passing:</strong> Your eval suite (unit, integration, system) is green. Results are recorded somewhere permanent &mdash; not just "it passed in CI." You need a baseline to compare against when you inevitably investigate a quality regression. Document what you tested, what scores you got, and what your pass/fail thresholds are.</li>
  <li><strong>Guardrails tested with adversarial inputs:</strong> Someone on your team spent a day trying to break the system. Prompt injection attempts, edge-case inputs, PII in unexpected fields, off-topic requests. If your guardrails haven't been adversarially tested, they haven't been tested. Document what attacks you tried and how the system responded.</li>
  <li><strong>Monitoring configured and alerting:</strong> You have dashboards tracking response quality, latency, cost, error rates, and guardrail trigger rates. And you have alerts that fire when these metrics cross thresholds. Monitoring you don't look at is decoration. Alerts you don't act on are noise. Be specific about who gets paged and what they do.</li>
  <li><strong>Rollback plan documented and tested:</strong> You can revert to the previous version (or disable the AI feature entirely) within minutes. This plan has been tested &mdash; someone has actually performed the rollback in staging. The rollback plan should include who can authorize it, how to execute it, and how to communicate it to users.</li>
</ul>`
      },

      {
        type: "callout",
        variant: "warning",
        title: "The Missing Rollback",
        content: `<p>The number one deployment failure mode for AI products is not having a tested rollback plan. Traditional software rollbacks are well-understood (revert the deploy). AI rollbacks are trickier: you might need to revert the model version, the prompt, the retrieval index, AND the guardrails simultaneously. Test the full rollback, not just the code revert.</p>`
      },

      {
        type: "concept",
        title: "Deployment Patterns",
        expandable: true,
        content: `<p>AI deployments use the same patterns as traditional software, but with additional quality gates that account for non-deterministic behavior:</p>
<ul>
  <li><strong>Shadow mode:</strong> Run the AI system in parallel with the existing solution. Both process every request, but only the existing system's output is shown to users. Compare the AI's outputs against the baseline to measure quality before any user sees it. Run shadow mode for at least 1-2 weeks to capture enough variation. This is your best tool for building confidence before launch.</li>
  <li><strong>Canary deployment:</strong> Route a small percentage of traffic (1-5%) to the new AI system. Monitor quality metrics closely. If the canary looks good after 24-48 hours, gradually increase traffic. If quality degrades, route everything back to the baseline. The key difference from traditional canary deploys: you're watching quality metrics (hallucination rate, user satisfaction), not just error rates and latency.</li>
  <li><strong>Staged rollout with quality gates:</strong> Internal users first (dogfooding), then beta users who opted in, then a small percentage of production traffic, then general availability. Each stage has explicit quality gates &mdash; metrics that must be met before advancing. If any gate fails, you stop and investigate before proceeding. This is the most conservative approach and the right one for high-stakes applications.</li>
</ul>`,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "n1", label: "Shadow Mode", type: "start" },
              { id: "n2", label: "Quality Gate", type: "decision" },
              { id: "n3", label: "Canary (1-5%)", type: "process" },
              { id: "n4", label: "Quality Gate", type: "decision" },
              { id: "n5", label: "Staged Rollout", type: "process" },
              { id: "n6", label: "Quality Gate", type: "decision" },
              { id: "n7", label: "General Availability", type: "end" }
            ],
            edges: [["n1","n2"],["n2","n3"],["n3","n4"],["n4","n5"],["n5","n6"],["n6","n7"]]
          }
        }
      },

      {
        type: "callout",
        variant: "example",
        title: "Quality Gates in Practice",
        content: `<p>A real quality gate for a customer support AI might look like: "Hallucination rate below 2% on a sample of 500 responses, CSAT score within 5 points of human agents, escalation rate between 10-20%, and zero critical guardrail violations." Each metric has a clear threshold, a measurement method, and a sample size. If any metric misses, the gate doesn't open.</p>`
      },

      {
        type: "concept",
        title: "Production Monitoring for AI Systems",
        expandable: true,
        content: `<p>Once you're live, monitoring becomes your early warning system. AI systems need monitoring beyond traditional APM:</p>
<ul>
  <li><strong>Drift detection:</strong> Are user inputs changing over time? If your support bot was trained on questions about Product A but users are increasingly asking about Product B, quality will degrade even though nothing in your system changed. Monitor input distributions and flag significant shifts. This is often the first signal of an impending quality problem.</li>
  <li><strong>Cost tracking:</strong> LLM API costs can spike unexpectedly. A verbose prompt, a retry loop, or a popular feature can blow your budget in hours. Track cost per request, cost per user, and total daily spend. Set hard spending caps and alerts at 70% and 90% of budget. Some teams implement circuit breakers that degrade to cheaper models when costs exceed thresholds.</li>
  <li><strong>Hallucination rate trending:</strong> Use automated eval (LLM-as-judge on a sample of production traffic) to track hallucination rates over time. A gradual increase often indicates knowledge base staleness or input drift. A sudden spike usually means something broke. Either way, you want to catch it before users do.</li>
  <li><strong>Guardrail trigger rates:</strong> Track how often each guardrail fires. A sudden spike in input rail triggers might mean an adversarial campaign. A gradual increase in output rail triggers might mean model quality is degrading. Low trigger rates might mean your guardrails are too permissive. These rates tell a story &mdash; read it.</li>
  <li><strong>User feedback signals:</strong> Thumbs up/down, explicit complaints, escalation to humans, and implicit signals like users rephrasing their question (a sign the first answer was bad). Combine automated quality metrics with real user feedback for the full picture.</li>
</ul>`
      },

      {
        type: "concept",
        title: "Incident Response for AI Systems",
        expandable: true,
        content: `<p>AI incidents are different from traditional software incidents. A 500 error is obvious &mdash; a hallucinating bot looks like it's working fine until someone notices the output is wrong. Here's how to structure AI-specific incident response:</p>
<ul>
  <li><strong>Detection:</strong> Most AI incidents are detected through monitoring alerts (quality score drops, guardrail spikes), user complaints, or internal spot-checks. The median time to detect an AI quality issue is much longer than a traditional outage because the system keeps responding &mdash; just with bad answers. Invest in automated detection.</li>
  <li><strong>Severity classification:</strong> Not all AI failures are equal. A hallucination in a casual chatbot is minor. A hallucination in a medical information system is critical. Pre-define severity levels based on the potential impact of incorrect outputs in your specific domain.</li>
  <li><strong>Immediate mitigation:</strong> For critical incidents, your first move is reducing blast radius. Options: roll back to the previous version, enable a stricter guardrail profile, increase the HITL routing rate to 100% (every response gets human review), or disable the AI feature entirely and show a fallback. Have these levers pre-built and tested.</li>
  <li><strong>Root cause analysis:</strong> AI incidents often have surprising root causes. Common ones: the knowledge base was updated with incorrect information, a prompt was changed without running evals, the model provider shipped an update that changed behavior, or user behavior shifted (input drift). Your RCA process should investigate the full stack, not just the code.</li>
  <li><strong>Post-incident improvements:</strong> Every AI incident should produce at least two artifacts: a new eval test case that would have caught this failure, and an updated runbook for this class of incident. Build a library of failure modes specific to your system.</li>
</ul>`
      },

      {
        type: "callout",
        variant: "tip",
        title: "The Kill Switch",
        content: `<p>Every AI feature should have a kill switch &mdash; a feature flag that instantly disables the AI component and falls back to a non-AI experience (or a graceful error message). This is different from a rollback. A rollback takes minutes and requires a deploy. A kill switch takes seconds and requires a config change. Build the kill switch before you build the feature.</p>`
      },

      {
        type: "quiz",
        id: "deployment-stages-quiz",
        variant: "multiple-choice",
        question: "You're deploying a new AI-powered search feature. During canary deployment (5% of traffic), you notice the hallucination rate is 4% compared to your quality gate threshold of 2%. What should you do?",
        options: [
          { id: "a", text: "Increase the canary to 25% to gather more data and see if the rate stabilizes" },
          { id: "b", text: "Route all canary traffic back to the baseline, investigate the hallucinations, fix the issue, and restart the canary" },
          { id: "c", text: "Adjust the quality gate threshold to 5% since 4% is close enough to acceptable" },
          { id: "d", text: "Proceed to staged rollout since the canary has been running for 24 hours and the system is functional" }
        ],
        correct: "b",
        explanation: "The quality gate exists for exactly this reason. A 4% hallucination rate exceeding your 2% threshold is a clear fail signal. You should stop the canary, investigate why hallucinations are occurring (check the specific examples — are they one category of question? a knowledge base gap? a prompt issue?), fix the root cause, verify with evals, and restart. Never weaken your quality gates to accommodate a failing deploy."
      },

      {
        type: "exercise",
        id: "deployment-plan-exercise",
        title: "Deployment Plan",
        prompt: "You're deploying an AI assistant that helps sales reps draft personalized outreach emails using CRM data. Write a complete deployment plan covering pre-deployment checks, rollout stages with quality gates, monitoring setup, and incident response procedures.",
        template: `## Deployment Plan: AI Sales Email Assistant

### Pre-Deployment Checklist
- [ ] Eval results:
- [ ] Guardrail testing:
- [ ] Monitoring configured:
- [ ] Rollback plan tested:
- [ ] Kill switch implemented:

### Rollout Stages

#### Stage 1: Shadow Mode (Week 1-2)
- What we're measuring:
- Success criteria to advance:
- Sample size needed:

#### Stage 2: Internal Dogfood (Week 3)
- Who participates:
- Feedback collection method:
- Success criteria to advance:

#### Stage 3: Canary (Week 4)
- Traffic percentage:
- Quality gate metrics and thresholds:
  - Hallucination rate:
  - User edit rate (how much reps modify AI drafts):
  - Send-through rate (% of AI drafts actually sent):
  - Guardrail trigger rate:
- Monitoring cadence:

#### Stage 4: General Availability
- Rollout percentage ramp:
- Ongoing quality monitoring:

### Monitoring Dashboard
- Key metrics to display:
- Alert thresholds:
- On-call rotation:

### Incident Response
- Severity levels:
  - P1 (critical):
  - P2 (high):
  - P3 (medium):
- Mitigation playbook:
  - First 5 minutes:
  - First 30 minutes:
  - First 2 hours:
- Communication plan:`,
        hints: [
          "Shadow mode for email drafting means generating AI drafts for real outreach but not showing them to reps. Compare the AI drafts against what reps actually wrote to measure quality.",
          "User edit rate is a powerful quality signal for this use case. If reps send AI drafts with minimal edits, the quality is good. If they rewrite most of it, the AI isn't adding value.",
          "For incident response, think about the specific failure modes: what if the AI uses stale CRM data? What if it generates an email that violates compliance? What if it reveals competitive deal information to the wrong rep?",
          "Don't forget cost monitoring. If each email draft costs $0.05 in API calls and your team sends 10,000 emails/day, that's $500/day. Make sure your business case accounts for the actual per-unit cost."
        ]
      },

      {
        type: "takeaway",
        points: [
          "The pre-deployment checklist has four non-negotiable items: evals documented and passing, guardrails adversarially tested, monitoring configured with alerts, and rollback plan tested in staging.",
          "Deploy AI features through progressive stages: shadow mode, canary, staged rollout. Each stage has explicit quality gates with clear metrics and thresholds. Never weaken a gate to accommodate a failing deploy.",
          "AI monitoring goes beyond traditional APM: track drift detection, cost per request, hallucination rate trending, guardrail trigger rates, and user feedback signals. These metrics are your early warning system.",
          "Every AI feature needs a kill switch (instant disable via feature flag) and a rollback plan (full version revert). Build and test both before you ship the feature."
        ]
      }
    ],

    flashcards: [
      { front: "What are the four items on the AI pre-deployment checklist?", back: "1) Evals documented and passing with recorded baselines. 2) Guardrails adversarially tested by someone trying to break the system. 3) Monitoring configured with dashboards and alerts on quality, latency, cost. 4) Rollback plan documented and tested in staging." },
      { front: "What is shadow mode in AI deployment?", back: "Running the AI system in parallel with the existing solution. Both process every request, but only the existing system's output is shown to users. You compare AI outputs against the baseline to measure quality before any user sees it. Run for 1-2 weeks minimum." },
      { front: "What is the difference between a kill switch and a rollback?", back: "A kill switch is a feature flag that instantly disables the AI and falls back to a non-AI experience (seconds, config change). A rollback reverts to the previous version (minutes, requires a deploy). Build the kill switch first — it's your emergency brake." },
      { front: "Name five production monitoring signals specific to AI systems.", back: "1) Drift detection (input distribution changes). 2) Cost tracking (per request and total). 3) Hallucination rate trending (via automated LLM-as-judge on sampled traffic). 4) Guardrail trigger rates (spikes indicate problems). 5) User feedback signals (thumbs up/down, rephrasing, escalation)." }
    ]
  }

};
