"""Tests that need no API key and no running MCP server.

These pin down the two things that actually broke while building Part 3: the
shape of MCP tool results, and the graph's declared edges. Both failed silently
rather than loudly, which is exactly why they are worth a test.

Run:  uv run --project apps/agent pytest -q
"""

from __future__ import annotations

import json

import pytest

from agent.nodes import (
    _products_found,
    _results_from,
    _to_message_content,
    _unwrap_tool_result,
)
from agent.state import empty_turn
from agent.tools import TOOLSETS


# ------------------------------------------------- the bug that cost an hour


def test_unwraps_mcp_content_blocks():
    """The real shape: a JSON string nested inside a list of content blocks.

    Anything that checks `isinstance(payload, dict)` against the raw value
    matches nothing, and every worker quietly reports zero results.
    """
    raw = [{"type": "text", "text": json.dumps({"count": 2, "products": [{"id": "hp-001"}]})}]
    assert _unwrap_tool_result(raw) == {"count": 2, "products": [{"id": "hp-001"}]}


def test_unwraps_plain_json_string():
    assert _unwrap_tool_result('{"ok": true}') == {"ok": True}


def test_passes_through_already_parsed_dicts():
    assert _unwrap_tool_result({"ok": True}) == {"ok": True}


def test_leaves_non_json_text_alone():
    assert _unwrap_tool_result("not json at all") == "not json at all"


def test_leaves_unrecognised_lists_alone():
    assert _unwrap_tool_result([1, 2, 3]) == [1, 2, 3]


def test_multi_block_results_are_concatenated_before_parsing():
    raw = [{"type": "text", "text": '{"a":'}, {"type": "text", "text": " 1}"}]
    assert _unwrap_tool_result(raw) == {"a": 1}


def test_message_content_is_always_a_string():
    assert _to_message_content({"a": 1}) == '{"a": 1}'
    assert _to_message_content("already text") == "already text"


# ------------------------------------------------------- extracting products


def test_products_are_collected_across_several_searches():
    collected = [
        ("search_products", {"products": [{"id": "a"}, {"id": "b"}]}),
        ("search_products", {"products": [{"id": "b"}, {"id": "c"}]}),
        ("get_product", {"id": "d"}),
    ]
    assert [p["id"] for p in _products_found(collected)] == ["a", "b", "c", "d"]


def test_non_dict_tool_results_do_not_crash_extraction():
    assert _products_found([("search_products", "server exploded")]) == []


def test_results_from_returns_the_most_recent_call():
    collected = [("check_stock", {"n": 1}), ("check_stock", {"n": 2})]
    assert _results_from(collected, "check_stock") == {"n": 2}
    assert _results_from(collected, "never_called") is None


# ------------------------------------------------------------- graph shape


def test_supervisor_routes_are_visible_to_langgraph():
    """The `Command[SupervisorDestination]` annotation is load-bearing.

    Without it LangGraph infers `supervisor -> __end__` and prunes every worker
    as unreachable - the graph still runs, but Studio draws a lie.
    """
    from agent.graph import graph

    edges = {(e.source, e.target) for e in graph.get_graph().edges}
    for worker in ("catalog_agent", "compare_agent", "recommend_agent", "cart_agent"):
        assert ("supervisor", worker) in edges, f"supervisor cannot reach {worker}"
        assert (worker, "presenter") in edges, f"{worker} does not reach the presenter"

    assert ("presenter", "__end__") in edges
    assert ("supervisor", "__end__") not in edges


def test_every_worker_node_is_registered():
    from agent.graph import graph

    nodes = set(graph.get_graph().nodes)
    assert {"supervisor", "presenter", *TOOLSETS} - {"cart_agent"} <= nodes | {"cart_agent"}
    assert "cart_agent" in nodes


# ------------------------------------------------------------ state hygiene


def test_new_turn_clears_last_turn_scratch():
    """A follow-up must not inherit the previous turn's comparison.

    Otherwise the presenter re-renders a stale table for a question that had
    nothing to do with it.
    """
    reset = empty_turn()
    for key in ("intent", "comparison", "surface", "refined_query"):
        assert reset[key] is None


