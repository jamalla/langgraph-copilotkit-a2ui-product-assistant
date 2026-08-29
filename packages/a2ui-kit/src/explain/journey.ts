/**
 * The twelve hops between "user types a question" and "React components appear".
 *
 * This is the teaching content. Every step names the file that does the work, so
 * the panel is a map into the repository rather than a diagram - the thing that
 * is hardest to reconstruct from the code is the ORDER, and that is exactly what
 * a list can carry.
 *
 * `stage` groups the steps into the four places the work actually happens; the
 * panel colours them so the crossings are visible at a glance. Notice there are
 * only three: browser → server, server → agent, agent → browser. Most of the
 * confusion in this stack is about which side of those lines a thing is on.
 */

export type Stage = "browser" | "runtime" | "agent" | "render";

export interface JourneyStep {
  id: string;
  stage: Stage;
  title: string;
  /** What happens, in one or two sentences. */
  what: string;
  /** Where it happens. Repo-relative, with the symbol when there is one. */
  where: string;
  /** The thing people get wrong here. Optional. */
  gotcha?: string;
  /** Which trace field, if any, this step can show live. */
  live?:
    | "question"
    | "route"
    | "tools"
    | "surface"
    | "components"
    | "dataModel"
    | "operations"
    | "theme";
}

export const JOURNEY: JourneyStep[] = [
  {
    id: "ask",
    stage: "browser",
    title: "You ask a question",
    what: "The chat posts your message to the CopilotKit runtime endpoint. Nothing about UI has been decided yet - this is an ordinary HTTP request.",
    where: "packages/a2ui-kit/src/provider.tsx → <A2UIChatProvider>",
    live: "question",
  },
  {
    id: "runtime",
    stage: "runtime",
    title: "The runtime attaches the component catalog",
    what: "CopilotRuntime is configured with `a2ui: {}`, which applies @ag-ui/a2ui-middleware. The middleware sends the list of components the browser can render to the agent, as AG-UI context.",
    where: "apps/web/app/api/copilotkit/[[...rest]]/route.ts",
    gotcha:
      "An empty object is enough. It means: use the standard A2UI v0.9 basic catalog, and let a model design the tree each turn (dynamic schema).",
  },
  {
    id: "bridge",
    stage: "runtime",
    title: "AG-UI carries it to the graph",
    what: "LangGraphAgent speaks AG-UI over HTTP to `langgraph dev`. The catalog, your frontend tools and the conversation all arrive as graph input.",
    where: "@ag-ui/langgraph → langgraph dev :2024",
    gotcha:
      "Because the NODE adapter is used here, the Python helper that would populate `ag-ui.a2ui_schema` never runs. The catalog arrives as a plain context entry instead.",
  },
  {
    id: "route",
    stage: "agent",
    title: "The supervisor picks one specialist",
    what: "A single routing decision per turn, made with structured output so the model cannot return something unroutable. It returns Command(goto=…) plus the state update.",
    where: "apps/agent/src/agent/nodes.py → supervisor()",
    live: "route",
    gotcha:
      "Structured output must use method=\"json_schema\". The default implementation is function calling, which streams a malformed tool call to the browser and blanks the answer.",
  },
  {
    id: "tools",
    stage: "agent",
    title: "A worker queries the catalog",
    what: "The chosen worker calls MCP tools over streamable HTTP. The MCP server owns the data and the comparison logic; the agent only decides what to ask for.",
    where: "apps/agent/src/agent/nodes.py → catalog_agent() · apps/mcp/src/mcp_products/server.py",
    live: "tools",
    gotcha:
      "MCP tools are invoked with `config={\"callbacks\": []}`. Tracing them makes ag_ui_langgraph synthesise an id-less tool call that corrupts the chat.",
  },
  {
    id: "surface",
    stage: "agent",
    title: "The worker writes DATA, not prose",
    what: "It puts what it found into a `surface` dict - kind, title, and the raw products. It never writes a sentence for you. This is the hinge of the whole design.",
    where: "apps/agent/src/agent/state.py → SurfaceSpec",
    live: "surface",
    gotcha:
      "Because workers emit data, swapping markdown for generative UI changed exactly one function. If each worker wrote its own answer, that swap would have been a rewrite.",
  },
  {
    id: "present",
    stage: "agent",
    title: "The presenter writes the answer",
    what: "One node decides how anything looks. It generates the prose first, on its own, so the text message streams and completes cleanly.",
    where: "apps/agent/src/agent/nodes.py → _present_with_a2ui()",
    gotcha:
      "Prose first, then render. Generating both in one turn attaches the text to a tool call and the bubble comes out empty.",
  },
  {
    id: "subagent",
    stage: "agent",
    title: "A SECOND model designs the UI",
    what: "generate_a2ui runs a separate LLM that is shown the component catalog and the data, and invents a component tree for this turn. Its output is forced through a schema and validated against the catalog, with retries.",
    where: "apps/agent/src/agent/a2ui.py → render_tool() · ag_ui_langgraph.get_a2ui_tools",
    live: "components",
    gotcha:
      "It reads its data from `ag-ui.context`, never from the presenter's prompt. Miss that and it invents plausible products you do not sell.",
  },
  {
    id: "ops",
    stage: "agent",
    title: "Three operations go on the wire",
    what: "createSurface opens a canvas, updateComponents sends the tree, updateDataModel sends the values it binds to. Structure and data travel separately.",
    where: "A2UI v0.9 envelope: { a2ui_operations: [...] }",
    live: "operations",
  },
  {
    id: "data",
    stage: "agent",
    title: "Values bind into the tree by path",
    what: "Components reference data as { path: … }. Inside a repeating List the paths are RELATIVE to each item; the List's own path is absolute.",
    where: "updateDataModel → surface data model",
    live: "dataModel",
    gotcha:
      "Relative vs absolute paths inside templates is the single most common way a generated surface renders blank.",
  },
  {
    id: "paint",
    stage: "render",
    title: "The middleware paints the surface",
    what: "The A2UI middleware turns the operations into an `a2ui-surface` activity message. The whole lifecycle - building, retrying, painted - rides one message id and replaces in place, so you never see two loaders.",
    where: "@ag-ui/a2ui-middleware → ACTIVITY_SNAPSHOT",
  },
  {
    id: "render",
    stage: "render",
    title: "React mounts it, in your theme",
    what: "The renderer starts at the component with id \"root\", walks the tree, resolves each binding, and mounts real React components. Colour and radius come from CSS variables scoped to .a2ui-surface - mapped to your own design tokens.",
    where: "@copilotkit/a2ui-renderer · packages/a2ui-kit/src/styles/a2ui-theme.css",
    live: "theme",
    gotcha:
      "Exactly one component must have id \"root\". Without it the surface renders as an empty placeholder and nothing is shown.",
  },
];

export const STAGE_LABEL: Record<Stage, string> = {
  browser: "browser",
  runtime: "next.js runtime",
  agent: "langgraph agent",
  render: "back in the browser",
};
