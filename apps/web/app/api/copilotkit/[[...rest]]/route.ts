import { LangGraphAgent } from "@ag-ui/langgraph";
import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";

import { AGENT_ID } from "@/lib/agent";

/**
 * The CopilotKit runtime.
 *
 * This is the join between the two halves of the system. It speaks HTTP to the
 * browser and AG-UI to the Python graph, and it is where A2UI is switched on.
 *
 *   browser  ──HTTP──▶  this route  ──AG-UI──▶  langgraph dev :2024
 *
 * Note how little is here. The runtime is configuration, not logic: no prompts,
 * no routing, no tool definitions. All of that lives in the agent, which is why
 * the agent stays runnable and debuggable on its own in LangGraph Studio.
 */

const runtime = new CopilotRuntime({
  agents: {
    // The key is the agent name the browser asks for, so it must equal AGENT_ID
    // - every hook on the client resolves against this map by name. `graphId`
    // is a separate thing: the key in apps/agent/langgraph.json.
    [AGENT_ID]: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:2024",
      graphId: process.env.LANGGRAPH_GRAPH_ID ?? "product_agent",
    }),
  },

  /**
   * Switching on A2UI does three things, none of which are obvious:
   *
   *  1. It applies `@ag-ui/a2ui-middleware` to every agent above.
   *  2. The middleware sends the component catalog to the agent as an AG-UI
   *     context entry, which `ag_ui_langgraph` routes into
   *     `state["ag-ui"]["a2ui_schema"]` - the value our presenter checks before
   *     deciding whether a browser is even attached.
   *  3. It tells the browser that A2UI is configured, which is what activates
   *     the renderer client-side. `<CopilotKitProvider>` needs no `a2ui` prop
   *     for this; it reacts to what the runtime reports.
   *
   * An empty object is enough because we use the DYNAMIC schema: no catalog is
   * declared here, so the default A2UI v0.9 basic catalog is used and a
   * subagent designs the component tree per turn.
   */
  a2ui: {},

  // Threads live in this process's memory. Restarting the dev server clears
  // them. Durable threads are a CopilotKit Intelligence feature.
  runner: new InMemoryAgentRunner(),
});

/**
 * `createCopilotEndpoint` returns a HONO APP, not a Next.js route handler - and
 * in its default "multi-route" mode it registers several paths beneath
 * `basePath`, not just one. Two consequences, both of which bite immediately:
 *
 *   1. This file lives at `[[...rest]]`, an optional catch-all. A plain
 *      `route.ts` would answer `/api/copilotkit` and 404 everything under it.
 *   2. The export must be a function. Assigning the Hono app straight to `POST`
 *      type-errors against Next 16's `RouteHandlerConfig`; hand it `app.fetch`
 *      instead.
 */
const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;

// The runtime holds a streaming connection open to the agent, which can outlive
// the default serverless budget on a long tool-calling turn.
export const maxDuration = 300;
