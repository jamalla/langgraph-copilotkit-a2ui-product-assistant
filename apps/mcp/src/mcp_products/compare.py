"""Building the comparison matrix.

You chose to let the model judge which product is better rather than encoding a
SPEC_DIRECTION map. That is a real tradeoff: zero maintenance and it adapts to
any new spec, at the cost of determinism.

This module's job is therefore to make the model's judgement as RELIABLE as
possible without making it for them. For every row we ship:

  * `numeric`      - can these values be ordered at all?
  * `differs`      - do the products actually differ here? (skip identical rows)
  * `range`        - the observed min/max, so the model never does arithmetic
  * `spread_pct`   - how big the gap is, so it can tell "meaningful" from "noise"
  * `caveat`       - traps a model would otherwise walk into (battery_hours: 0)

Everything above is a FACT. Which fact matters is left to the reader.
"""

from __future__ import annotations

from typing import Any

from . import catalog
from .specs import SPEC_CAVEATS, spec_label, spec_unit

# Comparable attributes that live outside the `specs` object.
TOP_LEVEL_ROWS: list[tuple[str, str, str | None]] = [
    ("price", "Price", "USD"),
    ("rating", "Rating", "/5"),
    ("reviewCount", "Review count", None),
    ("stockCount", "Units in stock", None),
]


def _row(key: str, label: str, unit: str | None, values: dict[str, Any]) -> dict[str, Any]:
    present = [v for v in values.values() if v is not None]
    numeric = bool(present) and all(
        isinstance(v, (int, float)) and not isinstance(v, bool) for v in present
    )
    differs = len({str(v) for v in present}) > 1

    row: dict[str, Any] = {
        "key": key,
        "label": label,
        "unit": unit,
        "numeric": numeric,
        "differs": differs,
        "values": values,
    }

    if numeric and differs:
        lo, hi = min(present), max(present)
        row["range"] = {"min": lo, "max": hi}
        row["spread_pct"] = round(((hi - lo) / lo * 100), 1) if lo else None
        row["leaders"] = {
            "highest": [k for k, v in values.items() if v == hi],
            "lowest": [k for k, v in values.items() if v == lo],
        }

    if key in SPEC_CAVEATS:
        row["caveat"] = SPEC_CAVEATS[key]

    return row


def compare(product_ids: list[str]) -> dict[str, Any]:
    products = [catalog.get_product(pid) for pid in product_ids]
    missing = [pid for pid, p in zip(product_ids, products) if p is None]
    found = [p for p in products if p is not None]

    if len(found) < 2:
        return {
            "ok": False,
            "error": "Need at least two existing products to compare.",
            "missing_ids": missing,
        }

    categories = {p["category"] for p in found}
    cross_category = len(categories) > 1

    rows = [
        _row(key, label, unit, {p["id"]: p.get(key) for p in found})
        for key, label, unit in TOP_LEVEL_ROWS
    ]

    # Union of spec keys, so a spec only one product has still shows up (as null
    # for the others) rather than being silently dropped.
    spec_keys: list[str] = []
    for p in found:
        for k in p["specs"]:
            if k not in spec_keys:
                spec_keys.append(k)

    reference_category = found[0]["category"]
    for key in spec_keys:
        rows.append(
            _row(
                key,
                spec_label(reference_category, key),
                spec_unit(reference_category, key),
                {p["id"]: p["specs"].get(key) for p in found},
            )
        )

    return {
        "ok": True,
        "products": [
            {
                "id": p["id"],
                "name": p["name"],
                "brand": p["brand"],
                "category": p["category"],
                "price": p["price"],
                "rating": p["rating"],
                "in_stock": p["inStock"],
                "accent": p["accent"],
                "summary": p["shortDescription"],
                "tags": p["tags"],
            }
            for p in found
        ],
        "rows": rows,
        "differing_rows": [r["key"] for r in rows if r["differs"]],
        "identical_rows": [r["key"] for r in rows if not r["differs"]],
        "cross_category": cross_category,
        "missing_ids": missing,
        "judgement_note": (
            "This matrix contains facts only - no winner has been chosen. "
            "Decide which rows matter for the user's stated use case and say so "
            "explicitly. Rows in `identical_rows` are not differentiators. "
            "Respect any `caveat` on a row."
            + (
                " WARNING: these products span different categories, so most "
                "spec rows are not meaningfully comparable."
                if cross_category
                else ""
            )
        ),
    }
