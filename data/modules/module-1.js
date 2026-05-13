export default {
  "ai-ecosystem": {
    id: "ai-ecosystem",
    moduleId: "ai-foundations",
    title: "AI Ecosystem & Landscape",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "The AI Taxonomy: From Broad to Specific",
        content: `<p>As a PM, you need a mental model for how AI terms nest inside each other. Think of it as concentric circles. <strong>Artificial Intelligence</strong> is the broadest category — any system that performs tasks typically requiring human intelligence. That includes everything from a rules-based spam filter to a self-driving car.</p>
<p><strong>Machine Learning</strong> is a subset of AI where systems learn from data rather than being explicitly programmed. Instead of writing rules, you feed the system examples and it finds patterns. Most of the AI you ship as a PM today is ML under the hood.</p>
<p><strong>Deep Learning</strong> is a subset of ML that uses neural networks with many layers. It excels at unstructured data — images, text, audio — where hand-engineering features is impractical. The "deep" refers to the depth of the network, not the depth of understanding.</p>
<p><strong>Generative AI</strong> is a subset of DL focused on creating new content — text, images, code, audio. This is the ChatGPT and Claude layer. The key shift: instead of classifying or predicting, these models produce novel outputs.</p>
<p><strong>Agentic AI</strong> is the newest layer. These are GenAI systems that can autonomously plan, use tools, and take actions to achieve goals. They don't just answer questions — they execute multi-step workflows. As a PM, this is where the product design gets genuinely different from traditional software.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "The AI Product Stack",
        content: `<p>Every AI product you build or evaluate sits on a four-layer stack. Understanding these layers tells you where value accrues, where lock-in happens, and where your team needs to invest.</p>
<p><strong>Layer 1: Data Infrastructure.</strong> This is the foundation — your vector databases (Pinecone, Weaviate, Chroma), data pipelines (Airflow, dbt), and storage. Without clean, accessible data, nothing above works. Many PM teams underinvest here and pay for it later with hallucination problems and stale outputs.</p>
<p><strong>Layer 2: Model Layer.</strong> These are the foundation models themselves — Claude (Anthropic), GPT-4o/o3 (OpenAI), Gemini (Google), Llama (Meta), Mistral. As a PM, your key decision is build vs. buy at this layer. Almost nobody trains from scratch anymore. You're choosing between proprietary APIs and open-weight models you host yourself.</p>
<p><strong>Layer 3: Orchestration.</strong> This is where you wire models to tools, data, and each other. Frameworks like LangGraph, CrewAI, and vendor SDKs (Claude Agent SDK, OpenAI Agents SDK, Google ADK) live here. This layer handles prompt management, tool calling, memory, guardrails, and agent loops. For most PM teams, this is where your engineering effort concentrates.</p>
<p><strong>Layer 4: Application.</strong> The user-facing product. This could be a chatbot, a copilot embedded in your SaaS product, an autonomous agent, or a workflow automation. Low-code platforms like n8n, Make, and Zapier operate at this layer, letting you build AI-powered workflows without deep engineering investment.</p>`,
        expandable: false,
        diagram: {
          type: "stack",
          data: {
            layers: [
              {
                label: "Application Layer",
                items: ["Chatbots", "Copilots", "Autonomous Agents", "n8n / Make / Zapier"],
                color: "#4F46E5"
              },
              {
                label: "Orchestration Layer",
                items: ["Claude Agent SDK", "LangGraph", "CrewAI", "OpenAI Agents SDK", "Google ADK"],
                color: "#7C3AED"
              },
              {
                label: "Model Layer",
                items: ["Claude (Anthropic)", "GPT-4o / o3 (OpenAI)", "Gemini (Google)", "Llama (Meta)", "Mistral"],
                color: "#9333EA"
              },
              {
                label: "Data Infrastructure",
                items: ["Pinecone / Weaviate / Chroma", "Airflow / dbt", "PostgreSQL / S3", "Embedding Pipelines"],
                color: "#A855F7"
              }
            ]
          }
        }
      },
      {
        type: "callout",
        variant: "key-insight",
        title: "Where PM Value Concentrates",
        content: `<p>Most PMs spend too much time debating the model layer (Claude vs. GPT) and too little time on orchestration and data. The model is increasingly a commodity. Your competitive advantage lives in <strong>how you orchestrate</strong> (your agent architecture, tool integrations, guardrails) and <strong>what data you feed</strong> (proprietary datasets, user context, domain knowledge). When evaluating vendors, focus on the orchestration and data layers first.</p>`
      },
      {
        type: "concept",
        title: "The Current Vendor Landscape (Mid-2026)",
        content: `<p>The AI tooling landscape has consolidated around a few key categories. Here's what matters for PMs making build-vs-buy decisions right now.</p>
<p><strong>Vendor SDKs</strong> are the first-party tools from model providers. Anthropic's <strong>Claude Agent SDK</strong> gives you a Python/TypeScript framework for building agents that use Claude's extended thinking and tool use. OpenAI's <strong>Agents SDK</strong> (successor to the Assistants API) provides similar capabilities with their models. Google's <strong>Agent Development Kit (ADK)</strong> integrates with Gemini and Google Cloud services. These are your best bet when you want tight integration with a specific model provider and don't need to be model-agnostic.</p>
<p><strong>Open frameworks</strong> sit above vendor SDKs and give you more flexibility. <strong>LangGraph</strong> (from LangChain) lets you build stateful, multi-actor agent workflows as graphs — it's become the default choice for complex agent orchestration. <strong>CrewAI</strong> focuses on multi-agent collaboration with role-based agents. These frameworks let you swap models and build more complex architectures, but add a dependency layer.</p>
<p><strong>Low-code platforms</strong> have become surprisingly capable. <strong>n8n</strong> is the open-source standout — you can build AI workflows with tool calling, branching logic, and human-in-the-loop steps without writing code. <strong>Make</strong> and <strong>Zapier</strong> offer similar capabilities with more polished UIs but less flexibility. For PM teams prototyping AI features or building internal tools, low-code is often the fastest path to value.</p>
<p><strong>Frontend and prototyping tools</strong> like <strong>v0.dev</strong> (Vercel) let you generate React UIs from prompts. Combined with n8n for backend logic and a model API, you can prototype a complete AI product in hours rather than weeks. This is a game-changer for PM-led discovery and validation.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "quiz",
        id: "ai-eco-quiz-1",
        variant: "drag-match",
        question: "Match each AI paradigm to its defining characteristic:",
        pairs: [
          { left: "Machine Learning", right: "Learns patterns from data instead of following explicit rules" },
          { left: "Deep Learning", right: "Uses multi-layer neural networks for unstructured data" },
          { left: "Generative AI", right: "Creates new content like text, images, and code" },
          { left: "Agentic AI", right: "Autonomously plans and executes multi-step tasks with tools" }
        ],
        explanation: "Each paradigm builds on the previous one. ML learns from data. DL uses deep neural networks (a specific ML technique). GenAI uses DL to generate new content. Agentic AI uses GenAI models as a reasoning core but adds planning, tool use, and autonomous execution."
      },
      {
        type: "quiz",
        id: "ai-eco-quiz-2",
        variant: "multiple-choice",
        question: "A PM team is building an AI-powered customer support agent that needs to look up order status, process refunds, and escalate to humans. Which layer of the AI stack will require the MOST engineering investment?",
        options: [
          { id: "a", text: "Data Infrastructure — they need to build a new vector database" },
          { id: "b", text: "Model Layer — they need to fine-tune a foundation model" },
          { id: "c", text: "Orchestration — they need to wire up tool calling, guardrails, and escalation logic" },
          { id: "d", text: "Application — they need to build the chat UI" }
        ],
        correct: "c",
        explanation: "For most AI product teams, the orchestration layer absorbs the majority of engineering effort. The model is an API call, the data infrastructure likely already exists (order database, CRM), and the chat UI is increasingly commoditized. The hard part is building reliable tool calling (order lookup, refund processing), designing guardrails (preventing unauthorized refunds), and implementing the escalation logic. This is where agents succeed or fail."
      },
      {
        type: "exercise",
        id: "ai-eco-exercise-1",
        title: "Map Your Organization's AI Stack",
        prompt: "Think about an AI feature your organization has built or is planning to build. Map it to the four-layer stack. If you're not currently working on AI, pick a product you use daily (like GitHub Copilot, Notion AI, or a customer support chatbot) and reverse-engineer its stack.",
        template: `Product/Feature: ___

Data Infrastructure Layer:
- What data sources does it use?
- How is data stored and accessed?
- ___

Model Layer:
- Which foundation model(s)?
- API or self-hosted?
- ___

Orchestration Layer:
- How are prompts managed?
- What tools/APIs are connected?
- What guardrails exist?
- ___

Application Layer:
- What's the user-facing interface?
- How do users interact with the AI?
- ___

Biggest gap or risk in this stack:
___`,
        hints: [
          "If you can't identify the model, check the product's docs or pricing page — most now disclose which models they use.",
          "For orchestration, think about what happens between the user's input and the model's response. Is there RAG? Tool calling? Content filtering?",
          "The biggest risk is usually at the layer the team has spent the least time on. Data quality issues are the most common silent killer."
        ]
      },
      {
        type: "takeaway",
        points: [
          "AI terms nest: AI > ML > DL > GenAI > Agentic AI. Each is a subset of the one above. As a PM, precision with these terms builds credibility with engineering.",
          "The four-layer AI product stack (Data, Model, Orchestration, Application) tells you where to invest. Most teams over-index on the model layer and under-index on data and orchestration.",
          "The vendor landscape has consolidated: vendor SDKs for tight model integration, open frameworks (LangGraph) for complex orchestration, low-code (n8n) for rapid prototyping.",
          "Your competitive moat as a PM is rarely the model — it's your data and how you orchestrate it. Focus your roadmap accordingly."
        ]
      }
    ],
    flashcards: [
      {
        front: "What are the five nested layers of the AI taxonomy, from broadest to most specific?",
        back: "AI > Machine Learning > Deep Learning > Generative AI > Agentic AI. Each is a subset of the one above. Agentic AI adds autonomous planning, tool use, and multi-step execution on top of GenAI's content generation capabilities."
      },
      {
        front: "What are the four layers of the AI product stack?",
        back: "1) Data Infrastructure (vector DBs, pipelines, storage), 2) Model Layer (foundation models — Claude, GPT, Gemini), 3) Orchestration (agent frameworks, tool calling, guardrails), 4) Application (user-facing product). Most engineering effort concentrates at the orchestration layer."
      },
      {
        front: "Name three categories of AI development tools and give an example of each.",
        back: "1) Vendor SDKs — Claude Agent SDK, OpenAI Agents SDK, Google ADK (tight model integration). 2) Open Frameworks — LangGraph, CrewAI (model-agnostic orchestration). 3) Low-code platforms — n8n, Make, Zapier (rapid prototyping without code)."
      },
      {
        front: "Where does competitive advantage typically live in the AI product stack?",
        back: "In the data and orchestration layers, not the model layer. The model is increasingly a commodity (you can swap Claude for GPT). Your moat is proprietary data, domain-specific context, and how you orchestrate tools, guardrails, and workflows around the model."
      }
    ]
  },

  "ml-concepts": {
    id: "ml-concepts",
    moduleId: "ai-foundations",
    title: "Neural Networks & Learning Paradigms",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "How Neural Networks Learn",
        content: `<p>You don't need to understand the math to be an effective AI PM, but you do need the mental model. A neural network is a function that takes inputs (text, pixels, numbers) and produces outputs (classifications, predictions, generated text). Between input and output are layers of <strong>neurons</strong>, each holding a numerical <strong>weight</strong>.</p>
<p>Here's how learning works in three steps. <strong>Step 1: Forward pass.</strong> Data flows through the network from input to output. Each neuron multiplies its input by its weight, adds a bias, and passes the result through an activation function. The network produces a prediction. <strong>Step 2: Loss calculation.</strong> The prediction is compared to the correct answer. The difference is the "loss" — a number representing how wrong the network was. <strong>Step 3: Backpropagation.</strong> The network works backwards, adjusting each weight slightly to reduce the loss. This is done using calculus (gradient descent), but conceptually it's just: "this weight contributed to the error, so nudge it in the other direction."</p>
<p>This cycle repeats millions of times across the training data. Each pass through the full dataset is called an <strong>epoch</strong>. Over many epochs, the weights converge to values that make the network's predictions accurate. The key insight for PMs: this is why training data quality matters so much. The network can only learn patterns that exist in the data. Garbage in, garbage out is literally how neural networks work.</p>
<p>Modern large language models like Claude have billions of parameters (weights) trained on massive text corpora. The training process is the same conceptually — forward pass, loss, backpropagation — just at an enormous scale. Fine-tuning takes a pre-trained model and runs additional training on your specific data, adjusting the weights further for your domain.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "callout",
        variant: "tip",
        title: "The PM's Neural Network Intuition",
        content: `<p>When your engineers say a model is "overfitting," it means the network has memorized the training data instead of learning generalizable patterns — like a student who memorizes test answers but can't solve new problems. When they say it's "underfitting," the model hasn't learned enough — it's too simple for the complexity of the task. Your job as a PM is to ensure the training data is representative of real-world usage, which directly prevents both problems.</p>`
      },
      {
        type: "concept",
        title: "When Traditional ML Beats Deep Learning",
        content: `<p>Deep learning gets the hype, but traditional ML algorithms (random forests, gradient boosting, logistic regression) are often the better choice. Knowing when to use each is a genuine PM skill that earns trust with data science teams.</p>
<p><strong>Use traditional ML when:</strong></p>
<ul>
<li><strong>Your data is structured and tabular.</strong> Customer churn prediction from CRM data, fraud detection from transaction records, demand forecasting from sales history. XGBoost and random forests routinely outperform deep learning on tabular data, and they train in minutes, not days.</li>
<li><strong>Your dataset is small.</strong> If you have fewer than 10,000 labeled examples, deep learning will likely overfit. Traditional ML algorithms are more data-efficient. A logistic regression model can perform well with a few hundred examples.</li>
<li><strong>Interpretability matters.</strong> If regulators, compliance, or users need to understand why a decision was made (loan approvals, medical diagnoses), traditional ML gives you feature importance scores and decision paths. Deep learning models are largely black boxes.</li>
<li><strong>Latency and cost are constraints.</strong> A random forest model runs in microseconds on a single CPU. A deep learning model might need a GPU and take seconds. For high-throughput, low-latency applications, simpler models win on operational cost.</li>
</ul>
<p><strong>Use deep learning when:</strong> your data is unstructured (text, images, audio, video), you have massive datasets, and the task requires understanding complex patterns. If you're building a feature on top of a foundation model (which is already deep learning), you're already in DL territory by default.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "concept",
        title: "Learning Paradigms: Supervised, Unsupervised, Reinforcement",
        content: `<p>Every ML system learns through one of three paradigms. As a PM, the paradigm determines your data requirements, your labeling costs, and your evaluation strategy.</p>
<p><strong>Supervised Learning</strong> is the workhorse. You give the model labeled examples: "This email is spam. This one isn't. This image is a cat. This one is a dog." The model learns the mapping from inputs to labels. Most production ML systems are supervised — recommendation engines, content classifiers, fraud detectors, search ranking. The PM challenge: you need labeled data, and labeling is expensive. A common mistake is underestimating labeling costs in your roadmap.</p>
<p><strong>Unsupervised Learning</strong> finds structure in unlabeled data. Clustering algorithms group similar customers together. Dimensionality reduction compresses high-dimensional data for visualization. Anomaly detection flags outliers. You don't tell the model what to look for — it discovers patterns on its own. The PM challenge: evaluating quality is harder because there's no "correct answer" to compare against. You need domain expertise to judge whether the clusters or patterns are meaningful.</p>
<p><strong>Reinforcement Learning (RL)</strong> learns by trial and error. An agent takes actions in an environment, receives rewards or penalties, and optimizes its strategy over time. This is how AlphaGo learned to play Go and how RLHF (Reinforcement Learning from Human Feedback) is used to align language models like Claude. The PM relevance: agentic AI borrows heavily from RL concepts. Your AI agent tries actions, observes results, and adapts its approach — even if the underlying model was trained with supervised learning, the agent loop is RL-inspired.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "Where Agents Fit: Goal-Directed Behavior",
        content: `<p>Agentic AI draws on RL concepts even when the underlying model is a supervised-learning LLM. The connection is the <strong>agent loop</strong>: perceive the environment, decide on an action, execute, observe the result, repeat. This is fundamentally the same structure as an RL agent, just with a language model as the "brain" instead of a trained policy network.</p>
<p>In practice, modern AI agents use LLMs for reasoning and planning, but the execution pattern is RL-inspired. The agent has a <strong>goal</strong> (resolve this customer ticket, write this report, deploy this code change). It <strong>observes</strong> its environment (reads documents, checks APIs, looks at tool outputs). It <strong>plans</strong> a sequence of actions. It <strong>acts</strong> (calls tools, writes text, makes API requests). It <strong>evaluates</strong> the result and adjusts. This loop continues until the goal is met or the agent decides to escalate.</p>
<p>The PM implication is significant: you're no longer designing a request-response product. You're designing a goal-directed system with a feedback loop. This changes how you think about success metrics (task completion rate, not just response quality), error handling (what happens when the agent gets stuck in a loop?), and user trust (how much autonomy do users grant the agent?).</p>`,
        expandable: true,
        diagram: {
          type: "comparison",
          data: {
            columns: [
              {
                title: "Traditional ML",
                items: [
                  "Single prediction per input",
                  "Trained on labeled datasets",
                  "No tool use or environment interaction",
                  "Evaluation: accuracy, precision, recall",
                  "Example: spam classifier"
                ],
                color: "#0891B2"
              },
              {
                title: "Deep Learning / GenAI",
                items: [
                  "Generates complex outputs (text, images)",
                  "Trained on massive unstructured data",
                  "No autonomous actions",
                  "Evaluation: quality, coherence, safety",
                  "Example: Claude answering a question"
                ],
                color: "#7C3AED"
              },
              {
                title: "Agentic AI",
                items: [
                  "Multi-step autonomous execution",
                  "Uses LLM + tools + memory",
                  "Interacts with environment (APIs, files, web)",
                  "Evaluation: task completion, reliability, cost",
                  "Example: AI agent resolving support tickets"
                ],
                color: "#DC2626"
              }
            ]
          }
        }
      },
      {
        type: "quiz",
        id: "ml-concepts-quiz-1",
        variant: "multiple-choice",
        question: "A fintech company wants to predict which loan applications will default. They have 50,000 historical applications with outcomes (defaulted / didn't default), all in structured tabular format. What's the best approach?",
        options: [
          { id: "a", text: "Fine-tune a large language model on the loan data" },
          { id: "b", text: "Use a gradient-boosted decision tree (like XGBoost)" },
          { id: "c", text: "Build an agentic AI system that reviews each application" },
          { id: "d", text: "Use unsupervised clustering to group risky applicants" }
        ],
        correct: "b",
        explanation: "Tabular, structured data with 50K labeled examples is the sweet spot for traditional ML. Gradient-boosted trees (XGBoost, LightGBM) consistently outperform deep learning on structured data, train faster, and provide feature importance for regulatory interpretability. Fine-tuning an LLM on tabular data would be slower, more expensive, and less accurate. An agentic system is over-engineered for a single prediction task. Unsupervised learning wouldn't use the labels you already have."
      },
      {
        type: "exercise",
        id: "ml-concepts-exercise-1",
        title: "Learning Type Audit",
        prompt: "Pick three AI-powered features from products you use daily. For each, identify the learning paradigm (supervised, unsupervised, or RL) and justify your classification. Think about what data the system was trained on, whether there are labels, and how the system improves over time.",
        template: `Feature 1: ___
Product: ___
Learning paradigm: [Supervised / Unsupervised / RL]
Reasoning: ___
What training data it likely uses: ___

Feature 2: ___
Product: ___
Learning paradigm: [Supervised / Unsupervised / RL]
Reasoning: ___
What training data it likely uses: ___

Feature 3: ___
Product: ___
Learning paradigm: [Supervised / Unsupervised / RL]
Reasoning: ___
What training data it likely uses: ___

Pattern I noticed across these features:
___`,
        hints: [
          "Netflix recommendations use supervised learning (predicting ratings from user-item interaction data) combined with unsupervised techniques (clustering similar users).",
          "Google Search ranking uses a combination of supervised learning on click-through data and RL-like signals from user satisfaction metrics.",
          "Think about whether the system needs labeled examples (supervised), finds patterns in unlabeled data (unsupervised), or optimizes through trial-and-error (RL)."
        ]
      },
      {
        type: "takeaway",
        points: [
          "Neural networks learn through forward pass, loss calculation, and backpropagation — the same conceptual loop from a 10-neuron network to a billion-parameter LLM. Data quality directly determines model quality.",
          "Traditional ML (XGBoost, random forests) beats deep learning on structured tabular data, small datasets, and tasks requiring interpretability. Don't default to deep learning for everything.",
          "Three learning paradigms: Supervised (labeled data, most production ML), Unsupervised (find structure in unlabeled data), Reinforcement Learning (learn by trial and error with rewards).",
          "Agentic AI uses an RL-inspired loop — perceive, plan, act, observe — even though the core model may be a supervised-learning LLM. This changes your product design from request-response to goal-directed."
        ]
      }
    ],
    flashcards: [
      {
        front: "What are the three steps in how a neural network learns?",
        back: "1) Forward pass — data flows through the network to produce a prediction. 2) Loss calculation — the prediction is compared to the correct answer to measure error. 3) Backpropagation — weights are adjusted backwards through the network to reduce the error. This cycle repeats millions of times during training."
      },
      {
        front: "When should a PM advocate for traditional ML over deep learning?",
        back: "When the data is structured/tabular, the dataset is small (under ~10K examples), interpretability is required (regulatory, compliance), or latency and cost are tight constraints. Gradient-boosted trees (XGBoost) consistently outperform DL on tabular data."
      },
      {
        front: "What are the three ML learning paradigms and their data requirements?",
        back: "Supervised: needs labeled examples (expensive to create but easy to evaluate). Unsupervised: works on unlabeled data (cheaper but harder to evaluate quality). Reinforcement Learning: needs an environment with reward signals (used in RLHF for aligning LLMs and conceptually in agent loops)."
      },
      {
        front: "How does agentic AI relate to reinforcement learning?",
        back: "Agentic AI uses an RL-inspired loop: perceive environment, plan actions, execute, observe results, repeat. Even though the core model (an LLM) was trained with supervised learning, the agent's runtime behavior follows the RL pattern of goal-directed interaction with an environment."
      }
    ]
  },

  "prompt-engineering": {
    id: "prompt-engineering",
    moduleId: "ai-foundations",
    title: "Prompt Engineering for PMs",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "Core Prompting Techniques",
        content: `<p>Prompt engineering isn't about tricks — it's about clear communication with a statistical reasoning engine. The better your instructions, the better the output. Here are the four techniques every PM should have in their toolkit.</p>
<p><strong>Zero-shot prompting</strong> is the simplest: you ask the model to do something with no examples. "Classify this support ticket as billing, technical, or account." This works well for tasks the model has seen extensively in training. If zero-shot gives you 80%+ accuracy, don't over-engineer it.</p>
<p><strong>Few-shot prompting</strong> adds examples to your prompt. "Here are three support tickets and their correct categories. Now classify this one." The examples calibrate the model's understanding of your specific task. As a rule of thumb, 3-5 examples is usually sufficient. More examples improve consistency but use more tokens (and cost more money).</p>
<p><strong>Role-playing</strong> sets a persona for the model. "You are a senior product analyst at a B2B SaaS company" produces different output than a generic prompt because it activates relevant knowledge patterns and adjusts tone, depth, and assumptions. Role prompts are especially useful when you need domain-specific language or a particular level of technical depth.</p>
<p><strong>Chain-of-thought (CoT)</strong> asks the model to reason step by step before answering. Adding "Think through this step by step" or "Show your reasoning" dramatically improves performance on complex tasks — multi-step math, logical reasoning, strategic analysis. The model literally produces better answers when it "thinks out loud." For PM work, CoT is essential for competitive analysis, prioritization frameworks, and any task requiring structured reasoning.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "The RCFCE Framework",
        content: `<p>When you need consistently high-quality outputs, use the RCFCE framework. It's a checklist for prompt construction that covers the five dimensions that matter most.</p>
<p><strong>Role:</strong> Who should the model be? "You are a product manager with 10 years of experience in fintech" is more useful than "You are helpful." The role sets the lens through which the model approaches the problem. Be specific about domain, seniority level, and perspective.</p>
<p><strong>Context:</strong> What background does the model need? Include the situation, constraints, and any relevant data. "We're a Series B startup with 50K users, growing 15% month-over-month, considering adding an AI-powered feature to our onboarding flow." The model can't read your mind — context you omit is context it invents.</p>
<p><strong>Format:</strong> What should the output look like? "Respond as a bullet-point list," "Write a one-page memo with headers," "Create a table with columns for feature, effort, and impact." Format instructions eliminate the most common source of prompt iteration: getting the right content in the wrong structure.</p>
<p><strong>Constraints:</strong> What are the boundaries? "Maximum 500 words," "Don't suggest solutions requiring more than 2 engineering sprints," "Focus only on the mobile experience," "Use only publicly available data." Constraints prevent scope creep and keep outputs actionable. They're especially important for preventing hallucination — "Only reference features that exist in our current product" is a useful guardrail.</p>
<p><strong>Examples:</strong> What does good output look like? Even one example of the expected output calibrates the model more than paragraphs of instructions. This is the few-shot technique applied within the framework. If you have a previous deliverable that represents the quality and format you want, include it or an excerpt.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "callout",
        variant: "example",
        title: "RCFCE in Action",
        content: `<p><strong>Weak prompt:</strong> "Write a PRD for a new feature."</p>
<p><strong>Strong prompt using RCFCE:</strong> "You are a senior PM at a B2B SaaS company [Role]. We're adding an AI-powered meeting summarizer to our project management tool. Our users are engineering managers who run 5+ meetings daily. We use a freemium model [Context]. Write a 1-page PRD with sections: Problem, Solution, Success Metrics, MVP Scope, and Risks [Format]. Focus only on the MVP — no post-launch features. Limit to features achievable in one 2-week sprint [Constraints]. Here's an example of our PRD format: [paste example] [Examples]."</p>`
      },
      {
        type: "concept",
        title: "Prompt Chaining for PM Workflows",
        content: `<p>Single prompts hit a ceiling. For complex PM tasks, you chain multiple prompts together — the output of one becomes the input of the next. This is how you build reliable AI-assisted workflows.</p>
<p><strong>Why chain?</strong> Each prompt in a chain has a focused, achievable task. A single prompt that says "Analyze our competitors, identify opportunities, write a strategy memo, and create a presentation" will produce mediocre output. But four chained prompts — each handling one step, with the previous output as context — produce dramatically better results. Each link in the chain can be evaluated and refined independently.</p>
<p><strong>Common PM prompt chains:</strong></p>
<ul>
<li><strong>Research → Synthesize → Recommend:</strong> Prompt 1 gathers and structures raw data. Prompt 2 identifies patterns and insights. Prompt 3 generates actionable recommendations with the synthesis as context.</li>
<li><strong>Draft → Critique → Revise:</strong> Prompt 1 generates a first draft (PRD, email, strategy doc). Prompt 2 critiques it from a specific perspective (engineering feasibility, user impact, executive readability). Prompt 3 revises based on the critique.</li>
<li><strong>Decompose → Execute → Integrate:</strong> Prompt 1 breaks a large task into subtasks. Each subtask is executed independently. A final prompt integrates the results.</li>
</ul>
<p><strong>Building chains in practice:</strong> You can chain manually (copy-paste between prompts) or automate with tools like n8n, LangGraph, or a simple script. For PM prototyping, n8n is often the fastest path — you can build a multi-step AI workflow with a visual interface, add human-in-the-loop approvals, and connect to real data sources (Slack, Jira, Google Sheets) without writing code.</p>`,
        expandable: false,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "n1", label: "User Input\n(PM task)", type: "start" },
              { id: "n2", label: "Prompt 1:\nResearch &\nGather Data", type: "process" },
              { id: "n3", label: "Prompt 2:\nSynthesize &\nAnalyze", type: "process" },
              { id: "n4", label: "Quality\nCheck", type: "decision" },
              { id: "n5", label: "Prompt 3:\nGenerate\nDeliverable", type: "process" },
              { id: "n6", label: "Human\nReview", type: "decision" },
              { id: "n7", label: "Final\nOutput", type: "end" }
            ],
            edges: [
              ["n1", "n2"],
              ["n2", "n3"],
              ["n3", "n4"],
              ["n4", "n5"],
              ["n4", "n2"],
              ["n5", "n6"],
              ["n6", "n7"],
              ["n6", "n5"]
            ]
          }
        }
      },
      {
        type: "concept",
        title: "Building an AI PM Co-Pilot with n8n and v0.dev",
        content: `<p>Here's a practical architecture for building your own AI PM co-pilot — a system that helps you with daily PM tasks like writing updates, triaging feedback, and drafting specs. No heavy engineering required.</p>
<p><strong>Frontend with v0.dev:</strong> Use Vercel's v0.dev to generate a React-based UI. Prompt it to create a simple dashboard with a text input, preset task buttons (e.g., "Write status update," "Triage this feedback," "Draft user story"), and an output panel. v0.dev generates deployable code that you can host on Vercel for free. You now have a custom interface tailored to your workflow, built in minutes.</p>
<p><strong>Backend with n8n:</strong> Set up an n8n workflow that receives requests from your frontend via webhook. The workflow includes: an AI node connected to Claude or GPT (your model call with your RCFCE-structured prompts), integration nodes that pull context from your tools (Jira tickets, Slack messages, Google Docs), and output nodes that send results back to your frontend or directly to Slack/Notion.</p>
<p><strong>Prompt chaining in n8n:</strong> Each n8n workflow step can be a separate prompt in your chain. Step 1 pulls raw context from Jira. Step 2 sends that context to the LLM with a synthesis prompt. Step 3 sends the synthesis to another LLM call with a formatting prompt. Step 4 posts the result to Slack. Each step is visible, debuggable, and independently tweakable. This is prompt chaining made visual and maintainable.</p>
<p><strong>Why this matters for PMs:</strong> You can prototype AI features for your team without filing engineering tickets. You can validate AI-assisted workflows with real users before committing to a production build. And you develop firsthand intuition for how AI products work — which makes you a better PM when you're speccing the real thing.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "quiz",
        id: "prompt-eng-quiz-1",
        variant: "drag-match",
        question: "Match each prompt to its technique:",
        pairs: [
          { left: "\"Classify this ticket as billing, tech, or account.\"", right: "Zero-shot" },
          { left: "\"Here are 3 classified tickets. Now classify this one.\"", right: "Few-shot" },
          { left: "\"You are a senior PM at a fintech startup.\"", right: "Role-playing" },
          { left: "\"Think through this step by step before answering.\"", right: "Chain-of-thought" }
        ],
        explanation: "Zero-shot gives no examples — just the task. Few-shot provides examples to calibrate the model. Role-playing sets a persona that shapes the model's knowledge activation and tone. Chain-of-thought asks the model to reason explicitly before producing its answer, which improves accuracy on complex tasks."
      },
      {
        type: "exercise",
        id: "prompt-eng-exercise-1",
        title: "Write 3 Prompts Using RCFCE",
        prompt: "Write three prompts for real PM tasks you do weekly. Use the RCFCE framework for each. Start with a task you currently do manually, then write the prompt that would let an LLM assist you.",
        template: `Prompt 1 — Task: ___
Role: ___
Context: ___
Format: ___
Constraints: ___
Examples: ___
Full prompt:
"""
___
"""

Prompt 2 — Task: ___
Role: ___
Context: ___
Format: ___
Constraints: ___
Examples: ___
Full prompt:
"""
___
"""

Prompt 3 — Task: ___
Role: ___
Context: ___
Format: ___
Constraints: ___
Examples: ___
Full prompt:
"""
___
"""

Which RCFCE component had the biggest impact on output quality?
___`,
        hints: [
          "Good PM tasks for LLM assistance: writing weekly status updates, converting user feedback into user stories, drafting stakeholder emails, summarizing meeting notes into action items.",
          "The 'Constraints' component is often the most impactful. Try adding 'Maximum 200 words' or 'Only include items from this sprint' to see how constraints focus the output.",
          "For the 'Examples' component, paste a real output from a previous week. Even one example dramatically improves consistency."
        ]
      },
      {
        type: "takeaway",
        points: [
          "Four core techniques: zero-shot (just ask), few-shot (show examples), role-playing (set persona), chain-of-thought (think step by step). Match the technique to the task complexity.",
          "RCFCE framework: Role, Context, Format, Constraints, Examples. Using all five components consistently produces dramatically better outputs than ad-hoc prompting.",
          "Prompt chaining breaks complex tasks into focused steps. The output of each prompt feeds into the next. This is how you build reliable AI workflows, not with one massive prompt.",
          "n8n + v0.dev lets PMs prototype AI workflows without engineering support. Build the co-pilot, validate the workflow, then spec the production version with real data."
        ]
      }
    ],
    flashcards: [
      {
        front: "What are the four core prompting techniques and when do you use each?",
        back: "Zero-shot: simple tasks the model handles well without examples. Few-shot: tasks needing calibration via 3-5 examples. Role-playing: tasks needing domain-specific tone or depth. Chain-of-thought: complex reasoning tasks where step-by-step thinking improves accuracy."
      },
      {
        front: "What does RCFCE stand for and why does it matter?",
        back: "Role, Context, Format, Constraints, Examples. It's a prompt construction checklist. Role sets the persona. Context provides background. Format specifies output structure. Constraints set boundaries (length, scope). Examples calibrate quality. Using all five eliminates most prompt iteration."
      },
      {
        front: "What is prompt chaining and what are three common PM chain patterns?",
        back: "Prompt chaining passes the output of one prompt as input to the next. Three patterns: 1) Research > Synthesize > Recommend. 2) Draft > Critique > Revise. 3) Decompose > Execute > Integrate. Each step is focused, evaluable, and independently tunable."
      },
      {
        front: "How can a PM build an AI co-pilot without engineering support?",
        back: "Use v0.dev to generate a React frontend (dashboard with task buttons and output panel). Use n8n for the backend (webhook receiver, LLM calls with RCFCE prompts, integrations with Jira/Slack/Docs). Deploy the frontend on Vercel. Each n8n step is a link in your prompt chain, visual and debuggable."
      }
    ]
  },

  "agentic-ai-history": {
    id: "agentic-ai-history",
    moduleId: "ai-foundations",
    title: "History & Architecture of Agentic AI",
    estimatedMinutes: 25,
    sections: [
      {
        type: "concept",
        title: "From Rules to Agents: The Timeline",
        content: `<p>Agentic AI didn't appear out of nowhere. It's the culmination of decades of AI research, accelerated by a few key breakthroughs. Understanding this history helps you evaluate which ideas are genuinely new and which are repackaged old concepts.</p>
<p><strong>The rules era (1950s-1990s):</strong> Early AI was expert systems — hand-coded rules like "IF patient has fever AND cough THEN suggest flu test." These were brittle, expensive to maintain, and couldn't handle ambiguity. But they established the idea of automated decision-making, and they're still embedded in many production systems today (your spam filter's rules, your CI/CD pipeline's logic).</p>
<p><strong>The ML era (2000s-2016):</strong> Machine learning shifted from hand-coded rules to learned patterns. Systems like Google's PageRank, Netflix's recommendation engine, and fraud detection models learned from data. The limitation: each model did one task. You needed a separate model for each capability, and models couldn't reason about novel situations.</p>
<p><strong>The deep learning/GenAI era (2017-2023):</strong> The 2017 Transformers paper ("Attention Is All You Need") unlocked modern GenAI. GPT-3 (2020) demonstrated that large language models could generalize across tasks. ChatGPT (November 2022) brought GenAI to mainstream users. Claude, Gemini, and others followed. The key shift: one model could handle thousands of different tasks through natural language instructions.</p>
<p><strong>The agentic era (2024-present):</strong> The jump from GenAI to Agentic AI happened rapidly. In 2024, models gained reliable tool use (function calling) and extended context windows. By early 2025, Claude's Agent SDK, OpenAI's Agents SDK, and Google's ADK provided production-ready frameworks. The Model Context Protocol (MCP) standardized how agents connect to external tools. By mid-2026, agents are shipping in production products — handling customer support, writing and deploying code, managing workflows autonomously.</p>`,
        expandable: false,
        diagram: {
          type: "timeline",
          data: {
            events: [
              { year: "1956", label: "Dartmouth Conference coins 'AI'" },
              { year: "1980s", label: "Expert systems era — hand-coded rules" },
              { year: "1997", label: "Deep Blue beats Kasparov at chess" },
              { year: "2012", label: "AlexNet — deep learning revolution begins" },
              { year: "2017", label: "\"Attention Is All You Need\" — Transformers paper" },
              { year: "2020", label: "GPT-3 — large language models go mainstream" },
              { year: "2022", label: "ChatGPT launch — GenAI reaches 100M users" },
              { year: "2023", label: "GPT-4 and Claude 2 — multimodal, tool use emerges" },
              { year: "2024", label: "Reliable function calling, MCP protocol, agent frameworks" },
              { year: "2025", label: "Claude Agent SDK, OpenAI Agents SDK, Google ADK launch" },
              { year: "2026", label: "Production agents shipping — support, coding, workflows" }
            ]
          }
        }
      },
      {
        type: "concept",
        title: "Key Differences: ML vs. GenAI vs. Agentic AI",
        content: `<p>These three paradigms are often conflated in product discussions. As a PM, being precise about the differences helps you scope features correctly, set realistic expectations with stakeholders, and choose the right architecture.</p>
<p><strong>Traditional ML/AI</strong> takes structured inputs and produces structured outputs. A classification model takes feature vectors and outputs categories. A regression model takes historical data and outputs predictions. The system does one task, does it well, and has clear performance metrics. You evaluate with precision, recall, and F1 scores. The user rarely interacts with the model directly — it's embedded in the product logic.</p>
<p><strong>Generative AI</strong> takes natural language inputs and produces natural language (or image, audio, code) outputs. It's a general-purpose reasoning engine. You evaluate with human judgment, safety benchmarks, and task-specific rubrics. The user interacts with the model through prompts. The key PM challenge: outputs are non-deterministic. The same input can produce different outputs each time, which complicates testing and quality assurance.</p>
<p><strong>Agentic AI</strong> takes goals and produces completed tasks. It combines an LLM for reasoning with tools for action. It maintains state across multiple steps. It can recover from errors, try alternative approaches, and decide when to ask for help. You evaluate with task completion rate, cost per task, time to completion, and error recovery rate. The key PM challenge: you're designing for autonomy. How much should the agent do before checking in with the user? What's the blast radius of a mistake? These are product design questions, not engineering questions.</p>`,
        expandable: false,
        diagram: {
          type: "comparison",
          data: {
            columns: [
              {
                title: "Traditional ML/AI",
                items: [
                  "Structured input → structured output",
                  "Single-task, deterministic",
                  "Metrics: precision, recall, F1",
                  "User doesn't interact directly",
                  "Example: fraud detection model"
                ],
                color: "#0891B2"
              },
              {
                title: "Generative AI",
                items: [
                  "Natural language → generated content",
                  "Multi-task, non-deterministic",
                  "Metrics: quality rubrics, safety scores",
                  "User interacts via prompts",
                  "Example: Claude answering questions"
                ],
                color: "#7C3AED"
              },
              {
                title: "Agentic AI",
                items: [
                  "Goal → completed task",
                  "Multi-step, autonomous, stateful",
                  "Metrics: completion rate, cost, reliability",
                  "User delegates then reviews",
                  "Example: agent resolving support tickets"
                ],
                color: "#DC2626"
              }
            ]
          }
        }
      },
      {
        type: "callout",
        variant: "warning",
        title: "The Autonomy-Trust Tradeoff",
        content: `<p>The biggest PM challenge with agentic AI isn't technical — it's trust calibration. More autonomy means faster execution but higher risk. Less autonomy means more human oversight but slower workflows. You need to design for progressive trust: start with the agent suggesting actions (human approves), graduate to the agent acting with human review (human can undo), and eventually reach full autonomy for low-risk tasks. Get the trust ladder wrong and users either won't adopt (too many approval prompts) or will lose trust after a bad outcome (too much autonomy too soon).</p>`
      },
      {
        type: "concept",
        title: "Agent Architecture: The ReAct Pattern",
        content: `<p>Most production agents follow the <strong>ReAct pattern</strong> (Reasoning + Acting). Understanding this architecture is essential for PMs because it determines what your agent can and can't do, how it fails, and how you debug it.</p>
<p>The ReAct loop has five stages that repeat:</p>
<ul>
<li><strong>Perception:</strong> The agent observes its environment — reads user input, checks tool outputs, reviews previous conversation history. The quality of perception is limited by the model's context window (how much information it can hold at once) and the tools available for gathering information.</li>
<li><strong>Reasoning:</strong> The agent thinks about what to do next. In Claude, this is the "extended thinking" feature — the model explicitly works through its logic before deciding on an action. This is where chain-of-thought happens at the system level. Better reasoning models produce more reliable agents.</li>
<li><strong>Planning:</strong> The agent decides on a sequence of actions. "I need to first check the customer's order status, then look up return policies, then draft a response." Planning quality depends on the model's ability to decompose complex tasks and anticipate dependencies between steps.</li>
<li><strong>Action:</strong> The agent executes — calls an API, writes a file, sends a message, queries a database. Actions are mediated through <strong>tools</strong> that the agent has been given access to. The tool definition (name, description, parameters) is how the agent knows what actions are possible.</li>
<li><strong>Observation:</strong> The agent processes the result of its action. Did the API return the expected data? Was there an error? Does the result change the plan? This feedback loop is what makes agents adaptive — they don't just execute a fixed script, they adjust based on outcomes.</li>
</ul>
<p>When agents fail, it's usually at one of these stages: bad perception (missing context), flawed reasoning (wrong conclusion from good data), poor planning (wrong order of operations), failed action (tool error), or misinterpreted observation (the agent didn't understand the tool's response). Diagnosing which stage failed is the key to debugging agent behavior.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "Building Agents: The Modern Stack",
        content: `<p>Here's how a production agent is actually built in mid-2026. This is the architecture your engineering team is likely evaluating or already implementing.</p>
<p><strong>Frontend:</strong> The user interface where humans interact with the agent. This could be a chat UI (most common), a dashboard with task cards showing agent progress, or an embedded copilot in your existing product. The frontend needs to handle streaming responses (showing the agent's work as it happens), progress indicators for multi-step tasks, and intervention points where the user can redirect or stop the agent. Frameworks like Next.js with Vercel AI SDK or v0.dev handle the streaming and UI patterns well.</p>
<p><strong>Backend orchestration:</strong> This is the brain of the system. <strong>LangGraph</strong> has emerged as the leading orchestration framework. It models agent workflows as directed graphs: each node is a step (LLM call, tool invocation, human approval), and edges define the flow between steps. This gives you conditional branching (if the tool returns an error, try a different approach), parallel execution (run multiple tool calls simultaneously), and persistent state (remember what happened in previous steps). For simpler agents, vendor SDKs like Claude's Agent SDK give you a clean abstraction — you define tools, give the agent a goal, and the SDK handles the ReAct loop.</p>
<p><strong>Tool integration via MCP:</strong> The <strong>Model Context Protocol (MCP)</strong> is an open standard that defines how agents connect to external tools and data sources. Instead of writing custom integrations for each tool, you connect to MCP servers that expose capabilities in a standardized format. There are MCP servers for databases, file systems, APIs, browsers, and more. As a PM, MCP matters because it dramatically reduces integration cost — adding a new capability to your agent might be as simple as connecting another MCP server.</p>
<p><strong>Memory and state:</strong> Agents need to remember things across interactions. Short-term memory is the conversation context window. Long-term memory is typically a vector database (Pinecone, Weaviate) or structured storage where the agent can save and retrieve information about users, past tasks, and learned preferences. Memory architecture directly affects agent quality — an agent that remembers your preferences produces better results over time.</p>`,
        expandable: true,
        diagram: null
      },
      {
        type: "quiz",
        id: "agentic-history-quiz-1",
        variant: "multiple-choice",
        question: "An AI agent is trying to help a user resolve a billing issue. It checks the order database, finds the charge, but then applies a refund to the wrong order. Which stage of the ReAct pattern most likely failed?",
        options: [
          { id: "a", text: "Perception — the agent couldn't see the correct order data" },
          { id: "b", text: "Reasoning — the agent drew wrong conclusions from the data" },
          { id: "c", text: "Planning — the agent executed steps in the wrong order" },
          { id: "d", text: "Observation — the agent misinterpreted the refund tool's response" }
        ],
        correct: "b",
        explanation: "The agent successfully perceived the data (it found the charge) and its planning was logical (check order, then apply refund). The failure was in reasoning — it looked at the correct data but identified the wrong order for the refund. This is a reasoning error: the model drew an incorrect conclusion from the available information. In practice, this kind of error is reduced by adding verification steps (\"confirm the order ID with the user before processing\") and by improving the model's context (showing order details clearly in the tool output)."
      },
      {
        type: "exercise",
        id: "agentic-history-exercise-1",
        title: "Agent Architecture Sketch",
        prompt: "Design an agent architecture for a specific use case. Pick a task your team handles today that involves multiple steps, multiple tools, and some judgment. Sketch the ReAct loop, define the tools, and identify where human oversight is needed.",
        template: `Use Case: ___
User Goal: ___

Agent Architecture:

Perception — What information does the agent need?
- Data source 1: ___
- Data source 2: ___
- Data source 3: ___

Reasoning — What decisions does the agent make?
- Decision 1: ___
- Decision 2: ___

Planning — What's the typical step sequence?
1. ___
2. ___
3. ___
4. ___

Tools Required:
- Tool 1: ___ (what it does: ___)
- Tool 2: ___ (what it does: ___)
- Tool 3: ___ (what it does: ___)

Human Oversight Points:
- Before step ___: User confirms ___
- After step ___: User reviews ___

Failure Modes:
- If ___ fails: agent should ___
- If ___ is ambiguous: agent should ___

Success Metrics:
- Task completion rate target: ___%
- Average time to completion: ___
- Cost per task target: $___`,
        hints: [
          "Good use cases for agents: customer support ticket resolution, onboarding new team members, writing and publishing release notes, triaging and routing bug reports.",
          "For human oversight points, think about the blast radius. High-cost or hard-to-reverse actions (sending emails, processing refunds, deploying code) need human approval. Low-cost, reversible actions (drafting text, searching databases) can be autonomous.",
          "Failure modes are the most important part of agent design. The agent will fail — your job is to make failures graceful. 'Ask the user for clarification' is almost always better than 'guess and proceed.'"
        ]
      },
      {
        type: "takeaway",
        points: [
          "AI evolved through four eras: rules (expert systems), ML (learned patterns), GenAI (general-purpose generation), and Agentic AI (autonomous goal-directed behavior). Each era built on the previous one.",
          "ML does one task with structured data. GenAI generates content from prompts. Agentic AI completes multi-step tasks autonomously using tools. As a PM, the paradigm determines your product design, evaluation metrics, and trust model.",
          "The ReAct pattern (Perception, Reasoning, Planning, Action, Observation) is the architecture behind most production agents. When debugging agent failures, identify which stage broke.",
          "The modern agent stack: frontend for user interaction, LangGraph or vendor SDKs for orchestration, MCP for tool integration, vector databases for memory. MCP is the key enabler — it standardizes how agents connect to tools."
        ]
      }
    ],
    flashcards: [
      {
        front: "What are the four eras of AI development and what defined each?",
        back: "1) Rules era (1950s-1990s): hand-coded expert systems. 2) ML era (2000s-2016): systems learned from data, one task per model. 3) GenAI era (2017-2023): Transformers enabled general-purpose content generation. 4) Agentic era (2024-present): LLMs gained tool use and autonomy for multi-step task execution."
      },
      {
        front: "What are the five stages of the ReAct pattern?",
        back: "1) Perception — observe environment and gather inputs. 2) Reasoning — analyze information and draw conclusions. 3) Planning — decide on a sequence of actions. 4) Action — execute via tools (APIs, databases, files). 5) Observation — process results and adjust plan. The loop repeats until the goal is met."
      },
      {
        front: "What is MCP and why does it matter for agent-based products?",
        back: "Model Context Protocol (MCP) is an open standard that defines how agents connect to external tools and data sources. Instead of custom integrations for each tool, agents connect to standardized MCP servers. It dramatically reduces integration cost — adding new agent capabilities becomes plug-and-play rather than custom engineering."
      },
      {
        front: "What is the autonomy-trust tradeoff and how should PMs handle it?",
        back: "More agent autonomy means faster execution but higher risk of errors. PMs should design for progressive trust: 1) Agent suggests, human approves. 2) Agent acts, human can review and undo. 3) Full autonomy for low-risk tasks. Get this wrong and users either won't adopt (too many prompts) or lose trust (too much autonomy too early)."
      }
    ]
  }
};
