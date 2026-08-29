"use client";

import { useEffect, useState } from "react";

import { stepStatus, type Progress, type RunState } from "./runState";

import { useA2UIKitConfig } from "../config";
import { JOURNEY, STAGE_LABEL, type JourneyStep, type Stage } from "./journey";

/**
 * A left-hand panel that walks the whole journey from question to rendered UI.
 *
 * Generative UI is hard to learn for one specific reason: the interesting part
 * leaves no trace. A grid of cards appears and there is no component you wrote,
 * no template, no route to inspect. This panel reconstructs the twelve hops,
 * names the file responsible for each, and fills in what actually happened on
 * the last turn.
 *
 * It reads the same /api/a2ui-trace endpoint as the in-chat explainer - one
 * source, two views: the chat annotates a single surface, this teaches the
 * pipeline.
 */

interface Trace {
  question?: string;
  intent?: string | null;
  route_reason?: string | null;
  refined_query?: string | null;
  tools_used?: { tool: string; result?: string }[];
  surface_kind?: string | null;
  surface_title?: string | null;
  product_count?: number;
  surface_id?: string | null;
  catalog_id?: string | null;
  components?: { id: string; component: string }[] | null;
  data_model?: unknown;
  operations?: unknown[] | null;
  error?: string | null;
  langsmith?: { enabled?: boolean; run_id?: string; url?: string };
}

/**
 * A one-line summary shown on the COLLAPSED step.
 *
 * The panel is meant to be read at a glance: you should be able to see that
 * step 5 called `search_products` and step 8 produced 38 components without
 * opening anything. Detail stays behind the expander.
 */
function glance(step: JourneyStep, trace: Trace | null): string | null {
  if (!trace) return null;
  switch (step.live) {
    case "question":
      return trace.question ? `“${trace.question}”` : null;
    case "route":
      return trace.intent ? `→ ${trace.intent}` : null;
    case "tools": {
      const used = trace.tools_used ?? [];
      return used.length ? used.map((t) => t.tool).join(" · ") : null;
    }
    case "surface":
      return trace.surface_kind && trace.surface_kind !== "none"
        ? `${trace.surface_kind} · ${trace.product_count ?? 0} products`
        : null;
    case "components": {
      const n = trace.components?.length ?? 0;
      return n ? `${n} components` : null;
    }
    case "operations": {
      const n = trace.operations?.length ?? 0;
      return n ? `${n} operations` : null;
    }
    case "dataModel":
      return trace.data_model ? "bound" : null;
    case "theme":
      return "8 CSS variables";
    default:
      return null;
  }
}

const STAGE_STYLE: Record<Stage, string> = {
  browser: "border-brand/50 bg-brand/5",
  runtime: "border-warning/50 bg-warning/5",
  agent: "border-positive/50 bg-positive/5",
  render: "border-brand/50 bg-brand/5",
};

const STAGE_DOT: Record<Stage, string> = {
  browser: "bg-brand",
  runtime: "bg-warning",
  agent: "bg-positive",
  render: "bg-brand",
};

function Code({ value, max = 190 }: { value: unknown; max?: number }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      className="mt-1.5 overflow-auto rounded-control border border-line bg-canvas p-2 font-mono text-[10px] leading-relaxed text-ink-muted"
      style={{ maxHeight: max }}
    >
      {text}
    </pre>
  );
}

