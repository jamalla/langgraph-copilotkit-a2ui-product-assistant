"""Dynamic A2UI generation.

## How a surface actually gets painted

    <CopilotKitProvider>                      browser
        |  catalog + schema as AG-UI context
    CopilotRuntime({ a2ui: {} })              Node, @ag-ui/a2ui-middleware
        |  stamps the component schema as an AG-UI context entry
    ag_ui_langgraph                           splits it into state["ag-ui"]["a2ui_schema"]
        |
    presenter node                            binds generate_a2ui and calls it
        |
    generate_a2ui                             a SECOND llm designs the component tree,
        |                                     forced through tool_choice="render_a2ui",
        |                                     validated against the catalog, retried on error
    {"a2ui_operations": [...]}                returned as the tool result
        |
    a2ui middleware                           paints the surface

## Why "dynamic" and what it costs

You chose dynamic schema over fixed. The component tree is invented per turn by a
subagent rather than pre-authored by us. That buys surfaces nobody designed in
advance - the agent can lay out a comparison one turn and a cart the next - and
costs an extra LLM round trip plus the guarantee that the same question renders
identically twice.

The tradeoff is contained: the DECISION to render still lives in the graph
(the presenter only offers the tool when there is something to draw), so the
non-determinism is confined to layout, never to whether the user gets an answer.

## The awkward bit: ToolRuntime

`generate_a2ui` declares `runtime: ToolRuntime` so it can read
`state["ag-ui"]["a2ui_schema"]`. LangGraph injects that automatically inside a
`ToolNode`, but this graph runs its own tool loop, so we build the runtime by
hand - exactly as `ToolNode._afunc` does. `runtime` is filtered out of the
tool's public schema, so the model never sees it and never tries to fill it in.
"""

from __future__ import annotations

from typing import Any

from ag_ui_langgraph import get_a2ui_tools
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool
from langgraph.prebuilt.tool_node import ToolRuntime
from langgraph.runtime import get_runtime

from .design_rules import HOUSE_STYLE
from .llm import make_model

A2UI_TOOL_NAME = "generate_a2ui"

_tool: BaseTool | None = None


def render_tool() -> BaseTool:
    """The A2UI generation tool, built once per process.

    The model passed here is the SUBAGENT that designs the component tree - it
    is a separate call from the one that decides to render, and it is the one
    that pays for the extra latency.

    `composition_guide` carries your house style (design_rules.py). It is
    APPENDED to the built-in generation and design guidelines rather than
    replacing them, because those defaults carry protocol constraints the
    surface will not render without - exactly one component with id "root",
    relative paths inside List templates. To replace a block instead, pass
    `design_guidelines`; an empty string suppresses one entirely.
    """
    global _tool
    if _tool is None:
        _tool = get_a2ui_tools(
            {
                "model": make_model(),
                "guidelines": {"composition_guide": HOUSE_STYLE},
            }
        )
    return _tool


def needs_runtime(tool: BaseTool) -> bool:
    """Whether a tool expects an injected `runtime` argument.

    Checked against the FULL args schema rather than the model-facing one:
    injected arguments are deliberately hidden from `tool.args`, so asking the
    public schema would always say no.
    """
    fields = getattr(getattr(tool, "args_schema", None), "model_fields", {}) or {}
    return "runtime" in fields


def build_tool_runtime(
    *,
    state: Any,
    tool_call_id: str,
    config: RunnableConfig,
    tools: list[BaseTool],
) -> ToolRuntime:
    """Construct the runtime object LangGraph would normally inject.

    Mirrors `langgraph.prebuilt.tool_node.ToolNode._afunc`. Must be called from
    inside a running graph node - `get_runtime()` has no ambient runtime
    otherwise.
    """
    runtime = get_runtime()
    return ToolRuntime(
        state=state,
        tool_call_id=tool_call_id,
        config=config,
        context=runtime.context,
        store=runtime.store,
        stream_writer=runtime.stream_writer,
        tools=tools,
        execution_info=runtime.execution_info,
        server_info=runtime.server_info,
    )


