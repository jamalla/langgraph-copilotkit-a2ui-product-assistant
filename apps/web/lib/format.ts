import type { Category, SpecValue } from "./types";
import { specUnit } from "./specs";

export function formatPrice(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

/**
 * Render one spec value for display.
 *
 * The `battery_hours: 0` case is why this exists: a wired reference headphone
 * has no battery, and printing "0 h" reads as a defect rather than an absence.
 */
export function formatSpec(
  category: Category,
  key: string,
  value: SpecValue,
): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (key === "battery_hours" && value === 0) return "Wired - no battery";

  const unit = specUnit(category, key);
  if (typeof value === "number") {
    const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
    return unit ? `${n}${unit === '"' ? unit : ` ${unit}`}` : n;
  }
  return String(value);
}

/** Deterministic two-stop gradient derived from the product's accent colour. */
export function tileGradient(accent: string): string {
  return `linear-gradient(135deg, ${accent} 0%, ${accent}99 45%, ${accent}33 100%)`;
}

export function monogram(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
