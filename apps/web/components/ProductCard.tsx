"use client";

import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import { ProductTile } from "./ProductTile";
import { Rating } from "./Rating";
import { StockBadge } from "./StockBadge";

export function ProductCard({
  product,
  onSelect,
  selected = false,
}: {
  product: Product;
  onSelect: (product: Product) => void;
  /** Part 5 drives this from shared agent state. For now it is click-only. */
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      aria-pressed={selected}
      // The frontend tool `highlight_product` finds cards by this attribute.
      data-product-id={product.id}
      className={`group flex flex-col overflow-hidden rounded-card border bg-surface text-left shadow-card transition
        hover:-translate-y-0.5 hover:shadow-float
        ${selected ? "border-brand ring-2 ring-brand/35" : "border-line"}`}
    >
      <ProductTile
        name={product.name}
        accent={product.accent}
        imageUrl={product.imageUrl}
        imageAlt={product.imageAlt}
        className="h-36 w-full shrink-0"
      />

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              {product.brand}
            </p>
            <h3 className="truncate text-sm font-semibold text-ink">
              {product.name}
            </h3>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
            {formatPrice(product.price, product.currency)}
          </p>
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-ink-muted">
          {product.shortDescription}
        </p>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
          <Rating value={product.rating} reviewCount={product.reviewCount} />
          <StockBadge inStock={product.inStock} stockCount={product.stockCount} />
        </div>
      </div>
    </button>
  );
}
