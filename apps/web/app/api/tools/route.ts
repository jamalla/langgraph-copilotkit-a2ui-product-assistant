import { NextResponse } from "next/server";

/**
 * What the agent can actually do, for the chat's tool list.
 *
 * Proxies the MCP server's /tools.json (a plain HTTP route it exposes
 * alongside the MCP protocol itself) and appends the tools that live in the
 * browser. Those two sets are genuinely different things:
 *
 *   backend  - what the SERVER knows or can do: search the catalog, compare,
 *              change the cart.
 *   browser  - what only the BROWSER can do: scroll, focus, measure the
 *              viewport. No backend can scroll your page.
 *
 * Listing them together, labelled, is the clearest way to show that split.
 */

const MCP = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:8931/mcp";
const TOOLS_URL = MCP.replace(/\/mcp\/?$/, "") + "/tools.json";

/** Declared in apps/web/components/AgentBridge.tsx via useFrontendTool. */
const FRONTEND_TOOLS = [
  {
    name: "highlight_product",
    summary: "Scroll a product card into view in the catalog behind the chat and flash it.",
    write: false,
    parameters: ["product_id"],
    where: "browser" as const,
  },
];

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(TOOLS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`MCP server returned ${res.status}`);

    const data = (await res.json()) as {
      tools: { name: string; summary: string; write: boolean; parameters: string[] }[];
    };

    return NextResponse.json({
      tools: [
        ...data.tools.map((t) => ({ ...t, where: "server" as const })),
        ...FRONTEND_TOOLS,
      ],
    });
  } catch (error) {
    // The MCP server may simply not be running - say so rather than 500.
    return NextResponse.json({
      tools: FRONTEND_TOOLS,
      warning: `Could not reach the MCP server at ${TOOLS_URL}. Start it with: pnpm dev:mcp`,
      detail: String(error),
    });
  }
}
