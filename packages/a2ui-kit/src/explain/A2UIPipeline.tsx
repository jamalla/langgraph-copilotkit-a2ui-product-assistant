"use client";

import { useEffect, useState } from "react";

import { useA2UIKitConfig } from "../config";

/**
 * Shows how the A2UI surface above it was built, inline in the chat.
 *
 * Generative UI has one genuinely confusing property: the interesting part
 * leaves no trace. A grid of product cards appears and there is nothing to
 * inspect - no component you wrote, no template, no route. This panel puts the
 * whole chain back on screen: the data that went in, the component tree a
 * second model invented from it, and the operations that were emitted.
 *
 * The trace comes from `a2ui_trace` in the agent's own state, written by the
 * presenter in apps/agent/src/agent/nodes.py. It is explanatory only - the
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
  /** What the subagent was shown, and when it ran. */
  input_facts?: string | null;
  input_bytes?: number | null;
  input_products?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  model?: string | null;
}

interface AgentStateWithTrace {
  a2ui_trace?: A2UITrace;
  surface?: { kind?: string; title?: string; data?: { products?: unknown[] } };
}

function CopyButton({ value, label }: { value: unknown; label: string }) {
  const [done, setDone] = useState(false);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          },
          () => {
            /* clipboard blocked: the JSON is still selectable below */
          },
        );
      }}
      className="rounded-control border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition hover:border-line-strong hover:text-ink"
    >
      {done ? "copied" : label}
    </button>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 text-ink-faint">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-ink-muted">{children}</dd>
    </div>
  );
}

/** Local clock time, plus how long ago, because "when" is usually "was that this answer?". */
function formatWhen(iso?: string | null): string {
  if (!iso) return "unknown";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  const ago =
    seconds < 60
      ? `${seconds}s ago`
      : seconds < 3600
        ? `${Math.round(seconds / 60)}m ago`
        : `${Math.round(seconds / 3600)}h ago`;
  return `${at.toLocaleTimeString()} · ${ago}`;
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
  const { traceEndpoint, tracePollMs, threadId } = useA2UIKitConfig();

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
   * The obvious source would be `useAgent().agent.state` - but that comes back
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
        const res = await fetch(
          // Ask about the conversation on screen. Without the id this is a
          // guess at "the newest thread that rendered anything", which is
          // wrong as soon as an empty thread is newer than the real one.
          threadId ? `${traceEndpoint}?thread=${encodeURIComponent(threadId)}` : traceEndpoint,
          { cache: "no-store" },
        );
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
    const timer = setInterval(load, tracePollMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [traceEndpoint, tracePollMs, threadId]);

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
          {/* Answers the three questions a generated surface always raises:
              what was produced, what it was produced FROM, and when. Without
              the timestamp there is no way to tell whether the panel describes
              this answer or the one before it. */}
          <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-control border border-line bg-canvas px-2.5 py-2 text-[10.5px]">
            <Fact label="generated">
              {components.length} components
              {trace.operations?.length ? `, ${trace.operations.length} ops` : ""}
            </Fact>
            <Fact label="from">
              {trace.input_products ?? 0} products
              {trace.input_bytes ? ` · ${Math.round(trace.input_bytes / 100) / 10} KB` : ""}
            </Fact>
            <Fact label="when">{formatWhen(trace.started_at)}</Fact>
            <Fact label="took">
              {typeof trace.duration_ms === "number"
                ? `${(trace.duration_ms / 1000).toFixed(1)}s`
                : "unknown"}
            </Fact>
            <Fact label="designed by">{trace.model ?? "unknown"}</Fact>
            <Fact label="for">{trace.question ? `"${trace.question}"` : "unknown"}</Fact>
          </dl>

          {trace.error && (
            <p className="mb-3 rounded-control border border-danger/40 bg-danger/5 px-2.5 py-2 text-[10.5px] leading-relaxed text-danger">
              <span className="font-medium">No UI was generated.</span> {trace.error}
            </p>
          )}
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
                A worker called MCP tools and wrote what it found into <code>surface</code> - data,
                never prose. Nothing here knows what the UI will look like.
              </p>
              <p className="mb-2 text-[11px] text-ink-faint">
                question: <span className="text-ink">{trace.question || "-"}</span>
              </p>
              {/* `source` reads surface.data.products, which a cart or a
                  comparison does not have. input_facts is the exact payload the
                  subagent was handed, so it is right for every surface kind and
                  is the honest answer to "generated from what". */}
              <Code value={source ?? trace.input_facts ?? "nothing was captured"} max={320} />
            </>
          )}

          {tab === "tree" && (
            <>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">
                A <strong>second model</strong> was shown the component catalog and the data above,
                and invented this layout for this turn. Nobody wrote it in advance - that is what
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
                surface <span className="text-ink">{trace.surface_id ?? "-"}</span> · catalog{" "}
                <span className="text-ink">
                  {String(trace.catalog_id ?? "-").split("/").pop()}
                </span>
              </p>
              {trace.operations?.length ? (
                <>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-ink-faint">
                      {trace.operations.length} operations, exactly as the model emitted them
                    </span>
                    <CopyButton value={trace.operations} label="copy JSON" />
                  </div>
                  <Code value={trace.operations} max={420} />
                </>
              ) : trace.components?.length ? (
                <>
                  {/* The envelope was not captured but the tree was. Show the
                      tree rather than nothing: it is the part people came for. */}
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-ink-faint">
                      the component tree the model wrote
                    </span>
                    <CopyButton value={trace.components} label="copy JSON" />
                  </div>
                  <Code value={trace.components} max={420} />
                </>
              ) : (
                <p className="rounded-control border border-line bg-canvas px-2.5 py-2 text-[11px] leading-relaxed text-ink-muted">
                  {/* Rendering a bare `null` here was its own small bug: it looked
                      like the panel was broken rather than like the turn was. */}
                  Nothing was generated for this turn.{" "}
                  {trace.error
                    ? "The request to the design model failed, so no operations were produced. The error is above."
                    : "This answer was prose only, with no surface to build."}
                </p>
              )}
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
