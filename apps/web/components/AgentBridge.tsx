"use client";

import { useCallback } from "react";
import { z } from "zod";

import { useFrontendTool, useInterrupt } from "@copilotkit/react-core/v2";

import { findConfirmWrite } from "@/lib/agent-state";

/**
 * The two places the agent reaches into the browser.
 *
 * Rendered once, near the top of the tree, and draws nothing of its own — it
 * only registers handlers. Keeping them together makes the surface area
 * obvious: this file is the complete list of what the agent can make the page
 * do, which is exactly the list you want to be able to audit at a glance.
 */
export function AgentBridge() {
  /**
   * 1. Human-in-the-loop for cart writes.
   *
   * The graph called `interrupt()` and SUSPENDED — it is checkpointed on the
   * server, not waiting in memory. `resolve()` sends a value back that becomes
   * the return value of that `interrupt()` call and resumes execution from
   * exactly that line.
   *
   * Because the pause lives in the checkpointer, reloading this page does not
   * lose it. That is the property a confirm dialog in React cannot give you.
   */
  useInterrupt({
    enabled: (event) => findConfirmWrite(event) !== null,
    render: ({ event, interrupt, resolve, cancel }) => {
      const payload = findConfirmWrite(event, interrupt);
      const summary = payload?.summary ?? "Confirm this action?";

      return (
        <div className="my-2 rounded-card border border-line bg-surface-2 p-3.5 shadow-card">
          <p className="text-sm font-medium text-ink">{summary}</p>
          <p className="mt-1 text-xs text-ink-muted">
            This changes your cart, so it needs your say-so.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => resolve({ approved: true })}
              className="rounded-control bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink transition hover:opacity-90"
            >
              Yes, do it
            </button>
            <button
              type="button"
              onClick={() =>
                resolve({ approved: false, reason: "The user declined the change." })
              }
              className="rounded-control border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-surface"
            >
              No
            </button>
            <button
              type="button"
              onClick={() => cancel()}
              className="rounded-control px-3 py-1.5 text-sm text-ink-faint transition hover:text-ink"
            >
              Cancel the whole thing
            </button>
          </div>
        </div>
      );
    },
  });

  /**
   * 2. A tool that only the browser can perform.
   *
   * The agent cannot scroll your page — no backend can. So `highlight_product`
   * is defined here, in React, and merely ADVERTISED to the agent. When the
   * model calls it, the handler below runs in this tab.
   *
   * That is the dividing line worth internalising: MCP tools are for things the
   * server knows or can do; frontend tools are for things only the browser can
   * do. Scrolling, focusing, reading a DOM measurement, opening a native file
   * picker. If it needs the user's viewport, it belongs here.
   */
  const highlight = useCallback(async ({ product_id }: { product_id: string }) => {
    const el = document.querySelector<HTMLElement>(`[data-product-id="${product_id}"]`);
    if (!el) {
      return { ok: false, error: `No card for ${product_id} is on screen right now.` };
    }

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate(
      [
        { boxShadow: "0 0 0 0 var(--brand)" },
        { boxShadow: "0 0 0 6px color-mix(in srgb, var(--brand) 35%, transparent)" },
        { boxShadow: "0 0 0 0 var(--brand)" },
      ],
      { duration: 1100, easing: "ease-out" },
    );
    return { ok: true, product_id };
  }, []);

  useFrontendTool({
    name: "highlight_product",
    description:
      "Scroll one product card into view in the catalog behind the chat and flash it. " +
      "Use when you mention a specific product and want the user to see which one you mean. " +
      "Only works for products currently rendered in the grid.",
    parameters: z.object({
      product_id: z.string().describe("Product id such as hp-001."),
    }),
    handler: highlight,
  });

  return null;
}
