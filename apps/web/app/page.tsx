import { Catalog } from "@/components/Catalog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { listCategories, priceBounds, queryProducts } from "@/lib/data";

/**
 * The catalog is read from disk at request time (see lib/data.ts, which caches
 * on mtime). Opting out of static prerendering means editing data/products.json
 * is reflected on the next request instead of requiring a rebuild.
 */
export const dynamic = "force-dynamic";

/**
 * Server component. Reads the catalog directly from disk — no self-fetch to our
 * own API route, which would be a pointless network hop on the server.
 */
export default function HomePage() {
  const products = queryProducts();
  const facets = listCategories();
  const { max } = priceBounds();

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            Product catalog
          </h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            {products.length} products across {facets.length} categories.
            <span className="text-ink-faint">
              {" "}
              Ask the assistant, bottom right — click a card first and it will know what
              &ldquo;this one&rdquo; means.
            </span>
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Catalog
        initialProducts={products}
        facets={facets}
        priceMax={Math.ceil(max / 100) * 100}
      />
    </main>
  );
}
