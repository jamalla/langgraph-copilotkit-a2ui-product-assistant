export function StockBadge({
  inStock,
  stockCount,
}: {
  inStock: boolean;
  stockCount: number;
}) {
  if (!inStock) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
        <span className="size-1.5 rounded-pill bg-danger" />
        Out of stock
      </span>
    );
  }
  const low = stockCount <= 15;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-xs font-medium ${
        low ? "bg-warning/10 text-warning" : "bg-positive/10 text-positive"
      }`}
    >
      <span
        className={`size-1.5 rounded-pill ${low ? "bg-warning" : "bg-positive"}`}
      />
      {low ? `Only ${stockCount} left` : "In stock"}
    </span>
  );
}
