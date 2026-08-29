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
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field

from . import prompts
from .a2ui import (
    A2UI_TOOL_NAME,
    a2ui_is_available,
    build_tool_runtime,
    needs_runtime,
    render_tool,
    state_with_render_data,
)
from .llm import make_model
from .state import AgentState, SurfaceSpec, empty_turn
from .tools import tools_for

def quiet(config: RunnableConfig | None, *, tool_calls: bool = True) -> RunnableConfig:
    """Stop a node's output from streaming into the chat.

    Every model call inside the graph streams to the AG-UI wire by default,
    which is right for the presenter and wrong for everyone else.

    Two independent knobs, both read per event by `ag_ui_langgraph`
    (agent.py: `should_emit_messages` / `should_emit_tool_calls`):

      emit-messages    the model's prose
      emit-tool-calls  the tool calls it makes

    Workers keep `tool_calls=True`: seeing "searching the catalog…" is real
    progress. The SUPERVISOR must pass `tool_calls=False`, and that is subtler
    than it looks — `with_structured_output(Route)` is implemented AS A TOOL
    CALL. Leave it visible and the client receives a tool call that never gets a
    result, because nothing executes it; the chat then renders an assistant
    bubble containing an orphan tool call and NO TEXT. The answer arrives
    perfectly on the wire and the user sees an empty message.

    Do NOT reach for `copilotkit.langgraph.copilotkit_customize_config` for any
    of this. It sets the PREFIXED `copilotkit:emit-messages`, which
    `ag_ui_langgraph` never reads. The call type-checks, runs clean, and does
    absolutely nothing.
    """
    config = dict(config or {})
    metadata = {**(config.get("metadata") or {}), "emit-messages": False}
    if not tool_calls:
        metadata["emit-tool-calls"] = False
    config["metadata"] = metadata
    return config  # type: ignore[return-value]


MAX_TOOL_ITERATIONS = 4
"""How many times a worker may call tools before we stop it.

Not a safety net - a budget. A worker that has not answered after four rounds of
tool calls is looping, and looping quietly is worse than stopping loudly.
"""


# --------------------------------------------------------------------- helpers


def _selection_note(state: AgentState) -> str | None:
    """The browser's current selection, phrased for a worker's system prompt.

    This is the READ half of shared state. The user clicks a card, the React app
    writes `selected_product_ids` into agent state, and every worker sees it -
    which is what lets "is this one good for gaming?" resolve without the user
    naming anything.

    Note what is NOT happening: the app is not stuffing a description of the
    product into the prompt text. It shares STATE, and the agent reads it. The
    value is always current, costs a handful of tokens, and survives context
    compaction - none of which is true of text jammed into a system prompt.
    """
    ids = state.get("selected_product_ids") or []
    if not ids:
        return None
    return prompts.SELECTION_NOTE.format(ids=", ".join(ids))


