"use client";

import { useEffect, useState } from "react";

/**
 * Shows how the A2UI surface above it was built, inline in the chat.
 *
 * Generative UI has one genuinely confusing property: the interesting part
 * leaves no trace. A grid of product cards appears and there is nothing to
 * inspect — no component you wrote, no template, no route. This panel puts the
 * whole chain back on screen: the data that went in, the component tree a
 * second model invented from it, and the operations that were emitted.
 *
 * The trace comes from `a2ui_trace` in the agent's own state, written by the
 * presenter in apps/agent/src/agent/nodes.py. It is explanatory only — the
 * agent never reads it back.
 */

interface A2UIComponent {
  id: string;
  component: string;
  children?: string[] | { componentId?: string; path?: string };
  [key: string]: unknown;
}

export interface A2UITrace {
  question?: string;
  surface_kind?: string | null;
  surface_id?: string | null;
  catalog_id?: string | null;
  components?: A2UIComponent[] | null;
  data_model?: unknown;
  operations?: unknown[] | null;
  error?: string | null;
}

interface AgentStateWithTrace {
  a2ui_trace?: A2UITrace;
  surface?: { kind?: string; title?: string; data?: { products?: unknown[] } };
}

function Code({ value, max = 260 }: { value: unknown; max?: number }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      className="overflow-auto rounded-control border border-line bg-canvas p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-muted"
      style={{ maxHeight: max }}
    >
      {text}
    </pre>
  );
}

