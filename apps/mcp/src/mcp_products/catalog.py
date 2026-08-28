"""Loading and querying data/products.json.

This mirrors apps/web/lib/data.ts, but NOT exactly, and the difference matters.

The web app's search box is a human typing a filter: strict AND over substrings
is what people expect, and getting fewer results is fine because they can see
the box and edit it. The agent's search is retrieval: it fires one query on the
user's behalf and never sees what it missed, so RECALL matters far more than
precision. Strict AND here quietly returned 2 of 6 noise-cancelling headphones
because one description said "cancellation" and another said "ANC".

So this module scores instead of filtering: any term hit keeps the product, and
where the hit landed decides the rank.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

Product = dict[str, Any]

_cache: tuple[float, list[Product]] | None = None


def _data_file() -> Path:
    """Walk up from this file until data/products.json turns up."""
    override = os.getenv("PRODUCTS_FILE")
    if override:
        return Path(override)

    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "data" / "products.json"
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        f"Could not locate data/products.json above {here}. "
        "Set PRODUCTS_FILE to point at it explicitly."
    )


def load_products() -> list[Product]:
    """Read the catalog, re-reading only when the file changes on disk."""
    global _cache
    path = _data_file()
    mtime = path.stat().st_mtime
    if _cache is not None and _cache[0] == mtime:
        return _cache[1]

    products: list[Product] = json.loads(path.read_text(encoding="utf-8"))
    _cache = (mtime, products)
    return products


def get_product(product_id: str) -> Product | None:
    return next((p for p in load_products() if p["id"] == product_id), None)


# --------------------------------------------------------------------- search

# Vocabulary the catalog does not literally contain. Without this, "noise
# cancelling" misses every product whose copy says "ANC" instead - which is
# most of them. Kept deliberately small and hand-written: this is the cheapest
# possible stand-in for embeddings, and it is enough at this catalog size.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "noise": ("anc", "cancelling", "cancellation", "quiet"),
    "cancelling": ("anc", "cancellation", "noise"),
    "cancellation": ("anc", "cancelling", "noise"),
    "anc": ("noise", "cancelling", "cancellation"),
    "quiet": ("anc", "silent", "noise"),
    "cheap": ("budget", "value", "affordable"),
    "affordable": ("budget", "value", "cheap"),
    "light": ("lightweight", "ultraportable", "portable"),
    "lightweight": ("light", "ultraportable", "portable"),
    "gaming": ("gamer", "high-refresh", "esports"),
    "work": ("business", "office", "productivity"),
    "travel": ("portable", "commute", "ultraportable"),
    "photo": ("color-accurate", "creator", "photo-editing"),
    "video": ("creator", "video-editing", "workstation"),
    "typing": ("keyboard", "mechanical", "ergonomic"),
    "wireless": ("bluetooth", "bt", "2.4ghz"),
    "battery": ("long-battery", "endurance"),
}

_WORD = re.compile(r"[a-z0-9.+]+")

# Where a term matched decides how much it counts.
FIELD_WEIGHTS: dict[str, float] = {
    "name": 5.0,
    "brand": 4.0,
    "tags": 3.0,
    "category": 3.0,
    "description": 2.0,
    "specs": 1.5,
}


def _fields(product: Product) -> dict[str, str]:
    return {
        "name": product["name"].lower(),
        "brand": product["brand"].lower(),
        "tags": " ".join(product["tags"]).lower(),
        "category": product["category"].lower(),
        "description": product["shortDescription"].lower(),
        "specs": " ".join(str(v) for v in product["specs"].values()).lower(),
    }


def _expand(terms: list[str]) -> list[tuple[str, float]]:
    """Each query term, plus its synonyms at reduced weight."""
    expanded: list[tuple[str, float]] = []
    for term in terms:
        expanded.append((term, 1.0))
        for syn in SYNONYMS.get(term, ()):
            expanded.append((syn, 0.6))
    return expanded


def _score(product: Product, terms: list[str]) -> tuple[float, int]:
    """Return (score, distinct original terms matched)."""
    fields = _fields(product)
    score = 0.0
    matched_terms: set[str] = set()

    for term, term_weight in _expand(terms):
        best = 0.0
        for field, text in fields.items():
            if term in text:
                best = max(best, FIELD_WEIGHTS[field] * term_weight)
        if best:
            score += best
            # Credit the ORIGINAL term, so a synonym hit still counts as
            # covering that part of the query.
            for original in terms:
                if term == original or term in SYNONYMS.get(original, ()):
                    matched_terms.add(original)

    return score, len(matched_terms)


def _popularity(product: Product) -> float:
    """Rating weighted by review volume.

    A 4.9 from 340 reviews should not automatically outrank a 4.7 from 5,600.
    """
    return product["rating"] * (1 + (product["reviewCount"] ** 0.25) / 10)


def search(
    query: str | None = None,
    category: str | None = None,
    max_price: float | None = None,
    min_rating: float | None = None,
    in_stock_only: bool = False,
    limit: int = 10,
) -> list[Product]:
    terms = _WORD.findall(query.lower()) if query and query.strip() else []

    scored: list[tuple[float, int, Product]] = []
    for p in load_products():
        # Hard filters first - these are constraints, not preferences.
        if category and p["category"] != category:
            continue
        if max_price is not None and p["price"] > max_price:
            continue
        if min_rating is not None and p["rating"] < min_rating:
            continue
        if in_stock_only and not p["inStock"]:
            continue

        if not terms:
            scored.append((0.0, 0, p))
            continue

        score, covered = _score(p, terms)
        if score > 0:
            scored.append((score, covered, p))

    # Rank by: how many of the query's terms were covered, then match strength,
    # then popularity. Term coverage leads because a product matching both
    # "noise" and "cancelling" is a better answer than one matching "noise"
    # very strongly and nothing else.
    scored.sort(key=lambda t: (t[1], t[0], _popularity(t[2])), reverse=True)
    return [p for _, _, p in scored[: max(1, limit)]]


def total_count() -> int:
    """How many products exist at all."""
    return len(load_products())


def categories() -> list[dict[str, Any]]:
    buckets: dict[str, list[Product]] = {}
    for p in load_products():
        buckets.setdefault(p["category"], []).append(p)

    return sorted(
        (
            {
                "category": name,
                "count": len(items),
                "price_range": {
                    "min": min(i["price"] for i in items),
                    "max": max(i["price"] for i in items),
                },
                "brands": sorted({i["brand"] for i in items}),
                "example_tags": sorted({t for i in items for t in i["tags"]})[:8],
            }
            for name, items in buckets.items()
        ),
        key=lambda c: c["category"],
    )
