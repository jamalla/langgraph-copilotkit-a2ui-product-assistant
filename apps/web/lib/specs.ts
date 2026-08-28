import type { Category } from "./types";

/**
 * Presentation metadata for spec keys: how to LABEL and UNIT them.
 *
 * Note what is deliberately NOT here: whether a higher value is better.
 * That is comparison logic, and it lives in the MCP server (apps/mcp), which is
 * the one place that ranks products. Duplicating it here would let the UI and
 * the agent disagree about which laptop "wins" on weight.
 */
export interface SpecMeta {
  label: string;
  unit?: string;
}

const COMMON: Record<string, SpecMeta> = {
  battery_hours: { label: "Battery", unit: "h" },
  weight_g: { label: "Weight", unit: "g" },
  ports: { label: "Ports" },
};

export const SPEC_META: Record<Category, Record<string, SpecMeta>> = {
  laptops: {
    cpu: { label: "Processor" },
    ram_gb: { label: "Memory", unit: "GB" },
    storage_gb: { label: "Storage", unit: "GB" },
    screen_inches: { label: "Screen", unit: '"' },
    screen_type: { label: "Panel" },
    weight_kg: { label: "Weight", unit: "kg" },
    battery_hours: COMMON.battery_hours,
    gpu: { label: "Graphics" },
    ports: COMMON.ports,
    os: { label: "OS" },
  },
  headphones: {
    type: { label: "Form factor" },
    anc: { label: "Noise cancelling" },
    battery_hours: COMMON.battery_hours,
    driver_mm: { label: "Driver", unit: "mm" },
    codecs: { label: "Codecs" },
    weight_g: COMMON.weight_g,
    multipoint: { label: "Multipoint" },
    water_resistance: { label: "Water resistance" },
  },
  monitors: {
    size_inches: { label: "Size", unit: '"' },
    resolution: { label: "Resolution" },
    panel: { label: "Panel" },
    refresh_hz: { label: "Refresh rate", unit: "Hz" },
    response_ms: { label: "Response", unit: "ms" },
    color_gamut_srgb: { label: "sRGB coverage", unit: "%" },
    hdr: { label: "HDR" },
    ports: COMMON.ports,
    adjustable_stand: { label: "Adjustable stand" },
  },
  keyboards: {
    layout: { label: "Layout" },
    switch_type: { label: "Switches" },
    hot_swappable: { label: "Hot-swappable" },
    connectivity: { label: "Connectivity" },
    backlight: { label: "Backlight" },
    battery_hours: COMMON.battery_hours,
    keycaps: { label: "Keycaps" },
    weight_g: COMMON.weight_g,
  },
};

export function specLabel(category: Category, key: string): string {
  return SPEC_META[category]?.[key]?.label ?? key.replace(/_/g, " ");
}

export function specUnit(category: Category, key: string): string | undefined {
  return SPEC_META[category]?.[key]?.unit;
}
