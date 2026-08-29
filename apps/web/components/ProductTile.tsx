import { monogram, tileGradient } from "@/lib/format";

/**
 * Product imagery, with a real photograph when there is one.
 *
 * The gradient-and-monogram fallback is not dead code: it renders for any
 * product whose `imageUrl` is unset, and it sits UNDER every photo as the
 * background. So a missing file, a slow network, or a transparent PNG degrades
 * to something deliberate instead of a broken-image icon on white.
 *
 * A plain <img> rather than next/image. The files in public/products are
 * already served at exactly the size they render (900x675, ~70 KB), so the
 * optimiser has nothing left to do — and skipping it keeps the container free
 * of an image-processing step at request time.
 */
export function ProductTile({
  name,
  accent,
  imageUrl,
  imageAlt,
  className = "",
  size = "card",
}: {
  name: string;
  accent: string;
  imageUrl?: string;
  imageAlt?: string;
  className?: string;
  size?: "card" | "hero" | "chip";
}) {
  const text =
    size === "hero" ? "text-5xl" : size === "chip" ? "text-[10px]" : "text-2xl";

  return (
    <div
      // Decorative when it is a monogram; when it is a photo the <img> below
      // carries its own alt text, so the wrapper stays hidden either way.
      aria-hidden={!imageUrl}
      className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{ background: tileGradient(accent) }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={imageAlt ?? name}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span
          className={`${text} font-bold tracking-tight text-white/90 drop-shadow-sm select-none`}
        >
          {monogram(name)}
        </span>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/15 to-transparent" />
    </div>
  );
}
