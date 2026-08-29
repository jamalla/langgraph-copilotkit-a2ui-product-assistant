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
| [packages/a2ui-kit](packages/a2ui-kit/) | The generative-UI layer, reusable | pnpm · source-only | — |
| [apps/agent](apps/agent/) | LangGraph supervisor multi-agent | uv · Python 3.11 | 2024 |
| [apps/mcp](apps/mcp/) | MCP product-catalog tool server | uv · Python 3.11 | 8931 |
| [data/products.json](data/products.json) | 30 seeded products | — | — |

No cross-imports between the three services — they talk over HTTP. The one shared library is
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

It ships TypeScript source rather than a build output — `transpilePackages: ["@a2ui/kit"]` in
`next.config.ts` — so there is no build step to keep in sync.

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
| `pnpm check` | typecheck + all 59 tests |
| `pnpm smoke` | load the running app in headless Edge, fail on any console error |
| `pnpm check:all` | `check` + `smoke` (needs `pnpm dev` running) |
| `pnpm test:mcp` / `test:agent` | one suite |
| `pnpm preflight` | environment check on its own |
| `pnpm build` | production build of the web app |

---

## Learning it: the explainer

Open [`a2ui-explainer.html`](a2ui-explainer.html) in a browser — a standalone, twelve-step player
that traces one real question from typed sentence to mounted React. Each step names the file that
does the work, shows the code, and shows what that step produced on an actual run. Arrow keys to
step, space to play, number keys to jump.

No build, no server, no dependencies — one file you can send to someone.

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

Expanding a step shows what happens, the file path, the trap people hit there, and the live data —
step 4 shows the routing decision and refined query, step 5 the MCP calls and their results, step 8
the component types the subagent chose.

The colour bands mark the three boundaries, and most confusion in this stack is about which side of
one you are on: browser → runtime, runtime → agent, agent → browser.

Each collapsed step shows what it did — `search_products`, `product_grid · 3 products`,
`40 components`, `3 operations` — so the whole turn reads at a glance. Expand one for the
explanation, the file path, and the trap people hit there.

On by default in development (`showJourney` on `<A2UIChatProvider>`), off in production.

### Making generated UI follow YOUR style

Two levers, and they do different jobs:

| Want to change | Edit | How it works |
|---|---|---|
| Colour, radius, type | [`packages/a2ui-kit/src/styles/a2ui-theme.css`](packages/a2ui-kit/src/styles/a2ui-theme.css) | 8 CSS variables scoped to `.a2ui-surface`, mapped to your tokens. Applies after the fact — **deterministic**, CSS cannot be ignored. |
| Which components, how arranged | [`apps/agent/src/agent/design_rules.py`](apps/agent/src/agent/design_rules.py) | Reaches the model that *designs* the tree. **Influential, not guaranteed** — it is a prompt. |

If you can express it in CSS, do it in CSS. Come to `design_rules.py` for what CSS cannot reach:
*"comparisons must be horizontal"*, *"never use Image"*, *"every card leads with the price"*.

The house style is passed as `composition_guide`, which is **appended** to the built-in guidelines
rather than replacing them — those defaults carry protocol constraints (exactly one component with
id `"root"`, relative paths inside `List` templates) that a surface will not render without.

Measured effect of adding the default rules in that file: component count on the same question
dropped from ~38 to **12**, and every rule held — no `Image`, `List` of `Card`, `h2` title outside
the list, `h3` product names, `caption` for metadata, `Row justify="spaceBetween"` for spec pairs.

### Going deeper: LangSmith

The panel shows a summary. LangSmith has the full tree — every prompt sent, token counts per call,
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

### "Nothing was found" is not "nothing was looked up"

Asked *"how many products do I have"*, the supervisor routed straight to the presenter — no tools,
no search — and the presenter replied **"No products were found in your catalog."** Nobody had
looked. That is a false statement about the user's own data, and it is the same confabulation
family as the invented Sony product.

