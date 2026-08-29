/**
 * The shape of data/products.json.
 *
 * apps/mcp mirrors this as a Pydantic model. The two are kept in sync by hand —
 * that is the deliberate cost of letting the services stay independent. If you
 * change a field here, change it there too.
 */

export type Category = "laptops" | "headphones" | "monitors" | "keyboards";

/** Spec values are intentionally primitive so they can be compared numerically. */
export type SpecValue = string | number | boolean;

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: Category;
  price: number;
  currency: string;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  stockCount: number;
  /** Hex colour behind the photo, and the whole tile when there is none. */
  accent: string;
  /** Path under public/, e.g. "/products/lp-001.jpg". Absent = gradient tile. */
  imageUrl?: string;
  /** Alt text from the photographer's own description of the shot. */
  imageAlt?: string;
  shortDescription: string;
  specs: Record<string, SpecValue>;
  tags: string[];
}

export interface ProductQuery {
  q?: string;
  category?: Category;
  maxPrice?: number;
  minRating?: number;
  inStockOnly?: boolean;
  sort?: SortKey;
}

export type SortKey = "relevance" | "price-asc" | "price-desc" | "rating-desc";

export interface CategoryFacet {
  category: Category;
  count: number;
  minPrice: number;
  maxPrice: number;
}
