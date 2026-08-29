import "server-only";

import fs from "node:fs";
import path from "node:path";

import type {
  CategoryFacet,
  Category,
  Product,
  ProductQuery,
  SortKey,
} from "./types";

/**
 * Server-only access to the shared seed catalog at <repo root>/data/products.json.
 *
 * The file lives OUTSIDE this app on purpose - apps/mcp (Python) reads the very
 * same file. Rather than hard-coding "../../data", we walk up from cwd until we
 * find it, so this keeps working whether Next is started from apps/web, from the
 * repo root, or from a standalone build output.
 */

let cachedPath: string | null = null;
let cache: { mtimeMs: number; products: Product[] } | null = null;

function resolveDataFile(): string {
  if (cachedPath) return cachedPath;

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "data", "products.json");
    if (fs.existsSync(candidate)) {
      cachedPath = candidate;
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not locate data/products.json. Expected it at the monorepo root, " +
      `searched upward from ${process.cwd()}.`,
  );
}

/** Reads the catalog, re-reading only when the file changes on disk. */
export function loadProducts(): Product[] {
  const file = resolveDataFile();
  const { mtimeMs } = fs.statSync(file);
  if (cache && cache.mtimeMs === mtimeMs) return cache.products;

  const products = JSON.parse(fs.readFileSync(file, "utf8")) as Product[];
  cache = { mtimeMs, products };
  return products;
}

export function getProduct(id: string): Product | undefined {
  return loadProducts().find((p) => p.id === id);
}

function matchesText(product: Product, needle: string): boolean {
  const haystack = [
    product.name,
    product.brand,
    product.category,
    product.shortDescription,
    ...product.tags,
    ...Object.values(product.specs).map(String),
  ]
    .join(" ")
    .toLowerCase();
  // Every whitespace-separated term must appear somewhere (AND semantics).
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

const SORTERS: Record<SortKey, (a: Product, b: Product) => number> = {
  relevance: (a, b) => b.rating * Math.log10(b.reviewCount + 10) - a.rating * Math.log10(a.reviewCount + 10),
  "price-asc": (a, b) => a.price - b.price,
  "price-desc": (a, b) => b.price - a.price,
  "rating-desc": (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
};

export function queryProducts(query: ProductQuery = {}): Product[] {
  const { q, category, maxPrice, minRating, inStockOnly, sort = "relevance" } = query;

  const results = loadProducts().filter((p) => {
    if (category && p.category !== category) return false;
    if (typeof maxPrice === "number" && p.price > maxPrice) return false;
    if (typeof minRating === "number" && p.rating < minRating) return false;
    if (inStockOnly && !p.inStock) return false;
    if (q && q.trim() && !matchesText(p, q)) return false;
    return true;
  });

  return results.sort(SORTERS[sort] ?? SORTERS.relevance);
}

export function listCategories(): CategoryFacet[] {
  const byCategory = new Map<Category, Product[]>();
  for (const p of loadProducts()) {
    const bucket = byCategory.get(p.category) ?? [];
    bucket.push(p);
    byCategory.set(p.category, bucket);
  }
  return [...byCategory.entries()]
    .map(([category, items]) => ({
      category,
      count: items.length,
      minPrice: Math.min(...items.map((i) => i.price)),
      maxPrice: Math.max(...items.map((i) => i.price)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export function priceBounds(): { min: number; max: number } {
  const prices = loadProducts().map((p) => p.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
