# A2UI Product Assistant

A polyglot monorepo of **three independent services** that compose into one generative-UI product
assistant - an agent that doesn't just *describe* products, it **renders live UI** into the chat and
stays bidirectionally in sync with the React app's own state.

**Live: <https://a2ui-assistant.onrender.com>**

Hosted on Render's free plan, so the first request after a quiet spell waits
through a cold start: two Python runtimes, a Next server, and a graph import.
Give it up to a minute, then it is quick.

```
Browser ────────────────────────────────────────────────────────────┐
  React product grid  ⟷  <CopilotKitProvider> + A2UI renderer       │
                                    │ HTTP  /api/copilotkit         │
  Next.js route  →  CopilotRuntime v2  (a2ui middleware)            │ :3000
                                    │ AG-UI over HTTP               │
  langgraph dev  →  supervisor → catalog / compare / recommend/cart │ :2024
                                    │ MCP streamable-http           │
  FastMCP server →  search · detail · compare · stock · cart tools  │ :8931
                                    │
  data/products.json  (single source of truth, read by web and mcp) │
```

| Path | What it is | Toolchain | Port |
|---|---|---|---|
| [apps/web](apps/web/) | React catalog + CopilotKit runtime | pnpm · Next.js 16 | 3000 |
| [packages/a2ui-kit](packages/a2ui-kit/) | The generative-UI layer, reusable | pnpm · source-only | - |
| [apps/agent](apps/agent/) | LangGraph supervisor multi-agent | uv · Python 3.11 | 2024 |
| [apps/mcp](apps/mcp/) | MCP product-catalog tool server | uv · Python 3.11 | 8931 |
| [data/products.json](data/products.json) | 30 seeded products | - | - |

No cross-imports between the three services - they talk over HTTP. The one shared library is
`@a2ui/kit`, which holds everything about **how an agent's UI reaches a browser** and nothing about
products: the chat shell, resizing, the tool list, the A2UI theme, the pipeline explainer, and write
confirmation. A second app gets that whole layer from one import, and the CopilotKit-version-fragile
parts (the `.copilotKitChat` selector, the `z-[1200]` sizing, the inline-colour overrides) live in
one package instead of scattered through an app.

```tsx
<A2UIChatProvider runtimeUrl="/api/copilotkit" agentId="product_agent" app={children}>
  <FrontendTools />   {/* things only YOUR browser can do */}
</A2UIChatProvider>
```

It ships TypeScript source rather than a build output - `transpilePackages: ["@a2ui/kit"]` in
`next.config.ts` - so there is no build step to keep in sync.

---

## Contents