def test_conversation_state_survives_the_reset():
    """messages, selection and results are the conversation, not scratch.

    `last_results` belongs here rather than in the cleared set. Clearing it hid
    behind the supervisor, which reads state BEFORE this update is applied, so
    routing kept working while every worker ran afterwards and saw nothing. The
    confirmation dialog lost its id-to-name lookup and showed "lp-008" to a
    person deciding whether to buy a laptop.
    """
    reset = empty_turn()
    assert "messages" not in reset
    assert "selected_product_ids" not in reset
    assert "last_results" not in reset


# ------------------------------------------------------------ tool isolation


@pytest.mark.parametrize("worker", ["catalog_agent", "compare_agent", "recommend_agent"])
def test_only_the_cart_worker_can_write(worker):
    """Withholding a tool beats telling the model not to use it."""
    writes = {"add_to_cart", "remove_from_cart"}
    assert not (writes & set(TOOLSETS[worker]))


def test_cart_worker_can_write():
    assert {"add_to_cart", "remove_from_cart"} <= set(TOOLSETS["cart_agent"])


# ------------------------------------------------------------------- A2UI


def test_a2ui_gate_keys_off_the_inject_flag_not_the_schema():
    """The gate that silently disabled generative UI for an afternoon.

    `a2ui_schema` is contributed by the BROWSER's catalog and is absent whenever
    the client does not send one - so gating on it fell back to markdown even
    with A2UI fully configured and working. `inject_a2ui_tool` is the signal the
    middleware actually forwards.
    """
    from agent.a2ui import a2ui_is_available

    assert a2ui_is_available({"ag-ui": {"inject_a2ui_tool": True}}) is True
    assert a2ui_is_available({"ag-ui": {"a2ui_schema": "<schema>"}}) is True
    assert a2ui_is_available({"ag-ui": {"inject_a2ui_tool": False}}) is False
    assert a2ui_is_available({}) is False
    assert a2ui_is_available({"ag-ui": None}) is False


def test_render_data_reaches_the_subagent_as_ag_ui_context():
    """The bug that painted a product we do not sell.

    The A2UI subagent builds its prompt from `ag-ui.context` and
    `state["messages"]` - never from the presenter's prompt. Asked to render
    products it had never been shown, it invented a Sony WH-1000XM4 at $349.99:
    correct layout, accurate prose, fictional data, no error anywhere.
    """
    from agent.a2ui import RENDER_DATA_DESCRIPTION, state_with_render_data

    facts = '{"products": [{"id": "hp-001", "name": "Aether NC 900"}]}'
    out = state_with_render_data({"ag-ui": {"context": [{"description": "existing", "value": "x"}]}}, facts)

    context = out["ag-ui"]["context"]
    assert len(context) == 2, "must append, not replace existing context"
    assert context[0]["description"] == "existing"
    assert context[-1]["value"] == facts
    assert context[-1]["description"] == RENDER_DATA_DESCRIPTION
    assert "do not invent" in RENDER_DATA_DESCRIPTION.lower()


def test_render_data_does_not_mutate_the_original_state():
    from agent.a2ui import state_with_render_data

    original = {"ag-ui": {"context": []}, "surface": {"kind": "product_grid"}}
    out = state_with_render_data(original, "{}")

    assert original["ag-ui"]["context"] == [], "original state was mutated"
    assert out is not original
    assert out["surface"] is original["surface"]


def test_render_data_survives_missing_ag_ui():
    from agent.a2ui import state_with_render_data

    out = state_with_render_data({}, "{}")
    assert len(out["ag-ui"]["context"]) == 1


def test_ag_ui_and_tools_are_declared_channels():
    """`ag_ui_langgraph` passes both as graph INPUT.

    LangGraph silently drops input keys with no declared channel, so an
    undeclared `ag-ui` means the agent never learns a browser is attached.
    """
    from agent.state import AgentState

    assert "ag-ui" in AgentState.__annotations__
    assert "tools" in AgentState.__annotations__


# ------------------------------------------------ Part 5: shared state + HITL


