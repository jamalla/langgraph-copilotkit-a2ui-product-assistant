"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CategoryFacet, Product } from "@/lib/types";
import { useSharedSelection } from "@/lib/useSharedSelection";
import { FilterBar, type Filters } from "./FilterBar";
import { ProductGrid } from "./ProductGrid";
import { ProductDetailSheet } from "./ProductDetailSheet";

/**
 * The interactive shell.
 *
 * `initialProducts` is rendered by the server, so the first paint is complete
 * HTML with no loading state. Every filter change after that goes back to
 * /api/products — filtering stays on the server, and the browser never holds
 * the full catalog.
 *
 * In Part 5 this component grows a `useCoAgent` hook so `selectedIds` becomes
 * shared state with the LangGraph agent, in both directions. The seam is
 * already here: selection is one piece of state in one place.
 */
export function Catalog({
  initialProducts,
  facets,
  priceMax,
}: {
  initialProducts: Product[];
  facets: CategoryFacet[];
  priceMax: number;
}) {
  const defaults = useMemo<Filters>(
    () => ({
      q: "",
      category: "",
      maxPrice: priceMax,
      minRating: 0,
      inStockOnly: false,
      sort: "relevance",
    }),
    [priceMax],
  );

  const [filters, setFilters] = useState<Filters>(defaults);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<Product | null>(null);

  // Part 5: this used to be `useState<string[]>([])`. That is the entire change
  // on the React side — one hook swap — because selection was always a single
  // piece of state in a single place. Now the agent shares it.
  const { selectedIds, select, intent, routeReason } = useSharedSelection();

  const pristine = useRef(true);

  useEffect(() => {
    // Skip the first run: the server already gave us unfiltered results.
    if (pristine.current) {
      pristine.current = false;
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.q.trim()) params.set("q", filters.q.trim());
      if (filters.category) params.set("category", filters.category);
      if (filters.maxPrice < priceMax) params.set("maxPrice", String(filters.maxPrice));
      if (filters.minRating > 0) params.set("minRating", String(filters.minRating));
      if (filters.inStockOnly) params.set("inStock", "true");
      params.set("sort", filters.sort);

      try {
        const res = await fetch(`/api/products?${params}`, { signal: controller.signal });
        const data = (await res.json()) as { products: Product[] };
        setProducts(data.products);
      } catch (err) {
        if ((err as Error).name !== "AbortError") console.error(err);
      } finally {
        setLoading(false);
      }
    }, 180); // debounce so typing does not fire a request per keystroke

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [filters, priceMax]);

  const onChange = useCallback(
    (next: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...next })),
    [],
  );

  const onSelect = useCallback(
    (product: Product) => {
      setActive(product);
      // Writes through to the agent, so the next question can just say "this one".
      select([product.id]);
    },
    [select],
  );

  return (
    <>
      <FilterBar
        filters={filters}
        facets={facets}
        priceMax={priceMax}
        resultCount={products.length}
        onChange={onChange}
        onReset={() => setFilters(defaults)}
      />

      {routeReason && (
        <p className="mb-3 text-xs text-ink-faint">
          <span className="font-medium text-ink-muted">agent:</span> {intent} — {routeReason}
        </p>
      )}

      <ProductGrid
        products={products}
        onSelect={onSelect}
        selectedIds={selectedIds}
        loading={loading}
      />

      <ProductDetailSheet product={active} onClose={() => setActive(null)} />
    </>
  );
}
