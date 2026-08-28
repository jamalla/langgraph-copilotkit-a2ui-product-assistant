"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Makes the CopilotKit popup resizable.
 *
 * The popup ships at a fixed 420×560 and is anchored bottom-right. Two reasons
 * plain `resize: both` is not enough:
 *
 *   - CSS only ever puts the grip in the BOTTOM-RIGHT corner. On a
 *     bottom-right-anchored panel that grip drags the window off-screen.
 *   - A2UI surfaces are wide. A comparison table in a 420px column is unusable.
 *
 * So this renders its own handle in the TOP-LEFT of the popup, where dragging
 * grows the panel up and to the left — into the viewport rather than out of it.
 * Size lives in CSS variables on :root, read by copilot-chat.css, and persists
 * per browser.
 */

const MIN_W = 340;
const MIN_H = 320;
const KEY = "chat-size";

const PRESETS: { label: string; w: number; h: number }[] = [
  { label: "S", w: 420, h: 560 },
  { label: "M", w: 620, h: 720 },
  { label: "L", w: 900, h: 860 },
];

export function ChatResizer() {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Restore before first paint of the handle so the panel does not jump.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setSize(JSON.parse(saved));
      else setSize(PRESETS[0]);
    } catch {
      setSize(PRESETS[0]);
    }
  }, []);

  useEffect(() => {
    if (!size) return;
    const root = document.documentElement;
    root.style.setProperty("--cpk-w", `${size.w}px`);
    root.style.setProperty("--cpk-h", `${size.h}px`);
    try {
      localStorage.setItem(KEY, JSON.stringify(size));
    } catch {
      /* private mode — the size just will not persist */
    }
  }, [size]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!size) return;
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    },
    [size],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // Dragging LEFT and UP grows the panel, because it is anchored bottom-right.
    setSize({
      w: Math.max(MIN_W, Math.min(window.innerWidth * 0.94, d.w - (e.clientX - d.x))),
      h: Math.max(MIN_H, Math.min(window.innerHeight * 0.88, d.h - (e.clientY - d.y))),
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }, []);

  if (!size) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[1300]">
      <div
        className="pointer-events-auto absolute flex items-center gap-1"
        style={{
          right: `calc(1.5rem + ${size.w}px - 2rem)`,
          bottom: `calc(6rem + ${size.h}px - 1.75rem)`,
        }}
      >
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            title={`${p.w} × ${p.h}`}
            onClick={() => setSize({ w: p.w, h: p.h })}
            className={`grid size-6 place-items-center rounded-control border text-[10px] font-medium transition ${
              size.w === p.w && size.h === p.h
                ? "border-brand bg-brand text-brand-ink"
                : "border-line bg-surface text-ink-muted hover:border-line-strong"
            }`}
          >
            {p.label}
          </button>
        ))}

        <div
          role="separator"
          aria-label="Resize chat"
          title="Drag to resize"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="grid size-6 cursor-nwse-resize place-items-center rounded-control border border-line bg-surface text-ink-faint transition hover:border-brand hover:text-brand"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M9 1 1 9M9 5l-4 4" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        </div>
      </div>
    </div>
  );
}