def test_quiet_uses_the_key_ag_ui_langgraph_actually_reads():
    """The two packages disagree, and the wrong key fails silently.

    `copilotkit_customize_config` sets `copilotkit:emit-messages` (prefixed).
    `ag_ui_langgraph` reads `emit-messages` (unprefixed). Using the former
    type-checks, runs clean, and does nothing at all - the supervisor's routing
    JSON and every worker's summary keep streaming into the chat.
    """
    from agent.nodes import quiet

    out = quiet({"metadata": {"existing": 1}, "tags": ["keep-me"]})
    assert out["metadata"]["emit-messages"] is False
    assert "copilotkit:emit-messages" not in out["metadata"]
    assert out["metadata"]["existing"] == 1, "must not clobber existing metadata"
    assert out["tags"] == ["keep-me"], "must not drop the rest of the config"


def test_quiet_handles_a_missing_config():
    from agent.nodes import quiet

    assert quiet(None)["metadata"]["emit-messages"] is False


def test_quiet_does_not_mutate_the_caller_config():
    from agent.nodes import quiet

    original = {"metadata": {}}
    quiet(original)
    assert original["metadata"] == {}


def test_only_write_tools_are_gated():
    from agent.nodes import WRITE_TOOLS

    assert WRITE_TOOLS == {"add_to_cart", "remove_from_cart"}
    assert "view_cart" not in WRITE_TOOLS, "reads must never need confirmation"
    assert "search_products" not in WRITE_TOOLS


def test_confirmation_prompt_names_the_actual_action():
    """The dialog has to say what will happen, not just 'are you sure?'."""
    from agent.nodes import _describe_write

    add = _describe_write({"name": "add_to_cart", "args": {"product_id": "hp-002", "quantity": 2}})
    assert "hp-002" in add and "2 units" in add

    one = _describe_write({"name": "add_to_cart", "args": {"product_id": "hp-002", "quantity": 1}})
    assert "1 unit " in one, "singular, not '1 units'"

    rm = _describe_write({"name": "remove_from_cart", "args": {"product_id": "kb-001"}})
    assert "kb-001" in rm and "Remove" in rm


def test_selection_note_is_omitted_when_nothing_is_selected():
    """An empty selection must add no context at all.

    Emitting "selected: none" teaches the model that a selection concept exists
    and invites it to reason about the absence.
    """
    from agent.nodes import _selection_note

    assert _selection_note({}) is None
    assert _selection_note({"selected_product_ids": []}) is None

    note = _selection_note({"selected_product_ids": ["hp-001", "hp-002"]})
    assert note is not None
    assert "hp-001" in note and "hp-002" in note


def test_worker_context_merges_selection_with_router_hints():
    from agent.nodes import _worker_context

    ctx = _worker_context({"selected_product_ids": ["mn-004"]}, "Search terms: oled gaming")
    assert "oled gaming" in ctx
    assert "mn-004" in ctx

    assert _worker_context({}, "") == ""


# ------------------------------------- not looking is not the same as finding nothing


def test_presenter_marker_is_shared_between_prompt_and_code():
    """The prompt keys off this exact string; drift would silently disarm it."""
    import inspect

    from agent import nodes, prompts

    assert prompts.NO_WORK_MARKER in prompts.PRESENTER
    source = inspect.getsource(nodes.presenter)
    assert "prompts.NO_WORK_MARKER" in source
    assert '"no catalog work was done"' not in source, "must not hard-code the marker"


def test_presenter_is_forbidden_from_claiming_an_empty_catalog():
    """The bug: asked "how many products do I have", the supervisor routed
    straight to the presenter, nothing was searched, and the presenter replied
    "No products were found in your catalog."

    Nobody had looked. That is a false statement about the user's own data, and
    it is the same confabulation family as the invented Sony product.
    """
    from agent import prompts

    body = " ".join(prompts.PRESENTER.lower().split())
    assert "no search ran" in body
    assert "must not say the catalog is empty" in body


def test_supervisor_sends_catalog_questions_to_the_catalog_agent():
    from agent import prompts

    # Collapse the prompt's hand-wrapping so assertions match meaning, not
    # line breaks - otherwise a harmless re-wrap fails the test.
    body = " ".join(prompts.SUPERVISOR.lower().split())
    assert "how many products do i have" in body
    assert "what do you sell" in body
    # And it must be told never to assert absence without checking.
    assert "you have not looked" in body


