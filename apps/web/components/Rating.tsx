import { formatCount } from "@/lib/format";

export function Rating({
  value,
  reviewCount,
  compact = false,
}: {
  value: number;
  reviewCount: number;
  compact?: boolean;
}) {
  const pct = (value / 5) * 100;
  return (
    <div className="flex items-center gap-1.5" title={`${value} out of 5`}>
      <div className="relative text-sm leading-none" aria-hidden>
        <span className="text-line-strong">★★★★★</span>
        <span
          className="absolute inset-0 overflow-hidden text-warning"
          style={{ width: `${pct}%` }}
        >
          ★★★★★
        </span>
      </div>
      <span className="text-xs text-ink-muted tabular-nums">
        {value.toFixed(1)}
        {!compact && <> · {formatCount(reviewCount)}</>}
      </span>
      <span className="sr-only">
        Rated {value} out of 5 from {reviewCount} reviews
      </span>
    </div>
  );
}
