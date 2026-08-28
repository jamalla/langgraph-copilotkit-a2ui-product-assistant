"""FastMCP server exposing the product catalog to any MCP client.

Run it:      uv run --project apps/mcp python -m mcp_products.server
Endpoint:    http://127.0.0.1:8931/mcp

A note on style, because it is the whole lesson of this file: the model never
sees this source. It sees the tool NAME, the TYPE SIGNATURE, and the DOCSTRING.
Those three things are the entire prompt. So the docstrings below are written
for a reader who has no other context - they say when to reach for the tool,
when not to, and what the caller gets back.

Every tool returns structured JSON, never prose. Downstream, the LangGraph
nodes read these fields by name and the A2UI data model binds to them by path.
A tool that returned "I found 3 great laptops!" would be unusable by both.
"""

from __future__ import annotations

import os
from typing import Annotated, Any, Literal

from fastmcp import FastMCP
from pydantic import Field

from . import cart as cart_store
from . import catalog
from .compare import compare as build_comparison

mcp = FastMCP(
    name="product-catalog",
    instructions=(
        "Tools for a consumer electronics catalog of laptops, headphones, "
        "monitors and keyboards. Start with `search_products` or "
        "`list_categories` to discover ids, then use `get_product` for detail "
        "and `compare_products` to place candidates side by side. "
        "`add_to_cart` changes state and should only be called on an explicit "
        "user request, never speculatively."
    ),
)

Category = Literal["laptops", "headphones", "monitors", "keyboards"]


# ---------------------------------------------------------------- read tools


@mcp.tool
def search_products(
    query: Annotated[
        str,
        Field(
            description=(
                "Free text scored against name, brand, tags, description and "
                "spec values, with a small synonym vocabulary so 'noise "
                "cancelling' also finds products described as 'ANC'. Matching "
                "any term is enough to be returned; matching more ranks higher. "
                "Keep it to 1-4 meaningful terms. Pass an empty string to "
                "browse by filter alone."
            )
        ),
    ] = "",
    category: Annotated[
        Category | None, Field(description="Restrict to one category.")
    ] = None,
    max_price: Annotated[
        float | None, Field(description="Upper price bound in USD, inclusive.", gt=0)
    ] = None,
    min_rating: Annotated[
        float | None, Field(description="Lower bound on the 0-5 rating.", ge=0, le=5)
    ] = None,
    in_stock_only: Annotated[
        bool, Field(description="Drop products that cannot currently be bought.")
    ] = False,
    limit: Annotated[
        int, Field(description="Maximum results to return.", ge=1, le=30)
    ] = 8,
) -> dict[str, Any]:
    """Find products matching a text query and optional filters.

    This is the entry point for almost every question - use it to turn a vague
    request such as "quiet headphones for flights" into concrete product ids.

    Results are ranked by rating weighted by review volume, so a 4.9 with 340
    reviews does not automatically outrank a 4.7 with 5,600.

    Returns {query, count, products[]} where each product carries its id, name,
    brand, category, price, rating, stock and full specs. Pass the ids on to
    `compare_products` or `get_product`.

    Put CONSTRAINTS in the filter arguments, not in `query`. Text relevance
    ignores price entirely, so "cheap laptop" as a query ranks by wording, not
    by cost - translate the user's budget into `max_price` instead. The same
    goes for "in stock", "well reviewed" and a named category.

    If you get zero results, relax one filter at a time rather than re-issuing
    the same search - `max_price` is usually the one that is too tight.
    """
    products = catalog.search(
        query=query or None,
        category=category,
        max_price=max_price,
        min_rating=min_rating,
        in_stock_only=in_stock_only,
        limit=limit,
    )
    return {
        "query": {
            "text": query,
            "category": category,
            "max_price": max_price,
            "min_rating": min_rating,
            "in_stock_only": in_stock_only,
        },
        "count": len(products),
        "products": products,
    }


@mcp.tool
def get_product(
    product_id: Annotated[
        str, Field(description="Product id such as lp-001, from a prior search.")
    ],
) -> dict[str, Any]:
    """Fetch one product in full, including every spec and tag.

    Use this when the user asks about a specific product you already have an id
    for. To find an id in the first place, use `search_products`.

    Returns the product object, or {error, product_id} if the id is unknown -
    check for `error` before reading any other field.
    """
    product = catalog.get_product(product_id)
    if product is None:
        return {
            "error": f"No product with id {product_id!r}.",
            "product_id": product_id,
        }
    return product


@mcp.tool
def compare_products(
    product_ids: Annotated[
        list[str],
        Field(
            description="Two to four product ids to place side by side.",
            min_length=2,
            max_length=4,
        ),
    ],
) -> dict[str, Any]:
    """Build a fact-only comparison matrix for two to four products.

    IMPORTANT: this tool does not pick a winner. It returns aligned rows of
    facts and leaves the judgement to you, because which spec matters depends
    entirely on what the user is trying to do.

    Each row carries `numeric` (are these values orderable?), `differs` (do the
    products actually differ here?), and for numeric rows a `range`,
    `spread_pct` and `leaders.highest` / `leaders.lowest`. Some rows carry a
    `caveat` - respect it. For example battery_hours of 0 means a wired product
    with no battery, not a terrible battery.

    How to use the result well:
      1. Ignore every key in `identical_rows` - those are not differentiators.
      2. Of the `differing_rows`, name the two or three that matter for the
         user's stated use case, and say why you picked those.
      3. Then state a recommendation and the tradeoff it costs.

    Returns {ok, products[], rows[], differing_rows[], identical_rows[],
    cross_category, judgement_note}, or {ok: false, error} if fewer than two
    ids resolve.
    """
    return build_comparison(product_ids)