# --------------------------- the phantom tool call that ate every answer


def test_mcp_tools_are_invoked_with_callbacks_detached():
    """The bug that made the chat render empty bubbles for any turn using a tool.

    This graph runs its own tool loop instead of a ToolNode, so LangChain fires
    on_tool_start/on_tool_end for each MCP call and `ag_ui_langgraph` turns them
    into AG-UI tool-call events with NO toolCallId and NO toolCallName - the ids
    live in the ToolNode machinery we bypassed.

    That id-less, unpaired event corrupts the client's message reconstruction:
    CopilotKit ends up with `assistant(content: "", toolCalls: [...])`, drops
    the presenter's text, and poisons the thread so later runs lose earlier
    answers from their snapshot too. Server-side everything looked perfect.

    Passing an explicit empty `callbacks` list is what keeps the MCP call off
    the callback tree. Note that omitting `config=` entirely is NOT enough -
    LangChain picks the callback manager up from the ambient run context.
    """
    import inspect

    from agent import nodes

    source = inspect.getsource(nodes._run_tool_loop)
    invoke = source[source.index("result = await tool.ainvoke") :][:200]

    assert '"callbacks": []' in invoke, (
        "MCP tools must be invoked with callbacks detached, or ag_ui_langgraph "
        "synthesises an id-less tool call that breaks chat rendering"
    )
    assert "config=config" not in invoke, "the traced config must not be forwarded"


def test_worker_tool_calls_still_stream():
    """Suppressing them is not the fix, and actively makes things worse.

    With `emit-tool-calls: False` the proper tool call disappears but the
    synthesised on_tool_end event does NOT - leaving a lone id-less event and no
    assistant bubble at all. Workers keep tool-call streaming so the UI can show
    real progress; only the supervisor's is silenced.
    """
    import inspect

    from agent import nodes

    source = inspect.getsource(nodes._run_tool_loop)
    assert "config = quiet(config)" in source
    assert "quiet(config, tool_calls=False)" not in source


# ------------------------------------------ A2UI reaches the browser at all


def test_a2ui_is_detected_from_context_entries():
    """`ag-ui.a2ui_schema` is never set in this architecture.

    `ag_ui_langgraph`'s `split_a2ui_schema_context` lifts the component schema
    into that key - but it only runs when PYTHON serves the AG-UI endpoint. We
    use the Node `LangGraphAgent` against `langgraph dev`, so the schema arrives
    as an ordinary context entry instead and the gate must look there.

    Symptom when it didn't: `a2uiEnabled: true`, four A2UI context entries on
    the wire, a `product_grid` surface ready to draw - and every answer silently
    rendered as markdown.
    """
    from agent.a2ui import a2ui_is_available, a2ui_schema_from_state

    browser_state = {
        "ag-ui": {
            "context": [
                {"description": "A2UI catalog capabilities: available catalog IDs.", "value": "{}"},
                {
                    "description": (
                        "A2UI Component Schema - available components for generating UI "
                        "surfaces. Use these component names and properties when creating "
                        "A2UI operations."
                    ),
                    "value": '{"Text": {}}',
                },
            ]
        }
    }
    assert a2ui_is_available(browser_state) is True
    assert a2ui_schema_from_state(browser_state) == '{"Text": {}}'

    # Fallbacks for the Python-served path still work.
    assert a2ui_is_available({"ag-ui": {"a2ui_schema": "<schema>"}}) is True
    assert a2ui_is_available({"ag-ui": {"inject_a2ui_tool": True}}) is True

    # And no browser means no surface.
    assert a2ui_is_available({}) is False
    assert a2ui_is_available({"ag-ui": {"context": [{"description": "Something else"}]}}) is False


