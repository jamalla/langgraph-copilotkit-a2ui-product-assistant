import { NextResponse } from "next/server";

/**
 * The most recent A2UI build trace, read straight from LangGraph.
 *
 * Why not read it from CopilotKit's client state? Because `useAgent().agent.state`
 * comes back as an empty object in the browser - verified: the trace is present
 * in the STATE_SNAPSHOT events on the wire, and `Object.keys(agent.state)` is
 * still `[]`. Three CopilotKit extension points were tried before this
 * (`useRenderTool`, `renderCustomMessages`, `useRenderActivityMessage`) and none
 * of them delivered the data either.
 *
 * So the panel asks the source of truth. `langgraph dev` keeps full state per
 * thread, and `a2ui_trace` is a normal state channel, so one HTTP call gets it.
 *
 * Explanatory only - nothing about the product depends on this route.
 */

const LANGGRAPH = process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:2024";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const threadId = new URL(request.url).searchParams.get("thread");

  const stateOf = async (id: string) => {
    const res = await fetch(`${LANGGRAPH}/threads/${id}/state`, { cache: "no-store" });
    if (!res.ok) return null;
    const state = (await res.json()) as { values?: Record<string, unknown> };
    return state.values ?? null;
  };

  try {
    if (threadId) {
      const values = await stateOf(threadId);
      return NextResponse.json({
        threadId,
        trace: values?.a2ui_trace ?? null,
        surface: values?.surface ?? null,
      });
    }

    // No thread given: walk recent threads newest-first and take the first that
    // actually has a trace.
    //
    // Taking simply the newest does not work - CopilotKit creates an empty
    // thread as soon as the chat mounts, so the most recently touched thread is
    // usually one with no state at all.
    const res = await fetch(`${LANGGRAPH}/threads/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 10, sort_by: "updated_at", sort_order: "desc" }),
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ trace: null, reason: "thread search failed" });

    const threads = (await res.json()) as { thread_id: string }[];
    for (const thread of threads ?? []) {
      const values = await stateOf(thread.thread_id);
      if (values?.a2ui_trace) {
        return NextResponse.json({
          threadId: thread.thread_id,
          trace: values.a2ui_trace,
          surface: values.surface ?? null,
        });
      }
    }

    return NextResponse.json({ trace: null, reason: "no thread has rendered a surface yet" });
  } catch (error) {
    return NextResponse.json({ trace: null, reason: String(error) }, { status: 200 });
  }
}
