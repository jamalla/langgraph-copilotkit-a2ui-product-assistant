"""In-memory shopping cart.

Demo state only: a single global cart, reset whenever the server restarts.
A real deployment would key this by authenticated user and persist it.

It exists so the agent has a genuine SIDE EFFECT to perform. Read-only tools
are safe to call speculatively; a write is not. That asymmetry is what makes
the human-in-the-loop confirmation in Part 5 necessary rather than decorative.
"""

from __future__ import annotations

from typing import Any

from . import catalog

_lines: dict[str, int] = {}


def add(product_id: str, quantity: int = 1) -> dict[str, Any]:
    product = catalog.get_product(product_id)
    if product is None:
        return {"ok": False, "error": f"No product with id {product_id!r}."}
    if quantity < 1:
        return {"ok": False, "error": "Quantity must be at least 1."}
    if not product["inStock"]:
        return {
            "ok": False,
            "error": f"{product['name']} is out of stock.",
            "product_id": product_id,
        }

    already = _lines.get(product_id, 0)
    if already + quantity > product["stockCount"]:
        return {
            "ok": False,
            "error": (
                f"Only {product['stockCount']} units of {product['name']} exist; "
                f"the cart already holds {already}."
            ),
            "available": product["stockCount"],
            "in_cart": already,
        }

    _lines[product_id] = already + quantity
    return {"ok": True, "product_id": product_id, "quantity": _lines[product_id], "cart": view()}


def remove(product_id: str) -> dict[str, Any]:
    if product_id not in _lines:
        return {"ok": False, "error": f"{product_id!r} is not in the cart."}
    del _lines[product_id]
    return {"ok": True, "product_id": product_id, "cart": view()}


def clear() -> dict[str, Any]:
    _lines.clear()
    return {"ok": True, "cart": view()}


def view() -> dict[str, Any]:
    items = []
    subtotal = 0.0
    for product_id, quantity in _lines.items():
        product = catalog.get_product(product_id)
        if product is None:
            continue
        line_total = product["price"] * quantity
        subtotal += line_total
        items.append(
            {
                "product_id": product_id,
                "name": product["name"],
                "brand": product["brand"],
                # The cart is rendered like every other product surface, so it
                # needs the same photo. This function already holds the full
                # catalog row; leaving it out only forced the caller to look the
                # product up a second time.
                "imageUrl": product.get("imageUrl"),
                "imageAlt": product.get("imageAlt"),
                "in_stock": product["inStock"],
                "unit_price": product["price"],
                "quantity": quantity,
                "line_total": line_total,
            }
        )
    return {
        "items": items,
        "item_count": sum(i["quantity"] for i in items),
        "subtotal": round(subtotal, 2),
        "currency": "USD",
    }