def test_a2ui_render_keeps_its_traced_config():
    """The MCP tools detach callbacks; this one must NOT.

    The A2UI middleware paints from the live tool-call stream, so detaching
    callbacks here silences the surface completely - verified, surface count
    drops to zero. The two tool invocations in this file need opposite
    treatment, which is exactly the kind of thing a test should hold still.
    """
    import inspect

    from agent import nodes

    source = inspect.getsource(nodes._present_with_a2ui)
    invoke = source[source.index("await tool.ainvoke(args") :][:120]
    assert "config=config" in invoke
    assert '"callbacks": []' not in invoke


def test_a2ui_path_returns_only_the_prose():
    """Tool plumbing must stay out of `messages`.

    The middleware has already consumed the tool call and its result from the
    live stream. Returning them as chat messages too puts an empty-content
    assistant message in the closing snapshot, and the chat renders that instead
    of the answer.
    """
    import inspect

    from agent import nodes

    source = inspect.getsource(nodes._present_with_a2ui)
    tail = source[source.index("return {") :]
    assert "AIMessage(content=prose" in tail
    assert "ToolMessage" not in tail


# ------------------------------------------------ the teaching journey panel


def test_trace_carries_every_step_the_journey_panel_shows():
    """The left-hand panel walks 12 hops and fills each with live data.

    Each field here backs a specific step, so dropping one silently empties that
    step in the UI rather than failing anything.
    """
    import inspect

    from agent import nodes

    source = inspect.getsource(nodes._present_with_a2ui)
    for field in (
        '"question"',          # step 1  - what was asked
        '"intent"',            # step 4  - how it routed
        '"route_reason"',
        '"refined_query"',
        '"tools_used"',        # step 5  - which MCP tools ran
        '"surface_kind"',      # step 6  - the data the worker wrote
        '"surface_title"',
        '"product_count"',
        '"components"',        # step 8  - the tree the subagent invented
        '"data_model"',        # step 10 - values bound by path
        '"operations"',        # step 9  - the three A2UI ops
    ):
        assert field in source, f"a2ui_trace is missing {field}"


def test_tool_summary_is_a_summary_not_the_payload():
    """A search result is a whole catalog slice; inlining it would swamp the panel."""
    from agent.nodes import _tool_summary

    out = _tool_summary(
        [
            ("search_products", {"count": 4, "products": [{"id": "hp-001"}] * 4}),
            ("list_categories", {"total_products": 30, "category_count": 4}),
            ("add_to_cart", {"ok": False, "error": "out of stock"}),
        ]
    )
    assert out[0] == {"tool": "search_products", "result": "4 products"}
    assert "30 products" in out[1]["result"]
    assert out[2]["result"].startswith("refused")

    # No raw payloads leaked through.
    assert "products" not in str(out[0].get("products", ""))
    assert all(set(e) <= {"tool", "result"} for e in out)


# ---------------------------------------------------- your own style rules


def test_house_style_is_appended_not_substituted():
    """The built-in guidelines carry protocol constraints, not just taste.

    Replacing them wholesale drops "exactly one component must have id root"
    and the relative-vs-absolute path rules for List templates - and a surface
    that breaks either renders blank. So the house style goes in as
    `composition_guide`, which is APPENDED.
    """
    from ag_ui_a2ui_toolkit import build_subagent_prompt

    from agent.design_rules import HOUSE_STYLE

    prompt = build_subagent_prompt(
        context_prompt="## Available Components\n{}",
        guidelines={"composition_guide": HOUSE_STYLE},
    )

    # The house style arrived...
    assert "House rules for this product catalog" in prompt
    # ...and the protocol rules survived it.
    assert "COMPONENT ID RULES" in prompt
    assert "PATH RULES FOR TEMPLATES" in prompt
    # ...and it comes last, so it refines rather than contradicts.
    assert prompt.index("House rules") > prompt.index("COMPONENT ID RULES")


def test_render_tool_passes_the_house_style():
    import inspect

    from agent import a2ui

    source = inspect.getsource(a2ui.render_tool)
    assert "composition_guide" in source
    assert "HOUSE_STYLE" in source


# ---------------------------------------------------------------------------
# Display projection
# ---------------------------------------------------------------------------
#
# These guard the shape the A2UI subagent is promised in HOUSE_STYLE. If a field
# here is renamed or dropped, the model keeps binding the old path and the card
# renders blank - with no error anywhere. That silence is why these exist.