def _context_entries(state: Any) -> list[Any]:
    ag_ui = (state.get("ag-ui") if isinstance(state, dict) else None) or {}
    return list(ag_ui.get("context") or [])


def _description(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(entry.get("description") or "")
    return str(getattr(entry, "description", "") or "")


def a2ui_is_available(state: Any) -> bool:
    """Whether a browser is attached and able to render a surface.

    ## Why this does not simply read `ag-ui.a2ui_schema`

    Because in THIS architecture that key is never set, and the reason is worth
    understanding.

    `ag_ui_langgraph` (Python) has a `split_a2ui_schema_context` helper that
    lifts the A2UI component schema out of the AG-UI context and into
    `state["ag-ui"]["a2ui_schema"]`. Every guide points at that key. It works
    perfectly - I tested it directly on the exact byte-identical description the
    browser sends, and it matched.

    It just never runs. That helper lives on the path where PYTHON serves the
    AG-UI endpoint (`LangGraphAGUIAgent` + FastAPI). We use the Node
    `LangGraphAgent`, which talks to `langgraph dev` over the LangGraph Platform
    HTTP API, so the Python adapter is not in the request path at all. The
    schema still arrives - as an ordinary context entry, alongside the catalog
    capabilities and the generation and design guidelines.

    So detect A2UI from the context entries that actually show up. The
    `inject_a2ui_tool` and `a2ui_schema` checks stay as a fallback for anyone who
    later switches to the Python-served path.

    Nothing about the miss was visible: `a2uiEnabled: true` on the runtime, four
    A2UI context entries on the wire, a surface ready to draw - and a gate that
    silently stayed shut, so every answer came back as markdown.
    """
    ag_ui = (state.get("ag-ui") if isinstance(state, dict) else None) or {}
    if ag_ui.get("inject_a2ui_tool") or ag_ui.get("a2ui_schema"):
        return True
    return any(_description(e).startswith("A2UI ") for e in _context_entries(state))


def a2ui_schema_from_state(state: Any) -> str | None:
    """The component schema, wherever it ended up.

    Prefers the split-out key; falls back to the context entry the Node adapter
    leaves in place.
    """
    ag_ui = (state.get("ag-ui") if isinstance(state, dict) else None) or {}
    schema = ag_ui.get("a2ui_schema")
    if schema:
        return str(schema)

    for entry in _context_entries(state):
        if _description(entry).startswith("A2UI Component Schema"):
            value = entry.get("value") if isinstance(entry, dict) else getattr(entry, "value", None)
            if value:
                return str(value)
    return None


RENDER_DATA_DESCRIPTION = (
    "Data to render. Use ONLY these exact products, names, prices, ratings and "
    "specs. Do NOT invent example products, do NOT substitute well-known real "
    "brands, and do NOT use placeholder values."
)


def state_with_render_data(state: Any, facts: str) -> dict[str, Any]:
    """Return a copy of state with the turn's findings added as A2UI context.

    ## Why this exists

    The A2UI subagent does not see the presenter's prompt. `prepare_a2ui_request`
    builds its own prompt from `build_context_prompt(state)` plus the
    conversation in `state["messages"]` - and our workers deliberately never
    write their findings into `messages`, they write them into `surface`.

    So the subagent was asked to "render the products" while being shown only
    the user's question. It did what a language model does with a plausible
    request and no data: it invented some. The first surface this graph ever
    painted advertised a **Sony WH-1000XM4 at $349.99** - a real product, a
    believable price, and not in our catalog at all.

    Nothing errored. The layout was correct, the prose was accurate, and the UI
    underneath it was fiction.

    `ag-ui.context` is the documented seam for this: `build_context_prompt`
    renders each entry as `## {description}` followed by its value, straight
    into the subagent's prompt. Putting the facts there is what makes the
    surface show the products we actually found.
    """
    ag_ui = dict((state.get("ag-ui") if isinstance(state, dict) else None) or {})
    ag_ui["context"] = [
        *(ag_ui.get("context") or []),
        {"description": RENDER_DATA_DESCRIPTION, "value": facts},
    ]
    return {**state, "ag-ui": ag_ui}