/** What this step did on the most recent turn, if anything. */
function LiveData({ step, trace }: { step: JourneyStep; trace: Trace | null }) {
  if (!trace || !step.live) return null;

  switch (step.live) {
    case "question":
      return trace.question ? (
        <p className="mt-1.5 rounded-control bg-surface-2 px-2 py-1 text-[11px] text-ink">
          “{trace.question}”
        </p>
      ) : null;

    case "route":
      return trace.intent ? (
        <div className="mt-1.5 text-[11px] text-ink-muted">
          <span className="rounded-pill bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink">
            {trace.intent}
          </span>{" "}
          {trace.route_reason}
          {trace.refined_query && (
            <span className="block text-ink-faint">
              search terms: <span className="font-mono">{trace.refined_query}</span>
            </span>
          )}
        </div>
      ) : null;

    case "tools":
      return trace.tools_used?.length ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {trace.tools_used.map((t, i) => (
            <li key={i} className="flex gap-1.5 text-[11px]">
              <span className="font-mono text-ink">{t.tool}</span>
              {t.result && <span className="text-ink-faint">→ {t.result}</span>}
            </li>
          ))}
        </ul>
      ) : null;

    case "surface":
      return trace.surface_kind ? (
        <Code
          value={{
            kind: trace.surface_kind,
            title: trace.surface_title,
            products: trace.product_count,
          }}
          max={110}
        />
      ) : null;

    case "components": {
      const list = trace.components ?? [];
      if (!list.length) return null;
      const kinds = [...new Set(list.map((c) => c.component))];
      return (
        <div className="mt-1.5">
          <p className="text-[11px] text-ink-muted">
            <span className="font-medium text-ink">{list.length} components</span> from{" "}
            {kinds.length} types
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {kinds.map((k) => (
              <span
                key={k}
                className="rounded-pill bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      );
    }

    case "dataModel":
      return trace.data_model ? <Code value={trace.data_model} max={150} /> : null;

    case "operations":
      return trace.operations?.length ? (
        <Code value={trace.operations} max={200} />
      ) : null;

    case "theme":
      return (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {["--background", "--foreground", "--card", "--border", "--primary"].map((v) => (
            <span
              key={v}
              className="rounded-pill bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
            >
              {v}
            </span>
          ))}
        </div>
      );

    default:
      return null;
  }
}

export function JourneyPanel() {
  const { traceEndpoint, tracePollMs } = useA2UIKitConfig();
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [run, setRun] = useState<RunState>({ running: false, progress: null });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(traceEndpoint, { cache: "no-store" });
        const data = (await res.json()) as {
          trace?: Trace;
          running?: boolean;
          progress?: Progress | null;
        };
        if (!alive) return;
        // Keep the last trace on screen while the next run is in flight. The
        // alternative is the panel emptying itself the moment you ask
        // something, which loses the very comparison it exists to support.
        if (data?.trace) setTrace(data.trace);
        setRun({ running: Boolean(data?.running), progress: data?.progress ?? null });
      } catch {
        /* the agent may not be running */
      }
    };
    void load();
    // A turn takes a few seconds end to end, so the idle poll is far too slow
    // to show anything moving. Tighten it only while something is happening.
    const timer = setInterval(load, run.running ? 600 : tracePollMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, traceEndpoint, tracePollMs, run.running]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="How A2UI works, step by step"
        className="fixed left-0 top-1/2 z-[1250] -translate-y-1/2 rounded-r-card border border-l-0 border-line bg-surface px-2 py-4 text-[11px] font-medium text-ink-muted shadow-card transition hover:border-brand hover:text-brand"
        style={{ writingMode: "vertical-rl" }}
      >
        How A2UI works
      </button>
    );
  }

  return (
    <aside className="fixed left-0 top-0 z-[1250] flex h-full w-[380px] max-w-[92vw] flex-col border-r border-line bg-surface shadow-float">
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">From question to rendered UI</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
            Twelve hops, and the file that does each one. Live data fills in from your last
            question.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="ml-auto grid size-6 shrink-0 place-items-center rounded-control border border-line text-ink-muted transition hover:border-line-strong hover:text-ink"
        >
          ×
        </button>
      </header>

      {!trace && (
        <p className="border-b border-line bg-surface-2 px-4 py-2 text-[11px] text-ink-muted">
          Ask the assistant something that shows products, then come back - every step fills in
          with what actually happened.
        </p>
      )}

      <ol className="flex-1 overflow-y-auto px-3 py-3">
        {JOURNEY.map((step, i) => {
          const prev = JOURNEY[i - 1];
          const crossing = !prev || prev.stage !== step.stage;
          const isOpen = expanded === step.id;
          const status = stepStatus(i, run);
          const hint = glance(step, trace);

          return (
            <li key={step.id}>
              {crossing && (
                <p className="mb-1.5 mt-3 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint first:mt-0">
                  <span className={`size-1.5 rounded-pill ${STAGE_DOT[step.stage]}`} />
                  {STAGE_LABEL[step.stage]}
                </p>
              )}

              <div
                className={`mb-1.5 rounded-card border px-2.5 py-2 transition-colors ${
                  status === "active"
                    ? "border-brand bg-brand/5 ring-1 ring-brand/30"
                    : status === "pending"
                      ? `${STAGE_STYLE[step.stage]} opacity-45`
                      : STAGE_STYLE[step.stage]
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : step.id)}
                  className="flex w-full items-start gap-2 text-left"
                >
                  <span
                    className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-pill font-mono text-[9px] ${
                      status === "active"
                        ? "bg-brand text-brand-ink"
                        : status === "done"
                          ? "bg-positive/20 text-positive"
                          : "bg-ink/10 text-ink"
                    }`}
                  >
                    {/* A running step pulses, a finished one is ticked. Both are
                        driven by graph state rather than by a timer. */}
                    {status === "active" ? (
                      <span className="size-1.5 animate-ping rounded-pill bg-brand-ink" />
                    ) : status === "done" ? (
                      "✓"
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-ink">{step.title}</span>
                    {!isOpen && (
                      <>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-faint">
                          {step.where}
                        </span>
                        {hint && (
                          <span className="mt-0.5 block truncate text-[10px] font-medium text-positive">
                            {hint}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                  <span className="mt-0.5 text-[10px] text-ink-faint">{isOpen ? "−" : "+"}</span>
                </button>

                {isOpen && (
                  <div className="mt-1.5 pl-6">
                    <p className="text-[11px] leading-relaxed text-ink-muted">{step.what}</p>
                    <p className="mt-1.5 break-all font-mono text-[10px] text-ink-faint">
                      {step.where}
                    </p>
                    {step.gotcha && (
                      <p className="mt-1.5 rounded-control border border-warning/40 bg-warning/5 p-1.5 text-[10.5px] leading-relaxed text-warning">
                        {step.gotcha}
                      </p>
                    )}
                    <LiveData step={step} trace={trace} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="border-t border-line px-4 py-2.5">
        {trace?.langsmith?.url ? (
          <a
            href={trace.langsmith.url}
            target="_blank"
            rel="noreferrer"
            className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-brand hover:underline"
          >
            Open this run in LangSmith →
          </a>
        ) : (
          <p className="mb-2 rounded-control border border-line bg-surface-2 px-2 py-1.5 text-[10.5px] leading-relaxed text-ink-muted">
            Every step here is a summary. For the full tree - each prompt, token counts, and the
            A2UI subagent&rsquo;s retries - set{" "}
            <code className="font-mono text-ink">LANGSMITH_TRACING=true</code> and{" "}
            <code className="font-mono text-ink">LANGSMITH_API_KEY</code> in <code>.env</code>, then
            restart the agent. This panel will link straight to each run.
          </p>
        )}
        <p className="text-[10.5px] leading-relaxed text-ink-faint">
          Three boundaries, and most confusion is about which side of one you are on: browser →
          runtime, runtime → agent, agent → browser.
        </p>
      </footer>
    </aside>
  );
}
