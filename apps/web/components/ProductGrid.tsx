"use client";

import type { Product } from "@/lib/types";
import { ProductCard } from "./ProductCard";

export function ProductGrid({
  products,
  onSelect,
  selectedIds = [],
  loading = false,
}: {
  products: Product[];
  onSelect: (product: Product) => void;
  selectedIds?: string[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-72 animate-pulse rounded-card border border-line bg-surface-2"
          />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="grid place-items-center rounded-card border border-dashed border-line-strong bg-surface/50 px-6 py-20 text-center">
        <p className="text-sm font-medium text-ink">No products match those filters</p>
        <p className="mt-1 text-xs text-ink-muted">
          Try widening the price range or clearing the search.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          onSelect={onSelect}
          selected={selectedIds.includes(product.id)}
        />
      ))}
    </div>
  );
}
