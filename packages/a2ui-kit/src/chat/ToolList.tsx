"use client";

import { useEffect, useState } from "react";

import { useA2UIKitConfig } from "../config";

/**
 * What the agent can actually do, listed in the chat.
 *
 * The list is fetched, not hard-coded: /api/tools proxies the MCP server's own
 * introspection route. Add a tool to apps/mcp and it shows up here without a
 * frontend change — which is the point, since the whole reason the tools live
 * in an MCP server is that the agent and the UI both discover them rather than
 * having them baked in.
 *
 * Two labels carry the ideas worth noticing:
 *
 *   write    changes state, so it needs a human to confirm (see interrupt() in
 *            the cart flow). Reads can be called speculatively; writes cannot.
 *   browser  only the browser can do it — scroll, focus, measure the viewport.
 *            No backend can scroll your page.
 */

interface Tool {
  name: string;
  summary: string;
  write: boolean;
  parameters: string[];
  where: "server" | "browser";
}

export function ToolList() {
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const { toolsEndpoint } = useA2UIKitConfig();

  useEffect(() => {
    let alive = true;
    fetch(toolsEndpoint, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tools?: Tool[]; warning?: string }) => {
        if (!alive) return;
        setTools(d.tools ?? []);
        setWarning(d.warning ?? null);
      })
      .catch(() => alive && setTools([]));
    return () => {
      alive = false;
    };
  }, [toolsEndpoint]);

  if (!tools?.length) return null;

  const writes = tools.filter((t) => t.write).length;

  return (
    <div className="mb-2 rounded-card border border-line bg-surface-2/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-[10px] text-ink-faint">{open ? "▾" : "▸"}</span>
        <span className="text-xs font-medium text-ink">What I can do</span>
        <span className="rounded-pill bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
          {tools.length} tools
        </span>
        {writes > 0 && (
          <span className="rounded-pill bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
            {writes} need confirmation
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-line px-3 py-2.5">
          {warning && (
            <p className="mb-2 rounded-control border border-warning/40 bg-warning/5 p-2 text-[11px] text-warning">
              {warning}
            </p>
          )}

          <ul className="flex flex-col gap-1.5">
            {tools.map((tool) => (
              <li key={tool.name} className="flex gap-2">
                <span
                  title={
                    tool.where === "browser"
                      ? "Runs in this browser tab"
                      : tool.write
                        ? "Changes state — you will be asked to confirm"
                        : "Read-only"
                  }
                  className={`mt-0.5 shrink-0 rounded-pill px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                    tool.where === "browser"
                      ? "bg-brand/10 text-brand"
                      : tool.write
                        ? "bg-warning/10 text-warning"
                        : "bg-surface text-ink-faint"
                  }`}
                >
                  {tool.where === "browser" ? "browser" : tool.write ? "write" : "read"}
                </span>
                <span className="min-w-0">
                  <span className="font-mono text-[11px] text-ink">{tool.name}</span>
                  {tool.parameters.length > 0 && (
                    <span className="font-mono text-[10px] text-ink-faint">
                      ({tool.parameters.join(", ")})
                    </span>
                  )}
                  <span className="block text-[11px] leading-relaxed text-ink-muted">
                    {tool.summary}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-2.5 border-t border-line pt-2 text-[10.5px] leading-relaxed text-ink-faint">
            Backend tools come from the MCP server and are discovered at runtime — the agent is
            never told about them in code. Browser tools are declared in React because no server can
            scroll your page.
          </p>
        </div>
      )}
    </div>
  );
}
