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
