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


def prune_dangling_tool_calls(messages: Any) -> Any:
    """Drop tool calls that never received a result, and results with no call.

    OpenAI enforces a pairing rule: every assistant message carrying
    `tool_calls` must be followed by a tool message for each `tool_call_id`.
    Break it and the whole request is rejected:

        400 - An assistant message with 'tool_calls' must be followed by tool
        messages responding to each 'tool_call_id'. The following tool_call_ids
        did not have response messages: call_xPmdTUzOyOhRWScbmjuSr6aV

    The history reaching this graph is not ours. CopilotKit reconstructs it in
    the browser from the event stream and sends it back as graph input, so a
    tool call whose result never made it into that reconstruction arrives here
    unanswered. `render_a2ui` is the usual culprit: it is answered by the A2UI
    middleware rather than by a tool message the client records.

    The damage is not where you would look for it. The turn that produced the
    orphan succeeds. It is the NEXT turn that dies, inside the A2UI subagent,
    because the subagent builds its prompt from this same history. The user sees
    a correct text answer with no UI beneath it and no error in the chat.

    Pruning rather than repairing: a synthesised tool result would be a lie
    about what happened, and the model reads it.
    """
    if not isinstance(messages, list):
        return messages

    answered = {
        getattr(m, "tool_call_id", None)
        for m in messages
        if getattr(m, "type", None) == "tool"
    }
    answered.discard(None)

    kept: list[Any] = []
    issued: set[str] = set()

    for message in messages:
        calls = getattr(message, "tool_calls", None)

        if calls:
            live = [c for c in calls if c.get("id") in answered]
            if len(live) == len(calls):
                issued.update(c["id"] for c in live if c.get("id"))
                kept.append(message)
                continue

            # Every call on this message went unanswered, and it says nothing
            # else. Keeping it contributes a rejected request and no meaning.
            if not live and not (getattr(message, "content", "") or "").strip():
                continue

            issued.update(c["id"] for c in live if c.get("id"))
            trimmed = message.model_copy(
                update={
                    "tool_calls": live,
                    # additional_kwargs carries its own copy of the raw call
                    # payload, and the API reads that too.
                    "additional_kwargs": {
                        k: v
                        for k, v in (getattr(message, "additional_kwargs", {}) or {}).items()
                        if k != "tool_calls"
                    },
                }
            )
            kept.append(trimmed)
            continue

        if getattr(message, "type", None) == "tool":
            # A result whose call we just removed, or that never had one, is
            # equally invalid in the other direction.
            if getattr(message, "tool_call_id", None) not in issued:
                continue

        kept.append(message)

    return kept


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
    # The subagent builds its own prompt from this history, so an unanswered
    # tool call anywhere in it rejects the whole request and no UI is generated.
    messages = state.get("messages") if isinstance(state, dict) else None
    if messages is not None:
        return {**state, "ag-ui": ag_ui, "messages": prune_dangling_tool_calls(messages)}
    return {**state, "ag-ui": ag_ui}


# ---------------------------------------------------------------------------
# Display projection
# ---------------------------------------------------------------------------
#
# An A2UI binding can only POINT AT a value that already exists. It cannot
# format one, concatenate two, or choose between them.
#
# The house style used to ask for exactly those things - "prices as $279",
# "brand and rating on one line", "out-of-stock products get a caption". None
# of them is expressible as a binding, so the subagent did the closest thing it
# could and shipped: a bare `229`, the brand with the rating silently dropped,
# and a LITERAL "Out of stock" on every card in the list, in-stock ones
# included. Nothing errored; the surface was simply wrong.
#
# Worse, it bound spec values as {"path": "specs/type"} - a nested path inside a
# List template, which resolves to nothing. Labels rendered, values came back
# empty.
#
# So the model no longer formats anything and never sees a nested object. Every
# string a card can display is precomputed here, flat, at the top level of each
# product. The subagent's only job is choosing which of them to show and where.