def _display(**overrides):
    from agent.a2ui import display_product

    product = {
        "id": "hp-001",
        "name": "Aether NC 900",
        "brand": "Sonare",
        "price": 1299,
        "currency": "USD",
        "rating": 4.8,
        "reviewCount": 4100,
        "inStock": True,
        "imageUrl": "/products/hp-001.jpg",
        "imageAlt": "black headphones",
        "shortDescription": "Flagship ANC.",
        "specs": {"battery_hours": 32, "anc": True},
        "tags": ["anc"],
    }
    product.update(overrides)
    return display_product(product)


def test_price_is_formatted_because_a_binding_cannot_format():
    assert _display()["priceLabel"] == "$1,299"


def test_stock_label_is_per_product_not_a_literal():
    # The bug this replaced: one literal "Out of stock" in the card template
    # applied to every product in the list.
    assert _display(inStock=True)["stockLabel"] == "In stock"
    assert _display(inStock=False)["stockLabel"] == "Out of stock"


def test_specs_are_flattened_and_the_nested_object_is_gone():
    d = _display()
    assert d["spec1Label"] == "Battery" and d["spec1Value"] == "32 h"
    assert d["spec2Label"] == "Noise cancelling" and d["spec2Value"] == "Yes"
    # A nested path inside a List template resolves to nothing, so the object
    # must not be there to tempt the model.
    assert "specs" not in d


def test_unused_spec_slots_exist_and_are_empty():
    # HOUSE_STYLE tells the model to bind all four without checking.
    d = _display(specs={"battery_hours": 32})
    assert d["spec4Label"] == "" and d["spec4Value"] == ""


def test_brand_line_carries_the_rating_a_binding_could_not_join():
    assert _display()["brandLine"] == "SONARE · 4.8 out of 5 · 4.1K reviews"


def test_image_fields_survive_the_projection():
    d = _display()
    assert d["imageUrl"] == "/products/hp-001.jpg"
    assert d["imageAlt"] == "black headphones"


def test_alt_text_falls_back_to_the_name():
    assert _display(imageAlt=None)["imageAlt"] == "Aether NC 900"


def test_surface_for_display_rewrites_products_in_place():
    from agent.a2ui import surface_for_display

    surface = surface_for_display(
        {"kind": "product_grid", "title": "1 match", "data": {"products": [_raw()], "note": "n"}}
    )
    assert surface["title"] == "1 match" and surface["data"]["note"] == "n"
    assert surface["data"]["products"][0]["priceLabel"] == "$1,299"


def test_surface_for_display_leaves_a_surface_without_products_alone():
    from agent.a2ui import surface_for_display

    assert surface_for_display({"kind": "none"}) == {"kind": "none"}
    assert surface_for_display(None) is None


def _raw():
    return {
        "id": "hp-001",
        "name": "Aether NC 900",
        "brand": "Sonare",
        "price": 1299,
        "currency": "USD",
        "rating": 4.8,
        "reviewCount": 4100,
        "inStock": True,
        "imageUrl": "/products/hp-001.jpg",
        "imageAlt": "black headphones",
        "shortDescription": "Flagship ANC.",
        "specs": {"battery_hours": 32},
        "tags": [],
    }


# ---------------------------------------------------------------------------
# Per-turn state actually resets
# ---------------------------------------------------------------------------
#
# The reducer used to read `incoming if incoming is not None else current`,
# which threw away exactly the None that empty_turn() uses to clear. So the
# function written to reset per-turn state never reset anything, and a surface
# from an earlier turn was re-rendered under an unrelated question. No error,
# and every individual node correct.


def test_the_reducer_lets_a_deliberate_clear_through():
    from agent.state import last_write_wins

    assert last_write_wins(["hp-001"], None) is None
    assert last_write_wins(None, ["hp-002"]) == ["hp-002"]
    assert last_write_wins(["hp-001"], ["hp-002"]) == ["hp-002"]


