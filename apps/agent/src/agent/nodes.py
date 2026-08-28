"""Graph nodes: one supervisor, four workers, one presenter.

The shape is a SUPERVISOR pattern: one routing decision per turn, then a single
specialist, then rendering. The alternative - a swarm, where agents hand off to
each other freely - buys flexibility this problem does not need and costs you
the ability to say why anything happened.

Two structural choices are worth calling out, because Part 4 depends on both:

1. Workers produce DATA, not prose. Each one writes a `surface` dict describing
   what should be drawn. Today the presenter renders that as markdown; in Part 4
   the exact same dict becomes an A2UI data model. Nothing else changes.

2. The presenter is its own node. Separating "decide and fetch" from "render" is
   what makes swapping markdown for generative UI a one-node change instead of a
   rewrite of every worker.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.types import Command
from pydantic import BaseModel, Field

from . import prompts
from .llm import make_model
from .state import AgentState, SurfaceSpec, empty_turn
from .tools import tools_for

MAX_TOOL_ITERATIONS = 4
"""How many times a worker may call tools before we stop it.

Not a safety net - a budget. A worker that has not answered after four rounds of
tool calls is looping, and looping quietly is worse than stopping loudly.
"""


# --------------------------------------------------------------------- helpers


def _last_user_text(messages: list[BaseMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            return message.text or ""
    return ""


def _conversation_tail(messages: list[BaseMessage], limit: int = 8) -> list[BaseMessage]:
    """Recent turns only.

    The supervisor needs enough history to resolve "compare the top two", and
    nothing beyond that. Sending the whole thread costs tokens and, worse, lets
    an old topic pull the routing decision off course.
    """
    return [m for m in messages if isinstance(m, (HumanMessage, AIMessage))][-limit:]


def _unwrap_tool_result(result: Any) -> Any:
    """Normalise whatever an MCP tool hands back into plain Python.

    This is the shape that actually bit during Part 3. `langchain-mcp-adapters`
    does not return the tool's JSON - it returns a list of MCP CONTENT BLOCKS:

        [{"type": "text", "text": "{\"count\": 3, \"products\": [...]}"}]

    So the payload is a JSON string nested inside a list of dicts. Code that
    checked `isinstance(payload, dict)` silently matched nothing, every worker
    reported zero products, and the only reason the answers looked right was
    that the presenter was reading product names out of the model's prose. That
    is a fluent, confident, unsourced answer - the exact failure this pipeline
    is built to avoid.

    Handles all three shapes: already-parsed objects, a bare JSON string, and
    the content-block list.
    """
    if isinstance(result, dict):
        return result

    if isinstance(result, list):
        texts = [
            block["text"]
            for block in result
            if isinstance(block, dict) and block.get("type") == "text" and "text" in block
        ]
        if texts:
            return _unwrap_tool_result("".join(texts))
        return result

    if isinstance(result, str):
        try:
            return json.loads(result)
        except (TypeError, ValueError):
            return result

    return result


def _to_message_content(result: Any) -> str:
    """Serialise a tool result for the message the model sees next."""
    if isinstance(result, str):
        return result
    return json.dumps(result, default=str)


async def _run_tool_loop(
    *,
    worker: str,
    system: str,
    user_text: str,
    context: str | None = None,
    config: RunnableConfig | None = None,
) -> tuple[str, list[tuple[str, Any]]]:
    """Run one worker to completion.

    Returns the worker's final text plus every (tool_name, parsed_result) pair
    it produced. Callers read their structured state out of those results, NOT
    out of the text - the model's prose is a summary, the tool output is the
    fact.
    """
    tools = await tools_for(worker)
    model = make_model().bind_tools(tools)
    by_name = {t.name: t for t in tools}

    messages: list[BaseMessage] = [SystemMessage(content=system)]
    if context:
        messages.append(SystemMessage(content=context))
    messages.append(HumanMessage(content=user_text))

    collected: list[tuple[str, Any]] = []

    for _ in range(MAX_TOOL_ITERATIONS):
        reply: AIMessage = await model.ainvoke(messages, config=config)
        messages.append(reply)

        if not reply.tool_calls:
            return (reply.text or "").strip(), collected

        for call in reply.tool_calls:
            tool = by_name.get(call["name"])
            if tool is None:
                messages.append(
                    ToolMessage(
                        content=f"Tool {call['name']!r} is not available to you.",
                        tool_call_id=call["id"],
                    )
                )
                continue
            try:
                result = await tool.ainvoke(call["args"], config=config)
            except Exception as exc:  # a failed tool is data, not a crash
                result = {"error": f"{type(exc).__name__}: {exc}"}

            parsed = _unwrap_tool_result(result)
            messages.append(
                ToolMessage(
                    content=_to_message_content(parsed), tool_call_id=call["id"]
                )
            )
            collected.append((call["name"], parsed))

    return (
        "I ran out of steps before finishing that. Could you narrow it down?",
        collected,
    )


def _results_from(collected: list[tuple[str, Any]], tool_name: str) -> Any | None:
    """Most recent result for a given tool, or None."""
    for name, payload in reversed(collected):
        if name == tool_name:
            return payload
    return None


def _products_found(collected: list[tuple[str, Any]]) -> list[dict[str, Any]]:
    """Every product seen across all searches this turn, de-duplicated in order."""
    seen: dict[str, dict[str, Any]] = {}
    for name, payload in collected:
        if not isinstance(payload, dict):
            continue
        if name == "search_products":
            for product in payload.get("products", []):
                seen.setdefault(product["id"], product)
        elif name == "get_product" and "id" in payload:
            seen.setdefault(payload["id"], payload)
    return list(seen.values())


# ------------------------------------------------------------------ supervisor


SupervisorDestination = Literal[
    "catalog_agent", "compare_agent", "recommend_agent", "cart_agent", "presenter"
]


class Route(BaseModel):
    """The supervisor's decision, as a schema the model must fill in.

    Structured output rather than "reply with one word": the model cannot
    return something unroutable, so the graph never has to guess what it meant.
    """

    next_agent: SupervisorDestination = Field(
        description="The single specialist that should handle this turn."
    )
    intent: Literal["search", "compare", "recommend", "cart", "chitchat"] = Field(
        description="What the turn is about, in one word."
    )
    reason: str = Field(description="One short sentence on why this route. Shown in traces.")
    refined_query: str = Field(
        default="",
        description="The request as 1-4 plain search terms, filler removed. Empty for presenter.",
    )
    product_ids: list[str] = Field(
        default_factory=list,
        description="Product ids the turn is about, if the conversation already named them.",
    )


async def supervisor(
    state: AgentState, config: RunnableConfig
) -> Command[SupervisorDestination]:
    """Decide who handles this turn, and clear the last turn's scratch state.

    The `Command[SupervisorDestination]` return annotation is load-bearing, not
    decoration. `Command(goto=...)` routes correctly at runtime either way, but
    without the annotation LangGraph cannot SEE those edges: it infers that this
    node has no outgoing edge, draws `supervisor -> __end__`, and prunes every
    worker as unreachable. Studio then shows you a two-node graph that has
    nothing to do with what actually runs.
    """
    messages = state["messages"]
    model = make_model().with_structured_output(Route)

    history = "\n".join(
        f"{'User' if isinstance(m, HumanMessage) else 'Assistant'}: {m.text or ''}"
        for m in _conversation_tail(messages)
    )
    known = state.get("selected_product_ids") or []

    route: Route = await model.ainvoke(
        [
            SystemMessage(content=prompts.SUPERVISOR),
            HumanMessage(
                content=(
                    f"Conversation so far:\n{history}\n\n"
                    f"Products already under discussion: {known or 'none'}\n\n"
                    "Route the most recent user turn."
                )
            ),
        ],
        config=config,
    )

    update: dict[str, Any] = {
        **empty_turn(),
        "intent": route.intent,
        "route_reason": route.reason,
        "refined_query": route.refined_query or _last_user_text(messages),
    }
    if route.product_ids:
        update["selected_product_ids"] = route.product_ids

    return Command(goto=route.next_agent, update=update)


# --------------------------------------------------------------------- workers


async def catalog_agent(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    """Find products."""
    summary, collected = await _run_tool_loop(
        worker="catalog_agent",
        system=prompts.CATALOG,
        user_text=_last_user_text(state["messages"]),
        context=f"Search terms suggested by the router: {state.get('refined_query') or 'none'}",
        config=config,
    )

    products = _products_found(collected)
    surface: SurfaceSpec = {
        "kind": "product_grid" if products else "none",
        "title": f"{len(products)} matching products" if products else "No matches",
        "data": {"products": products, "note": summary},
    }
    return {
        "last_results": products,
        "surface": surface,
        "selected_product_ids": [p["id"] for p in products[:4]],
    }


async def compare_agent(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    """Place known products side by side."""
    known = state.get("selected_product_ids") or [
        p["id"] for p in (state.get("last_results") or [])[:4]
    ]

    verdict, collected = await _run_tool_loop(
        worker="compare_agent",
        system=prompts.COMPARE,
        user_text=_last_user_text(state["messages"]),
        context=f"Products already under discussion: {known or 'none identified yet'}",
        config=config,
    )

    matrix = _results_from(collected, "compare_products")
    surface: SurfaceSpec = {
        "kind": "compare_table" if isinstance(matrix, dict) and matrix.get("ok") else "none",
        "title": "Side by side",
        "data": {"comparison": matrix, "verdict": verdict},
    }
    return {
        "comparison": matrix if isinstance(matrix, dict) else None,
        "surface": surface,
        "selected_product_ids": (
            [p["id"] for p in matrix["products"]]
            if isinstance(matrix, dict) and matrix.get("ok")
            else known
        ),
    }


async def recommend_agent(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    """Choose for the user."""
    advice, collected = await _run_tool_loop(
        worker="recommend_agent",
        system=prompts.RECOMMEND,
        user_text=_last_user_text(state["messages"]),
        context=f"Search terms suggested by the router: {state.get('refined_query') or 'none'}",
        config=config,
    )

    products = _products_found(collected)
    stock = _results_from(collected, "check_stock")
    surface: SurfaceSpec = {
        "kind": "recommendation" if products else "none",
        "title": "Recommendation",
        "data": {"products": products[:3], "advice": advice, "stock": stock},
    }
    return {
        "last_results": products,
        "surface": surface,
        "selected_product_ids": [p["id"] for p in products[:3]],
    }


async def cart_agent(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    """Read or change the cart."""
    note, collected = await _run_tool_loop(
        worker="cart_agent",
        system=prompts.CART,
        user_text=_last_user_text(state["messages"]),
        config=config,
    )

    cart = _results_from(collected, "view_cart")
    if cart is None:
        for name, payload in reversed(collected):
            if name in ("add_to_cart", "remove_from_cart") and isinstance(payload, dict):
                cart = payload.get("cart")
                break

    surface: SurfaceSpec = {
        "kind": "cart" if isinstance(cart, dict) else "none",
        "title": "Your cart",
        "data": {"cart": cart, "note": note},
    }
    return {"surface": surface}


# -------------------------------------------------------------------- presenter


def _render_markdown(surface: SurfaceSpec | None) -> str:
    """Turn a surface spec into text.

    This is the ONLY node that decides how anything looks, which is exactly why
    Part 4 can replace its body with A2UI operations and leave every worker
    untouched.
    """
    if not surface or surface.get("kind") == "none":
        return ""

    kind = surface["kind"]
    data = surface.get("data", {})

    if kind == "product_grid":
        products = data.get("products", [])
        if not products:
            return ""
        lines = [
            f"- **{p['name']}** ({p['brand']}) — ${p['price']:,} · {p['rating']}★"
            + ("" if p["inStock"] else " · _out of stock_")
            for p in products[:6]
        ]
        return "\n".join(lines)

    if kind == "compare_table":
        matrix = data.get("comparison") or {}
        if not matrix.get("ok"):
            return ""
        names = {p["id"]: p["name"] for p in matrix["products"]}
        header = "| Spec | " + " | ".join(names.values()) + " |"
        divider = "|---" * (len(names) + 1) + "|"
        rows = [
            "| "
            + row["label"]
            + " | "
            + " | ".join(str(row["values"].get(pid, "—")) for pid in names)
            + " |"
            for row in matrix["rows"]
            if row["differs"]
        ][:10]
        return "\n".join([header, divider, *rows])

    if kind == "recommendation":
        products = data.get("products", [])
        return "\n".join(
            f"- **{p['name']}** — ${p['price']:,} · {p['rating']}★" for p in products[:3]
        )

    if kind == "cart":
        cart = data.get("cart") or {}
        items = cart.get("items", [])
        if not items:
            return "_Your cart is empty._"
        lines = [f"- {i['name']} × {i['quantity']} — ${i['line_total']:,}" for i in items]
        lines.append(f"\n**Subtotal: ${cart.get('subtotal', 0):,.0f}**")
        return "\n".join(lines)

    return ""


async def presenter(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    """Write the single message the user actually reads."""
    surface = state.get("surface")
    model = make_model()

    facts = json.dumps(surface, default=str)[:6000] if surface else "no catalog work was done"

    reply = await model.ainvoke(
        [
            SystemMessage(content=prompts.PRESENTER),
            HumanMessage(
                content=(
                    f"User asked: {_last_user_text(state['messages'])}\n\n"
                    f"What was found (JSON):\n{facts}\n\n"
                    "Write the answer."
                )
            ),
        ],
        config=config,
    )

    prose = (reply.text or "").strip()
    rendered = _render_markdown(surface)
    content = f"{prose}\n\n{rendered}".strip() if rendered else prose

    return {"messages": [AIMessage(content=content)]}