def _last_user_text(messages: list[BaseMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            return message.text or ""
    return ""


def _worker_context(state: AgentState, *extra: str) -> str:
    """Everything a worker should know before it starts, selection included."""
    parts = [part for part in extra if part]
    note = _selection_note(state)
    if note:
        parts.append(note)
    return "\n\n".join(parts)


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


def _confirm_write(call: dict[str, Any]) -> dict[str, Any]:
    """Pause the graph and ask the human before performing a write.

    `interrupt()` does something no ordinary `await` can: it SUSPENDS the graph
    and writes the pending state to the checkpointer. The HTTP run finishes,
    the browser renders a dialog, and the answer arrives later as a `Command`
    that resumes execution from exactly this line. Between those two moments
    nothing is held in memory - which is why the pause survives a page reload,
    a lost connection, or a server restart.

    That durability is the whole reason to use `interrupt()` here rather than
    confirming in React before calling the tool. A dialog in the browser is a
    promise the client has to keep; a checkpointed interrupt is a promise the
    server keeps.

    The dict below is what the frontend receives verbatim, so it carries
    everything the dialog needs to explain the action. Whatever `resolve()`
    sends back becomes this function's return value.
    """
    answer = interrupt(
        {
            "kind": "confirm_write",
            "tool": call["name"],
            "args": call["args"],
            "summary": _describe_write(call),
        }
    )
    if isinstance(answer, dict):
        return answer
    # A bare truthy/falsey resume is accepted too, so a minimal client works.
    return {"approved": bool(answer)}


def _describe_write(call: dict[str, Any]) -> str:
    """One plain sentence for the confirmation dialog."""
    args = call.get("args") or {}
    product_id = args.get("product_id", "?")
    if call["name"] == "add_to_cart":
        quantity = args.get("quantity", 1)
        unit = "unit" if quantity == 1 else "units"
        return f"Add {quantity} {unit} of {product_id} to your cart?"
    if call["name"] == "remove_from_cart":
        return f"Remove {product_id} from your cart?"
    return f"Run {call['name']}?"


WRITE_TOOLS = frozenset({"add_to_cart", "remove_from_cart"})
"""Tools that change state and therefore need a human to say yes.

Derived from the same asymmetry the MCP server's docstrings describe: a read can
be called speculatively and the worst case is wasted tokens; a write cannot be
taken back. This is the enforcement of that rule, rather than a restatement of it.
"""


async def _run_tool_loop(
    *,
    worker: str,
    system: str,
    user_text: str,
    context: str | None = None,
    config: RunnableConfig | None = None,
    confirm_before: frozenset[str] = frozenset(),
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

    # One turn, one answer: only the presenter's PROSE reaches the user.
    # Tool calls stay visible — "searching the catalog…" is real progress, and
    # with the fix below they now carry proper ids.
    config = quiet(config)

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
            if call["name"] in confirm_before:
                decision = _confirm_write(call)
                if not decision.get("approved"):
                    parsed = {
                        "ok": False,
                        "cancelled_by_user": True,
                        "error": decision.get("reason") or "The user declined this action.",
                    }
                    messages.append(
                        ToolMessage(
                            content=_to_message_content(parsed), tool_call_id=call["id"]
                        )
                    )
                    collected.append((call["name"], parsed))
                    continue

            try:
                # NOTE the missing `config=`. That omission is the fix.
                #
                # This node runs its own tool loop instead of using a ToolNode,
                # so LangChain fires on_tool_start/on_tool_end callbacks that
                # `ag_ui_langgraph` turns into AG-UI tool-call events — but with
                # NO toolCallId and NO toolCallName, because the ids live in the
                # ToolNode machinery we bypassed. That id-less, unpaired event
                # corrupts the client's message reconstruction: CopilotKit ends
                # up with `assistant(content: "", toolCalls: [...])`, drops the
                # presenter's text, and poisons the thread so later runs lose
                # earlier answers from their MESSAGES_SNAPSHOT too.
                #
                # Not passing the run config keeps the MCP call off the callback
                # tree entirely, so no phantom event is synthesised. The model's
                # own tool_calls still stream normally, with correct ids.
                #
                # Cost: these MCP calls no longer appear as child spans in
                # LangSmith. The graph's own steps still do.
                result = await tool.ainvoke(
                    call["args"], config={"callbacks": []}
                )
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


def _tool_summary(collected: list[tuple[str, Any]]) -> list[dict[str, Any]]:
    """One line per tool call, for the journey panel.

    Results are summarised rather than included: a search result is the whole
    catalog slice and would dwarf everything else in the panel.
    """
    summary: list[dict[str, Any]] = []
    for name, payload in collected:
        entry: dict[str, Any] = {"tool": name}
        if isinstance(payload, dict):
            if "count" in payload:
                entry["result"] = f"{payload['count']} products"
            elif "total_products" in payload:
                entry["result"] = f"{payload['total_products']} products, {payload.get('category_count')} categories"
            elif payload.get("ok") is not None:
                entry["result"] = "ok" if payload["ok"] else f"refused: {payload.get('error', '')[:60]}"
            elif "name" in payload:
                entry["result"] = str(payload["name"])
            elif "rows" in payload:
                entry["result"] = f"{len(payload['rows'])} spec rows"
        summary.append(entry)
    return summary


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
    # `method="json_schema"` is load-bearing, not a style choice.
    #
    # The default implementation of structured output is FUNCTION CALLING, and
    # `ag_ui_langgraph` streams that to the browser as a TOOL_CALL_START whose
    # name, id and parent are all null - a malformed tool call that nothing can
    # ever resolve. CopilotKit's chat then renders the assistant bubble as a
    # pending tool call and shows NO TEXT, even though the answer arrived
    # correctly and the final MESSAGES_SNAPSHOT holds it in full.
    #
    # No error, no console warning: a perfect run and an empty chat.
    #
    # `json_schema` uses OpenAI's response_format instead, so the routing
    # decision never looks like a tool call.
    model = make_model().with_structured_output(Route, method="json_schema")

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
        # Structured output is a model call AND a tool call. Silence both, or
        # the client gets an orphan tool call and renders an empty bubble.
        config=quiet(config, tool_calls=False),
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
        context=_worker_context(state, f"Search terms suggested by the router: {state.get('refined_query') or 'none'}"),
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
        "tools_used": _tool_summary(collected),
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
        context=_worker_context(state, f"Products already under discussion: {known or 'none identified yet'}"),
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
        "tools_used": _tool_summary(collected),
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
        context=_worker_context(state, f"Search terms suggested by the router: {state.get('refined_query') or 'none'}"),
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
        "tools_used": _tool_summary(collected),
        "selected_product_ids": [p["id"] for p in products[:3]],
    }


async def cart_agent(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    """Read or change the cart."""
    note, collected = await _run_tool_loop(
        worker="cart_agent",
        system=prompts.CART,
        user_text=_last_user_text(state["messages"]),
        context=_worker_context(state),
        config=config,
        # The only worker that can write is also the only one that pauses.
        confirm_before=WRITE_TOOLS,
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
    return {"surface": surface, "tools_used": _tool_summary(collected)}


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
    """Write the single message the user reads - and, when a browser is
    attached, render a live A2UI surface instead of a markdown table.

    This is the ONLY node that changed in Part 4. Every worker still produces
    the same `surface` dict it produced in Part 3; the difference is entirely in
    how that dict is turned into something visible. That was the whole point of
    giving the presenter its own node.

    Two paths, chosen by whether a component catalog was actually offered:

      browser attached  ->  bind `generate_a2ui`, let the model call it, and let
                            a subagent design the component tree
      no browser        ->  the Part 3 markdown renderer, unchanged

    The fallback is not defensive padding. It is what keeps LangGraph Studio,
    `curl` and the test suite usable for debugging the GRAPH without standing up
    the entire frontend.
    """
    surface = state.get("surface")
    has_content = bool(surface and surface.get("kind") != "none")
    # The exact marker the PRESENTER prompt keys off to distinguish "we looked
    # and found nothing" from "we never looked". Shared constant so the two
    # cannot drift apart.
    facts = (
        json.dumps(surface, default=str)[:6000] if surface else prompts.NO_WORK_MARKER
    )
    question = _last_user_text(state["messages"])

    if has_content and a2ui_is_available(state):
        return await _present_with_a2ui(state, config, facts=facts, question=question)

    reply = await make_model().ainvoke(
        [
            SystemMessage(content=prompts.PRESENTER),
            HumanMessage(content=_presenter_brief(question, facts, "Write the answer.")),
        ],
        config=config,
    )

    prose = (reply.text or "").strip()
    rendered = _render_markdown(surface)
    content = "\n\n".join(part for part in (prose, rendered) if part).strip()

    # Reuse the STREAMED message's id.
    #
    # The model's tokens already reached the browser as TEXT_MESSAGE_* under
    # `reply.id` (an `lc_run--...` id), and the chat is rendering a bubble keyed
    # by it. Returning a freshly constructed AIMessage gives the same answer a
    # SECOND identity, so the MESSAGES_SNAPSHOT never merges into the bubble the
    # user is looking at: it stays empty while the correct text sits on the wire,
    # in the snapshot, unrendered.
    return {"messages": [AIMessage(content=content, id=reply.id)]}


def _presenter_brief(question: str, facts: str, instruction: str) -> str:
    return "\n\n".join(
        [
            f"User asked: {question}",
            f"What was found (JSON):\n{facts}",
            instruction,
        ]
    )


def _read_a2ui_envelope(envelope: Any) -> dict[str, Any]:
    """Pull the three A2UI operations apart for the pipeline panel.

    The envelope is `{"a2ui_operations": [createSurface, updateComponents,
    updateDataModel]}`. Splitting structure from data is the whole point of the
    format — the component tree is authored once and the data streams into it —
    so the panel shows them separately rather than as one JSON blob.
    """
    out: dict[str, Any] = {}
    try:
        payload = json.loads(envelope) if isinstance(envelope, str) else envelope
        operations = (payload or {}).get("a2ui_operations") or []
    except (TypeError, ValueError):
        return {"error": "the renderer returned something that was not JSON"}

    out["operations"] = operations
    for op in operations:
        if "createSurface" in op:
            out["surface_id"] = op["createSurface"].get("surfaceId")
            out["catalog_id"] = op["createSurface"].get("catalogId")
        elif "updateComponents" in op:
            out["components"] = op["updateComponents"].get("components")
        elif "updateDataModel" in op:
            out["data_model"] = op["updateDataModel"].get("value")
    return out


async def _present_with_a2ui(
    state: AgentState,
    config: RunnableConfig,
    *,
    facts: str,
    question: str,
) -> dict[str, Any]:
    """Write the answer, then paint the surface.

    ## Order matters, and so does who decides

    Earlier this bound `generate_a2ui` to the model and let it choose whether to
    call it. Two problems with that:

      * It spends an extra round trip re-deciding something the graph already
        knows — we only get here when `surface.kind != "none"`.
      * The tool call had to come first, so the prose was generated in the same
        turn as the tool call. `ag_ui_langgraph` then synthesised an id-less
        tool call from `on_tool_end`, the client reconstructed the assistant
        message as `content: "", toolCalls: [...]`, and the bubble rendered
        empty even though the surface painted perfectly.

    So: generate the prose on its own (it streams and completes as a clean text
    message), then invoke the renderer programmatically. Deterministic, one
    fewer LLM call, and the non-determinism stays confined to layout — which is
    exactly where dynamic A2UI is supposed to keep it.
    """
    # 1. The answer. No tools bound, so nothing can pollute this message.
    reply: AIMessage = await make_model().ainvoke(
        [
            SystemMessage(content=prompts.PRESENTER_A2UI),
            HumanMessage(content=_presenter_brief(question, facts, "Write the answer.")),
        ],
        config=config,
    )
    prose = (reply.text or "").strip()

    # 2. The surface. Keeps the traced config: the A2UI middleware paints from
    #    the live tool-call stream, and detaching callbacks here silences it
    #    entirely (verified — surface count drops to zero).
    tool = render_tool()
    args: dict[str, Any] = {"intent": "create"}
    if needs_runtime(tool):
        args["runtime"] = build_tool_runtime(
            # The subagent reads its data from state, not from any prompt above.
            # Without this the surface is invented rather than rendered.
            state=state_with_render_data(state, facts),
            tool_call_id=f"a2ui-{reply.id}",
            config=config,
            tools=[tool],
        )

    trace: dict[str, Any] = {
        "question": question,
        # How the turn was routed — step 4 of the journey panel.
        "intent": state.get("intent"),
        "route_reason": state.get("route_reason"),
        "refined_query": state.get("refined_query"),
        # What the worker actually did — step 5.
        "tools_used": state.get("tools_used") or [],
        "surface_title": (state.get("surface") or {}).get("title"),
        "product_count": len(((state.get("surface") or {}).get("data") or {}).get("products") or []),
        "surface_kind": (state.get("surface") or {}).get("kind"),
        "catalog_id": None,
        "surface_id": None,
        "components": None,
        "data_model": None,
        "operations": None,
        "error": None,
    }

    try:
        envelope = await tool.ainvoke(args, config=config)
        trace.update(_read_a2ui_envelope(envelope))
    except Exception as exc:
        # A broken surface must never cost the user their answer.
        trace["error"] = f"{type(exc).__name__}: {exc}"

    # Only the prose goes into `messages`. The surface lives on the wire as its
    # own `a2ui-surface` activity message; adding the tool plumbing here would
    # put an empty-content assistant message in the closing snapshot and the
    # chat would render that instead of the answer.
    return {
        "messages": [AIMessage(content=prose, id=reply.id)],
        "a2ui_trace": trace,
    }
