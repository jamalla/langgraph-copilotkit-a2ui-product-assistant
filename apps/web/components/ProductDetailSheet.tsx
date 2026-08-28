"use client";

import { useEffect } from "react";

import type { Product } from "@/lib/types";
import { formatPrice, formatSpec } from "@/lib/format";
import { specLabel } from "@/lib/specs";
import { ProductTile } from "./ProductTile";
import { Rating } from "./Rating";
import { StockBadge } from "./StockBadge";

export function ProductDetailSheet({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!product) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [product, onClose]);

  if (!product) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      <aside
        className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-float"
        style={{ animation: "a2ui-slide-in 180ms ease-out" }}
      >
        <ProductTile
          name={product.name}
          accent={product.accent}
          size="hero"
          className="h-40 w-full shrink-0"
        />

        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute right-3 top-3 grid size-8 place-items-center rounded-pill bg-black/25 text-lg leading-none text-white transition hover:bg-black/45"
        >
          ×
        </button>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            {product.brand} · {product.category}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-ink">{product.name}</h2>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums text-ink">
              {formatPrice(product.price, product.currency)}
            </span>
            <Rating value={product.rating} reviewCount={product.reviewCount} />
            <StockBadge inStock={product.inStock} stockCount={product.stockCount} />
          </div>

          <p className="mt-4 text-sm leading-relaxed text-ink-muted">
            {product.shortDescription}
          </p>

          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Specifications
          </h3>
          <dl className="mt-2 divide-y divide-line rounded-card border border-line">
            {Object.entries(product.specs).map(([key, value]) => (
              <div key={key} className="flex gap-4 px-3.5 py-2.5">
                <dt className="w-2/5 shrink-0 text-xs text-ink-muted">
                  {specLabel(product.category, key)}
                </dt>
                <dd className="flex-1 text-right text-xs font-medium text-ink">
                  {formatSpec(product.category, key, value)}
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Tags
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {product.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-pill bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-muted"
              >
                {tag}
              </span>
            ))}
          </div>

          <p className="mt-6 font-mono text-[11px] text-ink-faint">id: {product.id}</p>
        </div>
      </aside>
    </div>
  );
}
