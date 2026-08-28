import { monogram, tileGradient } from "@/lib/format";

/**
 * Zero-asset product imagery: a deterministic gradient derived from the
 * product's `accent` colour, with a monogram on top. No image files, no broken
 * <img> placeholders, no external requests — and it looks intentional.
 */
export function ProductTile({
  name,
  accent,
  className = "",
  size = "card",
}: {
  name: string;
  accent: string;
  className?: string;
  size?: "card" | "hero" | "chip";
}) {
  const text =
    size === "hero" ? "text-5xl" : size === "chip" ? "text-[10px]" : "text-2xl";

  return (
    <div
      aria-hidden
      className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{ background: tileGradient(accent) }}
    >
      <span
        className={`${text} font-bold tracking-tight text-white/90 drop-shadow-sm select-none`}
      >
        {monogram(name)}
      </span>
      <div className="absolute inset-0 bg-gradient-to-t from-black/15 to-transparent" />
    </div>
  );
}
