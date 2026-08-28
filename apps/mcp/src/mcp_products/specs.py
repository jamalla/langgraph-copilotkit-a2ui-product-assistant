"""Human-readable labels and units for spec keys.

Mirrors apps/web/lib/specs.ts.

Note what is NOT here: no declaration of which direction is "better".
You chose to let the model judge comparisons rather than encode a direction
map, so `compare_products` ships the model a well-shaped matrix (numeric flags,
observed ranges, which rows actually differ) and lets it reason. If you later
want determinism, this module is where a SPEC_DIRECTION map would go, and
compare.py is the only caller that would change.
"""

from __future__ import annotations

SPEC_META: dict[str, dict[str, dict[str, str]]] = {
    "laptops": {
        "cpu": {"label": "Processor"},
        "ram_gb": {"label": "Memory", "unit": "GB"},
        "storage_gb": {"label": "Storage", "unit": "GB"},
        "screen_inches": {"label": "Screen", "unit": '"'},
        "screen_type": {"label": "Panel"},
        "weight_kg": {"label": "Weight", "unit": "kg"},
        "battery_hours": {"label": "Battery", "unit": "h"},
        "gpu": {"label": "Graphics"},
        "ports": {"label": "Ports"},
        "os": {"label": "OS"},
    },
    "headphones": {
        "type": {"label": "Form factor"},
        "anc": {"label": "Noise cancelling"},
        "battery_hours": {"label": "Battery", "unit": "h"},
        "driver_mm": {"label": "Driver", "unit": "mm"},
        "codecs": {"label": "Codecs"},
        "weight_g": {"label": "Weight", "unit": "g"},
        "multipoint": {"label": "Multipoint"},
        "water_resistance": {"label": "Water resistance"},
    },
    "monitors": {
        "size_inches": {"label": "Size", "unit": '"'},
        "resolution": {"label": "Resolution"},
        "panel": {"label": "Panel"},
        "refresh_hz": {"label": "Refresh rate", "unit": "Hz"},
        "response_ms": {"label": "Response", "unit": "ms"},
        "color_gamut_srgb": {"label": "sRGB coverage", "unit": "%"},
        "hdr": {"label": "HDR"},
        "ports": {"label": "Ports"},
        "adjustable_stand": {"label": "Adjustable stand"},
    },
    "keyboards": {
        "layout": {"label": "Layout"},
        "switch_type": {"label": "Switches"},
        "hot_swappable": {"label": "Hot-swappable"},
        "connectivity": {"label": "Connectivity"},
        "backlight": {"label": "Backlight"},
        "battery_hours": {"label": "Battery", "unit": "h"},
        "keycaps": {"label": "Keycaps"},
        "weight_g": {"label": "Weight", "unit": "g"},
    },
}

# Notes the model would otherwise have to infer, and would sometimes get wrong.
SPEC_CAVEATS: dict[str, str] = {
    "battery_hours": (
        "A value of 0 means the product is wired and has no battery at all. "
        "It is NOT a worse battery than 7 hours; the axis does not apply."
    ),
    "response_ms": "Measured grey-to-grey. Panel technologies are not directly comparable.",
}


def spec_label(category: str, key: str) -> str:
    meta = SPEC_META.get(category, {}).get(key)
    return meta["label"] if meta else key.replace("_", " ")


def spec_unit(category: str, key: str) -> str | None:
    return SPEC_META.get(category, {}).get(key, {}).get("unit")
