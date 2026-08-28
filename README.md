# A2UI Product Assistant

A polyglot monorepo of **three independent services** that compose into one generative-UI product
assistant: an agent that doesn't just *describe* products, it **renders live UI** into the chat.

```
Browser ──────────────────────────────────────────────────────┐
  React product grid  ⟷  <CopilotKit> provider + A2UI catalog │
                                    │ HTTP /api/copilotkit    │
  Next.js route  →  CopilotRuntime v2 (A2UI middleware)       │ :3000
                                    │ AG-UI over HTTP         │
  langgraph dev  →  supervisor → catalog / compare / recommend│ :2024
                                    │ MCP streamable-http     │
  FastMCP server →  search / detail / compare / stock tools   │ :8931
                                    │
  data/products.json (single source of truth)                 │
```

## Layout

| Path | What it is | Toolchain | Port |
|---|---|---|---|
| `apps/web` | React catalog + CopilotKit runtime | pnpm / Next.js | 3000 |
| `apps/agent` | LangGraph multi-agent | uv / Python | 2024 |
| `apps/mcp` | MCP product-catalog tool server | uv / Python | 8931 |
| `data/products.json` | Seed catalog, read by `web` and `mcp` | — | — |

Each app is genuinely independent — no cross-imports, no shared build graph. They talk over HTTP.

## Build status

- [x] **Part 0** — monorepo skeleton & seed data
- [x] **Part 1** — React product catalog (standalone)
- [x] **Part 2** — MCP tool server (standalone)
- [x] **Part 3** — LangGraph multi-agent (standalone)
- [x] **Part 4** — CopilotKit runtime + A2UI
- [x] **Part 5** — bidirectional state & frontend tools
- [ ] **Part 6** — run everything, document, harden

## Gotchas found the hard way

**`langgraph dev` does not reliably hot-reload.** It logs "changes detected" constantly, but a
changed **state schema** or a newly imported module can keep serving the old graph. Symptom: your
edit has no effect and nothing errors. Check what is actually loaded:

```bash
AID=$(curl -s -X POST localhost:2024/assistants/search -H 'content-type: application/json'   -d '{"limit":1}' | python -c "import sys,json;print(json.load(sys.stdin)[0]['assistant_id'])")
curl -s localhost:2024/assistants/$AID/schemas | python -m json.tool | head -30
```

If the properties do not match `AgentState`, restart the agent. Killing the port holder is not
enough — it spawns a child:

```bash
pnpm dev:agent   # after stopping BOTH the listener and its child process
```

**`langgraph.json` must use the module form.** `"agent.graph:graph"`, never
`"./src/agent/graph.py:graph"` — the file form loads the module standalone and every relative
import dies with "attempted relative import with no known parent package".

**Two packages disagree on one metadata key.** To stop a node's prose streaming into the chat,
set `metadata["emit-messages"] = False` — the key `ag_ui_langgraph` reads. Do *not* use
`copilotkit_customize_config(..., emit_messages=False)`: it writes the **prefixed**
`copilotkit:emit-messages`, which `ag_ui_langgraph` never looks at. It type-checks, runs clean,
and does nothing.

**The CopilotKit runtime route must be a catch-all.** `createCopilotEndpoint` returns a Hono app
that registers several paths under `basePath`, so it lives at `app/api/copilotkit/[[...rest]]/`
and is exported as `app.fetch`, not assigned directly to `POST`.

## Getting started

```bash
cp .env.example .env      # then set OPENAI_API_KEY (needed from Part 3 onward)
pnpm install
pnpm verify:data
```

Full run instructions land in Part 6.