@mcp.tool
def list_categories() -> dict[str, Any]:
    """Summarise the whole catalog: total size, and every category with its
    product count, price range, brands and common tags.

    This is the RIGHT TOOL for any question about what the catalog contains as a
    whole - "how many products do I have", "what do you sell", "what categories
    are there", "what is the price range". Do not try to answer those with
    `search_products`: a text search for a word like "products" matches nothing
    and looks identical to an empty catalog.

    It is also the cheapest way to orient yourself before searching, because it
    shows what a realistic budget looks like in each category.

    Returns {total_products, category_count, categories[]}.
    """
    cats = catalog.categories()
    return {
        "total_products": catalog.total_count(),
        "category_count": len(cats),
        "categories": cats,
    }


@mcp.tool
def check_stock(
    product_id: Annotated[str, Field(description="Product id such as hp-008.")],
) -> dict[str, Any]:
    """Check current availability and unit count for one product.

    Call this before recommending a purchase or adding to the cart - search
    results carry stock at query time, but this is the authoritative answer.

    Returns {product_id, name, in_stock, stock_count, status} where `status` is
    one of "in_stock", "low_stock" (15 or fewer) or "out_of_stock".
    """
    product = catalog.get_product(product_id)
    if product is None:
        return {
            "error": f"No product with id {product_id!r}.",
            "product_id": product_id,
        }

    count = product["stockCount"]
    if not product["inStock"]:
        status = "out_of_stock"
    elif count <= 15:
        status = "low_stock"
    else:
        status = "in_stock"

    return {
        "product_id": product_id,
        "name": product["name"],
        "in_stock": product["inStock"],
        "stock_count": count,
        "status": status,
    }


# --------------------------------------------------------------- write tools


@mcp.tool
def add_to_cart(
    product_id: Annotated[str, Field(description="Product id to add.")],
    quantity: Annotated[int, Field(description="How many units.", ge=1, le=10)] = 1,
) -> dict[str, Any]:
    """Add a product to the shopping cart. THIS CHANGES STATE.

    Only call this when the user has explicitly asked to add something to their
    cart. Never call it to be helpful after a recommendation, and never call it
    to test whether a product exists - use `check_stock` for that.

    Fails cleanly if the product is unknown, out of stock, or if the requested
    quantity would exceed available units.

    Returns {ok, product_id, quantity, cart} on success, or {ok: false, error}
    on failure. Always check `ok` before telling the user it worked.
    """
    return cart_store.add(product_id, quantity)


@mcp.tool
def remove_from_cart(
    product_id: Annotated[str, Field(description="Product id to remove entirely.")],
) -> dict[str, Any]:
    """Remove a product from the cart completely. THIS CHANGES STATE.

    Removes the whole line, not one unit. Only call on explicit user request.

    Returns {ok, product_id, cart}, or {ok: false, error} if the product was not
    in the cart to begin with.
    """
    return cart_store.remove(product_id)


@mcp.tool
def view_cart() -> dict[str, Any]:
    """Read the current cart contents without changing anything.

    Safe to call any time you need to know what the user has already selected -
    for instance before recommending an accessory, or to answer "what is in my
    cart?".

    Returns {items[], item_count, subtotal, currency}. An empty cart returns an
    empty `items` list, not an error.
    """
    return cart_store.view()


# ------------------------------------------------------- introspection route


WRITE_TOOLS = {"add_to_cart", "remove_from_cart"}


@mcp.custom_route("/tools.json", methods=["GET"])
async def list_tools_route(request):  # noqa: ANN001, ANN201 - starlette types
    """Plain HTTP listing of this server's tools, for the UI to display.

    Not part of MCP. The chat shows users what the agent can actually do, and
    reimplementing the MCP handshake in the browser to find that out would be
    absurd when the server already knows.

    The first line of each docstring is the summary; `write` marks the tools
    that change state and therefore need a human to confirm.
    """
    from starlette.responses import JSONResponse

    tools = await mcp.list_tools()
    payload = [
        {
            "name": tool.name,
            "summary": (tool.description or "").strip().splitlines()[0],
            "write": tool.name in WRITE_TOOLS,
            "parameters": sorted(
                (tool.parameters or {}).get("properties", {}).keys()
            ),
        }
        for tool in tools
    ]
    payload.sort(key=lambda t: (t["write"], t["name"]))
    return JSONResponse({"server": "product-catalog", "tools": payload})


def main() -> None:
    host = os.getenv("MCP_SERVER_HOST", "127.0.0.1")
    port = int(os.getenv("MCP_SERVER_PORT", "8931"))
    mcp.run(transport="http", host=host, port=port)


if __name__ == "__main__":
    main()