_SPEC_LABELS = {
    "anc": "Noise cancelling",
    "battery_hours": "Battery",
    "cpu": "Processor",
    "driver_mm": "Drivers",
    "gpu": "Graphics",
    "hot_swap": "Hot-swap",
    "panel_type": "Panel",
    "ram_gb": "Memory",
    "refresh_hz": "Refresh rate",
    "resolution": "Resolution",
    "screen_inches": "Screen",
    "screen_type": "Panel",
    "storage_gb": "Storage",
    "switch_type": "Switches",
    "water_resistance": "Water resistance",
    "weight_g": "Weight",
    "weight_kg": "Weight",
}

_SPEC_UNITS = {
    "battery_hours": " h",
    "driver_mm": " mm",
    "ram_gb": " GB",
    "refresh_hz": " Hz",
    "screen_inches": '"',
    "storage_gb": " GB",
    "weight_g": " g",
    "weight_kg": " kg",
}


def _spec_label(key: str) -> str:
    """A readable label, from the override map or derived from the key itself.

    Deriving the fallback keeps this list short instead of becoming a third copy
    of the one in apps/mcp - which the architecture forbids importing.
    """
    if key in _SPEC_LABELS:
        return _SPEC_LABELS[key]
    return key.replace("_", " ").capitalize()


def _spec_value(key: str, value: Any) -> str:
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return f"{value}{_SPEC_UNITS.get(key, '')}"


def _compact(count: int) -> str:
    if count >= 1000:
        return f"{count / 1000:.1f}K".replace(".0K", "K")
    return str(count)


def display_product(product: dict[str, Any]) -> dict[str, Any]:
    """One product, flattened into strings a binding can reach directly."""
    price = product.get("price")
    currency = "$" if product.get("currency", "USD") == "USD" else ""
    rating = product.get("rating")

    # Two spellings reach this function. search_products returns the raw catalog
    # row with `inStock`; compare_products returns its own projection with
    # `in_stock`. Reading only the first turned every compared product into
    # "Out of stock", because a missing key is falsey and nothing complains.
    if "inStock" in product:
        in_stock = bool(product["inStock"])
    elif "in_stock" in product:
        in_stock = bool(product["in_stock"])
    else:
        in_stock = True

    description = product.get("shortDescription") or product.get("summary")

    out: dict[str, Any] = {
        "id": product.get("id"),
        "name": product.get("name"),
        "imageUrl": product.get("imageUrl"),
        "imageAlt": product.get("imageAlt") or product.get("name"),
        "description": description,
        "priceLabel": f"{currency}{price:,.0f}" if isinstance(price, (int, float)) else "",
        "brandLine": " · ".join(
            part
            for part in (
                str(product.get("brand") or "").upper(),
                f"{rating} out of 5" if rating is not None else "",
                f"{_compact(product.get('reviewCount') or 0)} reviews"
                if product.get("reviewCount")
                else "",
            )
            if part
        ),
        # Always present, always correct for THIS product - so the subagent can
        # bind it unconditionally, which is the only thing it can do.
        "stockLabel": "In stock" if in_stock else "Out of stock",
    }

    # Specs as flat, pre-labelled lines. Four is what fits a chat-width card.
    specs = product.get("specs") or {}
    for i, (key, value) in enumerate(list(specs.items())[:4], start=1):
        out[f"spec{i}Label"] = _spec_label(key)
        out[f"spec{i}Value"] = _spec_value(key, value)
    for i in range(len(specs) + 1, 5):
        out[f"spec{i}Label"] = ""
        out[f"spec{i}Value"] = ""

    return out