def test_empty_turn_clears_every_scratch_field_through_the_reducer():
    from agent.state import empty_turn, last_write_wins

    stale = {
        "intent": "compare",
        "surface": {"kind": "compare_table"},
        "comparison": {"ok": True},
        "tools_used": [{"tool": "compare_products"}],
        "a2ui_trace": {"components": 12},
        "route_reason": "because",
        "refined_query": "anc headphones",
    }
    cleared = empty_turn()
    for field, previous in stale.items():
        assert field in cleared, f"empty_turn forgot {field}"
        assert last_write_wins(previous, cleared[field]) is None, (
            f"{field} survived a turn it should not have"
        )


def test_a_surface_cannot_outlive_the_turn_that_made_it():
    # The user-visible symptom: ask a question that needs no catalog data and
    # the previous comparison is still on screen underneath the answer.
    from agent.state import empty_turn, last_write_wins

    assert last_write_wins({"kind": "compare_table"}, empty_turn()["surface"]) is None


# ---------------------------------------------------------------------------
# Cart surfaces
# ---------------------------------------------------------------------------
#
# A cart line is not a catalog row: it arrives as product_id / unit_price /
# quantity / line_total and carries none of the fields HOUSE_STYLE promises the
# subagent it will find. Told those fields existed and finding none of them, the
# model produced a tree whose every binding resolved to nothing.


def _cart():
    return {
        "items": [
            {
                "product_id": "lp-008",
                "name": "Forge Studio 16",
                "brand": "Lumen",
                "imageUrl": "/products/lp-008.jpg",
                "imageAlt": "a laptop",
                "in_stock": True,
                "unit_price": 3299,
                "quantity": 2,
                "line_total": 6598,
            }
        ],
        "item_count": 2,
        "subtotal": 6598.0,
        "currency": "USD",
    }


def test_cart_lines_use_the_same_field_names_as_products():
    from agent.a2ui import display_cart

    line = display_cart(_cart())["items"][0]
    for field in ("name", "imageUrl", "imageAlt", "priceLabel", "brandLine", "stockLabel"):
        assert field in line, f"a cart line is missing {field}"
    assert line["priceLabel"] == "$3,299"
    assert line["quantityLabel"] == "Qty 2"
    assert line["lineTotalLabel"] == "$6,598"


def test_cart_totals_are_preformatted():
    from agent.a2ui import display_cart

    out = display_cart(_cart())
    assert out["subtotalLabel"] == "$6,598"
    assert out["itemCountLabel"] == "2 items"


def test_one_item_is_not_called_items():
    from agent.a2ui import display_cart

    cart = _cart()
    cart["item_count"] = 1
    assert display_cart(cart)["itemCountLabel"] == "1 item"


def test_spec_slots_exist_on_a_cart_line_so_a_product_template_still_binds():
    from agent.a2ui import display_cart

    line = display_cart(_cart())["items"][0]
    assert line["spec1Label"] == "" and line["spec4Value"] == ""


def test_surface_for_display_reaches_into_a_cart_surface():
    from agent.a2ui import surface_for_display

    out = surface_for_display(
        {"kind": "cart", "title": "Your cart", "data": {"cart": _cart(), "note": "n"}}
    )
    assert out["data"]["note"] == "n"
    assert out["data"]["cart"]["items"][0]["priceLabel"] == "$3,299"


# ---------------------------------------------------------------------------
# Tool-call pairing in the history handed to the A2UI subagent
# ---------------------------------------------------------------------------
#
# OpenAI rejects an assistant message carrying tool_calls unless every
# tool_call_id has a tool message answering it. The history is reconstructed in
# the browser by CopilotKit and sent back as graph input, so a call whose result
# never made it into that reconstruction arrives here unanswered.
#
# The turn that creates the orphan succeeds. The NEXT turn dies inside the A2UI
# subagent, which builds its prompt from the same history, and the user sees a
# correct text answer with no UI under it.


def _msgs():
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

    return [
        HumanMessage(content="show me my cart"),
        AIMessage(content="", tool_calls=[{"name": "view_cart", "args": {}, "id": "ok"}]),
        ToolMessage(content="{}", tool_call_id="ok"),
        AIMessage(content="", tool_calls=[{"name": "render_a2ui", "args": {}, "id": "orphan"}]),
        AIMessage(content="Your cart has six items."),
    ]


