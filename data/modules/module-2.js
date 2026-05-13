export default {

  // ──────────────────────────────────────────────
  // TOPIC 1: Finding AI Opportunities
  // ──────────────────────────────────────────────
  "finding-opportunities": {
    id: "finding-opportunities",
    moduleId: "business-translation",
    title: "Finding AI Opportunities",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "Not Every Problem Needs AI",
        content: `<p>The fastest way to waste six months of engineering time is to slap an LLM onto a problem that a well-designed rule engine solves in a weekend. Before you pitch an AI feature, you need a framework for separating genuine AI opportunities from problems where deterministic code, better UX, or a simple lookup table will outperform any model.</p>
<p>AI shines when the input space is too large to enumerate, the rules are too fuzzy to hard-code, or the output requires generating something novel. If a support team handles 200 ticket categories but the routing logic boils down to 15 keywords, a regex-based router will be faster, cheaper, and more reliable than any classifier. Save the AI budget for the tickets that actually require reading context and making judgment calls.</p>
<p>The biggest trap is <strong>automation bias</strong>: stakeholders see a demo of GPT-4 doing something impressive and assume it will work at scale, on their data, with their edge cases. Your job as PM is to pressure-test that assumption before a single line of model code gets written.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "The Three-Filter Framework",
        content: `<p>Run every candidate AI feature through three filters before it earns a spot on your roadmap. If it fails any one of them, you either need to reframe the problem or shelve it.</p>
<ul>
  <li><strong>Filter 1 - Repetitive but requires judgment:</strong> The task happens frequently enough to justify the investment, but it is not purely mechanical. A warehouse worker scanning barcodes is repetitive but requires no judgment; reviewing insurance claims for fraud is repetitive <em>and</em> requires judgment. AI fits the second case.</li>
  <li><strong>Filter 2 - Enough data exists (or can be created):</strong> Models need training signal. That could be labeled examples for a classifier, a knowledge base for RAG, or simply enough volume of text for an LLM to pattern-match against. If your company has 50 examples of the thing you want to detect, you do not have enough data for a custom model. You might still use a foundation model with well-crafted prompts, but set expectations accordingly.</li>
  <li><strong>Filter 3 - Cost of errors is manageable:</strong> Every AI system makes mistakes. The question is what happens when it does. Misclassifying a support ticket as "billing" instead of "technical" is annoying but recoverable. Misclassifying a drug interaction is catastrophic. For high-stakes domains, you need a human-in-the-loop design, which changes the economics significantly.</li>
</ul>
<p>When a feature passes all three filters, you have a legitimate AI candidate. When it passes two out of three, dig deeper into the failing filter before making a call.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "callout",
        variant: "key-insight",
        title: "The PM Smell Test",
        content: `<p>Ask yourself: "If I gave a smart new hire a written procedure and 100 examples, could they do this task at 80% accuracy within a week?" If yes, AI can probably do it. If no, either the task requires deep domain expertise that is hard to encode, or the problem is too ambiguous even for humans.</p>`
      },
      {
        type: "concept",
        title: "Mapping Business Language to AI Problem Types",
        content: `<p>Business stakeholders do not say "I need a classification model." They say "We need to figure out which leads are worth calling." Your job is to translate their language into the right AI problem type, because the problem type determines the architecture, the eval strategy, and the cost profile.</p>
<ul>
  <li><strong>Classification:</strong> "Sort these into categories," "Flag the risky ones," "Is this spam or not?" These map to classifiers. They are the most mature AI pattern with well-understood eval metrics (precision, recall, F1).</li>
  <li><strong>Generation:</strong> "Write a first draft," "Create a summary," "Produce a response." This is the domain of LLMs. It is powerful but hard to evaluate and prone to hallucination. Always ask: what is the cost of a wrong generation?</li>
  <li><strong>Extraction:</strong> "Pull the key fields from this document," "Find the dates and amounts in these contracts." Structured extraction from unstructured data. Often combined with classification.</li>
  <li><strong>Summarization:</strong> "Give me the gist of this 40-page report." A specialized form of generation with the advantage that the source material constrains the output. Easier to evaluate than open-ended generation.</li>
  <li><strong>Agent workflows:</strong> "Handle the entire process end-to-end." The model does not just produce output; it takes actions, uses tools, and makes decisions in a loop. Most complex, most expensive, highest potential impact. Requires robust guardrails.</li>
</ul>
<p>Getting this translation right matters because each problem type has different data requirements, different latency profiles, and different failure modes. A stakeholder who wants "AI-powered search" might actually need extraction plus classification, not a generative chatbot.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "concept",
        title: "The AI Hype vs Reality Decision Tree",
        content: `<p>Before greenlighting any AI feature, walk through this decision tree. It forces you to confront the practical realities that demo-driven excitement tends to gloss over.</p>
<p>Start by asking whether the problem is well-defined enough that you could write an eval for it. If you cannot define what "good" looks like, you cannot build or measure an AI solution. Then ask whether you have access to the data the model would need. Then consider latency and cost constraints. A feature that costs $0.50 per API call and takes 8 seconds to respond may be viable for a B2B workflow tool but dead on arrival for a consumer app.</p>
<p>Finally, ask the uncomfortable question: <strong>what is the baseline?</strong> If the current manual process already works at 95% accuracy and costs $2 per transaction, your AI solution needs to beat that on at least one dimension (speed, cost, or accuracy) by a meaningful margin. "We could use AI for this" is not a business case. "AI reduces processing time from 4 hours to 20 minutes at comparable accuracy" is.</p>`,
        expandable: false,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "n1", label: "Can you define what 'good output' looks like?", type: "decision" },
              { id: "n2", label: "Stop. Define eval criteria first.", type: "end" },
              { id: "n3", label: "Do you have access to the required data?", type: "decision" },
              { id: "n4", label: "Can you acquire or synthesize it affordably?", type: "decision" },
              { id: "n5", label: "Is latency < 5s and cost < $0.10/call acceptable?", type: "decision" },
              { id: "n6", label: "Does AI beat the current baseline meaningfully?", type: "decision" },
              { id: "n7", label: "Valid AI candidate. Build a prototype.", type: "end" },
              { id: "n8", label: "Not an AI problem right now. Revisit later.", type: "end" }
            ],
            edges: [
              ["n1", "n2"],
              ["n1", "n3"],
              ["n3", "n4"],
              ["n3", "n5"],
              ["n4", "n5"],
              ["n4", "n8"],
              ["n5", "n6"],
              ["n5", "n8"],
              ["n6", "n7"],
              ["n6", "n8"]
            ]
          }
        }
      },
      {
        type: "callout",
        variant: "warning",
        title: "The Demo Trap",
        content: `<p>A demo that works on 5 cherry-picked examples proves nothing about production viability. Before committing resources, run at least 50-100 representative examples through the model and measure accuracy on cases that include edge cases, ambiguous inputs, and adversarial content. If stakeholders resist this step, that is a red flag about their understanding of AI risk.</p>`
      },
      {
        type: "quiz",
        id: "fo-quiz-1",
        variant: "multiple-choice",
        question: "A legal team wants AI to review 500 contracts per month and flag clauses that deviate from standard templates. Which filter is the BIGGEST risk for this use case?",
        options: [
          { id: "a", text: "Repetitive but requires judgment - contract review is too unique each time" },
          { id: "b", text: "Cost of errors - a missed non-standard clause could have major legal consequences" },
          { id: "c", text: "Data availability - there aren't enough contracts to train on" },
          { id: "d", text: "None - this is a perfect AI use case with no significant risks" }
        ],
        correct: "b",
        explanation: "While contract review passes the 'repetitive + judgment' filter and likely has sufficient data (500/month is solid volume), the cost of errors is the critical risk. A missed non-standard clause in a legal contract could expose the company to significant liability. This does not mean AI should not be used, but it means the design must include human-in-the-loop review for flagged items and a high-recall approach (better to over-flag than under-flag)."
      },
      {
        type: "quiz",
        id: "fo-quiz-2",
        variant: "drag-match",
        question: "Match each business need to the correct AI problem type.",
        pairs: [
          { left: "Route support tickets to the right team", right: "Classification" },
          { left: "Write first-draft marketing copy from a brief", right: "Generation" },
          { left: "Pull invoice amounts and dates from PDF scans", right: "Extraction" },
          { left: "Book meetings and send follow-ups automatically", right: "Agent Workflow" }
        ],
        explanation: "Routing tickets is a classification problem (assign to category). Writing copy from a brief is generation (create new content). Pulling structured fields from PDFs is extraction. Booking meetings involves multiple steps, tool use, and decision-making, which is an agent workflow."
      },
      {
        type: "exercise",
        id: "fo-exercise-1",
        title: "AI Opportunity Audit",
        prompt: "Pick a product you work on (or a product you use daily). Identify three processes or features that could potentially benefit from AI. For each one, run it through the three-filter framework and classify the AI problem type. Be honest about which ones fail a filter.",
        template: `## AI Opportunity Audit

### Product: [Your product name]

### Opportunity 1: [Name]
- Description: [What does this process/feature do today?]
- Filter 1 (Repetitive + Judgment): [Pass/Fail - explain why]
- Filter 2 (Data Availability): [Pass/Fail - what data exists?]
- Filter 3 (Error Cost): [Pass/Fail - what happens when AI is wrong?]
- AI Problem Type: [Classification / Generation / Extraction / Summarization / Agent]
- Verdict: [Pursue / Reframe / Shelve]

### Opportunity 2: [Name]
- Description:
- Filter 1:
- Filter 2:
- Filter 3:
- AI Problem Type:
- Verdict:

### Opportunity 3: [Name]
- Description:
- Filter 1:
- Filter 2:
- Filter 3:
- AI Problem Type:
- Verdict:

### Summary
Which opportunity has the strongest case? Why?`,
        hints: [
          "Look for processes where people complain about tedious work that still requires thinking",
          "Consider the data that already flows through your systems - logs, tickets, documents, conversations",
          "For the error cost filter, think about both the direct cost and the reputational cost of mistakes",
          "If an opportunity fails Filter 2, consider whether a foundation model with few-shot prompting could substitute for fine-tuned model training data"
        ]
      },
      {
        type: "takeaway",
        points: [
          "Not every problem needs AI. Run every candidate through three filters: repetitive judgment, data availability, and error cost tolerance.",
          "Translate business language into AI problem types (classification, generation, extraction, summarization, agent workflows) to determine architecture and eval strategy.",
          "Always define what 'good' looks like before building. If you cannot write an eval, you cannot ship an AI feature responsibly.",
          "The demo trap is real. Demand evaluation on 50-100 representative examples including edge cases before committing resources."
        ]
      }
    ],
    flashcards: [
      {
        front: "What are the three filters in the AI opportunity framework?",
        back: "1) Repetitive but requires judgment, 2) Enough data exists or can be created, 3) Cost of errors is manageable. A candidate must pass all three to be a strong AI opportunity."
      },
      {
        front: "How do you distinguish between a classification problem and an extraction problem in business terms?",
        back: "Classification assigns inputs to categories ('Is this spam?', 'Which team handles this?'). Extraction pulls structured data from unstructured sources ('Get the dollar amounts from these invoices'). The stakeholder says 'sort' or 'flag' for classification, and 'find' or 'pull' for extraction."
      },
      {
        front: "What is the 'demo trap' and how do you avoid it?",
        back: "The demo trap is when stakeholders see an AI model work on a few cherry-picked examples and assume production viability. Avoid it by running 50-100 representative examples (including edge cases and adversarial inputs) through the model before committing resources."
      },
      {
        front: "When should you use an agent workflow vs. a simpler AI problem type?",
        back: "Use an agent workflow when the task requires multiple steps, tool usage, and decision-making in a loop (e.g., book a meeting, check availability, send confirmation). Use simpler types (classification, extraction) when the task is a single input-to-output mapping. Agents are the most complex and expensive pattern - do not use them when a one-shot call suffices."
      }
    ]
  },

  // ──────────────────────────────────────────────
  // TOPIC 2: RAG - Vanilla vs Agentic
  // ──────────────────────────────────────────────
  "rag-deep-dive": {
    id: "rag-deep-dive",
    moduleId: "business-translation",
    title: "RAG: Vanilla vs Agentic",
    estimatedMinutes: 30,
    sections: [
      {
        type: "concept",
        title: "Why LLMs Need External Knowledge",
        content: `<p>Large language models have a knowledge cutoff. They do not know about your company's internal documentation, your product's latest release notes, or the policy changes your legal team made last Tuesday. Even for public knowledge, they confidently hallucinate details that sound plausible but are fabricated. This is not a bug that will be fixed in the next model version; it is an architectural reality of how these models work.</p>
<p>Retrieval-Augmented Generation (RAG) solves this by giving the model access to a curated knowledge base at inference time. Instead of relying on what the model memorized during training, you retrieve relevant documents and include them in the prompt context. The model generates its answer grounded in those retrieved sources. Done well, RAG dramatically reduces hallucination and lets you control exactly what knowledge the model draws from.</p>
<p>For PMs, the key insight is that RAG turns an AI project from a "train a model" problem into a "build a search pipeline" problem. The quality of your RAG system depends more on the quality of your retrieval and your document corpus than on which LLM you use. This is both good news (you have more control) and a warning (garbage in, garbage out applies with full force).</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "Vanilla RAG Pipeline",
        content: `<p>The standard RAG pipeline has five stages, and understanding each one is critical because each is a potential failure point.</p>
<ul>
  <li><strong>Query:</strong> The user asks a question. Seems simple, but ambiguous queries are the #1 source of bad RAG results. "What's the policy?" could mean anything.</li>
  <li><strong>Embed:</strong> The query is converted into a vector (a list of numbers) using an embedding model. This vector represents the semantic meaning of the query in a high-dimensional space.</li>
  <li><strong>Retrieve:</strong> The system searches a vector database for document chunks whose embeddings are closest to the query embedding. Typically you retrieve the top 3-10 chunks. This is where chunking strategy matters enormously: too small and you lose context, too large and you dilute relevance.</li>
  <li><strong>Augment:</strong> The retrieved chunks are inserted into the LLM prompt alongside the original query. The prompt template instructs the model to answer based on the provided context and to say "I don't know" if the context does not contain the answer.</li>
  <li><strong>Generate:</strong> The LLM produces an answer grounded in the retrieved context. Ideally it cites which chunks it drew from, making the answer verifiable.</li>
</ul>
<p>This pipeline works remarkably well for straightforward factual questions against a clean, well-organized knowledge base. It falls apart when the questions get complex.</p>`,
        expandable: true,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "q", label: "User Query", type: "start" },
              { id: "e", label: "Embed Query", type: "process" },
              { id: "r", label: "Retrieve Top-K Chunks", type: "process" },
              { id: "a", label: "Augment Prompt with Context", type: "process" },
              { id: "g", label: "Generate Answer (LLM)", type: "process" },
              { id: "o", label: "Grounded Response", type: "end" }
            ],
            edges: [
              ["q", "e"],
              ["e", "r"],
              ["r", "a"],
              ["a", "g"],
              ["g", "o"]
            ]
          }
        }
      },
      {
        type: "concept",
        title: "Where Vanilla RAG Fails",
        content: `<p>Vanilla RAG is a single-pass system: one query, one retrieval, one generation. That works for simple lookups but breaks down in three common scenarios that your users will absolutely encounter.</p>
<p><strong>Multi-hop questions:</strong> "What was the revenue impact of the pricing change we made after the Q3 board meeting?" requires finding the board meeting, finding the pricing decision from that meeting, then finding revenue data after that change. A single retrieval pass cannot chain these together. It will grab chunks about board meetings OR pricing changes OR revenue, but not connect them.</p>
<p><strong>Ambiguous queries:</strong> "Tell me about the project" retrieves random chunks because the query lacks specificity. The user expects the system to ask clarifying questions or infer context from the conversation. Vanilla RAG does neither.</p>
<p><strong>Contradictory sources:</strong> When your knowledge base contains documents from different time periods or departments that contradict each other, vanilla RAG might retrieve both and the LLM will either pick one arbitrarily or try to reconcile them in a way that is subtly wrong. There is no mechanism for resolving conflicts based on recency, authority, or source reliability.</p>
<p>These are not exotic edge cases. In any enterprise deployment, multi-hop and ambiguity are the majority of real user queries. This is why agentic RAG exists.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "callout",
        variant: "example",
        title: "Vanilla RAG Failure in Practice",
        content: `<p>A customer support bot using vanilla RAG receives: "Why was my refund denied, and what can I do about it?" This requires: (1) finding the refund policy, (2) finding the customer's specific denial reason, (3) finding the appeal process. Vanilla RAG might retrieve the refund policy but miss the appeal process entirely, giving a half-answer that frustrates the customer.</p>`
      },
      {
        type: "concept",
        title: "Agentic RAG: Retrieval as a Control Loop",
        content: `<p>Agentic RAG treats retrieval not as a single step but as a tool the model uses iteratively within a reasoning loop. The most common pattern is ReAct (Reason + Act): the model thinks about what information it needs, issues a retrieval query, evaluates what it got back, decides whether it has enough to answer, and either retrieves again with a refined query or generates the final response.</p>
<p>In practice, an agentic RAG system might handle that multi-hop question like this: (1) search for "Q3 board meeting" and find the meeting notes, (2) read the notes to identify the pricing decision, (3) search for "pricing change [specific date]" to find implementation details, (4) search for "revenue [date range after pricing change]" to find impact data, (5) synthesize a coherent answer from all retrieved context.</p>
<p>The model is acting as a <strong>research analyst</strong>, not a lookup tool. It decides what to search for, evaluates results, and iterates. This is dramatically more capable but also more expensive and harder to debug. Each iteration burns tokens, adds latency, and introduces another point where the model could go off-track.</p>
<p>For PMs, the key trade-off is this: agentic RAG handles complex queries that vanilla RAG simply cannot, but it uses 3-10x more tokens per query and adds 2-5x latency. You need to decide whether your use case justifies that cost, or whether you can redesign the UX to guide users toward simpler queries that vanilla RAG handles well.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "concept",
        title: "Vanilla RAG vs Agentic RAG",
        content: `<p>The choice between vanilla and agentic RAG is not binary. Many production systems use a hybrid approach: route simple queries through the vanilla pipeline and escalate complex ones to the agentic system. This is called <strong>adaptive RAG</strong>, and it is the architecture most teams should aim for.</p>
<p>A lightweight classifier (or even a prompt-based check) at the front of the pipeline determines query complexity. Factual lookups like "What is our return policy?" go through the fast, cheap vanilla path. Multi-step research questions like "Compare our Q3 and Q4 churn rates and identify contributing factors" get routed to the agentic path. This way you control costs while still handling the hard queries.</p>`,
        expandable: false,
        diagram: {
          type: "comparison",
          data: {
            columns: [
              {
                title: "Vanilla RAG",
                items: [
                  "Single retrieval pass",
                  "Fast: 1-3 seconds",
                  "Low cost: 1x tokens",
                  "Simple factual queries",
                  "Easy to debug and monitor",
                  "Fails on multi-hop questions",
                  "No query refinement"
                ],
                color: "#0239A8"
              },
              {
                title: "Agentic RAG",
                items: [
                  "Iterative retrieval loop (ReAct)",
                  "Slower: 5-15 seconds",
                  "Higher cost: 3-10x tokens",
                  "Complex, multi-step queries",
                  "Harder to debug and predict",
                  "Handles ambiguity and multi-hop",
                  "Self-correcting retrieval"
                ],
                color: "#F42A72"
              }
            ]
          }
        }
      },
      {
        type: "concept",
        title: "RAGAS: Evaluating Your RAG System",
        content: `<p>You cannot improve what you cannot measure, and RAG systems have failure modes that are invisible without proper evaluation. RAGAS (Retrieval Augmented Generation Assessment) is the standard evaluation framework, and it measures four dimensions that correspond to the four ways a RAG system can fail.</p>
<ul>
  <li><strong>Context Precision:</strong> Of the chunks you retrieved, what fraction were actually relevant to the question? Low precision means your retrieval is noisy and the model is being distracted by irrelevant information. Fix: better chunking, better embeddings, or metadata filtering.</li>
  <li><strong>Context Recall:</strong> Of all the relevant chunks in your knowledge base, what fraction did you actually retrieve? Low recall means you are missing critical information. Fix: retrieve more chunks (increase K), improve query expansion, or add keyword search alongside vector search.</li>
  <li><strong>Faithfulness:</strong> Does the generated answer only contain claims that are supported by the retrieved context? Low faithfulness means the model is hallucinating, adding information from its training data instead of sticking to your documents. Fix: stronger grounding prompts, lower temperature, or citation requirements.</li>
  <li><strong>Answer Relevancy:</strong> Does the generated answer actually address the user's question? You can be faithful to the context but still not answer what was asked. Fix: better query understanding, query rewriting, or retrieval reranking.</li>
</ul>
<p>As a PM, you should track all four metrics and set quality gates. A system with 90% faithfulness but 60% context recall is retrieving too few documents. A system with 95% recall but 70% faithfulness is retrieving well but the model is adding fabricated details. Each failure pattern has a different fix.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "callout",
        variant: "tip",
        title: "The Chunking Strategy Matters More Than the Model",
        content: `<p>Teams spend weeks debating which LLM to use and 30 minutes deciding on chunking. This is backwards. A well-chunked knowledge base with a decent model will outperform a poorly-chunked one with the best model. Experiment with chunk sizes (256-1024 tokens), overlap (10-20%), and semantic vs. fixed-size boundaries. Measure retrieval precision before and after.</p>`
      },
      {
        type: "quiz",
        id: "rag-quiz-1",
        variant: "multiple-choice",
        question: "Your RAG system scores 92% on context recall but only 68% on faithfulness. What is the most likely problem?",
        options: [
          { id: "a", text: "The retrieval pipeline is not finding enough relevant documents" },
          { id: "b", text: "The LLM is adding information from its training data instead of sticking to the retrieved context" },
          { id: "c", text: "The embedding model is too slow for production use" },
          { id: "d", text: "The user's queries are too ambiguous to answer" }
        ],
        correct: "b",
        explanation: "High context recall (92%) means the system IS finding the relevant documents. Low faithfulness (68%) means the LLM is generating claims that are not supported by the retrieved context. It is hallucinating, pulling in information from its parametric memory rather than grounding its answer in the provided chunks. Fixes include: stronger system prompts that enforce grounding, requiring inline citations, lowering the temperature, or using a model that is better at instruction-following."
      },
      {
        type: "exercise",
        id: "rag-exercise-1",
        title: "RAG Architecture Decision",
        prompt: "You are building a knowledge assistant for a company with 10,000 internal documents (policies, procedures, technical docs). Users range from new hires asking simple questions to senior engineers asking complex multi-step research questions. Design your RAG architecture, including whether to use vanilla, agentic, or adaptive RAG, and justify your choices.",
        template: `## RAG Architecture Decision

### Use Case Summary
- Document corpus: [size, types, update frequency]
- User types: [who will use this, what are typical queries?]
- Quality requirements: [what accuracy is needed? consequences of errors?]

### Architecture Choice: [Vanilla / Agentic / Adaptive RAG]
- Rationale: [Why this architecture for this use case?]

### Retrieval Design
- Chunking strategy: [size, overlap, semantic boundaries?]
- Embedding model: [which one and why?]
- Search approach: [vector only, hybrid, metadata filtering?]
- Top-K setting: [how many chunks to retrieve?]

### Query Routing (if adaptive)
- How do you classify simple vs. complex queries?
- What percentage of queries go to each path?

### Evaluation Plan
- Context Precision target: [  ]%
- Context Recall target: [  ]%
- Faithfulness target: [  ]%
- Answer Relevancy target: [  ]%
- How often will you run evals?

### Cost & Latency Budget
- Target latency: [  ] seconds (p50), [  ] seconds (p95)
- Estimated cost per query: $[  ]
- Monthly budget at expected volume: $[  ]`,
        hints: [
          "For 10,000 documents with mixed user types, adaptive RAG is almost always the right call. You want cheap-and-fast for simple lookups, powerful-and-slow for research queries.",
          "Consider using a small classifier or prompt-based router at the front to detect query complexity. Route ~70% of queries to vanilla RAG and ~30% to agentic.",
          "Set faithfulness targets high (>90%) because internal policy documents have real consequences if the model makes things up.",
          "Think about document freshness. Policies change - how do you handle versioning so the system does not cite outdated procedures?"
        ]
      },
      {
        type: "takeaway",
        points: [
          "RAG gives LLMs access to your specific knowledge base at inference time, reducing hallucination and keeping answers grounded in your documents.",
          "Vanilla RAG (single-pass retrieval) works for simple factual queries but fails on multi-hop questions, ambiguous queries, and contradictory sources.",
          "Agentic RAG uses iterative retrieval in a reasoning loop (ReAct), handling complex queries at the cost of 3-10x more tokens and 2-5x higher latency.",
          "Measure RAG quality with RAGAS: context precision, context recall, faithfulness, and answer relevancy. Each metric reveals a different failure mode with a different fix."
        ]
      }
    ],
    flashcards: [
      {
        front: "What are the five stages of a vanilla RAG pipeline?",
        back: "1) Query - user asks a question. 2) Embed - convert query to a vector. 3) Retrieve - find top-K similar document chunks from vector DB. 4) Augment - inject retrieved chunks into the LLM prompt. 5) Generate - LLM produces an answer grounded in the context."
      },
      {
        front: "What is the ReAct pattern in agentic RAG?",
        back: "ReAct (Reason + Act) is a control loop where the model: reasons about what information it needs, acts by issuing a retrieval query, observes the results, then decides whether to retrieve again with a refined query or generate the final answer. It treats retrieval as a tool used iteratively, not a single step."
      },
      {
        front: "What are the four RAGAS evaluation metrics and what does each measure?",
        back: "Context Precision: what fraction of retrieved chunks were relevant? Context Recall: what fraction of all relevant chunks were retrieved? Faithfulness: does the answer only contain claims supported by the context? Answer Relevancy: does the answer actually address the user's question?"
      },
      {
        front: "What is adaptive RAG and why do most production systems use it?",
        back: "Adaptive RAG routes simple queries through a fast, cheap vanilla RAG pipeline and complex queries through a more capable (but slower, more expensive) agentic RAG pipeline. A classifier at the front determines query complexity. This gives you cost efficiency for easy questions and high quality for hard ones."
      }
    ]
  },

  // ──────────────────────────────────────────────
  // TOPIC 3: AI Feature Prioritization
  // ──────────────────────────────────────────────
  "prioritization": {
    id: "prioritization",
    moduleId: "business-translation",
    title: "AI Feature Prioritization",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "Beyond RICE: AI-Specific Prioritization",
        content: `<p>Traditional RICE (Reach, Impact, Confidence, Effort) scoring works fine for deterministic features. You know what a button does before you ship it. AI features are different: they have probabilistic outcomes, ongoing operational costs, and failure modes that are fundamentally harder to predict. Using vanilla RICE for AI features is like using a ruler to measure wind speed. You need additional dimensions.</p>
<p>AI-RICE extends the standard framework with five additional factors that capture what makes AI features uniquely risky and expensive to operate. These are not theoretical concerns. Every PM who has shipped an AI feature and then watched the monthly inference bill or dealt with a hallucination incident will tell you these should have been on the prioritization scorecard from day one.</p>
<p>The goal is not to create analysis paralysis. It is to make the hidden costs visible so you can make informed trade-offs. A feature with high impact but extreme token costs might still be worth building, but you need to know the true cost before you commit.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "The Five AI-Specific Prioritization Dimensions",
        content: `<p>Add these five dimensions to your standard prioritization framework. Score each 1-5 where 5 is favorable (low risk, low cost, high readiness).</p>
<ul>
  <li><strong>Token cost per interaction:</strong> What does each AI call cost? A single GPT-4 call with a large context window can cost $0.10-0.50. Multiply by expected usage volume. A feature used 10,000 times/day at $0.20/call is $60,000/month in inference costs alone. Score 5 for under $0.01/call, score 1 for over $0.50/call.</li>
  <li><strong>Hallucination risk:</strong> How much does the model need to be factually accurate? A creative writing assistant can tolerate hallucination. A medical information tool cannot. Score 5 for low-stakes creative tasks, score 1 for high-stakes factual accuracy requirements.</li>
  <li><strong>Data availability:</strong> Do you have the training data, knowledge base, or examples needed? Score 5 for abundant, clean, labeled data. Score 1 for no existing data and expensive acquisition.</li>
  <li><strong>Model dependency:</strong> How tightly coupled is the feature to a specific model or provider? If the feature only works with one model's unique capability, you are locked in to that provider's pricing, availability, and deprecation decisions. Score 5 for provider-agnostic, score 1 for single-provider dependency on a niche capability.</li>
  <li><strong>Latency budget:</strong> How fast does the response need to be? Real-time autocomplete needs sub-second responses. A nightly batch report can take minutes. Lower latency requirements constrain your model choices and increase costs (smaller, faster models or caching required). Score 5 for batch/async, score 1 for real-time sub-second.</li>
</ul>`,
        expandable: true,
        diagram: {
          type: "comparison",
          data: {
            columns: [
              {
                title: "Traditional RICE",
                items: [
                  "Reach: how many users?",
                  "Impact: how much value per user?",
                  "Confidence: how sure are we?",
                  "Effort: how many person-weeks?"
                ],
                color: "#0239A8"
              },
              {
                title: "AI-RICE (Added Dimensions)",
                items: [
                  "Token Cost: $/interaction at volume",
                  "Hallucination Risk: factual accuracy stakes",
                  "Data Availability: training signal quality",
                  "Model Dependency: provider lock-in risk",
                  "Latency Budget: response time constraints"
                ],
                color: "#F42A72"
              }
            ]
          }
        }
      },
      {
        type: "callout",
        variant: "key-insight",
        title: "The Operational Cost Surprise",
        content: `<p>The #1 surprise for teams shipping their first AI feature is the ongoing operational cost. A deterministic feature costs near-zero to run once deployed. An AI feature has a per-call inference cost that scales linearly with usage. Success literally makes it more expensive. Model this before launch: best case usage x cost per call x 12 months. If that number makes your CFO uncomfortable, you need a caching strategy, a cheaper model, or a different approach.</p>`
      },
      {
        type: "concept",
        title: "The AI Readiness Checklist",
        content: `<p>Before a feature enters sprint planning, run it through this checklist. Any "no" is a blocker that needs resolution, not something to figure out later.</p>
<ul>
  <li><strong>Eval criteria defined?</strong> Can you write down, in specific terms, what a good output looks like and what a bad output looks like? Without this, you cannot measure quality and you will ship blind.</li>
  <li><strong>Data pipeline exists?</strong> Is the data the model needs already flowing through your systems, or do you need to build new integrations? Data pipeline work is consistently underestimated by 3-5x.</li>
  <li><strong>Failure mode documented?</strong> You have written down the three worst things that could happen when the model gets it wrong, and you have a mitigation for each one.</li>
  <li><strong>Latency budget realistic?</strong> You have tested the model at realistic prompt sizes and know the p50 and p95 latency. Your UX design accounts for these response times.</li>
  <li><strong>Cost model built?</strong> You have calculated the per-call cost, multiplied by expected volume, and gotten finance to sign off on the monthly budget.</li>
  <li><strong>Monitoring plan ready?</strong> You know how you will detect model quality degradation in production. Prompt drift, data drift, and model deprecation are real operational risks.</li>
  <li><strong>Rollback plan exists?</strong> If the AI feature starts producing bad outputs, you can disable it and fall back to a non-AI experience without a code deploy.</li>
</ul>`,
        expandable: true,
        diagram: null
      },
      {
        type: "concept",
        title: "Hype vs Reality: What Models Do Well and Where They Struggle",
        content: `<p>As of mid-2026, here is an honest assessment of where current models reliably deliver value versus where they still struggle. This is not pessimism; it is calibration. Building on strengths gets you to production. Building on weaknesses gets you stuck in perpetual prototype.</p>
<p><strong>Models do well at:</strong> Summarization of well-structured documents. Classification tasks with clear categories. First-draft content generation. Code completion and simple code generation. Extraction of structured fields from semi-structured text. Translation between languages. Conversational interfaces over well-curated knowledge bases (RAG).</p>
<p><strong>Models still struggle with:</strong> Precise numerical reasoning and arithmetic. Maintaining consistency across very long contexts (>50K tokens). Tasks requiring real-time data or current events beyond training cutoff. Multi-step planning with branching logic (agent reliability varies). Tasks requiring domain expertise where training data is sparse (rare medical conditions, niche engineering domains). Anything requiring guaranteed 100% accuracy, as all models have a nonzero error rate.</p>
<p>The practical implication: prioritize features that play to model strengths and design around weaknesses. A feature that requires a model to do long-form numerical analysis is fighting the architecture. A feature that summarizes meeting notes is working with it.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "callout",
        variant: "warning",
        title: "Model Capability Is a Moving Target",
        content: `<p>Any assessment of model capabilities has a shelf life of 6-12 months. What models struggle with today may be solved in the next generation. Build your prioritization on current capabilities but design your architecture to take advantage of improvements. Avoid hard-coding workarounds for model limitations that will become unnecessary. Use abstraction layers that let you swap models without rebuilding features.</p>`
      },
      {
        type: "concept",
        title: "Adaptive Routing: Not Every Query Needs the Big Model",
        content: `<p>A powerful cost optimization that belongs in your prioritization framework is adaptive routing. Not every user interaction needs the most capable (and most expensive) model. A query complexity classifier at the front of your pipeline can route simple requests to a smaller, faster, cheaper model and only invoke the large model for complex tasks.</p>
<p>In practice, 60-80% of user queries in most products are straightforward and can be handled by a smaller model at 1/10th the cost. The remaining 20-40% benefit from a larger model's capabilities. This tiered approach can reduce your inference budget by 50-70% without meaningful quality loss for the majority of interactions.</p>
<p>When prioritizing AI features, factor in whether adaptive routing is feasible. Features where all queries require the same model complexity are more expensive per unit than features where you can tier the model selection. This can shift the cost calculus enough to change a feature's priority rank.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "quiz",
        id: "pri-quiz-1",
        variant: "multiple-choice",
        question: "You are prioritizing two AI features. Feature A: AI-generated meeting summaries (batch, async, sent 30 min after meeting ends). Feature B: Real-time AI sales coaching (live suggestions during customer calls). Both have similar RICE scores. Which AI-specific dimension is most likely to differentiate them?",
        options: [
          { id: "a", text: "Data availability - one has more training data than the other" },
          { id: "b", text: "Hallucination risk - meeting summaries need to be more accurate" },
          { id: "c", text: "Latency budget - real-time coaching has much stricter response time requirements" },
          { id: "d", text: "Model dependency - one requires a specific provider's model" }
        ],
        correct: "c",
        explanation: "The biggest differentiator is latency budget. Meeting summaries are batch/async (can take 30+ seconds, run post-meeting), while real-time coaching needs sub-second responses during a live call. This constrains model choice, may require a smaller/faster model for coaching, impacts cost structure (streaming vs. batch), and significantly changes the architecture. Latency budget scores 5 for summaries and 1-2 for real-time coaching, likely making summaries the better first bet."
      },
      {
        type: "exercise",
        id: "pri-exercise-1",
        title: "AI Feature Prioritization",
        prompt: "You have four AI features on your backlog and budget for two this quarter. Score each using AI-RICE (standard RICE plus the five AI dimensions) and make a recommendation. Defend your ranking.",
        template: `## AI Feature Prioritization Exercise

### Feature Candidates
Score each 1-5 (5 = favorable/high/low risk).

| Dimension | Feature A: Smart Search | Feature B: Auto-Triage | Feature C: Content Generator | Feature D: Anomaly Detector |
|-----------|------------------------|----------------------|---------------------------|--------------------------|
| Reach | | | | |
| Impact | | | | |
| Confidence | | | | |
| Effort (inverse) | | | | |
| Token Cost | | | | |
| Hallucination Risk | | | | |
| Data Availability | | | | |
| Model Dependency | | | | |
| Latency Budget | | | | |
| **Total** | | | | |

### Feature Descriptions (fill in context from your product)
- **Smart Search:** AI-powered semantic search over internal docs
- **Auto-Triage:** Classify and route incoming requests automatically
- **Content Generator:** Draft responses / content from templates + context
- **Anomaly Detector:** Flag unusual patterns in operational data

### Recommendation
Which two features would you build this quarter? Why?

### What would change your ranking?
What new information or capability would cause you to reprioritize?`,
        hints: [
          "Auto-triage (classification) is one of the most mature AI patterns with well-understood eval metrics - this usually scores well on confidence and hallucination risk",
          "Content generation has high impact but be honest about hallucination risk if the content is customer-facing",
          "Smart search over internal docs is essentially a RAG problem - score data availability based on the state of your document corpus",
          "Consider which features could use adaptive routing (not all queries need the expensive model) and factor that into token cost scoring"
        ]
      },
      {
        type: "takeaway",
        points: [
          "Standard RICE is insufficient for AI features. Add five dimensions: token cost, hallucination risk, data availability, model dependency, and latency budget.",
          "Use the AI readiness checklist before sprint planning: eval criteria, data pipeline, failure modes, latency, cost model, monitoring, and rollback plan.",
          "Prioritize features that play to current model strengths (summarization, classification, extraction) over features that fight model weaknesses (precise math, guaranteed accuracy).",
          "Adaptive query routing can reduce inference costs by 50-70% by sending simple queries to cheaper models. Factor this into your cost calculations when prioritizing."
        ]
      }
    ],
    flashcards: [
      {
        front: "What five dimensions does AI-RICE add to traditional RICE scoring?",
        back: "1) Token cost per interaction, 2) Hallucination risk (factual accuracy stakes), 3) Data availability (quality and quantity of training signal), 4) Model dependency (provider lock-in risk), 5) Latency budget (response time constraints). Score each 1-5 where 5 is favorable."
      },
      {
        front: "Why is the operational cost of AI features fundamentally different from traditional features?",
        back: "Traditional features cost near-zero to run once deployed. AI features have a per-call inference cost that scales linearly with usage. Success literally makes the feature more expensive. You must model: cost per call x expected volume x 12 months, and get finance sign-off before launch."
      },
      {
        front: "What is adaptive query routing and how does it reduce AI costs?",
        back: "A complexity classifier at the front of the pipeline routes simple queries to a smaller, cheaper model (handling 60-80% of traffic) and only invokes the expensive large model for complex queries (20-40%). This can reduce inference costs by 50-70% without meaningful quality loss for simple interactions."
      },
      {
        front: "Name three items from the AI readiness checklist that teams most commonly skip.",
        back: "1) Cost model: teams launch without calculating per-call cost x volume = monthly spend. 2) Failure mode documentation: teams do not write down the three worst things that could happen when the model errs. 3) Monitoring plan: teams have no way to detect model quality degradation in production. Skipping any of these leads to preventable incidents."
      }
    ]
  },

  // ──────────────────────────────────────────────
  // TOPIC 4: Writing an AI-First PRD
  // ──────────────────────────────────────────────
  "ai-prd": {
    id: "ai-prd",
    moduleId: "business-translation",
    title: "Writing an AI-First PRD",
    estimatedMinutes: 30,
    sections: [
      {
        type: "concept",
        title: "Why Traditional PRDs Fall Short for AI Features",
        content: `<p>A traditional PRD assumes deterministic behavior: you define the input, describe the expected output, and engineering builds exactly that. The feature either works or it does not. AI features break this model because their behavior is probabilistic. The same input can produce different outputs. The feature might work 93% of the time and fail in ways that are hard to predict or reproduce.</p>
<p>This means your PRD needs sections that a traditional product document has never required: model requirements that specify acceptable accuracy ranges, data requirements that describe the training and inference pipeline, an evaluation framework that defines how you will measure quality continuously (not just at launch), guardrails that constrain what the model can and cannot do, explicit failure modes with mitigation strategies, and monitoring specifications for production quality tracking.</p>
<p>If you write a PRD for an AI feature using a traditional template, you are leaving the hardest and most important decisions to the engineering team to figure out implicitly. That is how you end up with a feature that works in demos but fails in production. The PRD is where these decisions get made explicitly, with input from PM, engineering, data science, and legal.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "AI-Specific PRD Sections",
        content: `<p>An AI-first PRD contains all the standard sections (problem statement, user stories, requirements, success metrics) plus six AI-specific sections. Each one addresses a category of risk or complexity that is unique to AI features.</p>
<ul>
  <li><strong>Model Requirements:</strong> Which model(s) will you use? What are the acceptable accuracy, latency, and cost ranges? What is your fallback if the primary model is unavailable or deprecated? Include specific benchmarks: "The model must achieve >90% precision and >85% recall on our test set of 500 labeled examples."</li>
  <li><strong>Data Requirements:</strong> What data does the model need for training, fine-tuning, or retrieval? Where does it come from? How is it labeled? What are the privacy and compliance constraints? How often does it need to be refreshed?</li>
  <li><strong>Evaluation Framework:</strong> How will you measure quality before launch, at launch, and continuously in production? Define specific metrics, acceptable thresholds, and the evaluation cadence. Include both automated evals and human review processes.</li>
  <li><strong>Guardrails:</strong> What should the model never do? What topics is it not allowed to discuss? What output formats are required? Guardrails are the constraints that prevent the worst failure modes.</li>
  <li><strong>Failure Modes:</strong> Document the top 5-10 ways the model can fail, rank them by severity, and specify the mitigation for each. Include both technical failures (hallucination, refusal to answer) and product failures (wrong tone, irrelevant response).</li>
  <li><strong>Monitoring:</strong> What metrics will you track in production? What are the alert thresholds? How do you detect model quality degradation? What is the escalation path when alerts fire?</li>
</ul>`,
        expandable: true,
        diagram: {
          type: "comparison",
          data: {
            columns: [
              {
                title: "Traditional PRD",
                items: [
                  "Problem statement & goals",
                  "User stories",
                  "Functional requirements",
                  "Non-functional requirements",
                  "Success metrics",
                  "Design specifications",
                  "Launch plan"
                ],
                color: "#0239A8"
              },
              {
                title: "AI-First PRD (Added Sections)",
                items: [
                  "Model requirements & benchmarks",
                  "Data requirements & pipeline",
                  "Evaluation framework & thresholds",
                  "Guardrails & output constraints",
                  "Failure modes & mitigations",
                  "Monitoring & alerting",
                  "Token cost model & caching strategy"
                ],
                color: "#F42A72"
              }
            ]
          }
        }
      },
      {
        type: "callout",
        variant: "key-insight",
        title: "The Eval Section Is the Most Important Part",
        content: `<p>If you write only one AI-specific section well, make it the evaluation framework. Without clear eval criteria, you cannot tell whether the feature is improving or degrading. Without quality gates, you will ship a model that passes the vibe check in a demo but fails silently on real user queries. Define what "good enough" means in numbers, not adjectives.</p>`
      },
      {
        type: "concept",
        title: "Data Requirements: The Section Everyone Underestimates",
        content: `<p>The data requirements section is where most AI PRDs are either too vague or missing entirely. "We will use customer data" is not a data requirement. Here is what this section actually needs to cover.</p>
<p><strong>Data quality:</strong> What format is the data in? How clean is it? What percentage has missing fields, inconsistencies, or errors? What preprocessing is needed? If you are building a RAG system, what is the state of the document corpus? Are documents up to date, well-structured, and deduplicated?</p>
<p><strong>Pipeline dependencies:</strong> Where does the data come from? How does it flow into the system? What other teams or services own the source data? What happens if the pipeline breaks? Specify SLAs for data freshness: "Policy documents must be indexed within 24 hours of updates."</p>
<p><strong>Labeling:</strong> If you need labeled data for training or evaluation, who creates the labels? What are the labeling guidelines? What is the inter-annotator agreement target? How much labeled data do you need and how long will it take to produce?</p>
<p><strong>Privacy and compliance:</strong> Does the data contain PII? Is it subject to GDPR, HIPAA, or other regulations? Can it be sent to a third-party API (if using an external model)? Does the data need to be anonymized or pseudonymized? Who has approved the data usage from a legal perspective?</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "concept",
        title: "Token Cost Modeling",
        content: `<p>Token cost modeling is a PM skill, not an engineering detail. If you cannot estimate the monthly inference cost of your feature, you are flying blind on a metric that directly hits the P&L.</p>
<p><strong>Cost per session:</strong> Calculate the average tokens per request (prompt + completion), multiply by the model's per-token price. A typical RAG query might use 2,000 input tokens (system prompt + retrieved context) and 500 output tokens. At GPT-4o pricing, that is roughly $0.01-0.03 per query. At Claude Opus pricing, it might be $0.05-0.10. Multiply by average queries per user session.</p>
<p><strong>Caching strategies:</strong> Prompt caching can reduce costs by 50-90% for repeated system prompts and context. If your system prompt is 1,500 tokens and every request uses it, caching that prefix across requests saves significant money at scale. Semantic caching goes further: if multiple users ask essentially the same question, cache the answer and serve it without an LLM call.</p>
<p><strong>Volume projections:</strong> Build three scenarios: conservative (current usage patterns), expected (moderate growth), and aggressive (viral adoption). Your CFO wants to know the worst-case monthly spend, not the best case. Include the cost of evaluation runs, which can be substantial if you are using LLM-as-judge for quality monitoring.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "callout",
        variant: "example",
        title: "Cost Model in Action",
        content: `<p>Feature: AI customer support assistant. Average query: 2,500 input tokens + 400 output tokens. Model: Claude Sonnet at ~$3/M input, $15/M output. Cost per query: ~$0.014. Volume: 50,000 queries/month. Monthly inference cost: ~$700. Add 20% for eval runs and retries: ~$840/month. Caching the 1,200-token system prompt reduces input cost by ~40%: final estimate ~$560/month. This is the number that goes in your PRD and your budget request.</p>`
      },
      {
        type: "concept",
        title: "Risk Sections: Model Dependency, Data Drift, and Regulatory",
        content: `<p>Your PRD needs a risk section that goes beyond generic "technical risk" bullet points. AI features have three specific risk categories that need explicit treatment.</p>
<p><strong>Model dependency risk:</strong> If you are using a third-party model, what happens when the provider deprecates it, changes pricing by 3x, or experiences an extended outage? Document your fallback model, the effort required to switch, and any feature degradation users would experience. The mitigation is to abstract the model layer and maintain compatibility with at least two providers.</p>
<p><strong>Data drift risk:</strong> The data your model was trained or evaluated on will diverge from production data over time. Customer language changes. Product terminology evolves. New topics emerge that your knowledge base does not cover. Without monitoring, quality degrades silently. The mitigation is continuous evaluation on a rolling sample of production queries, with alert thresholds for quality drops.</p>
<p><strong>Regulatory risk:</strong> AI regulation is evolving rapidly. The EU AI Act is in effect. Industry-specific regulations (healthcare, finance, education) add additional constraints. Document which regulations apply to your feature, what compliance requirements they impose (transparency, explainability, human oversight), and who on your legal team has reviewed and approved the approach.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "callout",
        variant: "warning",
        title: "The Model Deprecation Scenario",
        content: `<p>It has already happened to production teams: a model gets deprecated with 90 days notice, and the replacement model produces subtly different outputs that break downstream logic. Your PRD should specify: "If the primary model is deprecated, the team has a tested fallback model that achieves within 5% of the primary model's eval scores. Migration can be completed within 2 weeks." If you cannot write that sentence honestly, you have unmitigated model dependency risk.</p>`
      },
      {
        type: "quiz",
        id: "prd-quiz-1",
        variant: "multiple-choice",
        question: "A PM writes an AI PRD with detailed user stories, functional requirements, and a launch plan, but omits the evaluation framework section. What is the most likely consequence?",
        options: [
          { id: "a", text: "The feature will launch late because engineering does not know what to build" },
          { id: "b", text: "The feature will launch on time but the team will have no way to measure quality or detect degradation in production" },
          { id: "c", text: "The feature will not get approved because stakeholders expect an eval framework" },
          { id: "d", text: "There is no real consequence - eval can be added after launch" }
        ],
        correct: "b",
        explanation: "Without an evaluation framework, the team can still build the feature (user stories and requirements tell them what to build), and it will probably launch on schedule. But post-launch, there is no defined way to measure whether the model is performing well, no quality gates to catch degradation, and no alert thresholds. The model might be hallucinating on 15% of responses and nobody would know. Adding eval after launch means you have already shipped an unmeasured feature to users."
      },
      {
        type: "exercise",
        id: "prd-exercise-1",
        title: "Write an AI PRD Section",
        prompt: "Choose one AI-specific section (Model Requirements, Data Requirements, Evaluation Framework, Guardrails, Failure Modes, or Monitoring) and write it for a real or hypothetical AI feature. Make it specific enough that an engineer could implement from your spec.",
        template: `## AI PRD Section: [Choose: Model Requirements / Data Requirements / Evaluation Framework / Guardrails / Failure Modes / Monitoring]

### Feature: [Name and one-line description]

### [Your Chosen Section]

#### Overview
[2-3 sentences: what does this section cover and why is it critical for this feature?]

#### Specifications

[Write the detailed specifications here. Use the guidance below for your chosen section:]

**If Model Requirements:**
- Primary model: [name, version, provider]
- Fallback model: [name, version, provider]
- Accuracy targets: precision [  ]%, recall [  ]%, F1 [  ]%
- Latency targets: p50 [  ]ms, p95 [  ]ms
- Cost per call: $[  ] (input: [  ] tokens, output: [  ] tokens)
- Context window usage: [  ] tokens typical, [  ] tokens max

**If Data Requirements:**
- Data sources: [list each source, owner, format]
- Volume: [how much data, how often updated]
- Quality: [known issues, preprocessing needed]
- Labeling: [who labels, guidelines, agreement targets]
- Privacy: [PII present? regulations? anonymization needed?]
- Pipeline SLA: [data freshness requirement]

**If Evaluation Framework:**
- Pre-launch eval: [test set size, metrics, pass thresholds]
- Launch gate: [minimum scores required to ship]
- Production eval: [sample rate, frequency, metrics]
- Human review: [cadence, sample size, reviewer guidelines]
- Alert thresholds: [when do you page someone?]

**If Guardrails:**
- Topic restrictions: [what the model must never discuss]
- Output format constraints: [required structure, length limits]
- Tone and style: [brand voice, formality level]
- Confidence thresholds: [when to defer to human]
- PII handling: [what to redact, what to never generate]

**If Failure Modes:**
- Failure 1: [description, severity, likelihood, mitigation]
- Failure 2: [description, severity, likelihood, mitigation]
- Failure 3: [description, severity, likelihood, mitigation]
- Escalation path: [what happens when mitigation fails?]

**If Monitoring:**
- Key metrics: [list each metric and its alert threshold]
- Dashboard: [what does the monitoring dashboard show?]
- Alert routing: [who gets paged, response time SLA]
- Quality degradation detection: [how do you spot slow model drift?]
- Reporting cadence: [weekly/monthly quality reports to whom?]`,
        hints: [
          "The evaluation framework is the most impactful section to practice. Without it, you cannot tell whether the feature is working.",
          "Be specific with numbers. 'High accuracy' is not a spec. '>92% precision on our labeled test set of 300 examples' is a spec.",
          "For failure modes, think about both the technical failures (hallucination, timeout, refusal) and the product failures (wrong tone, irrelevant answer, violated user expectation).",
          "Monitoring should include both leading indicators (latency creeping up, context relevance scores dropping) and lagging indicators (user satisfaction, escalation rate)."
        ]
      },
      {
        type: "takeaway",
        points: [
          "Traditional PRDs assume deterministic behavior. AI features are probabilistic and need six additional sections: model requirements, data requirements, evaluation framework, guardrails, failure modes, and monitoring.",
          "The evaluation framework is the single most important AI-specific section. Without it, you ship an unmeasured feature and cannot detect quality degradation.",
          "Token cost modeling is a PM responsibility. Calculate cost per session, factor in caching savings, and build three volume scenarios (conservative, expected, aggressive).",
          "Document three AI-specific risks explicitly: model dependency (provider lock-in and deprecation), data drift (production data diverging from training data), and regulatory compliance (evolving AI regulations)."
        ]
      }
    ],
    flashcards: [
      {
        front: "What six sections does an AI-first PRD add beyond a traditional PRD?",
        back: "1) Model requirements and benchmarks, 2) Data requirements and pipeline specs, 3) Evaluation framework with quality gates, 4) Guardrails and output constraints, 5) Failure modes with severity rankings and mitigations, 6) Production monitoring and alerting specs."
      },
      {
        front: "How do you calculate the token cost of an AI feature for your PRD?",
        back: "Cost per query = (input tokens x input price) + (output tokens x output price). Then: monthly cost = cost per query x expected monthly volume. Build three scenarios (conservative, expected, aggressive). Factor in caching savings (50-90% reduction on repeated system prompts). Add 20% for eval runs and retries."
      },
      {
        front: "What are the three AI-specific risk categories that belong in every AI PRD?",
        back: "1) Model dependency: provider deprecation, pricing changes, outages. Mitigate with abstraction layers and tested fallback models. 2) Data drift: production data diverging from training/eval data over time. Mitigate with continuous evaluation on rolling production samples. 3) Regulatory: evolving AI laws (EU AI Act, industry-specific rules). Mitigate with legal review and compliance documentation."
      },
      {
        front: "What four elements make up a complete data requirements section in an AI PRD?",
        back: "1) Data quality: format, cleanliness, preprocessing needs. 2) Pipeline dependencies: source systems, data flow, freshness SLAs, failure handling. 3) Labeling: who creates labels, guidelines, inter-annotator agreement targets, volume needed. 4) Privacy and compliance: PII handling, regulatory constraints (GDPR, HIPAA), legal approval for data usage."
      }
    ]
  }

};
