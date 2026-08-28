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
    for key in ("intent", "comparison", "surface", "last_results", "refined_query"):
        assert reset[key] is None


def test_conversation_state_survives_the_reset():
    reset = empty_turn()
    assert "messages" not in reset
    assert "selected_product_ids" not in reset


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