Two halves to the fix: the supervisor now sends any question needing catalog data to
`catalog_agent` ("when unsure, choose catalog_agent — looking and finding nothing is recoverable,
asserting an answer without looking is not"), and the presenter is told explicitly that the
`no catalog work was done` marker means it knows nothing either way and must not describe the
catalog at all. `prompts.NO_WORK_MARKER` is shared by prompt and code so they cannot drift.

`list_categories` also now returns `total_products` and `category_count`, so catalog-wide questions
are answerable in one call instead of via a text search for the word "products" — which matches
nothing and looks exactly like an empty catalog.

### `useAgent().agent.state` is empty in the browser

The agent's state channels reach the client — `a2ui_trace` is plainly there in the `STATE_SNAPSHOT`
events on the wire — but `Object.keys(agent.state)` is `[]`. Three documented extension points were
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

`copilot-chat.css` pins the popup with `inset: auto 1.5rem 6rem auto` — 24px from the right, 96px
from the bottom to clear the launcher. A cap of `0.86 * innerHeight` looks safe and is not: on a
608px viewport it yields 523, and `523 + 96` pushes the popup's **top** to `-11`, so the resize
controls sit above the screen edge. `maxSize()` in `ChatResizer.tsx` and the `max-width` /
`max-height` in the CSS must both subtract the anchor offsets, and they must agree.

A saved size is also clamped to the current viewport on load and on every window resize — otherwise
maximising on a wide monitor and reopening on a laptop restores a popup wider than the screen.

### `langgraph dev` refuses blocking calls on its event loop

Resolving the LangSmith project URL uses `Client.read_project()` — a synchronous HTTP call. Inside a
node it fails with *"Blocking call to socket.socket.connect"*, because one blocked request would
stall every other run on the server. Wrap it: `await asyncio.to_thread(lookup)`.

Two related traps in the same helper. `RunTree.get_url()` raises `LangSmithError` on a local run
even when tracing is perfectly healthy, so the URL is built from `Client.read_project().url` plus
`/r/{run_id}` instead. And a single broad `try` around the whole lookup reported `enabled: false` on
a correctly configured setup — the failing URL call masked the healthy tracing state and sent me
checking env vars instead of the function. Guard each step separately.

### Tailwind does not scan a workspace package unless you tell it

Moving components into `packages/a2ui-kit` silently dropped **every Tailwind class they use**.
Tailwind 4 auto-detects sources relative to the stylesheet that imports it, and that detection stops
at the app. Nothing errors — the CSS simply is not generated, so the chat controls collapse to
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
someone wants it — the tool list most of all. `.copilotKitChat` is present as soon
as the popup opens and stays put.

### CopilotKit creates an empty thread on mount

`/threads/search` sorted newest-first returns that empty thread, not the one that
just rendered a surface. [`/api/a2ui-trace`](apps/web/app/api/a2ui-trace/route.ts)
therefore walks recent threads and takes the first that actually has an
`a2ui_trace`.

### The chat window only scales its outer container

Setting a size on the popup's outer container leaves `.copilotKitPopup` at its shipped 420×560
inside a 900×860 parent. Every layer between the container and the message list needs forcing to
fill, and `.copilotKitMessages` needs `min-height: 0` — without it a flex child grows instead of
scrolling. See [copilot-chat.css](apps/web/app/copilot-chat.css).

CSS `resize` only ever puts its grip in the bottom-right corner, which on a bottom-right-anchored
panel drags the window off-screen — hence the custom top-left handle in
[ChatResizer.tsx](apps/web/components/ChatResizer.tsx).

### `ag-ui.a2ui_schema` is never set on the Node-adapter path

Every A2UI guide says to read the component catalog from `state["ag-ui"]["a2ui_schema"]`, populated
by `ag_ui_langgraph`'s `split_a2ui_schema_context`. That helper works — it matches the
byte-identical description the browser sends. **It just never runs here.**

It lives on the path where *Python* serves the AG-UI endpoint (`LangGraphAGUIAgent` + FastAPI). This
project uses the Node `LangGraphAgent` talking to `langgraph dev` over the LangGraph Platform HTTP
API, so the Python adapter is not in the request path at all. The schema still arrives — as an
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
  stream; detaching callbacks silences the surface entirely (verified — surface count drops to 0).

### A phantom tool call eats every answer

Any turn that used a tool rendered an **empty bubble**. The server was flawless: the browser
received `TEXT_MESSAGE_START/CONTENT/END` and a final `MESSAGES_SNAPSHOT` holding the correct
assistant message. CopilotKit still ended up with `assistant(content: "", toolCalls: [...])`.

Cause: this graph runs its own tool loop rather than a `ToolNode`, so LangChain fires
`on_tool_start`/`on_tool_end` for each MCP call and `ag_ui_langgraph` synthesises AG-UI tool-call
events from them — with **no `toolCallId` and no `toolCallName`**, because the ids live in the
ToolNode machinery being bypassed. That id-less, unpaired event corrupts the client's message
reconstruction and takes the presenter's text with it. It also poisons the thread: later runs lose
earlier answers from their snapshot.

Fix — detach the MCP call from the callback tree:

```python
result = await tool.ainvoke(call["args"], config={"callbacks": []})
```

Two traps around it. Omitting `config=` entirely is **not** enough — LangChain picks the callback
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
[lib/agent-state.ts](apps/web/lib/agent-state.ts) is the single source of truth, used by the
runtime's `agents` map, the chat component and all three hooks.

**Nothing in this repo caught it.** `tsc` was clean, 45 tests passed, and driving the runtime with
`curl` produced a perfect A2UI surface — because none of those ever mount React.
[`pnpm smoke`](scripts/smoke-browser.mjs) exists for exactly this class of bug: it loads the app in
headless Edge and fails on any console error.

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
