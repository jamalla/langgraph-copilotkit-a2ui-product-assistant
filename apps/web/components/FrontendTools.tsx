"use client";

import { useCallback } from "react";
import { z } from "zod";

import { useFrontendTool } from "@copilotkit/react-core/v2";

import { AGENT_ID } from "@/lib/agent";

/**
 * Things only THIS app's browser can do.
 *
 * The dividing line worth internalising: MCP tools are for what the server
 * knows or can do; frontend tools are for what only the browser can do —
 * scrolling, focus, reading a DOM measurement, opening a native file picker.
 * No backend can scroll your page.
 *
 * That is also why this stays in the app rather than in @a2ui/kit: it knows
 * about product cards, and the kit knows nothing about products.
 */
export function FrontendTools() {
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
    agentId: AGENT_ID,
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
