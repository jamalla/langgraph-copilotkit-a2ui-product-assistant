"""Graph state.

`CopilotKitState` is `MessagesState` (a `messages` list with an add-messages
reducer) plus a `copilotkit` key that the CopilotKit middleware owns - frontend
actions, shared context, and some private bookkeeping. Inheriting from it is
what makes Parts 4 and 5 possible; a plain `MessagesState` would work fine
today and then need rewriting.

Everything else here is ours. Two rules kept these fields honest:

  * Anything the FRONTEND needs to see goes in state, not in the message text.
    Part 5 binds `selected_product_ids` to the React grid in both directions.
  * Anything a LATER NODE needs goes in state, not re-fetched. `last_results`
    exists so the presenter can render what the catalog agent already found
    without paying for a second MCP round trip.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, TypedDict

from copilotkit import CopilotKitState
from typing_extensions import TypedDict as ExtTypedDict

Intent = Literal["search", "compare", "recommend", "cart", "chitchat"]

WorkerName = Literal["catalog_agent", "compare_agent", "recommend_agent", "presenter"]


class SurfaceSpec(TypedDict, total=False):
    """What the presenter should draw.

    In Part 3 the presenter renders this as markdown. In Part 4 the very same
    dict becomes an A2UI data model - which is the whole reason the workers
    describe their output as data rather than writing prose themselves.
    """

    kind: Literal["product_grid", "compare_table", "recommendation", "cart", "none"]
    title: str
    data: dict[str, Any]


def last_write_wins(current: Any, incoming: Any) -> Any:
    """Reducer for per-turn scratch values.

    Without an explicit reducer LangGraph would still overwrite, but writing it
    down makes the intent visible: these fields describe THIS turn only and are
    expected to be replaced wholesale, unlike `messages`, which accumulates.
    """
    return incoming if incoming is not None else current


# `ag-ui` is not a valid Python identifier, so this channel has to be declared
# with the FUNCTIONAL TypedDict form. It must be `typing_extensions.TypedDict`
# rather than `typing.TypedDict` - mixing the two raises a metaclass conflict
# when combined with CopilotKitState.
#
# Declaring these matters: `ag_ui_langgraph` passes `ag-ui` and `tools` as graph
# INPUT, and LangGraph silently drops input keys that have no channel. Without
# them, `state["ag-ui"]["a2ui_schema"]` is never there and the A2UI subagent
# designs surfaces against no catalog at all.
AgUiChannels = ExtTypedDict(
    "AgUiChannels",
    {
        # {"tools": [...], "context": [...], "a2ui_schema": ..., "inject_a2ui_tool": bool}
        "ag-ui": Annotated[dict[str, Any] | None, last_write_wins],
        # Frontend tools forwarded by the runtime. Used in Part 5.
        "tools": Annotated[list[Any] | None, last_write_wins],
    },
    total=False,
)


class AgentState(CopilotKitState, AgUiChannels):
    """State for the product assistant graph."""

    # --- routing, set by the supervisor ---
    intent: Annotated[Intent | None, last_write_wins]
    """What the supervisor decided this turn is about."""

    route_reason: Annotated[str | None, last_write_wins]
    """Why it routed that way. Surfaced in Studio; makes debugging routing sane."""

    refined_query: Annotated[str | None, last_write_wins]
    """The user's request rewritten as search terms, so workers do not re-parse it."""

    # --- work products, set by the workers ---
    last_results: Annotated[list[dict[str, Any]] | None, last_write_wins]
    """Products the catalog agent found, carried to the presenter unfetched."""

    comparison: Annotated[dict[str, Any] | None, last_write_wins]
    """Raw matrix from the MCP compare_products tool."""

    surface: Annotated[SurfaceSpec | None, last_write_wins]
    """The presenter's instructions. Becomes the A2UI data model in Part 4."""

    tools_used: Annotated[list[dict[str, Any]] | None, last_write_wins]
    """Which MCP tools the worker called this turn, and with what arguments.

    Explanatory, like `a2ui_trace`: the agent never reads it. It exists so the
    journey panel can show the step where the catalog was actually queried.
    """

    a2ui_trace: Annotated[dict[str, Any] | None, last_write_wins]
    """How the last surface was built, for the pipeline panel in the UI.

    Purely explanatory: the agent never reads it. It exists so the browser can
    show the four steps between "products found" and "UI on screen", which are
    otherwise invisible — the interesting part of generative UI is exactly the
    part that normally leaves no trace.
    """

    # --- shared with the browser (Part 5 makes this bidirectional) ---
    selected_product_ids: Annotated[list[str] | None, last_write_wins]
    """Products under discussion. Written by the agent AND by clicks in the grid."""


def empty_turn() -> dict[str, Any]:
    """Clear last turn's scratch state.

    The supervisor applies this on every turn. Without it, a follow-up question
    inherits the previous turn's `comparison`, and the presenter cheerfully
    re-renders a stale table for a question that had nothing to do with it.
    `messages` and `selected_product_ids` deliberately survive - they are the
    conversation, not the scratchpad.
    """
    return {
        "intent": None,
        "route_reason": None,
        "refined_query": None,
        "last_results": None,
        "comparison": None,
        "surface": None,
        "tools_used": None,
        "a2ui_trace": None,
    }
