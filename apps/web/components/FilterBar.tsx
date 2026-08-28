"use client";

import type { CategoryFacet, Category, SortKey } from "@/lib/types";
import { formatPrice } from "@/lib/format";

export interface Filters {
  q: string;
  category: Category | "";
  maxPrice: number;
  minRating: number;
  inStockOnly: boolean;
  sort: SortKey;
}

const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Most relevant",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  "rating-desc": "Highest rated",
};

const controlClass =
  "rounded-control border border-line bg-surface px-2.5 py-1.5 text-sm text-ink " +
  "transition hover:border-line-strong focus:border-brand";

export function FilterBar({
  filters,
  facets,
  priceMax,
  resultCount,
  onChange,
  onReset,
}: {
  filters: Filters;
  facets: CategoryFacet[];
  priceMax: number;
  resultCount: number;
  onChange: (next: Partial<Filters>) => void;
  onReset: () => void;
}) {
  const dirty =
    filters.q !== "" ||
    filters.category !== "" ||
    filters.minRating > 0 ||
    filters.inStockOnly ||
    filters.maxPrice < priceMax ||
    filters.sort !== "relevance";

  return (
    <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-line bg-canvas/85 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search products, brands, specs…"
          aria-label="Search products"
          className={`${controlClass} min-w-[16rem] flex-1`}
        />

        <select
          value={filters.category}
          onChange={(e) => onChange({ category: e.target.value as Category | "" })}
          aria-label="Category"
          className={controlClass}
        >
          <option value="">All categories</option>
          {facets.map((f) => (
            <option key={f.category} value={f.category}>
              {f.category} ({f.count})
            </option>
          ))}
        </select>

        <select
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value as SortKey })}
          aria-label="Sort by"
          className={controlClass}
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1.5 text-sm">
          <span className="whitespace-nowrap text-ink-muted">Under</span>
          <input
            type="range"
            min={0}
            max={priceMax}
            step={50}
            value={filters.maxPrice}
            onChange={(e) => onChange({ maxPrice: Number(e.target.value) })}
            aria-label="Maximum price"
            className="w-28 accent-brand"
          />
          <span className="w-16 text-right font-medium tabular-nums text-ink">
            {formatPrice(filters.maxPrice)}
          </span>
        </label>

        <label className="flex items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1.5 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={filters.inStockOnly}
            onChange={(e) => onChange({ inStockOnly: e.target.checked })}
            className="accent-brand"
          />
          In stock
        </label>

        <label className="flex items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1.5 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={filters.minRating >= 4.5}
            onChange={(e) => onChange({ minRating: e.target.checked ? 4.5 : 0 })}
            className="accent-brand"
          />
          4.5★ and up
        </label>

        {dirty && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-control px-2.5 py-1.5 text-sm font-medium text-brand hover:bg-brand/10"
          >
            Reset
          </button>
        )}

        <span className="ml-auto text-xs tabular-nums text-ink-faint">
          {resultCount} {resultCount === 1 ? "result" : "results"}
        </span>
      </div>
    </div>
  );
}
