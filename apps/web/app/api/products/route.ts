import { NextResponse } from "next/server";

import { queryProducts } from "@/lib/data";
import type { Category, ProductQuery, SortKey } from "@/lib/types";

const CATEGORIES = new Set<Category>(["laptops", "headphones", "monitors", "keyboards"]);
const SORTS = new Set<SortKey>(["relevance", "price-asc", "price-desc", "rating-desc"]);

function num(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * GET /api/products?q=&category=&maxPrice=&minRating=&inStock=&sort=
 *
 * Filtering runs on the server. The browser never receives the full catalog,
 * and this route is the only HTTP surface the React app has to the data.
 */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const category = params.get("category") as Category | null;
  const sort = params.get("sort") as SortKey | null;

  const query: ProductQuery = {
    q: params.get("q") ?? undefined,
    category: category && CATEGORIES.has(category) ? category : undefined,
    maxPrice: num(params.get("maxPrice")),
    minRating: num(params.get("minRating")),
    inStockOnly: params.get("inStock") === "true",
    sort: sort && SORTS.has(sort) ? sort : "relevance",
  };

  const products = queryProducts(query);
  return NextResponse.json({ products, count: products.length, query });
}
