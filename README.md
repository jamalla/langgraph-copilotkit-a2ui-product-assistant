# A2UI Product Assistant

A polyglot monorepo of **three independent services** that compose into one generative-UI product
assistant — an agent that doesn't just *describe* products, it **renders live UI** into the chat and
stays bidirectionally in sync with the React app's own state.

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
| [apps/agent](apps/agent/) | LangGraph supervisor multi-agent | uv · Python 3.11 | 2024 |
| [apps/mcp](apps/mcp/) | MCP product-catalog tool server | uv · Python 3.11 | 8931 |
| [data/products.json](data/products.json) | 30 seeded products | — | — |

No cross-imports, no shared build graph. They talk over HTTP.

---

## Quick start

```bash
cp .env.example .env       # then add your OPENAI_API_KEY
pnpm setup                 # installs JS deps, syncs both Python venvs, runs preflight
pnpm dev                   # starts all three services
```

Open <http://localhost:3000> and click the chat bubble. Try, in order:

1. **"show me noise cancelling headphones under $300"** — a generated product grid appears in chat
2. **"compare the top two"** — a comparison surface; the reference resolves from shared state
3. **click a card, then ask "is this one good for long flights?"** — no product named, and it knows
4. **"add it to my cart"** — the graph pauses and asks you to confirm

`pnpm dev` runs [preflight](scripts/preflight.mjs) first, which checks the toolchain, both venvs,
the catalog file, your API key and all three ports before anything starts.

### Commands

| Command | Does |
|---|---|
| `pnpm setup` | install + sync + preflight, from a fresh clone |
| `pnpm dev` | all three services, colour-prefixed |
| `pnpm dev:web` / `dev:agent` / `dev:mcp` | one service at a time |
| `pnpm check` | typecheck + all 45 tests |
| `pnpm test:mcp` / `test:agent` | one suite |
| `pnpm preflight` | environment check on its own |
| `pnpm build` | production build of the web app |

---

## How a single turn actually flows

Ask *"compare the two best noise-cancelling headphones under $400"*:

1. **supervisor** classifies the turn with **structured output** and returns
   `Command(goto="compare_agent", update={...})`. One routing decision per turn.
2. **compare_agent** calls the MCP `compare_products` tool, which returns a **fact-only matrix** —
   no winner is chosen server-side. The model decides which rows matter for what you asked.
3. The worker writes a **`surface` dict** into state. It never writes prose for you.
4. **presenter** — the only node that decides how anything looks — hands that dict to the A2UI
   subagent, which designs a component tree and streams it to the browser, then writes 2–4 sentences.

Watch it happen at <http://localhost:2024> in LangGraph Studio.

### Why the presenter is its own node

Workers produce **data**, not prose. Swapping markdown for generative UI in Part 4 changed exactly
one function body — no worker was touched. If each worker had written its own answer, that swap
would have been a rewrite.

### Why comparison logic lives in the MCP server

`compare_products` returns `numeric`, `differs`, `range`, `spread_pct`, `leaders`, and a `caveat`
where one applies — facts only. `identical_rows` tells the model what *cannot* differentiate.

The caveat matters: `hp-004` is a **wired** reference headphone with `battery_hours: 0`. Looking at
`0 < 24 < 32`, a model concludes "terrible battery" — confident, fluent, wrong. The tool says so
explicitly instead.

### Why shared state beats prompt-stuffing

Clicking a card writes `selected_product_ids` into agent state, so *"is this one good for gaming?"*
resolves with nothing named. The alternative — pasting the product into the system prompt — goes
stale on the next click, costs tokens every turn, and is the first thing dropped by compaction.

`useSharedSelection` only ever pushes to the agent from a **user gesture**, never from an effect
watching state. That's what stops the bidirectional loop.

### Why `interrupt()` rather than a React confirm dialog

`add_to_cart` pauses the graph with `interrupt()`. The run **finishes** and the pending state is
written to the checkpointer — nothing is held in memory. Reload the page mid-confirmation and the
pause is still there. A dialog in React is a promise the client keeps; a checkpointed interrupt is a
promise the server keeps.

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

If those properties don't match `AgentState`, restart. Killing the port holder is not enough — it
spawns a child process that must go too.

### The A2UI subagent invents data it wasn't given

It builds its own prompt from `ag-ui.context` and `state["messages"]` — **never** from the
presenter's prompt. Asked to render products it had never seen, it produced a beautifully laid-out
card for a *Sony WH-1000XM4 at $349.99*, which this catalog does not contain. Facts must be injected
through `ag-ui.context`; see `state_with_render_data` in [a2ui.py](apps/agent/src/agent/a2ui.py).

### Two packages disagree on one metadata key

To stop a node's prose streaming into the chat, set `metadata["emit-messages"] = False` — the key
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

`"agent.graph:graph"`, never `"./src/agent/graph.py:graph"` — the file form loads the module
standalone and every relative import dies with *"attempted relative import with no known parent
package"*.

### The runtime route must be a catch-all

`createCopilotEndpoint` returns a **Hono app** that registers several paths under `basePath`, so it
lives at `app/api/copilotkit/[[...rest]]/route.ts` and is exported as `app.fetch` — assigning the
app directly to `POST` fails Next's `RouteHandlerConfig`.

### Ports: probe by connecting, not by binding

`next dev` binds dual-stack on `::`. Trying to bind `127.0.0.1` succeeds anyway and reports the port
free while the site is up.

---

## Troubleshooting

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

---

## Design decisions worth knowing

| Decision | Why |
|---|---|
| Data at the repo root | Two runtimes read it; putting it in either app forces a service boundary |
| Web search is strict AND, agent search is scored | A human sees the box and retypes; an agent fires once and never learns what it missed |
| Synonyms in the MCP server | `"noise cancelling"` found 2 of 6 ANC models before; products said *"cancellation"* and *"ANC"* |
| Comparison direction not in code | LLM judgement by choice; the tool ships facts, ranges and caveats so that judgement is reliable |
| `catalog_agent` cannot see `add_to_cart` | Withholding a tool beats instructing the model not to use it — and costs no context |
| Design tokens in one CSS file | `.a2ui-surface` maps 8 renderer variables onto them, so agent-invented UI tracks the app's theme |
| Dynamic A2UI schema | Surfaces nobody designed in advance, at the cost of an extra LLM call and per-turn variation |

---

## Build log

- [x] **Part 0** — monorepo skeleton & seed data
- [x] **Part 1** — React product catalog (standalone)
- [x] **Part 2** — MCP tool server (standalone)
- [x] **Part 3** — LangGraph multi-agent (standalone)
- [x] **Part 4** — CopilotKit runtime + A2UI
- [x] **Part 5** — bidirectional state & frontend tools
- [x] **Part 6** — one-command startup, docs, preflight