- [Quick start](#quick-start)
- [Prompts worth trying](#prompts-worth-trying)
- [Anatomy: three services and one library](#anatomy-three-services-and-one-library)
- [Learning it: the explainer](#learning-it-the-explainer)
- [Styling the generated UI](#styling-the-generated-ui)
- [Learning it: the journey panel](#learning-it-the-journey-panel)
- [How a single turn actually flows](#how-a-single-turn-actually-flows)
- [Human in the loop: confirming writes](#human-in-the-loop-confirming-writes)
- [Gotchas found the hard way](#gotchas-found-the-hard-way)
- [Running it in Docker](#running-it-in-docker)
- [Troubleshooting](#troubleshooting)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Build log](#build-log)

**Not reading?** Open [`a2ui-explainer.html`](a2ui-explainer.html) - a standalone,
twelve-step narrated player that traces one real question from typed sentence to mounted
React, naming the file responsible at every step. No build, no server, no dependencies.
It is also served by the running app at **/explainer**, and linked from the header of every
page.

---
## Quick start

### One command

```bash
./run.sh
```

Does everything below in order, and refuses early with one clear line if
anything is missing rather than failing three services deep:

| Step | Why it is worth checking first |
|---|---|
| node, uv, pnpm | enables corepack for you if pnpm is missing |
| `.env` and `OPENAI_API_KEY` | without a key the catalog renders and the assistant silently cannot answer |
| ports 3000, 2024, 8931 | probed by connecting, not binding, because `next dev` binds dual-stack and a bind test reports a free port as taken |
| dependencies | `pnpm install` and `uv sync` for both Python apps, skipped when already present |

Then it starts the three services **in dependency order and waits for each to
answer** before starting the next, so the web app never comes up pointing at an
agent that is not listening yet. Ctrl+C stops all three together.

```bash
./run.sh --check        # run the checks and exit, start nothing
./run.sh --skip-setup   # skip dependency install
```

On Windows use Git Bash. `pnpm dev` still works and does the same job without
the checks or the ordering.

```bash
cp .env.example .env       # then add your OPENAI_API_KEY
pnpm setup                 # installs JS deps, syncs both Python venvs, runs preflight
pnpm dev                   # starts all three services
```

Open <http://localhost:3000> and click the chat bubble. Try, in order:

1. **"show me noise cancelling headphones under $300"** - a generated product grid appears in chat
2. **"compare the top two"** - a comparison surface; the reference resolves from shared state
3. **click a card, then ask "is this one good for long flights?"** - no product named, and it knows
4. **"add it to my cart"** - the graph pauses and asks you to confirm

`pnpm dev` runs [preflight](scripts/preflight.mjs) first, which checks the toolchain, both venvs,
the catalog file, your API key and all three ports before anything starts.

### Commands

| Command | Does |
|---|---|
| `pnpm setup` | install + sync + preflight, from a fresh clone |
| `pnpm dev` | all three services, colour-prefixed |
| `pnpm dev:web` / `dev:agent` / `dev:mcp` | one service at a time |
| `pnpm check` | typecheck + all 103 tests |
| `pnpm smoke` | load the running app in headless Edge, fail on any console error |
| `pnpm check:all` | `check` + `smoke` (needs `pnpm dev` running) |
| `pnpm test:mcp` / `test:agent` | one suite |
| `pnpm preflight` | environment check on its own |
| `pnpm build` | production build of the web app |

---

## Prompts worth trying

Every prompt below is checked against the seeded catalog, so the expected result
is a fact rather than a guess. If one of them misbehaves, that is a real
regression and worth investigating.

Before any of this: the two write tools pause for confirmation, and the Python
services do not hot reload. If a change of yours seems to have no effect, see
[I changed Python code and nothing happened](#i-changed-python-code-and-nothing-happened).

### Start here

| Prompt | What you should see |
|---|---|
| `how many products do I have?` | 30 products across 4 categories. Prose only, no surface: nothing was retrieved that needs rendering |
| `show me noise cancelling headphones under $300` | A generated grid. Five headphones qualify |
| `compare the top two` | A comparison surface. "The top two" resolves from the previous turn, with nothing named again |
| `add the cheapest one to my cart` | The graph pauses and asks you to confirm. Nothing is written until you say yes |

### One prompt per route

The supervisor picks exactly one worker per turn. These four force each in turn,
and the left panel shows which one was chosen and why.

| Prompt | Routes to | Expected |
|---|---|---|
| `what categories are there?` | catalog | 4 categories with counts |
| `compare the Aether NC 900 and the Quiet Comfort Elite` | compare | A fact-only matrix, no winner declared by the tool |
| `I edit photos on a laptop all day, what should I buy?` | recommend | A ranked answer that explains the tradeoff |
| `what is in my cart?` | cart | Cart contents, and no confirmation prompt, because reading changes nothing |

### Generative UI

| Prompt | What it exercises |
|---|---|
| `show me every mechanical keyboard` | A multi-card grid. Resize or maximise the chat and the cards reflow, because the column count is CSS, not something the model decided |
| `show me the Panorama 34 UW` | A single result. It should not stretch to full width |
| `show me all monitors` | Seven cards, each with a photo, a formatted price, and per-product stock |

Open **How this UI was generated** above the chat on any of these to see the
component tree the model produced and the data it was bound to.

### Human in the loop

| Prompt | Expected |
|---|---|
| `add Pulse Buds Lite to my cart` | A confirmation naming the product, not `hp-006` |
| Then click **No** | The agent says it has not added it, rather than claiming success |
| `add two Aether NC 700 to my cart` then **Yes, do it** | Confirmed, then the cart reflects it |
| `remove it from my cart` | A second confirmation. Both write tools pause, not just the first |

Reload the page while a confirmation is open. It is still there. The pause lives
in the checkpointer, not in the browser. See
[Human in the loop](#human-in-the-loop-confirming-writes).

### Shared state and the frontend tool

| Prompt | Expected |
|---|---|
| Click a product card, then ask `is this one good for long flights?` | It answers about the card you clicked. No product is named in the question |
| `highlight the out of stock products` | Exactly one card highlights: Nomad Over-Ear 2, the only unavailable product |
| `scroll to the Forge Studio 16` | The catalog behind the chat scrolls to it. That is `highlight_product`, a tool defined in React and executed in your browser |

### The traps

The catalog is seeded with cases that a fluent model gets wrong. These are the
prompts most worth re-running after you change a prompt or a model.

| Prompt | The trap |
|---|---|
| `which headphones have the worst battery life?` | `Studio Ref 80` reports `battery_hours: 0`. It is a **wired** reference headphone with no battery. Reading `0 < 24 < 32` and concluding "terrible battery" is confident, fluent and wrong. The tool ships a caveat saying so |
| `what is the cheapest thing you sell?` | Silent Office 104 at $69, a keyboard. Answers that quietly restrict themselves to one category are wrong |
| `compare the Silent Office 104 and the Clicky 98 Retro` | Both report `battery_hours: 0` because both are wired. A spec that is identical across everything on screen cannot help anyone choose, and should not be shown |
| `what is your best laptop?` | "Best" is unstated. A good answer asks what for, or states the criterion it picked |

### Edge cases

| Prompt | Expected |
|---|---|
| `show me headphones under $10` | Nothing matches. It should say so plainly, not invent a product |
| `do you sell smartphones?` | No. The catalog is laptops, headphones, monitors and keyboards |
| `tell me about the Sony WH-1000XM4` | Not in the catalog. Inventing one is precisely the failure recorded under [Gotchas](#gotchas-found-the-hard-way), so this is worth re-running after any prompt change |
| `add 500 units of lp-001 to my cart` | The confirmation should state the quantity before you approve it |

## Anatomy: three services and one library

Four workspace members. Three are **services** - separate processes that speak HTTP - and one is a
**library** that only ever runs inside the browser bundle.

```
+---------------------------------------- BROWSER -----------------------------------------+
|                                                                                           |
|  apps/web  - your product                    packages/a2ui-kit  - the generative-UI layer  |
|  +----------------------------+             +-------------------------------------------+ |
|  | app/page.tsx               |             | provider.tsx       chat shell + write      | |
|  | components/Catalog.tsx     |<--shared--->|                    confirmation            | |
|  | components/ProductGrid.tsx |  selection  | chat/ChatResizer   drag / maximise         | |
|  | components/ProductCard.tsx |             | chat/ToolList      what the agent can do   | |
|  | components/FrontendTools   |             | explain/A2UIPipeline  "how was this UI     | |
|  |   things only a browser    |             |                       generated?"          | |
|  |   can do (highlight, ...)  |             | styles/a2ui-theme.css  house styling       | |
|  | app/globals.css - tokens --+-------------+-->  applied to every generated surface     | |
|  +----------------------------+             +-------------------------------------------+ |
+-------------------------------------------+---------------------------------------------+
                                            |  POST /api/copilotkit   (AG-UI event stream)
+-------------------------------------------v----------------- apps/web (server) - :3000 --+
|  app/api/copilotkit/[[...rest]]/route.ts    CopilotRuntime v2 + a2ui middleware           |
|  app/api/products/route.ts                  the catalog, for React                        |
|  app/api/tools/route.ts                     proxies the MCP tool list, for ToolList       |
|  app/api/a2ui-trace/route.ts                the last run's trace, for A2UIPipeline        |
|  app/explainer/route.ts                     serves a2ui-explainer.html from the root      |
+-------------------------------------------+---------------------------------------------+
                                            |  AG-UI over HTTP
+-------------------------------------------v----------------- apps/agent - Python - :2024 +
|  graph.py         wires the nodes                                                         |
|  nodes.py         supervisor -> catalog . compare . recommend . cart -> presenter         |
|  state.py         AgentState - what survives between turns                                |
|  a2ui.py          turns fetched products into a rendered surface                          |
|  design_rules.py  HOUSE_STYLE - the rules every generated surface must obey                |
|  prompts.py       one prompt per node                                                     |
+-------------------------------------------+---------------------------------------------+
                                            |  MCP streamable-http
+-------------------------------------------v----------------- apps/mcp - Python - :8931 --+
|  server.py    8 tools + GET /tools.json                                                   |
|  catalog.py   scored retrieval - synonyms, field weights, ranking                          |
|  compare.py   a fact-only comparison matrix (deliberately picks no winner)                 |
|  cart.py      the two write tools, which is why writes need confirming                     |
+-------------------------------------------+---------------------------------------------+
                                            |  reads
                         +------------------v-------------------+
                         |  data/products.json                   |
                         |  30 products - one source of truth,   |
                         |  read by web AND mcp                  |
                         +---------------------------------------+
```

### Who owns what

| Member | Owns | Deliberately knows nothing about |
|---|---|---|
| [apps/web](apps/web/) | Your product: catalog, filters, cards, design tokens | How an agent's UI is produced |
| [packages/a2ui-kit](packages/a2ui-kit/) | How an agent's UI reaches a browser | Products, prices, categories |
| [apps/agent](apps/agent/) | Reasoning, routing, deciding what to render | HTTP routes, React, CSS |
| [apps/mcp](apps/mcp/) | Retrieval and facts | LLMs, prompts, the agent |

That third column is the point. `@a2ui/kit` holds no product logic, so a second app gets the whole
generative-UI layer from one import. `apps/mcp` holds no LLM, so its 19 tests are deterministic and
finish in under a second. `apps/agent` holds no HTML, so replacing the frontend would not touch it.

### Which way dependencies point

```
apps/web  --imports-->  packages/a2ui-kit        the only import edge in the repo

apps/web  --HTTP-->  apps/agent  --HTTP-->  apps/mcp

apps/web  --reads-->  data/products.json  <--reads--  apps/mcp
```

Two rules keep it that way, and both matter more than they look.

**Nothing imports across a service boundary.** The Python apps never import each other, and the web
app never imports Python. They compose over HTTP, so any one can be restarted, rewritten, or moved
to another host without touching the others. That is also what lets all three ship as one container:
co-locating them is a deployment choice, not a coupling.

**`@a2ui/kit` never imports from `apps/web`.** If it did, it would stop being reusable and become a
second copy of this app. The dependency runs one way - the app supplies design tokens, the kit
consumes them. `@source "../../../packages/a2ui-kit/src"` in `globals.css` is what makes Tailwind
generate classes for kit components; omit it and they render unstyled, which looks like a CSS bug
and is really a build-scope one.

### One question, across every box

Typing **"show me noise cancelling headphones under $300"** traverses the whole diagram:

| # | File | What it does |
|---|---|---|
| 1 | `components/Catalog.tsx` | Click history is already shared state, so "this one" would resolve |
| 2 | `provider.tsx` (kit) | Chat posts the message to `/api/copilotkit` |
| 3 | `api/copilotkit/route.ts` | `CopilotRuntime` forwards it to the agent as an AG-UI stream |
| 4 | `nodes.py` supervisor | Classifies intent, routes to `catalog_agent` |
| 5 | `nodes.py` catalog_agent | Calls the MCP `search_products` tool |
| 6 | `catalog.py` (mcp) | Scores and ranks against `products.json`; returns **JSON, never prose** |
| 7 | `nodes.py` presenter | Writes the prose answer, with no tools bound |
| 8 | `a2ui.py` | Has a second model design a component tree under `HOUSE_STYLE` |
| 9 | a2ui middleware | Streams `createSurface` -> `updateComponents` -> `updateDataModel` |
| 10 | kit renderer | Mounts real React; `a2ui-theme.css` makes it match the app |
| 11 | `A2UIPipeline` (kit) | Replays steps 4-10 in the left panel so you can watch it |

Step 11 exists because every step above fails *silently*. The answer still reads plausibly, nothing
throws, and nothing lands in a log. Nearly every entry under
[Gotchas found the hard way](#gotchas-found-the-hard-way) was exactly that.

For *why* the graph is shaped this way, rather than what it touches, see
[How a single turn actually flows](#how-a-single-turn-actually-flows).

---

## Learning it: the explainer

Open [`a2ui-explainer.html`](a2ui-explainer.html) in a browser - a standalone, twelve-step player
that traces one real question from typed sentence to mounted React. Each step names the file that
does the work, shows the code, and shows what that step produced on an actual run. Arrow keys to
step, space to play, number keys to jump.

Press **Voice** and it narrates itself, advancing when each sentence finishes rather than on a
timer - so a dense step gets the time it needs. The narration is written for the ear: no code read
aloud, no file paths spelled out. Uses the browser's own `speechSynthesis`, so there are still no
audio files and no network calls.

No build, no server, no dependencies - one file you can send to someone.

## Styling the generated UI

[docs/styling-generated-ui.md](docs/styling-generated-ui.md) is the guide for
whoever maintains the look of agent-generated surfaces. It covers the four
levers that control it, ordered by the only thing that matters: whether the
model can ignore them.

The short version. CSS and the data shape are deterministic and do the real
work. The prompt is a tendency, not a guarantee. Constraining what the model
CAN say beats telling it what to say, which is why removing `specs` and `price`
from its payload fixed more than any wording ever did.

The catalog header links it too, alongside the explainer and the source.

---
## Learning it: the journey panel

Click **"How A2UI works"** on the left edge. It walks the twelve hops from your question to
rendered React, names the file responsible for each, and fills every step with what actually
happened on your last turn:

```
BROWSER            1  You ask a question              provider.tsx
NEXT.JS RUNTIME    2  Runtime attaches the catalog    api/copilotkit/[[...rest]]/route.ts
                   3  AG-UI carries it to the graph   @ag-ui/langgraph
LANGGRAPH AGENT    4  Supervisor picks a specialist   nodes.py → supervisor()
                   5  A worker queries the catalog    nodes.py · mcp/server.py
                   6  The worker writes DATA          state.py → SurfaceSpec
                   7  The presenter writes the answer nodes.py → _present_with_a2ui()
                   8  A SECOND model designs the UI   a2ui.py → render_tool()
                   9  Three operations go on the wire A2UI v0.9 envelope
                  10  Values bind into the tree       updateDataModel
BACK IN BROWSER   11  Middleware paints the surface   @ag-ui/a2ui-middleware
                  12  React mounts it, in your theme  @copilotkit/a2ui-renderer
```

Expanding a step shows what happens, the file path, the trap people hit there, and the live data -
step 4 shows the routing decision and refined query, step 5 the MCP calls and their results, step 8
the component types the subagent chose.

The colour bands mark the three boundaries, and most confusion in this stack is about which side of
one you are on: browser → runtime, runtime → agent, agent → browser.

Each collapsed step shows what it did - `search_products`, `product_grid · 3 products`,
`40 components`, `3 operations` - so the whole turn reads at a glance. Expand one for the
explanation, the file path, and the trap people hit there.

On by default in development (`showJourney` on `<A2UIChatProvider>`), off in production.

### Making generated UI follow YOUR style

Two levers, and they do different jobs:

| Want to change | Edit | How it works |
|---|---|---|
| Colour, radius, type | [`packages/a2ui-kit/src/styles/a2ui-theme.css`](packages/a2ui-kit/src/styles/a2ui-theme.css) | 8 CSS variables scoped to `.a2ui-surface`, mapped to your tokens. Applies after the fact - **deterministic**, CSS cannot be ignored. |
| Which components, how arranged | [`apps/agent/src/agent/design_rules.py`](apps/agent/src/agent/design_rules.py) | Reaches the model that *designs* the tree. **Influential, not guaranteed** - it is a prompt. |

If you can express it in CSS, do it in CSS. Come to `design_rules.py` for what CSS cannot reach:
*"comparisons must be horizontal"*, *"never use Image"*, *"every card leads with the price"*.

The house style is passed as `composition_guide`, which is **appended** to the built-in guidelines
rather than replacing them - those defaults carry protocol constraints (exactly one component with
id `"root"`, relative paths inside `List` templates) that a surface will not render without.

Measured effect of adding the default rules in that file: component count on the same question
dropped from ~38 to **12**, and every rule held - no `Image`, `List` of `Card`, `h2` title outside
the list, `h3` product names, `caption` for metadata, `Row justify="spaceBetween"` for spec pairs.

### Going deeper: LangSmith

The panel shows a summary. LangSmith has the full tree - every prompt sent, token counts per call,
and how many times the A2UI subagent retried before its component tree validated. `langsmith` is
already installed as a dependency of langchain, so it is three env vars:

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...        # https://smith.langchain.com/settings
LANGSMITH_PROJECT=a2ui-product-assistant
```

Restart the agent and the panel's footer becomes **"Open this run in LangSmith →"**, deep-linked to
that exact run rather than a project page you then have to search. `pnpm preflight` reports whether
tracing is on.

## How a single turn actually flows

Ask *"compare the two best noise-cancelling headphones under $400"*:

1. **supervisor** classifies the turn with **structured output** and returns
   `Command(goto="compare_agent", update={...})`. One routing decision per turn.
2. **compare_agent** calls the MCP `compare_products` tool, which returns a **fact-only matrix** -
   no winner is chosen server-side. The model decides which rows matter for what you asked.
3. The worker writes a **`surface` dict** into state. It never writes prose for you.
4. **presenter** - the only node that decides how anything looks - hands that dict to the A2UI
   subagent, which designs a component tree and streams it to the browser, then writes 2–4 sentences.

Watch it happen at <http://localhost:2024> in LangGraph Studio.

### Why the presenter is its own node

Workers produce **data**, not prose. Swapping markdown for generative UI in Part 4 changed exactly
one function body - no worker was touched. If each worker had written its own answer, that swap
would have been a rewrite.

### Why comparison logic lives in the MCP server

`compare_products` returns `numeric`, `differs`, `range`, `spread_pct`, `leaders`, and a `caveat`
where one applies - facts only. `identical_rows` tells the model what *cannot* differentiate.

The caveat matters: `hp-004` is a **wired** reference headphone with `battery_hours: 0`. Looking at
`0 < 24 < 32`, a model concludes "terrible battery" - confident, fluent, wrong. The tool says so
explicitly instead.

### Why shared state beats prompt-stuffing

Clicking a card writes `selected_product_ids` into agent state, so *"is this one good for gaming?"*
resolves with nothing named. The alternative - pasting the product into the system prompt - goes
stale on the next click, costs tokens every turn, and is the first thing dropped by compaction.

`useSharedSelection` only ever pushes to the agent from a **user gesture**, never from an effect
watching state. That's what stops the bidirectional loop.

---

## Human in the loop: confirming writes

Ask **"add Pulse Buds Lite to my cart"** and the agent does not do it. It stops and asks:

```
┌─────────────────────────────────────────────────┐
│  Add 1 unit of hp-006 to your cart?             │
│  This changes state, so it needs your say-so.   │
│                                                 │
│  [ Yes, do it ]  [ No ]   Cancel the whole thing│
└─────────────────────────────────────────────────┘
```

### No, this is not A2UI

It is worth being precise, because the two mechanisms look similar on screen and are nothing alike
underneath. **A2UI renders what the agent produced. The interrupt pauses to ask you something.**

| | A2UI surface | This confirmation |
|---|---|---|
| Who designs the UI | **A second LLM**, at run time, per turn | **You**, in `provider.tsx`, at build time |
| What arrives over the wire | `createSurface` → `updateComponents` → `updateDataModel` | One LangGraph interrupt event |
| Frontend hook | A2UI renderer inside CopilotKit | `useInterrupt` |
| Does the graph stop? | No - it is a render | **Yes** - suspended and checkpointed |
| Same layout every time? | No, by design | **Yes, by design** |
| Where it lives | [`a2ui.py`](apps/agent/src/agent/a2ui.py) | [`nodes.py`](apps/agent/src/agent/nodes.py) + [`provider.tsx`](packages/a2ui-kit/src/provider.tsx) |

That last row is the reason it is not A2UI, and it is a deliberate choice rather than a gap.

**You do not let a language model design the button that spends money.** A confirmation dialog has
to be identical every time, phrased the same way every time, with the destructive option never
styled as the safe one. Generated UI is valuable precisely because it varies with the answer - which
is exactly the property you do not want in a consent dialog. So the surfaces that *show* you things
are generated, and the one control that *asks* you something is hand-written and fixed.

### How it works, end to end

```
 you: "add Pulse Buds Lite to my cart"
   │
   ▼
 cart_agent decides to call add_to_cart
   │
   │  nodes.py - the call is checked against WRITE_TOOLS
   ▼
 _confirm_write(call)
   │
   │  interrupt({kind, tool, args, summary})
   │  ├─ graph SUSPENDS
   │  ├─ pending state is written to the checkpointer
   │  └─ the HTTP run FINISHES  ← nothing is held in memory
   ▼
 browser: useInterrupt renders <ConfirmWrites>
   │
   ├─ "Yes, do it"            → resolve({approved: true})
   ├─ "No"                    → resolve({approved: false, reason: …})
   └─ "Cancel the whole thing"→ cancel()
   │
   ▼
 a Command resumes the graph FROM THAT EXACT LINE
   │
   ├─ approved  → the MCP tool actually runs
   └─ declined  → a ToolMessage saying `cancelled_by_user`, so the
                  model answers gracefully instead of pretending it worked
```

The decline path matters more than it looks. The agent is not silently short-circuited - it receives
a real tool result saying the user said no, so it can reply *"No problem, I haven't added it"*
rather than hallucinating a success it never got.

### Why `interrupt()` rather than a confirm dialog in React

You could gate this in the browser: pop a dialog before letting the request go out. It would be less
code. It would also be wrong.

`interrupt()` **suspends the graph and writes the pending state to the checkpointer**. The HTTP run
completes, and the answer arrives later as a `Command` that resumes execution *from that exact line*.
Between those two moments nothing is held in memory.

That means the pause survives a page reload, a dropped connection, a server restart, and a deploy.
A dialog in React is a promise the client has to keep - close the tab and it is gone. A checkpointed
interrupt is a promise the **server** keeps.

### Which tools need it, and why only those

```python
WRITE_TOOLS = frozenset({"add_to_cart", "remove_from_cart"})
```

Two of the eight MCP tools. The split is not about danger, it is about **asymmetry**: a read that
goes wrong costs you a re-ask, while a write that goes wrong costs you a state you did not choose.
Searching, comparing, and checking stock need no permission because undoing them is free.

To gate another tool, add its name to that set - the machinery is already generic. To change the
wording, edit `_describe_write` (agent) or `ConfirmWrites` (kit). To change the buttons, only
`provider.tsx` changes; the graph neither knows nor cares how you were asked.

### A rough edge worth knowing

The dialog currently reads *"Add 1 unit of **hp-006** to your cart?"* - the raw product id, not
"Pulse Buds Lite". `_describe_write` only receives the tool-call arguments, and the id is all the
model passes. Correct, but colder than it should be at the exact moment a person is deciding.

---

## Gotchas found the hard way

Every one of these failed **silently**. None produced an error.

### `langgraph dev` does not reliably hot-reload

It logs "changes detected" constantly, but a changed **state schema** or a newly imported module can
keep serving the old graph. Check what is actually loaded:

```bash
AID=$(curl -s -X POST localhost:2024/assistants/search -H 'content-type: application/json' \
  -d '{"limit":1}' | python -c "import sys,json;print(json.load(sys.stdin)[0]['assistant_id'])")
curl -s localhost:2024/assistants/$AID/schemas | python -m json.tool | head -30
```

If those properties don't match `AgentState`, restart. Killing the port holder is not enough - it
spawns a child process that must go too.

### The A2UI subagent invents data it wasn't given

It builds its own prompt from `ag-ui.context` and `state["messages"]` - **never** from the
presenter's prompt. Asked to render products it had never seen, it produced a beautifully laid-out
card for a *Sony WH-1000XM4 at $349.99*, which this catalog does not contain. Facts must be injected
through `ag-ui.context`; see `state_with_render_data` in [a2ui.py](apps/agent/src/agent/a2ui.py).

### Two packages disagree on one metadata key

To stop a node's prose streaming into the chat, set `metadata["emit-messages"] = False` - the key
`ag_ui_langgraph` reads. Do **not** use `copilotkit_customize_config(..., emit_messages=False)`: it
writes the *prefixed* `copilotkit:emit-messages`, which `ag_ui_langgraph` never looks at. It
type-checks, runs clean, and does nothing.

### MCP tool results are content blocks, not JSON

`langchain-mcp-adapters` returns `[{"type": "text", "text": "<json string>"}]`. Code that checks
`isinstance(payload, dict)` matches nothing, every worker reports zero results, and the answers
still look right because the presenter reads product names out of the model's prose. See
`_unwrap_tool_result`.

### `Command(goto=...)` needs its return-type annotation

Without `-> Command[SupervisorDestination]`, LangGraph infers `supervisor -> __end__` and prunes
every worker as unreachable. The graph runs correctly; Studio draws a lie.

### `langgraph.json` must use the module form

`"agent.graph:graph"`, never `"./src/agent/graph.py:graph"` - the file form loads the module
standalone and every relative import dies with *"attempted relative import with no known parent
package"*.

### The runtime route must be a catch-all

`createCopilotEndpoint` returns a **Hono app** that registers several paths under `basePath`, so it
lives at `app/api/copilotkit/[[...rest]]/route.ts` and is exported as `app.fetch` - assigning the
app directly to `POST` fails Next's `RouteHandlerConfig`.

### "Nothing was found" is not "nothing was looked up"

Asked *"how many products do I have"*, the supervisor routed straight to the presenter - no tools,
no search - and the presenter replied **"No products were found in your catalog."** Nobody had
looked. That is a false statement about the user's own data, and it is the same confabulation
family as the invented Sony product.

Two halves to the fix: the supervisor now sends any question needing catalog data to
`catalog_agent` ("when unsure, choose catalog_agent - looking and finding nothing is recoverable,
asserting an answer without looking is not"), and the presenter is told explicitly that the
`no catalog work was done` marker means it knows nothing either way and must not describe the
catalog at all. `prompts.NO_WORK_MARKER` is shared by prompt and code so they cannot drift.

`list_categories` also now returns `total_products` and `category_count`, so catalog-wide questions
are answerable in one call instead of via a text search for the word "products" - which matches
nothing and looks exactly like an empty catalog.

### `useAgent().agent.state` is empty in the browser

The agent's state channels reach the client - `a2ui_trace` is plainly there in the `STATE_SNAPSHOT`
events on the wire - but `Object.keys(agent.state)` is `[]`. Three documented extension points were
tried before giving up on client state entirely:

| Mechanism | Result |
|---|---|
| `useRenderTool({name: "*"})` | renders MCP tool calls fine, never fires for the A2UI call |
| `renderCustomMessages` | provider prop for injecting UI into the message list; never ran |
| `useAgent().agent.state` | `{}` |

So the "How this UI was generated" panel reads
[`/api/a2ui-trace`](apps/web/app/api/a2ui-trace/route.ts), which asks `langgraph dev` for the
thread's state directly. `a2ui_trace` is an ordinary state channel, so one HTTP call gets it.

Note this also means **Part 5's agent → grid direction is unverified.** Clicking a card writes
selection to the agent (confirmed working); the agent writing selection back to the grid depends on
the same empty `agent.state` and has not been demonstrated.

### The chat's anchor offsets are part of the size budget

`copilot-chat.css` pins the popup with `inset: auto 1.5rem 6rem auto` - 24px from the right, 96px
from the bottom to clear the launcher. A cap of `0.86 * innerHeight` looks safe and is not: on a
608px viewport it yields 523, and `523 + 96` pushes the popup's **top** to `-11`, so the resize
controls sit above the screen edge. `maxSize()` in `ChatResizer.tsx` and the `max-width` /
`max-height` in the CSS must both subtract the anchor offsets, and they must agree.

A saved size is also clamped to the current viewport on load and on every window resize - otherwise
maximising on a wide monitor and reopening on a laptop restores a popup wider than the screen.

### `langgraph dev` refuses blocking calls on its event loop

Resolving the LangSmith project URL uses `Client.read_project()` - a synchronous HTTP call. Inside a
node it fails with *"Blocking call to socket.socket.connect"*, because one blocked request would
stall every other run on the server. Wrap it: `await asyncio.to_thread(lookup)`.

Two related traps in the same helper. `RunTree.get_url()` raises `LangSmithError` on a local run
even when tracing is perfectly healthy, so the URL is built from `Client.read_project().url` plus
`/r/{run_id}` instead. And a single broad `try` around the whole lookup reported `enabled: false` on
a correctly configured setup - the failing URL call masked the healthy tracing state and sent me
checking env vars instead of the function. Guard each step separately.

### Tailwind does not scan a workspace package unless you tell it

Moving components into `packages/a2ui-kit` silently dropped **every Tailwind class they use**.
Tailwind 4 auto-detects sources relative to the stylesheet that imports it, and that detection stops
at the app. Nothing errors - the CSS simply is not generated, so the chat controls collapse to
unstyled text (a `size-6` button measured **11×19** instead of 24×24), the injected panels lose
their layout, and the popup grows scrollbars around content that should have been contained.

One line in `apps/web/app/globals.css` fixes it:

```css
@import "tailwindcss";
@source "../../../packages/a2ui-kit/src";
```

Anything moved into a package that ships JSX needs the same treatment.

### Panels must anchor to `.copilotKitChat`, not `.copilotKitMessages`

The message list does not exist until the first message is sent, and it is
re-created as the thread changes. Anything mounted there is invisible exactly when
someone wants it - the tool list most of all. `.copilotKitChat` is present as soon
as the popup opens and stays put.

### CopilotKit creates an empty thread on mount

`/threads/search` sorted newest-first returns that empty thread, not the one that
just rendered a surface. [`/api/a2ui-trace`](apps/web/app/api/a2ui-trace/route.ts)
therefore walks recent threads and takes the first that actually has an
`a2ui_trace`.

### The chat window only scales its outer container

Setting a size on the popup's outer container leaves `.copilotKitPopup` at its shipped 420×560
inside a 900×860 parent. Every layer between the container and the message list needs forcing to
fill, and `.copilotKitMessages` needs `min-height: 0` - without it a flex child grows instead of
scrolling. See [copilot-chat.css](packages/a2ui-kit/src/styles/chat.css).

CSS `resize` only ever puts its grip in the bottom-right corner, which on a bottom-right-anchored
panel drags the window off-screen - hence the custom top-left handle in
[ChatResizer.tsx](packages/a2ui-kit/src/chat/ChatResizer.tsx).

### `ag-ui.a2ui_schema` is never set on the Node-adapter path

Every A2UI guide says to read the component catalog from `state["ag-ui"]["a2ui_schema"]`, populated
by `ag_ui_langgraph`'s `split_a2ui_schema_context`. That helper works - it matches the
byte-identical description the browser sends. **It just never runs here.**

It lives on the path where *Python* serves the AG-UI endpoint (`LangGraphAGUIAgent` + FastAPI). This
project uses the Node `LangGraphAgent` talking to `langgraph dev` over the LangGraph Platform HTTP
API, so the Python adapter is not in the request path at all. The schema still arrives - as an
ordinary `ag-ui.context` entry alongside the catalog capabilities and the generation/design
guidelines.

Nothing about the miss was visible: `a2uiEnabled: true`, four A2UI context entries on the wire, a
`product_grid` surface ready to draw, and a gate that silently stayed shut so every answer came back
as markdown. Detect A2UI from the context entries (`a2ui_is_available` in
[a2ui.py](apps/agent/src/agent/a2ui.py)), keeping the `a2ui_schema` / `inject_a2ui_tool` checks as
fallbacks for the Python-served path.

### The two tool invocations need OPPOSITE treatment

- **MCP tools** → `config={"callbacks": []}`. Tracing them synthesises an id-less tool call that
  blanks the answer (see below).
- **`generate_a2ui`** → keep `config=config`. The A2UI middleware paints from the live tool-call
  stream; detaching callbacks silences the surface entirely (verified - surface count drops to 0).

### A phantom tool call eats every answer

Any turn that used a tool rendered an **empty bubble**. The server was flawless: the browser
received `TEXT_MESSAGE_START/CONTENT/END` and a final `MESSAGES_SNAPSHOT` holding the correct
assistant message. CopilotKit still ended up with `assistant(content: "", toolCalls: [...])`.

Cause: this graph runs its own tool loop rather than a `ToolNode`, so LangChain fires
`on_tool_start`/`on_tool_end` for each MCP call and `ag_ui_langgraph` synthesises AG-UI tool-call
events from them - with **no `toolCallId` and no `toolCallName`**, because the ids live in the
ToolNode machinery being bypassed. That id-less, unpaired event corrupts the client's message
reconstruction and takes the presenter's text with it. It also poisons the thread: later runs lose
earlier answers from their snapshot.

Fix - detach the MCP call from the callback tree:

```python
result = await tool.ainvoke(call["args"], config={"callbacks": []})
```

Two traps around it. Omitting `config=` entirely is **not** enough - LangChain picks the callback
manager up from the ambient run context. And setting `emit-tool-calls: False` for workers makes it
**worse**: the proper tool call disappears while the synthesised one survives, leaving no assistant
bubble at all.

Perfect correlation before the fix: 2 `TOOL_CALL_START`s (1 malformed) on tool turns which rendered
nothing; 0 on chitchat turns, which rendered fine.

### Hooks silently default to an agent named `default`

`useAgent`, `useInterrupt` and `useFrontendTool` fall back to the surrounding chat configuration and
then to a literal `"default"`. A component mounted **outside** `<CopilotPopup>` has no chat
configuration, so it asks for an agent that does not exist:

```
useAgent: Agent 'default' not found after runtime sync. Known agents: [product_agent]
```

Pass `agentId` explicitly to every hook. `AGENT_ID` in
[lib/agent-state.ts](packages/a2ui-kit/src/agent-state.ts) is the single source of truth, used by the
runtime's `agents` map, the chat component and all three hooks.

**Nothing in this repo caught it.** `tsc` was clean, 45 tests passed, and driving the runtime with
`curl` produced a perfect A2UI surface - because none of those ever mount React.
[`pnpm smoke`](scripts/smoke-browser.mjs) exists for exactly this class of bug: it loads the app in
headless Edge and fails on any console error.

### Ports: probe by connecting, not by binding

`next dev` binds dual-stack on `::`. Trying to bind `127.0.0.1` succeeds anyway and reports the port
free while the site is up.

---

### I changed Python code and nothing happened

`next dev` hot reloads. **`langgraph dev` and the FastMCP server do not.** Edit a
node, a prompt, `design_rules.py`, or an MCP tool and the running processes keep
serving the modules they loaded at startup. The web app picks up its half
immediately, which makes it look like the change half worked.

It costs real time because the symptom is not an error. The old behaviour simply
continues, so you go looking for a bug in code that is correct and is not
running.

Two ways to tell in seconds, without guessing:

```bash
# Does the running MCP server have the tool argument you just added?
curl -s http://localhost:8931/tools.json | grep -o '"stock"'

# Did the last run use the new code? Compare against what you expect.
curl -s http://localhost:3000/api/a2ui-trace | head -c 400
```

The fix is always the same: stop `pnpm dev` and start it again. Restarting the
browser or the web app alone is not enough.

### A prompt cannot ask for what a binding cannot do

Generated cards showed spec labels with **no values**, a price reading `229`
instead of `$229`, and "Out of stock" on products that were in stock. Nothing
errored.

The house style was asking for four impossible things. An A2UI binding POINTS AT
a value; it cannot format one, join two, or choose between them:

| The rule said | What the model emitted | Why |
|---|---|---|
| prices as "$279" | `{"path": "price"}` -> `229` | no binding adds a currency symbol |
| brand and rating on one line | `{"path": "brand"}` | bindings cannot concatenate |
| out-of-stock products get a caption | literal `"Out of stock"` | literals live in the card *template*, so they apply to every product in the list |
| a Row per spec | `{"path": "specs/type"}` | a nested path inside a List template resolves to nothing |

Each one is the closest achievable thing to an unachievable instruction. The
model was not being careless; it was being asked for something the runtime does
not have.

The fix was not a firmer prompt. `display_product()` in
[a2ui.py](apps/agent/src/agent/a2ui.py) now precomputes every displayable string
as a flat top-level field - `priceLabel`, `brandLine`, `stockLabel`,
`spec1Label`/`spec1Value` - and **drops `specs` and `tags` entirely**, so the
nested path is not merely discouraged, it is impossible.

The general lesson, and the reason this is in the README rather than a commit
message: when generated output is consistently a bit wrong, check whether you
asked for something the runtime cannot express before you rewrite the prompt
again.

### The card grid is CSS, not a prompt

"Three to five products per row depending on the screen" is not something the
model can honour: it emits a component tree, cannot see the chat width, and
cannot re-decide when you drag the resizer.

So the column count is never stated. `a2ui-theme.css` turns the generated List
into `repeat(auto-fill, minmax(168px, 1fr))` and the browser fits as many as the
width allows, reflowing on every resize. The model emits the same tree either
way.

---

## Running it in Docker

All three services ship in **one image**. They are one product - the web app cannot
answer without the agent, and the agent cannot answer without the MCP server - and
only the web app needs to be reachable from outside.

```
container
  :$PORT  next start        <- the only public port
  :2024   langgraph dev     <- internal, loopback only
  :8931   fastmcp           <- internal, loopback only
```

```bash
docker compose up --build          # then open http://localhost:3000
```

Or without compose:

```bash
docker build -t a2ui-assistant .
docker run --rm -p 3000:3000 --env-file .env a2ui-assistant
```

`.env` is excluded by `.dockerignore` on purpose: **secrets never enter an image
layer**, because layers are cached, pushed, and readable by anyone who pulls the
image. `OPENAI_API_KEY` arrives at run time or not at all.

`docker/start.sh` starts the three processes in dependency order and waits for each
to answer before starting the next, so the public port only opens once the whole
chain is up. It exits as soon as *any* of them dies - a container that serves the
catalog while the agent is dead is worse than one that restarts.

### Deploying to Render

The deployment for this repo is <https://a2ui-assistant.onrender.com>.

`render.yaml` is a blueprint: **New → Blueprint**, point it at the repo, and paste
`OPENAI_API_KEY` when prompted.

Three things about Render specifically:

- **`PORT` is injected and `EXPOSE` is ignored.** Render publishes exactly one port
  and tells you which through `$PORT`; `start.sh` binds the web app to it. This is
  why the app is not hardcoded to 3000 in the container.
- **Use the Standard plan, not Starter.** Node plus two Python runtimes will not fit
  in 512 MB. They OOM partway through boot, and Render reports that as a failed
  deploy rather than as an out-of-memory kill - a confusing hour if you do not
  expect it.
- **`healthCheckPath: /api/products`.** It is served by the web app and reads the
  catalog, so a pass means the thing users actually hit is working.

### Keeping it awake, and what the free plan really costs

Render's free plan stops a service after 15 minutes without traffic, and the
next visitor waits through a full cold start: two Python runtimes, a Next
server, and a graph import the logs clock at about five seconds on its own.

[.github/workflows/keep-awake.yml](.github/workflows/keep-awake.yml) pings
`/api/products` every five minutes. Set `RENDER_URL` under **Settings >
Secrets and variables > Actions > Variables**, or it falls back to the URL in
the file.

Three honest caveats:

- **Five minutes is GitHub's floor, and schedules are best-effort.** Under load
  runs are delayed, sometimes past the 15-minute idle window, so the occasional
  cold start still happens.
- **GitHub disables scheduled workflows after 60 days without a commit**, and
  does it quietly. If cold starts come back after a long pause, check the
  Actions tab before looking anywhere else.
- **It spends the free allowance.** 750 instance-hours a month; a service kept
  awake around the clock uses roughly 730 of them. Fine for one service,
  impossible for two.

The free plan also gives 512 MB, and this image runs three processes. If deploys
die partway through boot with no error, that is the memory ceiling rather than a
bug: [render.yaml](render.yaml) asks for `plan: standard` for exactly this
reason.
Two honest caveats for a hosted deployment:

- `langgraph dev` is a development server. It is what makes LangGraph Studio and
  in-memory checkpointing work, and it is fine for a demo, but it is not what you
  would put in front of real traffic. The production path is LangGraph Platform, or
  a FastAPI host - either way `LANGGRAPH_DEPLOYMENT_URL` is the only thing that
  changes.
- Conversation state lives in memory and on the container filesystem, so a redeploy
  or restart drops it. Threads are not durable across deploys.

## Troubleshooting

### The chat looks stuck on a second question

`langgraph dev` runs one job at a time by default. Its own log says so:

```
Worker stats  active=0 available=1 max=1
```

So a second question does not run, it QUEUES behind the first, and on a
shared-CPU instance the first is slow enough that the wait reads as a hang.
Nothing errors, because nothing is wrong: the run has not started yet.

`docker/start.sh` passes `--n-jobs-per-worker 4`. Verified against a real
agent, the same line then reports `available=4 max=4`.


| Symptom | Cause | Fix |
|---|---|---|
| `Could not reach the MCP server` | mcp not running | `pnpm dev:mcp` |
| Chat says nothing, no surface | agent not running | `pnpm dev:agent`, check :2024 |
| Your edit has no effect | stale `langgraph dev` | restart it *and* its child process |
| A2UI surface never appears | `a2ui` missing from runtime config | check `/api/copilotkit/info` reports `"a2uiEnabled": true` |
| Empty surface, no error | no component has `id: "root"` | the renderer starts at `root` and walks down |
| Products in the UI aren't ours | facts not in `ag-ui.context` | see `state_with_render_data` |
| Answer appears twice | worker prose streaming | `quiet(config)` on non-presenter model calls |
| `Invalid thread ID: must be a UUID` | LangGraph requires UUID thread ids | use `uuid4()` |
| 404 under `/api/copilotkit/…` | route is not a catch-all | `[[...rest]]/route.ts` |
| Empty assistant bubble on any tool turn | id-less synthesised tool call | invoke MCP tools with `config={"callbacks": []}` |
| `An internal error occurred` in chat | transient `OpenAIConnectionError` | retries raised to 4; retry the turn |
| `Agent 'default' not found` | a hook outside the chat provider | pass `agentId: AGENT_ID` to it |
| "No products were found" on a catalog-wide question | routed to presenter, nothing searched | supervisor must send it to `catalog_agent` |

---

## Design decisions worth knowing

| Decision | Why |
|---|---|
| Data at the repo root | Two runtimes read it; putting it in either app forces a service boundary |
| Web search is strict AND, agent search is scored | A human sees the box and retypes; an agent fires once and never learns what it missed |
| Synonyms in the MCP server | `"noise cancelling"` found 2 of 6 ANC models before; products said *"cancellation"* and *"ANC"* |
| Comparison direction not in code | LLM judgement by choice; the tool ships facts, ranges and caveats so that judgement is reliable |
| `catalog_agent` cannot see `add_to_cart` | Withholding a tool beats instructing the model not to use it - and costs no context |
| Design tokens in one CSS file | `.a2ui-surface` maps 8 renderer variables onto them, so agent-invented UI tracks the app's theme |
| Dynamic A2UI schema | Surfaces nobody designed in advance, at the cost of an extra LLM call and per-turn variation |

---

## Build log

- [x] **Part 0** - monorepo skeleton & seed data
- [x] **Part 1** - React product catalog (standalone)
- [x] **Part 2** - MCP tool server (standalone)
- [x] **Part 3** - LangGraph multi-agent (standalone)
- [x] **Part 4** - CopilotKit runtime + A2UI
- [x] **Part 5** - bidirectional state & frontend tools
- [x] **Part 6** - one-command startup, docs, preflight
