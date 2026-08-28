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

from .llm import make_model

A2UI_TOOL_NAME = "generate_a2ui"

_tool: BaseTool | None = None


def render_tool() -> BaseTool:
    """The A2UI generation tool, built once per process.

    The model passed here is the SUBAGENT that designs the component tree - it
    is a separate call from the one that decides to render, and it is the one
    that pays for the extra latency.
    """
    global _tool
    if _tool is None:
        _tool = get_a2ui_tools({"model": make_model()})
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


def a2ui_is_available(state: Any) -> bool:
    """Whether a browser is attached and expecting a rendered surface.

    The signal is `inject_a2ui_tool`, which the A2UI middleware forwards when
    the runtime has `a2ui` configured. It is NOT `a2ui_schema`.

    That distinction cost an afternoon. Gating on `a2ui_schema` looks more
    correct - surely you need the catalog before you can design against it -
    but the schema is contributed by the BROWSER's catalog, so it is absent
    whenever the client does not send one, and the gate then silently fell back
    to markdown even though A2UI was fully configured and working.

    A missing schema is not fatal: the subagent still knows the A2UI v0.9 basic
    catalog from its own guidelines and produces valid operations without it.
    The schema only makes the components it picks more accurate. So: render
    whenever we are asked to, and treat the schema as an enhancement.
    """
    ag_ui = (state.get("ag-ui") if isinstance(state, dict) else None) or {}
    return bool(ag_ui.get("inject_a2ui_tool") or ag_ui.get("a2ui_schema"))


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
