export default {
  "first-agent-n8n": {
    id: "first-agent-n8n",
    moduleId: "hands-on-labs",
    title: "Build Your First Agent in n8n",
    estimatedMinutes: 35,
    sections: [
      {
        type: "concept",
        title: "What n8n Is (and Isn't)",
        content: `<p>n8n is an open-source workflow automation tool that has become a serious AI agent builder. Instead of writing code, you drag-and-drop <strong>nodes</strong> representing operations — API calls, data transforms, AI calls, Slack messages — and connect them with arrows. It's visual programming for workflows.</p>
<p><strong>What n8n IS:</strong> the fastest path to a functional AI workflow. You can build a working agent that triages customer feedback, routes to Slack channels, and follows up — in under an hour, with no deployment setup.</p>
<p><strong>What n8n ISN'T:</strong> a production architecture for high-scale systems. It shines for internal tools, prototypes, and workflows handling under 10,000 events per day. For millions of events or complex state management, graduate to LangGraph or a custom backend.</p>
<p><strong>PM use case:</strong> validate AI workflow assumptions before filing engineering tickets. If you can't make it work in n8n, the problem is usually in the logic, not the implementation.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "Anatomy of an n8n AI Workflow",
        content: `<p>Every n8n AI agent is built from five types of nodes, stacked in sequence.</p>
<p><strong>Trigger nodes</strong> start the workflow — a webhook (HTTP request from your app), a scheduled cron, an email, or a manual trigger for testing.</p>
<p><strong>AI nodes</strong> are the reasoning brain. You provide a system prompt, connect your Claude or OpenAI credentials, and set temperature. The AI node receives the trigger's data as input and decides what to do with it.</p>
<p><strong>Tool nodes</strong> extend the agent's capabilities — query a database, search the web, look up a Jira ticket, check an order status. The AI node decides when to invoke them and how to use their results.</p>
<p><strong>Memory nodes</strong> give the agent context across messages. Without memory, each interaction starts fresh. With it, the agent remembers conversation history and user preferences.</p>
<p><strong>Output nodes</strong> deliver results — Slack message, email, database write, HTTP response back to your frontend.</p>`,
        expandable: false,
        diagram: {
          type: "stack",
          data: {
            layers: [
              {
                label: "Output Nodes — deliver results",
                items: ["Slack Message", "HTTP Response", "Email", "Database Write"],
                color: "#F97316"
              },
              {
                label: "Memory Nodes — maintain context",
                items: ["Chat Memory", "Buffer Memory", "Pinecone Memory"],
                color: "#EA580C"
              },
              {
                label: "Tool Nodes — take actions",
                items: ["HTTP Request", "SQL Query", "Google Sheets", "Custom Code"],
                color: "#C2410C"
              },
              {
                label: "AI Node — reasoning brain",
                items: ["Claude", "GPT-4o", "Llama", "Gemini"],
                color: "#9A3412"
              },
              {
                label: "Trigger Nodes — workflow entry",
                items: ["Webhook", "Schedule", "Email Trigger", "Manual"],
                color: "#7C2D12"
              }
            ]
          }
        }
      },
      {
        type: "quiz",
        id: "n8n-quiz-1",
        variant: "multiple-choice",
        question: "In an n8n AI workflow, which node type maintains conversation context across multiple messages so the agent can remember what was discussed earlier?",
        options: [
          { id: "a", text: "Trigger node — it stores the initial request data for the entire session" },
          { id: "b", text: "AI node — it automatically remembers all previous interactions" },
          { id: "c", text: "Memory node — it persists and retrieves conversation history" },
          { id: "d", text: "Output node — it logs all responses for later retrieval" }
        ],
        correct: "c",
        explanation: "Memory nodes explicitly persist and retrieve conversation history. Without a memory node, each n8n execution is stateless — the AI node sees only the current trigger's data, with no awareness of prior interactions. Memory nodes connect to buffers or vector databases to store and retrieve conversation context, enabling multi-turn conversational agents."
      },
      {
        type: "concept",
        title: "Your First Agent: Customer Triage",
        content: `<p>Here's a four-step walkthrough for building a customer triage agent in n8n.</p>
<p><strong>Step 1:</strong> Add a <strong>Webhook trigger</strong> node. Copy the generated webhook URL — you'll POST test requests here.</p>
<p><strong>Step 2:</strong> Add a <strong>Claude AI node</strong>. Connect it to the webhook output. Set the system prompt: <em>"You are a customer support triage agent. Classify the incoming message as BILLING, TECHNICAL, ACCOUNT, or GENERAL. Respond with JSON: {category, priority: HIGH/MEDIUM/LOW, summary}."</em> Set temperature to 0 for consistent classification.</p>
<p><strong>Step 3:</strong> Add a <strong>Switch node</strong> that routes based on the AI output. Connect BILLING to a Slack message to #billing-team, TECHNICAL to #engineering, and so on.</p>
<p><strong>Step 4:</strong> Test by sending a POST request to your webhook URL with a sample customer message. Watch the execution log — each node shows its exact input and output.</p>
<p>That's a working AI triage agent in four steps. No deployment infrastructure required.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "quiz",
        id: "n8n-quiz-2",
        variant: "multiple-choice",
        question: "Your n8n triage agent returns the same JSON category for every customer message, regardless of content. The AI node is connected and the workflow executes. What's the most likely cause?",
        options: [
          { id: "a", text: "Temperature is set to 0, forcing the model to always output the same thing" },
          { id: "b", text: "The webhook URL is incorrect, so real customer messages never reach the AI node" },
          { id: "c", text: "The AI node isn't receiving the webhook's message body — it only sees the system prompt" },
          { id: "d", text: "The Slack output node is overriding the AI node's classification" }
        ],
        correct: "c",
        explanation: "Temperature 0 makes outputs deterministic for a given input, but different inputs should still produce different outputs. If the agent ignores the content entirely, the most likely cause is that the customer message isn't flowing into the AI node's context — the webhook body isn't mapped to the AI node's input. Check the data flow: the AI node needs the message explicitly passed as user input, not just left as the ambient trigger data. In n8n, this is done by referencing the webhook output in the AI node's user message field."
      },
      {
        type: "callout",
        variant: "warning",
        title: "Setup & Common Errors",
        content: `<p><strong>Credential errors:</strong> The AI node shows "invalid API key." Fix: go to Credentials in n8n, add your Anthropic or OpenAI key, then reconnect it to the AI node.</p>
<p><strong>Webhook URL not working locally:</strong> n8n generates a localhost URL that external services can't reach. Use the n8n cloud version (free tier) or expose your local instance with ngrok.</p>
<p><strong>JSON parse errors:</strong> The AI node returns text with extra characters around the JSON. Fix: add a Code node after the AI call to parse and clean the output before routing.</p>
<p><strong>No execution triggered:</strong> Make sure the workflow is <strong>Active</strong> (toggle in the top-right). Inactive workflows don't respond to webhooks.</p>`
      },
      {
        type: "exercise",
        id: "n8n-exercise-1",
        title: "Build a Personal PM Triage Agent",
        prompt: "Pick a real PM pain point that involves routing or classifying information — meeting notes → action items, Slack feedback → themes, bug reports → priority levels. Build it in n8n using the triage pattern. Use the template below to plan before you build.",
        template: `My PM Pain Point:
___

What gets classified/routed:
___

Categories I need (3-5 max):
1. ___
2. ___
3. ___

n8n Workflow Design:
Trigger type: [Webhook / Schedule / Email]
System prompt I'll use:
"""
___
"""
Temperature: ___ (hint: use 0 for classification)

Routing: After the AI node, route category ___ to: ___
         Route category ___ to: ___

Test input I'll use:
___

What actually happened when I tested it:
___

What I'd change to improve it:
___`,
        hints: [
          "Start with 3 categories maximum. Too many categories makes the classification less reliable — the model has more 'wrong' options.",
          "For your system prompt, be explicit about the output format. 'Respond ONLY with valid JSON, no other text: {category: \"...\", priority: \"...\"}' is better than asking for 'JSON format'.",
          "If the workflow isn't triggering, check: (1) Is the workflow set to Active? (2) Are you POSTing to the correct webhook URL? (3) Is the Content-Type header set to application/json?"
        ]
      },
      {
        type: "takeaway",
        points: [
          "n8n is a visual workflow tool for building AI agents quickly. It's the right tool for prototypes, internal tools, and workflows under ~10K events/day — not for high-scale production systems.",
          "Every n8n AI workflow has five node types: Trigger (entry), AI Node (reasoning), Tool Nodes (actions), Memory Nodes (context), and Output Nodes (delivery).",
          "A customer triage agent takes four steps: webhook trigger → Claude AI node with classification prompt → Switch node for routing → output nodes (Slack, email). Temperature 0 gives consistent classification.",
          "Common errors: credential setup, webhook URL accessibility (use n8n cloud or ngrok locally), JSON parsing, and forgetting to activate the workflow."
        ]
      }
    ],
    flashcards: [
      {
        front: "What is a trigger node in n8n and what are three common trigger types?",
        back: "A trigger node starts a workflow when something happens. Common types: 1) Webhook — triggered by an incoming HTTP request from an external app. 2) Schedule — runs at set intervals (cron-like). 3) Email Trigger — fires when an email arrives in a connected inbox. Without a trigger, a workflow only runs manually."
      },
      {
        front: "When should you use n8n vs. building a custom backend?",
        back: "Use n8n for: prototypes, internal tools, workflows under ~10K events/day, validating AI workflow logic before filing engineering tickets. Graduate to custom backend (LangGraph, FastAPI) when: you need high throughput, complex state management, or granular control over retry logic, observability, and scaling."
      },
      {
        front: "What is a webhook and how does it work in an n8n AI workflow?",
        back: "A webhook is an HTTP endpoint that triggers a workflow when your app sends a POST request to it. In n8n: your app sends customer data to the webhook URL → n8n receives it → the AI node processes it → the workflow routes and delivers results. The webhook URL is generated by n8n and must be kept active."
      },
      {
        front: "What does a credential node do in n8n?",
        back: "Credential nodes securely store API keys and authentication tokens (Anthropic, OpenAI, Slack, etc.) so you don't embed secrets directly in your workflows. Once a credential is saved, any node of that type can reference it. This lets you rotate keys in one place and share workflows without exposing secrets."
      }
    ]
  },

  "prototype-v0-claude": {
    id: "prototype-v0-claude",
    moduleId: "hands-on-labs",
    title: "Prototype with v0.dev + Claude Code",
    estimatedMinutes: 35,
    sections: [
      {
        type: "concept",
        title: "v0.dev — AI-Native UI Generation",
        content: `<p>v0.dev (by Vercel) is a prompt-to-UI tool that generates React components from natural language. You describe what you want — "a dashboard with a text input, three preset buttons, and a results panel" — and v0.dev generates the code, previews it live, and lets you iterate in plain English.</p>
<p>The output is real React/Next.js code deployable directly to Vercel. You're not building a mock — you're building a working product you can put in front of real users within minutes.</p>
<p><strong>PM use case:</strong> go from "I want to test whether users prefer a chat UI or a form" to a deployed, shareable prototype in under 20 minutes. No engineering ticket, no sprint planning.</p>
<p><strong>Key limitation:</strong> v0.dev handles the frontend only. It generates static components with no backend AI logic. To make it actually intelligent, you need to wire in model calls — which is where Claude Code comes in.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "Claude Code — AI-Powered Development",
        content: `<p>Claude Code (claude.ai/code) is Anthropic's AI coding tool that goes far beyond autocomplete. It reads your entire codebase, plans multi-file changes, runs terminal commands, and executes complex edits across your project.</p>
<p>For PMs building prototypes, the most useful capabilities are:</p>
<ul>
<li><strong>File editing:</strong> "Add a call to the Anthropic API in this component, use claude-haiku-4-5, stream the response to the output panel."</li>
<li><strong>Bash commands:</strong> runs tests, starts servers, checks for errors automatically.</li>
<li><strong>Slash commands:</strong> <code>/add</code> to include files in context, <code>/review</code> for code feedback.</li>
</ul>
<p>You've generated a UI in v0.dev. Now you need actual AI behavior. Claude Code can write the API call, response parsing, error handling, and loading states in minutes — you describe what you want and it handles the implementation. You don't need to know the Anthropic SDK.</p>
<p>This is fundamentally different from GitHub Copilot (which autocompletes as you type). Claude Code understands and modifies your entire project.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "The PM Prototyping Stack",
        content: `<p>Three tools, one hour, a working AI product.</p>
<p><strong>v0.dev (UI layer):</strong> Prompt it, iterate in the live preview, export the code. You get a polished React interface without writing a line of frontend code.</p>
<p><strong>Claude Code (logic layer):</strong> Open the v0.dev project, describe the AI behavior you need, let Claude Code write the API call, parsing, and error handling.</p>
<p><strong>Vercel (deploy layer):</strong> Push the code and Vercel builds and deploys automatically. You get a public URL to share with stakeholders or users within seconds.</p>
<p><strong>Why demos beat slides:</strong> a working prototype at a stakeholder meeting changes the conversation. Instead of "I think users will like it," you show actual interaction. Objections shift from "will it work?" to "what should we improve?" — which is a much better conversation to be having.</p>`,
        expandable: false,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "n1", label: "Your Idea\n(plain English)", type: "start" },
              { id: "n2", label: "v0.dev\nGenerate UI", type: "process" },
              { id: "n3", label: "Claude Code\nAdd AI Logic", type: "process" },
              { id: "n4", label: "Vercel\nDeploy", type: "process" },
              { id: "n5", label: "Shareable\nDemo URL", type: "end" }
            ],
            edges: [
              ["n1", "n2"],
              ["n2", "n3"],
              ["n3", "n4"],
              ["n4", "n5"]
            ]
          }
        }
      },
      {
        type: "quiz",
        id: "prototype-quiz-1",
        variant: "drag-match",
        question: "Match each tool in the PM prototyping stack to its role:",
        pairs: [
          { left: "v0.dev", right: "Generates a React UI from a natural language prompt" },
          { left: "Claude Code", right: "Adds AI logic and Anthropic API calls to existing code" },
          { left: "Vercel", right: "Deploys and hosts the prototype with a shareable public URL" }
        ],
        explanation: "Each tool handles a distinct layer: v0.dev creates the visual interface, Claude Code wires in the AI behavior, and Vercel makes it accessible to anyone with a link. Together they get you from idea to deployed demo in under an hour — no engineering sprint required."
      },
      {
        type: "concept",
        title: "Hands-On: Build a PRD Generator",
        content: `<p>Let's build a concrete prototype: a PRD section generator. Input: product context + problem statement. Output: a structured Problem section with user persona, pain points, and success metrics.</p>
<p><strong>Step 1 — Generate UI with v0.dev:</strong> Prompt: "Build a clean web form with three inputs (Product name, Target user, Core problem) and a large output panel. Add a 'Generate PRD Section' button."</p>
<p><strong>Step 2 — Add AI logic with Claude Code:</strong> Open the project. Say: "When the button is clicked, POST the form inputs to the Anthropic API using claude-haiku-4-5. System prompt: 'You are a senior PM. Write a PRD Problem section for [product] targeting [user] where the core problem is [problem]. Include: problem statement, user persona, 3 pain points, 3 success metrics.' Stream the response to the output panel."</p>
<p><strong>Step 3 — Deploy:</strong> Push to Vercel. Share the URL. You now have a functional AI tool your team can actually use today.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "quiz",
        id: "prototype-quiz-2",
        variant: "multiple-choice",
        question: "You have a stakeholder meeting in 3 days and need to demo an AI-powered meeting summarizer. What's the fastest path to a working demo with real AI functionality?",
        options: [
          { id: "a", text: "File an engineering ticket and push for it to be prioritized in the current sprint" },
          { id: "b", text: "Use v0.dev to generate the UI, Claude Code to add the Anthropic API call, and deploy to Vercel" },
          { id: "c", text: "Create a high-fidelity Figma prototype with simulated AI responses" },
          { id: "d", text: "Schedule a demo of a competitor's product that does something similar" }
        ],
        correct: "b",
        explanation: "v0.dev + Claude Code + Vercel gets you from idea to deployed, interactive demo in under an hour — with real AI functionality, not simulated responses. Figma (c) is faster to create but can't actually run AI; stakeholders can tell the difference. Engineering tickets (a) take days to weeks. A competitor demo (d) proves market demand but not your specific solution. The ability to ship a working demo independently is one of the most valuable skills an AI PM can develop."
      },
      {
        type: "exercise",
        id: "prototype-exercise-1",
        title: "Build Your Demo-Ready Prototype",
        prompt: "Pick any AI product idea relevant to your work — a feature you've been wanting to test, a workflow you want to automate, or a tool your team needs. Build it using the v0.dev + Claude Code + Vercel stack. The goal is a real, deployed URL you can share.",
        template: `My AI product idea:
___

Target user:
___

Core job to be done (what problem does it solve?):
___

v0.dev prompt I used:
"""
___
"""

AI behavior I added with Claude Code:
- Model: [claude-haiku-4-5 / claude-sonnet-4-6 / other]
- System prompt I used:
"""
___
"""
- How I handle the response: ___

Deployed URL:
___

Three things I learned from testing it with real inputs:
1. ___
2. ___
3. ___

What I'd add in version 2:
___`,
        hints: [
          "Start with the simplest possible version. One input, one AI call, one output. You can add complexity after the basic flow works.",
          "For the system prompt, be specific about output format. If you want bullet points, say 'Format your response as a bulleted list.' If you want JSON, specify the exact schema.",
          "When prompting v0.dev, include the visual style you want. 'Clean and minimal, white background, Inter font' produces very different results than leaving it to default."
        ]
      },
      {
        type: "takeaway",
        points: [
          "v0.dev generates deployable React UIs from natural language prompts. The output is real code, not mockups — you can put it in front of real users immediately.",
          "Claude Code understands your entire codebase and can add AI logic (API calls, streaming, error handling) from a plain English description. No SDK knowledge required.",
          "The PM prototyping stack — v0.dev (UI) + Claude Code (AI logic) + Vercel (deploy) — gets you from idea to shared demo in under an hour. Working demos change stakeholder conversations.",
          "Build the simplest version first: one input, one AI call, one output. Validate the core hypothesis before adding complexity."
        ]
      }
    ],
    flashcards: [
      {
        front: "What is v0.dev's primary use case for PMs?",
        back: "v0.dev generates deployable React components from natural language prompts. PMs use it to create working UI prototypes — forms, dashboards, chat interfaces — in minutes without writing frontend code. The output is real React/Next.js code that deploys directly to Vercel, not a static mockup."
      },
      {
        front: "How is Claude Code different from GitHub Copilot?",
        back: "GitHub Copilot autocompletes code as you type, one line at a time, within a single file. Claude Code understands your entire codebase, plans multi-file changes, executes bash commands, and modifies your project based on plain English instructions. It's a project-level collaborator, not a line-level autocomplete."
      },
      {
        front: "What is Vercel and why is it in the PM prototyping stack?",
        back: "Vercel is a hosting platform that automatically builds and deploys web apps when you push code. For PMs, it means: push your code → get a public URL in ~60 seconds. No infrastructure setup, no DevOps ticket. The free tier is sufficient for prototypes and demos."
      },
      {
        front: "What is the prototyping vs. production mindset difference?",
        back: "Prototyping mindset: ship the simplest thing that validates the hypothesis. One input, one AI call, one output. Acceptable to hard-code values, skip error handling, use expensive models. Production mindset: reliability, cost efficiency, scalability, security, monitoring. Never ship a prototype as production — rebuild it properly once you've validated the concept."
      }
    ]
  },

  "connect-your-stack": {
    id: "connect-your-stack",
    moduleId: "hands-on-labs",
    title: "Connect Your Agent to Your Prototype",
    estimatedMinutes: 30,
    sections: [
      {
        type: "concept",
        title: "How Webhooks Work",
        content: `<p>A webhook is an HTTP request automatically sent from one system to another when something happens. It's a push notification for servers.</p>
<p><strong>Real-world analogy:</strong> Uber's surge pricing. When driver supply drops in your area, the driver app immediately pushes a signal to the pricing engine, which adjusts prices and updates your rider app — no polling, no waiting. The driver app "webhooks" the pricing engine the moment supply changes.</p>
<p>In your AI prototype stack, the same pattern applies:</p>
<ol>
<li>User submits a form in your v0.dev frontend.</li>
<li>Frontend sends an HTTP POST request to your n8n webhook URL with the user's input as JSON.</li>
<li>n8n receives it, kicks off the AI workflow.</li>
<li>n8n sends the AI-generated response back as the HTTP response.</li>
<li>Frontend displays the result.</li>
</ol>
<p>The data travels as JSON: <code>{"message": "user input"}</code> goes in, <code>{"response": "AI output"}</code> comes back.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "quiz",
        id: "connect-quiz-1",
        variant: "multiple-choice",
        question: "Which of the following best describes how a webhook works?",
        options: [
          { id: "a", text: "Your app checks a remote server for updates every few seconds (polling)" },
          { id: "b", text: "An HTTP request automatically sent from one system to another when an event occurs" },
          { id: "c", text: "A JavaScript event listener that fires when a user submits a form" },
          { id: "d", text: "An n8n node that connects to external APIs on a schedule" }
        ],
        correct: "b",
        explanation: "A webhook is event-driven — the sending system pushes data immediately when something happens, rather than waiting to be asked. Polling (a) is the opposite pattern: your app repeatedly asks 'anything new?' every few seconds, which is slower and wastes resources. Webhooks are the standard pattern for connecting AI backends to frontends because they're fast, efficient, and real-time."
      },
      {
        type: "concept",
        title: "The Frontend–Backend Contract",
        content: `<p>Before writing code, define the contract between your v0.dev frontend and your n8n backend. This is your API spec — the exact shape of requests and responses both sides must agree on.</p>
<p><strong>Request schema</strong> (frontend → n8n):</p>
<pre><code>{ "message": "Customer wants to return a 60-day-old product",
  "userId": "optional — for logging" }</code></pre>
<p><strong>Response schema</strong> (n8n → frontend):</p>
<pre><code>{ "category": "RETURNS", "priority": "MEDIUM",
  "summary": "Return request past standard window" }</code></pre>
<p><strong>Why this matters for AI:</strong> LLM outputs are non-deterministic. Your AI node might occasionally return malformed JSON, add extra text, or structure the response differently. Your frontend needs graceful failure handling — an error state, a retry button, failure logging. Design for "the AI sometimes does unexpected things" from day one, not as an afterthought.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "Wiring v0.dev to n8n",
        content: `<p>Here's how to connect your frontend form to your n8n agent with a <code>fetch</code> call.</p>
<p>In Claude Code, say: <em>"In my submit handler, POST the form data to [your n8n webhook URL] as JSON. Show a loading spinner while waiting. Display the response in the output panel. If the request fails, show an error message with a retry option."</em></p>
<p>Claude Code generates a handler like this:</p>
<pre><code>const handleSubmit = async () => {
  setLoading(true);
  try {
    const res = await fetch('YOUR_N8N_URL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: inputText })
    });
    setResult(await res.json());
  } catch {
    setError('Something went wrong. Try again.');
  } finally { setLoading(false); }
};</code></pre>
<p>Deploy to Vercel. Send a real request through your UI. Verify end-to-end by watching both the browser network tab and the n8n execution log simultaneously.</p>`,
        expandable: false,
        diagram: {
          type: "flow",
          data: {
            nodes: [
              { id: "n1", label: "User Input\n(browser form)", type: "start" },
              { id: "n2", label: "Frontend\nPOST request", type: "process" },
              { id: "n3", label: "n8n\nWebhook trigger", type: "process" },
              { id: "n4", label: "Claude AI\nNode", type: "process" },
              { id: "n5", label: "JSON\nResponse", type: "process" },
              { id: "n6", label: "Frontend\nDisplay result", type: "end" }
            ],
            edges: [
              ["n1", "n2"],
              ["n2", "n3"],
              ["n3", "n4"],
              ["n4", "n5"],
              ["n5", "n6"]
            ]
          }
        }
      },
      {
        type: "quiz",
        id: "connect-quiz-2",
        variant: "multiple-choice",
        question: "Your v0.dev frontend sends a POST request to your n8n webhook but the UI shows no response. The request appears in the browser's network tab with status 200. Where should you look first?",
        options: [
          { id: "a", text: "The v0.dev component's CSS — a display bug might be hiding the response text" },
          { id: "b", text: "The n8n execution log — check what the workflow actually returned in the response body" },
          { id: "c", text: "The Anthropic API dashboard — the model call might have failed or hit rate limits" },
          { id: "d", text: "The Vercel deployment logs — the build might have a JavaScript error" }
        ],
        correct: "b",
        explanation: "A 200 status means n8n received the request and responded — so the connection works. The next question is: what did n8n actually return? The n8n execution log shows every node's exact input and output, including what the Respond to Webhook node sent back. A common cause of 'no response displayed' is n8n returning empty JSON or a different field name than the frontend expects. Check the response body in both the network tab and n8n's log before looking elsewhere."
      },
      {
        type: "callout",
        variant: "warning",
        title: "Debugging Your Stack",
        content: `<p><strong>CORS error:</strong> Browser blocks requests from your Vercel domain to n8n. Fix: use n8n cloud (which handles CORS correctly) or add CORS headers in your n8n webhook node settings.</p>