def _pairs_ok(messages) -> bool:
    issued = {c["id"] for m in messages for c in (getattr(m, "tool_calls", None) or [])}
    answered = {m.tool_call_id for m in messages if getattr(m, "type", None) == "tool"}
    return issued == answered


def test_an_unanswered_tool_call_is_removed():
    from agent.a2ui import prune_dangling_tool_calls

    assert not _pairs_ok(_msgs()), "fixture should start invalid"
    assert _pairs_ok(prune_dangling_tool_calls(_msgs()))


def test_answered_calls_and_their_results_survive():
    from agent.a2ui import prune_dangling_tool_calls

    out = prune_dangling_tool_calls(_msgs())
    assert [c["id"] for m in out for c in (getattr(m, "tool_calls", None) or [])] == ["ok"]
    assert any(getattr(m, "type", None) == "tool" for m in out)


def test_the_final_answer_is_never_dropped():
    from agent.a2ui import prune_dangling_tool_calls

    out = prune_dangling_tool_calls(_msgs())
    assert any("six items" in (m.content or "") for m in out)


def test_a_tool_result_with_no_call_is_dropped_too():
    from agent.a2ui import prune_dangling_tool_calls
    from langchain_core.messages import HumanMessage, ToolMessage

    out = prune_dangling_tool_calls(
        [HumanMessage(content="hi"), ToolMessage(content="{}", tool_call_id="ghost")]
    )
    assert all(getattr(m, "type", None) != "tool" for m in out)


def test_a_partly_answered_message_keeps_only_the_answered_call():
    from agent.a2ui import prune_dangling_tool_calls
    from langchain_core.messages import AIMessage, ToolMessage

    out = prune_dangling_tool_calls(
        [
            AIMessage(
                content="looking",
                tool_calls=[
                    {"name": "a", "args": {}, "id": "kept"},
                    {"name": "b", "args": {}, "id": "lost"},
                ],
            ),
            ToolMessage(content="{}", tool_call_id="kept"),
        ]
    )
    assert _pairs_ok(out)
    assert [c["id"] for m in out for c in (getattr(m, "tool_calls", None) or [])] == ["kept"]


def test_history_without_tool_calls_is_untouched():
    from agent.a2ui import prune_dangling_tool_calls
    from langchain_core.messages import AIMessage, HumanMessage

    msgs = [HumanMessage(content="hi"), AIMessage(content="hello")]
    assert prune_dangling_tool_calls(msgs) == msgs


def test_a_long_cart_is_capped_but_its_totals_are_not():
    # "add them all to my cart" produced 36 lines, and the subagent was asked to
    # design 36 cards. The surface never arrived: the chat sat on "Building
    # interface" indefinitely. Truncating the list is safe because the totals
    # are computed over the whole cart by the MCP server, not from the list.
    from agent.a2ui import CART_LINE_CAP, display_cart

    cart = {
        "items": [
            {
                "product_id": f"p-{i}",
                "name": f"Item {i}",
                "brand": "B",
                "unit_price": 100,
                "quantity": 1,
                "line_total": 100,
                "in_stock": True,
            }
            for i in range(36)
        ],
        "item_count": 36,
        "subtotal": 65564.0,
        "currency": "USD",
    }
    out = display_cart(cart)
    assert len(out["items"]) == CART_LINE_CAP
    assert out["itemCountLabel"] == "36 items"
    assert out["subtotalLabel"] == "$65,564"
    assert out["truncatedLabel"] == "Showing 12 of 36 lines"


def test_a_short_cart_says_nothing_about_truncation():
    from agent.a2ui import display_cart

    out = display_cart(
        {"items": [{"product_id": "a", "name": "A", "unit_price": 1, "quantity": 1,
                    "line_total": 1, "in_stock": True}],
         "item_count": 1, "subtotal": 1.0}
    )
    assert out["truncatedLabel"] == ""
    assert out["itemCountLabel"] == "1 item"


def test_an_empty_cart_projects_without_raising():
    from agent.a2ui import display_cart

    out = display_cart({"items": [], "item_count": 0, "subtotal": 0})
    assert out["items"] == []
    assert out["itemCountLabel"] == "0 items"
