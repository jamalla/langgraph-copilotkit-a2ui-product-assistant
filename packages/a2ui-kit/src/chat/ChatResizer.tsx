"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
const KEY_PREV = "chat-size-before-max";

/**
 * The largest the popup can be without leaving the viewport.
 *
 * The anchor offsets are part of the budget, not decoration. copilot-chat.css
 * pins the popup with `inset: auto 1.5rem 6rem auto` — 24px from the right and
 * 96px from the bottom, the latter clearing the launcher button. A height of
 * `0.86 * innerHeight` looks safe and is not: on a 608px viewport it yields 523,
 * and 523 + 96 pushes the popup's TOP to -11, so the resize controls sit above
 * the screen edge.
 */
const ANCHOR_RIGHT = 24;
const ANCHOR_BOTTOM = 96;
const EDGE_GAP = 16;

function maxSize() {
  return {
    w: Math.max(MIN_W, window.innerWidth - ANCHOR_RIGHT - EDGE_GAP),
    h: Math.max(MIN_H, window.innerHeight - ANCHOR_BOTTOM - EDGE_GAP),
  };
}

const PRESETS: { label: string; w: number; h: number }[] = [
  { label: "S", w: 420, h: 560 },
  { label: "M", w: 620, h: 720 },
  { label: "L", w: 900, h: 860 },
];

export function ChatResizer() {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  /**
   * A saved size must be clamped to the CURRENT viewport.
   *
   * Maximise on a wide monitor, reopen on a laptop, and the restored width is
   * larger than the screen: the popup hangs off the right edge and its content
   * is clipped mid-word. `max-width: 94vw` caps the painted box but the resize
   * handle is positioned from the stored number, so the controls drift
   * off-screen with it.
   */
  const clamp = useCallback((s: { w: number; h: number }) => {
    const max = maxSize();
    return {
      w: Math.max(MIN_W, Math.min(max.w, s.w)),
      h: Math.max(MIN_H, Math.min(max.h, s.h)),
    };
  }, []);

  // Restore before first paint of the handle so the panel does not jump.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      setSize(clamp(saved ? JSON.parse(saved) : PRESETS[0]));
    } catch {
      setSize(PRESETS[0]);
    }
  }, [clamp]);

  // And re-clamp whenever the window changes, so a resized browser cannot leave
  // the popup wider than the screen.
  useEffect(() => {
    const onResize = () => setSize((s) => (s ? clamp(s) : s));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

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
    const max = maxSize();
    setSize({
      w: Math.max(MIN_W, Math.min(max.w, d.w - (e.clientX - d.x))),
      h: Math.max(MIN_H, Math.min(max.h, d.h - (e.clientY - d.y))),
    });
  }, []);

  // Maximise / restore. The previous size is remembered so restore returns to
  // whatever the user had, not to a hard-coded default.
  const maxed = !!size && size.w >= maxSize().w - 2 && size.h >= maxSize().h - 2;

  const toggleMax = useCallback(() => {
    if (!size) return;
    if (maxed) {
      let previous = PRESETS[0];
      try {
        const saved = localStorage.getItem(KEY_PREV);
        if (saved) previous = JSON.parse(saved);
      } catch {
        /* fall back to the smallest preset */
      }
      setSize(clamp(previous));
      return;
    }
    try {
      localStorage.setItem(KEY_PREV, JSON.stringify(size));
    } catch {
      /* restore will fall back to a preset */
    }
    setSize(maxSize());
  }, [maxed, size, clamp]);

  // The popup is the portal host; it mounts lazily and re-mounts when reopened.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => {
      const popup = document.querySelector<HTMLElement>(".copilotKitPopup");
      if (popup) {
        if (getComputedStyle(popup).position === "static") popup.style.position = "relative";
        setHost(popup);
      } else {
        setHost(null);
      }
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }, []);


  if (!size || !host) return null;

  /**
   * Rendered INSIDE the popup, absolutely positioned at its top-left.
   *
   * The previous version placed the bar with `fixed` and computed its offset
   * from the stored size — `right: calc(1.5rem + Wpx - 2rem)`. That anchors the
   * bar's RIGHT edge near the popup's LEFT edge, so the bar extends leftwards
   * and slides off-screen as the popup grows: measured at x-6 on an 876px
   * viewport. Anchoring to the popup itself removes the arithmetic, and the
   * controls track it at any size.
   */
  return createPortal(
    <div className="absolute left-2 top-2 z-[1400] flex items-center gap-1">
      {PRESETS.map((p) => (
        <button
          key={p.label}
          type="button"
          title={`${p.w} × ${p.h}`}
          onClick={() => setSize(clamp(p))}
          className={`grid size-6 place-items-center rounded-control border text-[10px] font-medium transition ${
            size.w === p.w && size.h === p.h
              ? "border-brand bg-brand text-brand-ink"
              : "border-line bg-surface text-ink-muted hover:border-line-strong"
          }`}
        >
          {p.label}
        </button>
      ))}

      <button
        type="button"
        onClick={toggleMax}
        aria-pressed={maxed}
        title={maxed ? "Restore chat size" : "Maximize chat"}
        aria-label={maxed ? "Restore chat size" : "Maximize chat"}
        className={`grid size-6 place-items-center rounded-control border text-[11px] transition ${
          maxed
            ? "border-brand bg-brand text-brand-ink"
            : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink"
        }`}
      >
        {maxed ? "❐" : "⛶"}
      </button>

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
    </div>,
    host,
  );
}
