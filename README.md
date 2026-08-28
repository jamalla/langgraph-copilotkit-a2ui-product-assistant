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
- [ ] **Part 2** — MCP tool server (standalone)
- [ ] **Part 3** — LangGraph multi-agent (standalone)
- [ ] **Part 4** — CopilotKit runtime + A2UI
- [ ] **Part 5** — bidirectional state & frontend tools
- [ ] **Part 6** — run everything, document, harden

## Getting started

```bash
cp .env.example .env      # then set OPENAI_API_KEY (needed from Part 3 onward)
pnpm install
pnpm verify:data
```

Full run instructions land in Part 6.
