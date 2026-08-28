/**
 * This app's agent name.
 *
 * It must match three things: the key in the runtime's `agents` map
 * (app/api/copilotkit/[[...rest]]/route.ts), the graph id in
 * apps/agent/langgraph.json, and the `agentId` passed to <A2UIChatProvider>.
 */
export const AGENT_ID = "product_agent";
