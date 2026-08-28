import { NextResponse } from "next/server";

/**
 * The most recent A2UI build trace, read straight from LangGraph.
 *
 * Why not read it from CopilotKit's client state? Because `useAgent().agent.state`
 * comes back as an empty object in the browser — verified: the trace is present
 * in the STATE_SNAPSHOT events on the wire, and `Object.keys(agent.state)` is
 * still `[]`. Three CopilotKit extension points were tried before this
 * (`useRenderTool`, `renderCustomMessages`, `useRenderActivityMessage`) and none
 * of them delivered the data either.
 *
 * So the panel asks the source of truth. `langgraph dev` keeps full state per
 * thread, and `a2ui_trace` is a normal state channel, so one HTTP call gets it.
 *
 * Explanatory only — nothing about the product depends on this route.
 */

const LANGGRAPH = process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:2024";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const threadId = new URL(request.url).searchParams.get("thread");

  try {
    let target = threadId;

    // No thread given: take the most recently updated one.
    if (!target) {
      const res = await fetch(`${LANGGRAPH}/threads/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 1, sort_by: "updated_at", sort_order: "desc" }),
        cache: "no-store",
      });
      if (!res.ok) return NextResponse.json({ trace: null, reason: "no threads" });
      const threads = (await res.json()) as { thread_id: string }[];
      target = threads?.[0]?.thread_id ?? null;
    }

    if (!target) return NextResponse.json({ trace: null, reason: "no threads" });

    const stateRes = await fetch(`${LANGGRAPH}/threads/${target}/state`, { cache: "no-store" });
    if (!stateRes.ok) return NextResponse.json({ trace: null, reason: "no state" });

    const state = (await stateRes.json()) as { values?: Record<string, unknown> };
    const values = state.values ?? {};

    return NextResponse.json({
      threadId: target,
      trace: values.a2ui_trace ?? null,
      surface: values.surface ?? null,
    });
  } catch (error) {
    return NextResponse.json({ trace: null, reason: String(error) }, { status: 200 });
  }
}