<p><strong>Timeout:</strong> Complex AI workflows can take 30+ seconds. Fix: configure your n8n webhook to respond immediately with a job ID, then have your frontend poll for the result — or switch to n8n's async execution mode.</p>
<p><strong>Malformed JSON:</strong> The AI node returns text with extra characters around the JSON. Fix: add a Code node in n8n after the AI call to parse and clean the output before the Respond to Webhook node.</p>
<p><strong>Empty response:</strong> n8n returns nothing despite 200 status. Fix: check the n8n webhook node's "Respond" setting — must be "Last Node" or "Using Respond to Webhook Node," not "Immediately."</p>`
      },
      {
        type: "exercise",
        id: "connect-exercise-1",
        title: "Wire Your Prototype",
        prompt: "Connect the v0.dev frontend you built in the previous topic to the n8n agent from the first topic. Test with at least 3 real inputs. Document what broke and how you fixed it — the debugging process is the learning.",
        template: `My n8n webhook URL:
___

Request schema I'm sending (JSON):
___

Response schema I expect back:
___

Test 1 input: ___
  n8n execution log showed: ___
  Frontend displayed: ___
  Issue (if any): ___
  Fix applied: ___

Test 2 input: ___
  n8n execution log showed: ___
  Frontend displayed: ___
  Issue (if any): ___
  Fix applied: ___

Test 3 input: ___
  n8n execution log showed: ___
  Frontend displayed: ___
  Issue (if any): ___
  Fix applied: ___

Biggest lesson from debugging:
___

If I were building this for a real team, I'd also add:
___`,
        hints: [
          "Use the browser's DevTools (F12 → Network tab) to see the exact request your frontend sends and the exact response body n8n returns. Compare them to your expected schema.",
          "In n8n, click on any node after execution to see its input and output. This is the fastest way to find where data is being lost or transformed unexpectedly.",
          "If you get a CORS error, switch to n8n's cloud version (cloud.n8n.io has a free tier) — it handles CORS correctly for all origins by default."
        ]
      },
      {
        type: "takeaway",
        points: [
          "A webhook is an event-driven HTTP request — one system pushes data to another the moment something happens. Faster and more efficient than polling.",
          "Define your request/response schema before writing code. Both sides of the connection must agree on the data shape. This is especially important for AI because LLM outputs can vary.",
          "Wiring the frontend to n8n requires one fetch call with POST, Content-Type: application/json, and your webhook URL. Claude Code can generate this from a plain English description.",
          "Debug systematically: browser network tab shows what was sent and received; n8n execution log shows what each node did. Work inward from both ends to find the break."
        ]
      }
    ],
    flashcards: [
      {
        front: "What is a webhook and how does it differ from polling?",
        back: "A webhook is an HTTP request automatically sent from one system to another when an event occurs (push model). Polling is the opposite — your app repeatedly asks a server 'anything new?' on a timer (pull model). Webhooks are faster, more efficient, and real-time. They're the standard pattern for connecting AI frontends to backends."
      },
      {
        front: "Why do AI products need graceful failure handling from day one?",
        back: "LLM outputs are non-deterministic — the same input can occasionally produce malformed JSON, unexpected structure, or empty responses. Unlike deterministic APIs, you can't guarantee the AI response will always match your expected schema. Design error states, retry logic, and failure logging before you need them, not after a production incident."
      },
      {
        front: "What is CORS and why do you hit it when building AI prototypes?",
        back: "CORS (Cross-Origin Resource Sharing) is a browser security policy that blocks web pages from making requests to a different domain unless the server explicitly allows it. You hit it when your Vercel frontend tries to POST to your n8n backend on a different domain. Fix: use n8n cloud (handles CORS) or configure CORS headers in n8n's webhook node."
      },
      {
        front: "What causes n8n timeout errors and how do you fix them?",
        back: "n8n webhooks have a default timeout (~30 seconds). Complex AI workflows — especially those with multiple LLM calls, tool invocations, or RAG retrieval — can exceed this. Fix: configure the webhook to respond immediately with a job ID (async pattern), then have the frontend poll a separate status endpoint until the result is ready."
      }
    ]
  },

  "inference-data-strategy": {
    id: "inference-data-strategy",
    moduleId: "hands-on-labs",
    title: "Inference Economics & Data Strategy",
    estimatedMinutes: 30,
    sections: [
      {
        type: "concept",
        title: "Inference 101 for PMs",
        content: `<p>Every time your AI feature runs, it's an API call with a cost. Understanding inference economics helps you make smarter product and pricing decisions.</p>
<p><strong>Tokens</strong> are the unit of measure. Input tokens are what you send (prompt + context). Output tokens are what the model returns. Output tokens cost more than input. Roughly: 1,000 tokens ≈ 750 words.</p>
<p><strong>Pricing example</strong> (Claude Haiku 4.5, mid-2026): ~$0.001 per 1K input tokens, ~$0.005 per 1K output tokens. A typical chat message (500 input, 200 output) costs about $0.0015 — less than a fraction of a cent.</p>
<p>At scale it compounds: 10,000 daily users × 10 messages = 100,000 interactions × $0.0015 = <strong>$150/day, $4,500/month</strong>. That's a real cost line affecting your pricing and margin.</p>
<p><strong>Context window</strong>: the maximum tokens the model can consider at once. Larger context = more expensive per call. Long conversations need summarization to stay within cost budgets.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "quiz",
        id: "inference-quiz-1",
        variant: "multiple-choice",
        question: "Users send an average of 500 input tokens and receive 200 output tokens per interaction. Pricing: $0.001/1K input tokens, $0.005/1K output tokens. What is the cost per interaction?",
        options: [
          { id: "a", text: "$0.0005" },
          { id: "b", text: "$0.0006" },
          { id: "c", text: "$0.0015" },
          { id: "d", text: "$0.015" }
        ],
        correct: "c",
        explanation: "Input cost: (500 ÷ 1,000) × $0.001 = $0.0005. Output cost: (200 ÷ 1,000) × $0.005 = $0.001. Total: $0.0005 + $0.001 = $0.0015 per interaction. At 10,000 daily users doing 10 interactions each, that's 100,000 × $0.0015 = $150/day. Always model cost at 3 user tiers (100 / 1K / 10K daily users) before committing to a feature's architecture — the cost profile changes your build vs. buy decisions significantly."
      },
      {
        type: "concept",
        title: "Product Choices Through an Inference Lens",
        content: `<p>Every architecture decision has an inference cost implication.</p>
<p><strong>Streaming vs. batch:</strong> Streaming shows the response token-by-token as it generates (better UX for conversation). Batch processes requests asynchronously and returns when complete (better for background tasks). Streaming costs the same but feels faster — use it for anything user-facing.</p>
<p><strong>Long context vs. RAG:</strong> Including a 50-page document in every prompt is expensive (massive token count). RAG retrieves only the 2-3 relevant passages — same quality, potentially 90% cheaper. Use long context when the model needs to reason across the full document; use RAG when it only needs to look things up.</p>
<p><strong>Frontier model vs. SLM:</strong> Claude Opus or GPT-4o for complex reasoning; Claude Haiku or Llama 3 for simple classification. A fine-tuned 7B model can match frontier models on narrow tasks at 10-50x lower cost. Right model for the right task is a genuine PM skill.</p>
<p><strong>Caching:</strong> Identical prompts can be served without a new API call. Prompt caching (built into Claude's API) reduces costs 30-50% for features with repetitive system prompts.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "concept",
        title: "Data Collection for AI Products",
        content: `<p>Your data is your moat. The feature that generates the most useful training signal as a side effect of normal use has the most defensible advantage.</p>
<p><strong>Labeled data:</strong> Human-annotated examples showing correct inputs/outputs. Expensive to create but high signal. Used for supervised fine-tuning. Example: a PM manually labels 500 customer tickets with correct categories.</p>
<p><strong>Synthetic data:</strong> AI-generated examples used to augment training data. Fast and cheap, useful when real labeled data is scarce. Risk: if synthetic data doesn't reflect real-world distribution, fine-tuned models underperform in production.</p>
<p><strong>RLHF signals:</strong> "Was this response helpful?" thumbs up/down. "Which response is better?" preference pairs. This is how Claude, ChatGPT, and Gemini are aligned with human values — and your product can collect the same signal at scale.</p>
<p><strong>Data flywheel design:</strong> build features that generate training data as a side effect. Every edit a user makes to an AI suggestion is a supervision signal. Every thumbs down is a preference label. Design for this from the start — retrofitting data collection is expensive.</p>`,
        expandable: false,
        diagram: null
      },
      {
        type: "quiz",
        id: "inference-quiz-2",
        variant: "drag-match",
        question: "Match each data strategy to its best AI use case:",
        pairs: [
          { left: "RLHF (preference feedback)", right: "Improving a chatbot's response quality based on user thumbs up/down" },
          { left: "Labeled data (human annotation)", right: "Training a classifier to route support tickets into exact categories" },
          { left: "Synthetic data (AI-generated)", right: "Building training examples for a rare medical diagnosis scenario with few real cases" }
        ],
        explanation: "RLHF works when 'better vs. worse' is easier to judge than specifying the exact right answer — perfect for open-ended chat quality. Labeled data is best when you need precise categorical outputs with specific definitions. Synthetic data fills the gap when real examples are scarce, expensive to collect, or involve sensitive domains where you can't use real user data."
      },
      {
        type: "callout",
        variant: "tip",
        title: "Data Preparation Basics",
        content: `<p><strong>Cleaning:</strong> Remove duplicates, fix encoding errors, normalize whitespace. Models learn from noise as readily as signal — dirty data produces unreliable fine-tuned models.</p>
<p><strong>Chunking:</strong> For RAG, split documents into overlapping chunks (400-600 tokens, 10-15% overlap). Too large: retrieval is imprecise. Too small: chunks lose context. Test chunk sizes with your specific query types.</p>
<p><strong>Deduplication:</strong> Duplicate training examples over-represent certain patterns, causing the model to be biased toward those outputs. Deduplicate before fine-tuning.</p>
<p><strong>Garbage in, garbage out:</strong> Model quality is bounded by training data quality. Budget for data preparation — it's typically 60-80% of the total fine-tuning effort, not an afterthought.</p>
<p><strong>When synthetic is the right call:</strong> rare events, privacy-sensitive domains, quickly bootstrapping a new use case before you have real user data.</p>`
      },
      {
        type: "exercise",
        id: "inference-exercise-1",
        title: "Inference Cost Audit + Data Plan",
        prompt: "Pick an AI feature you're building or have in mind. Calculate the token cost at three user scale tiers, identify the single biggest cost optimization, and outline a data collection strategy for continuous improvement.",
        template: `Feature: ___
Model I'm using: ___
Estimated input tokens per interaction: ___
Estimated output tokens per interaction: ___
Current pricing (per 1K tokens): Input $___  Output $___

Cost at 100 daily users:
  Interactions/day: ___
  Daily cost: $___
  Monthly cost: $___

Cost at 1,000 daily users:
  Daily cost: $___
  Monthly cost: $___

Cost at 10,000 daily users:
  Daily cost: $___
  Monthly cost: $___

Biggest cost driver (circle one): Input tokens / Output tokens / Context window size / Model tier

Top optimization I'd implement:
[ ] Switch from frontier model to SLM for simple tasks → estimated savings: ___%
[ ] Implement RAG instead of full-document context → estimated savings: ___%
[ ] Enable prompt caching for repeated system prompts → estimated savings: ___%
[ ] Add output length limits (max_tokens) → estimated savings: ___%
[ ] Other: ___ → estimated savings: ___%

Data Collection Strategy:
What training signal exists in normal product usage: ___
How I'd capture it (UI element / log event / annotation queue): ___
Estimated labeled examples per month at scale: ___
Data type I'll start with: [Labeled / RLHF / Synthetic]
Why: ___`,
        hints: [
          "For context window costs: if your feature includes conversation history, remember that every message in the thread is re-sent with each new request. A 10-message conversation adds 10x the token cost vs. a single-turn interaction.",
          "The fastest cost win is usually switching the model tier. Running Claude Haiku instead of Claude Sonnet for a classification task can reduce costs by 10-20x with minimal quality loss.",
          "For the data plan, start with the signal that's cheapest to collect. If users already edit AI suggestions, log those edits — that's free labeled data. Add explicit feedback (thumbs up/down) only if passive signals aren't sufficient."
        ]
      },
      {
        type: "takeaway",
        points: [
          "Inference cost = input tokens × input price + output tokens × output price. Model this at 3 user tiers before committing to an architecture — cost profiles change your build vs. buy decisions.",
          "Four key cost levers: right model for the task (frontier vs. SLM), RAG over long context, prompt caching for repeated system prompts, and output length limits.",
          "Data is your moat. Design features that generate training signal as a side effect: user edits to AI suggestions are labeled data, thumbs up/down are RLHF signals, rare-domain gaps can be filled with synthetic data.",
          "Data preparation — cleaning, chunking, deduplication — is 60-80% of fine-tuning effort. Budget for it. Garbage in, garbage out is literally true for neural networks."
        ]
      }
    ],
    flashcards: [
      {
        front: "What is the difference between input and output tokens, and which costs more?",
        back: "Input tokens are what you send to the model (system prompt + user message + context). Output tokens are what the model generates in response. Output tokens cost more than input tokens — typically 3-5x more. This means verbose AI responses and long context windows (which become input tokens) both significantly increase your inference bill."
      },
      {
        front: "What does the context window limit mean for your product decisions?",
        back: "The context window is the maximum tokens the model can process at once. PM implications: (1) long conversations add tokens (every prior message resends), pushing toward summarization or RAG. (2) Large documents in-prompt are expensive — use RAG to retrieve only relevant passages. (3) Context window size determines how much 'working memory' the agent has, which affects task complexity it can handle."
      },
      {
        front: "What is synthetic data and when is it appropriate to use?",
        back: "Synthetic data is AI-generated training examples used when real labeled data is scarce or expensive. Appropriate when: domain is rare (few real examples exist), data is privacy-sensitive (can't use real user data), or you need to quickly bootstrap a new use case. Risk: if synthetic data doesn't match real-world distribution, fine-tuned models underperform. Always validate with a held-out set of real examples."
      },
      {
        front: "What is RLHF and how can PMs collect RLHF-quality data at the product level?",
        back: "RLHF (Reinforcement Learning from Human Feedback) uses human preference signals to improve model quality. At the product level: a thumbs up/down button on AI responses collects preference labels. 'Which response is better?' comparisons collect pairwise preference data. User edits to AI suggestions are implicit preference signals. These signals can train reward models or be used for fine-tuning — building a data flywheel as a side effect of normal product use."
      }
    ]
  }
};
