"""Regression tests for the catalog tools.

These lock down the behaviours that were actually wrong at some point during
Part 2, plus the traps the seed data was designed to expose. Run with:

    uv run --project apps/mcp pytest -q
"""

from __future__ import annotations

import pytest
from fastmcp import Client

from mcp_products.server import mcp


@pytest.fixture
async def client():
    async with Client(mcp) as c:
        yield c


async def call(client: Client, name: str, **kwargs):
    return (await client.call_tool(name, kwargs)).data


# ------------------------------------------------------------------- search


async def test_search_recall_survives_vocabulary_mismatch(client):
    """The bug that motivated scored retrieval.

    Strict AND matching returned 2 of 6 ANC headphones, because one product's
    copy says "cancellation" and another says only "ANC".
    """
    data = await call(client, "search_products", query="noise cancelling",
                      category="headphones", limit=10)
    found = {p["id"] for p in data["products"]}
    anc_models = {"hp-001", "hp-002", "hp-003", "hp-005", "hp-006", "hp-008"}
    assert anc_models <= found, f"missed {anc_models - found}"


async def test_search_hard_filters_are_not_preferences(client):
    data = await call(client, "search_products", query="laptop",
                      max_price=600, limit=10)
    assert all(p["price"] <= 600 for p in data["products"])


async def test_search_surfaces_intent_matched_products(client):
    """Tag-level intent ("budget", "student") must reach the top of the list.

    Note what this does NOT assert: that the cheapest laptop ranks first. Text
    relevance deliberately ignores price - a model that wants a price ceiling
    is told to pass `max_price` rather than hope the word "cheap" ranks for it.
    """
    data = await call(client, "search_products", query="cheap student laptop",
                      category="laptops", limit=3)
    assert "lp-007" in {p["id"] for p in data["products"]}


async def test_budget_intent_belongs_in_max_price(client):
    data = await call(client, "search_products", query="student laptop",
                      category="laptops", max_price=700, limit=5)
    assert {p["id"] for p in data["products"]} == {"lp-007"}


async def test_empty_query_browses_by_filter_alone(client):
    data = await call(client, "search_products", category="keyboards", limit=30)
    assert data["count"] == 7


# ------------------------------------------------------------------ compare


async def test_compare_reports_facts_without_picking_a_winner(client):
    """No row may carry a verdict - only facts and the range they sit in."""
    data = await call(client, "compare_products", product_ids=["hp-001", "hp-003"])
    assert data["ok"]

    verdict_keys = {"winner", "better", "best", "recommended", "score"}
    for row in data["rows"]:
        assert not (verdict_keys & set(row)), f"{row['key']} carries a verdict"
        # `leaders` is allowed: "highest"/"lowest" is an observation, not a
        # judgement. Which end is good depends on the spec and the use case.
        assert set(row.get("leaders", {})) <= {"highest", "lowest"}

    assert "no winner has been chosen" in data["judgement_note"].lower()


async def test_compare_flags_the_wired_battery_trap(client):
    """battery_hours: 0 means "no battery", not "terrible battery"."""
    data = await call(client, "compare_products",
                      product_ids=["hp-001", "hp-004"])
    row = next(r for r in data["rows"] if r["key"] == "battery_hours")
    assert row["values"]["hp-004"] == 0
    assert "caveat" in row


async def test_compare_separates_differentiators_from_noise(client):
    data = await call(client, "compare_products",
                      product_ids=["kb-001", "kb-002"])
    assert "switch_type" in data["identical_rows"]
    assert "layout" in data["differing_rows"]


async def test_compare_warns_across_categories(client):
    data = await call(client, "compare_products",
                      product_ids=["lp-001", "mn-001"])
    assert data["cross_category"] is True
    assert "not meaningfully comparable" in data["judgement_note"]


async def test_compare_rejects_a_single_id(client):
    with pytest.raises(Exception):
        await call(client, "compare_products", product_ids=["lp-001"])


# --------------------------------------------------------------------- cart


async def test_cart_refuses_out_of_stock(client):
    result = await call(client, "add_to_cart", product_id="hp-008")
    assert result["ok"] is False
    assert "out of stock" in result["error"].lower()


async def test_cart_refuses_more_than_exists(client):
    result = await call(client, "add_to_cart", product_id="lp-008", quantity=9)
    assert result["ok"] is False
    assert result["available"] == 8


async def test_cart_roundtrip(client):
    await call(client, "add_to_cart", product_id="mn-007", quantity=2)
    cart = await call(client, "view_cart")
    line = next(i for i in cart["items"] if i["product_id"] == "mn-007")
    assert line["quantity"] == 2
    assert line["line_total"] == line["unit_price"] * 2

    assert (await call(client, "remove_from_cart", product_id="mn-007"))["ok"]
    cart = await call(client, "view_cart")
    assert not any(i["product_id"] == "mn-007" for i in cart["items"])


# ------------------------------------------------------------------- errors


@pytest.mark.parametrize("tool", ["get_product", "check_stock"])
async def test_unknown_id_returns_error_not_exception(client, tool):
    result = await call(client, tool, product_id="does-not-exist")
    assert "error" in result


# ---------------------------------------------------------- catalog overview


async def test_list_categories_reports_the_whole_catalog(client):
    """"How many products do I have" must be answerable in one call.

    Without a total, the model reaches for `search_products` with a query like
    "products", which matches nothing and is indistinguishable from an empty
    catalog.
    """
    data = await call(client, "list_categories")
    assert data["total_products"] == 30
    assert data["category_count"] == 4
    assert sum(c["count"] for c in data["categories"]) == data["total_products"]


async def test_list_categories_carries_price_ranges(client):
    data = await call(client, "list_categories")
    monitors = next(c for c in data["categories"] if c["category"] == "monitors")
    assert monitors["price_range"] == {"min": 179, "max": 1499}


# ------------------------------------------------------- introspection route


async def test_every_tool_has_a_one_line_summary(client):
    """The /tools.json route shows users what the agent can do.

    It takes the first line of each docstring, so a tool whose docstring starts
    with a blank line would show an empty summary in the UI.
    """
    for tool in await client.list_tools():
        first = (tool.description or "").strip().splitlines()
        assert first, f"{tool.name} has no description"
        assert len(first[0]) > 15, f"{tool.name} has a uselessly short summary"


async def test_write_tools_announce_themselves(client):
    """The UI labels these as needing confirmation, and the model is told too."""
    tools = {t.name: (t.description or "") for t in await client.list_tools()}
    for name in ("add_to_cart", "remove_from_cart"):
        assert "CHANGES STATE" in tools[name], f"{name} must declare that it writes"