def display_cart_item(item: dict[str, Any]) -> dict[str, Any]:
    """One cart line, flattened into the same field names a product uses.

    A cart line is not a catalog row. It arrives as `product_id`, `unit_price`,
    `quantity` and `line_total`, and carries none of `imageUrl`, `priceLabel`,
    `stockLabel` or the spec pairs that HOUSE_STYLE promises the subagent will
    be there.

    So the model was told a set of fields existed, found none of them, and had
    to improvise a tree whose every binding resolved to nothing. Giving the cart
    the same field names as every other surface means there is one shape to
    learn and one set of rules that applies everywhere.
    """
    unit = item.get("unit_price")
    line = item.get("line_total")
    quantity = item.get("quantity") or 1

    return {
        "id": item.get("product_id"),
        "name": item.get("name"),
        "imageUrl": item.get("imageUrl"),
        "imageAlt": item.get("imageAlt") or item.get("name"),
        "brandLine": str(item.get("brand") or "").upper(),
        "priceLabel": f"${unit:,.0f}" if isinstance(unit, (int, float)) else "",
        "quantityLabel": f"Qty {quantity}",
        "lineTotalLabel": f"${line:,.0f}" if isinstance(line, (int, float)) else "",
        "stockLabel": "In stock" if item.get("in_stock", True) else "Out of stock",
        # Present but empty, so a card template written for products binds
        # cleanly against a cart line instead of failing halfway down.
        "description": "",
        "spec1Label": "",
        "spec1Value": "",
        "spec2Label": "",
        "spec2Value": "",
        "spec3Label": "",
        "spec3Value": "",
        "spec4Label": "",
        "spec4Value": "",
    }


CART_LINE_CAP = 12
"""How many cart lines a single generated surface may contain.

The same ceiling as a product grid, and for the same reason. "add them all to
my cart" produced a 36-line cart, and the subagent was then asked to design a
component tree with 36 cards in it. The surface never arrived: the chat sat on
"Building interface" indefinitely while the model wrote a tree far larger than
anything the chat column could show.

Truncating the LIST is safe because the totals do not come from it. Subtotal and
item count are computed over the whole cart by the MCP server, so a shortened
surface still reports what is really in the cart, and says how many it is not
showing.
"""


def display_cart(cart: dict[str, Any]) -> dict[str, Any]:
    """A cart with its lines projected, capped, and its totals pre-formatted."""
    items = cart.get("items") if isinstance(cart.get("items"), list) else []
    subtotal = cart.get("subtotal")
    count = cart.get("item_count") or 0

    shown = items[:CART_LINE_CAP]
    hidden = len(items) - len(shown)

    return {
        **cart,
        "items": [display_cart_item(i) for i in shown],
        "subtotalLabel": (
            f"${subtotal:,.0f}" if isinstance(subtotal, (int, float)) else ""
        ),
        "itemCountLabel": f"{count} item" if count == 1 else f"{count} items",
        # Empty when everything fits, so the model can bind it unconditionally
        # and an empty Text renders as nothing.
        "truncatedLabel": (
            f"Showing {len(shown)} of {len(items)} lines" if hidden > 0 else ""
        ),
    }


def surface_for_display(surface: dict[str, Any] | None) -> dict[str, Any] | None:
    """Replace raw products in a surface with their display projections.

    `specs` and `tags` are dropped rather than merely discouraged. Leaving a
    nested object in the payload is an invitation to bind `specs/type` again,
    and the failure is silent when it happens.
    """
    if not isinstance(surface, dict):
        return surface
    data = surface.get("data")
    if not isinstance(data, dict):
        return surface
    products = data.get("products")
    if isinstance(products, list):
        return {
            **surface,
            "data": {**data, "products": [display_product(p) for p in products]},
        }

    # A comparison surface keeps its products one level down, under
    # `comparison`. Missing that branch meant compare views were the only place
    # in the app that showed no photograph and an unformatted price, which read
    # as a rendering bug rather than a projection that did not run.
    cart = data.get("cart")
    if isinstance(cart, dict):
        return {**surface, "data": {**data, "cart": display_cart(cart)}}

    comparison = data.get("comparison")
    if isinstance(comparison, dict) and isinstance(comparison.get("products"), list):
        return {
            **surface,
            "data": {
                **data,
                "comparison": {
                    **comparison,
                    "products": [
                        display_product(p) for p in comparison["products"]
                    ],
                },
            },
        }

    return surface