function Tab({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-control px-2.5 py-1 text-[11px] font-medium transition ${
        active ? "bg-brand text-brand-ink" : "text-ink-muted hover:bg-surface-2"
      }`}
    >
      {children}
      {count !== undefined && <span className="ml-1 opacity-70">{count}</span>}
    </button>
  );
}

/** The component tree, drawn as a tree rather than as JSON. */
function ComponentTree({ components }: { components: A2UIComponent[] }) {
  const byId = new Map(components.map((c) => [c.id, c]));
  const seen = new Set<string>();

  const render = (id: string, depth = 0): React.ReactNode => {
    const node = byId.get(id);
    if (!node || depth > 8) return null;
    if (seen.has(id)) {
      return (
        <li key={`${id}-dup`} className="text-ink-faint">
          ↩ {id}
        </li>
      );
    }
    seen.add(id);

    const kids = node.children;
    const isTemplate = kids && !Array.isArray(kids);
    const bound = node.text && typeof node.text === "object" ? (node.text as { path?: string }) : null;

    return (
      <li key={id} className="leading-relaxed">
        <span className="font-mono text-[10.5px]">
          <span className="text-brand">{node.component}</span>
          <span className="text-ink-faint"> #{node.id}</span>
          {typeof node.text === "string" && (
            <span className="text-ink-muted"> “{node.text.slice(0, 32)}”</span>
          )}
          {bound?.path && <span className="text-positive"> ← {bound.path}</span>}
          {isTemplate && (
            <span className="text-warning">
              {" "}
              ⟲ repeats over {String((kids as { path?: string }).path ?? "?")}
            </span>
          )}
        </span>
        {Array.isArray(kids) && kids.length > 0 && (
          <ul className="ml-2.5 border-l border-line pl-2.5">
            {kids.map((k) => render(k, depth + 1))}
          </ul>
        )}
        {isTemplate && (kids as { componentId?: string }).componentId && (
          <ul className="ml-2.5 border-l border-dashed border-line-strong pl-2.5">
            {render((kids as { componentId: string }).componentId, depth + 1)}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul className="overflow-auto rounded-control border border-line bg-canvas p-2.5" style={{ maxHeight: 260 }}>
      {render("root")}
    </ul>
  );
}

type TabKey = "source" | "tree" | "data" | "ops";

export function A2UIPipeline() {
  const [state, setState] = useState<AgentStateWithTrace | null>(null);
  const [hasSurface, setHasSurface] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("source");

  /**
   * Only explain a surface that is actually on screen.
   *
   * /api/a2ui-trace returns the most recent thread that rendered anything, which
   * on a freshly opened chat is a PREVIOUS conversation. The panel then appeared
   * above an empty thread claiming "32 components", explaining a surface the
   * user had never seen.
   *
   * Tying it to a rendered `.a2ui-surface` makes the panel mean what it says:
   * it is an annotation on something visible, so no surface means no panel.
   */
  useEffect(() => {
    const check = () => setHasSurface(document.querySelectorAll(".a2ui-surface").length > 0);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  /**
   * The trace is fetched from /api/a2ui-trace, which reads LangGraph directly.
   *
   * The obvious source would be `useAgent().agent.state` — but that comes back
   * as an empty object in the browser. The trace is demonstrably present in the
   * STATE_SNAPSHOT events on the wire and `Object.keys(agent.state)` is still
   * `[]`. `useRenderTool`, `renderCustomMessages` and `useRenderActivityMessage`
   * were all tried before this and none of them delivered it either.
   *
   * Polling is crude, but this panel is explanatory and the payload is small.
   */
  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch("/api/a2ui-trace", { cache: "no-store" });
        const data = (await res.json()) as { trace?: A2UITrace; surface?: unknown };
        if (!alive) return;
        setState(
          data?.trace
            ? { a2ui_trace: data.trace, surface: data.surface as AgentStateWithTrace["surface"] }
            : null,
        );
      } catch {
        /* the agent may simply not be running */
      }
    };

    void load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const trace = state?.a2ui_trace;
  if (!trace || !hasSurface) return null;

  // What the UI was generated FROM: the products the workers actually found.
  const source = state?.surface?.data?.products ?? state?.surface?.data ?? null;
  const components = trace.components ?? [];

  return (
    <div className="my-2 rounded-card border border-line bg-surface-2/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-[10px] text-ink-faint">{open ? "▾" : "▸"}</span>
        <span className="text-xs font-medium text-ink">How this UI was generated</span>
        <span className="rounded-pill bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
          {components.length} components
        </span>
        {trace.error && (
          <span className="rounded-pill bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger">
            failed
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-line px-3 py-3">
          <div className="mb-2 flex flex-wrap gap-1">
            <Tab active={tab === "source"} onClick={() => setTab("source")}>
              1 · generated from
            </Tab>
            <Tab active={tab === "tree"} onClick={() => setTab("tree")} count={components.length}>
              2 · tree
            </Tab>
            <Tab active={tab === "data"} onClick={() => setTab("data")}>
              3 · data model
            </Tab>
            <Tab active={tab === "ops"} onClick={() => setTab("ops")} count={trace.operations?.length}>
              4 · A2UI code
            </Tab>
          </div>

          {tab === "source" && (
            <>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">
                A worker called MCP tools and wrote what it found into <code>surface</code> — data,
                never prose. Nothing here knows what the UI will look like.
              </p>
              <p className="mb-2 text-[11px] text-ink-faint">
                question: <span className="text-ink">{trace.question || "—"}</span>
              </p>
              <Code value={source} />
            </>
          )}

          {tab === "tree" && (
            <>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">
                A <strong>second model</strong> was shown the component catalog and the data above,
                and invented this layout for this turn. Nobody wrote it in advance — that is what
                “dynamic schema” means, and why the same question can render differently twice.
                <span className="text-positive"> ← </span>marks a value bound to the data model;
                <span className="text-warning"> ⟲ </span>marks a repeating template.
              </p>
              {components.length ? (
                <ComponentTree components={components} />
              ) : (
                <p className="text-[11px] text-ink-faint">No components were produced.</p>
              )}
            </>
          )}

          {tab === "data" && (
            <>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">
                Structure and data are sent <strong>separately</strong>. The tree is emitted once;
                these values fill it in. That split is what lets data stream into a layout that was
                only sent once.
              </p>
              <Code value={trace.data_model} />
            </>
          )}

          {tab === "ops" && (
            <>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">
                The three A2UI v0.9 operations that went over the wire.{" "}
                <code>createSurface</code> opens a canvas, <code>updateComponents</code> sends the
                tree, <code>updateDataModel</code> sends the values. The renderer starts at the
                component with id <code>root</code> and walks down.
              </p>
              <p className="mb-2 text-[11px] text-ink-faint">
                surface <span className="text-ink">{trace.surface_id ?? "—"}</span> · catalog{" "}
                <span className="text-ink">
                  {String(trace.catalog_id ?? "—").split("/").pop()}
                </span>
              </p>
              <Code value={trace.operations} max={340} />
            </>
          )}

          {trace.error && (
            <p className="mt-2 rounded-control border border-danger/40 bg-danger/5 p-2 text-[11px] text-danger">
              {trace.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
