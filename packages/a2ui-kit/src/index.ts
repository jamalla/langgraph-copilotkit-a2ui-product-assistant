/**
 * @a2ui/kit — the generative-UI layer for CopilotKit + A2UI.
 *
 * Everything here is about how an AGENT'S UI reaches a browser. Nothing knows
 * what your domain objects are, which is what makes it reusable across apps.
 *
 * Typical use:
 *
 *   import { A2UIChatProvider } from "@a2ui/kit";
 *   import "@a2ui/kit/styles.css";   // after your own design tokens
 *
 *   <A2UIChatProvider
 *     runtimeUrl="/api/copilotkit"
 *     agentId="product_agent"
 *     app={children}
 *   >
 *     <MyFrontendTools />
 *   </A2UIChatProvider>
 *
 * The stylesheet consumes your tokens (--surface, --ink, --line, --brand …)
 * rather than defining its own, so the agent's generated surfaces inherit your
 * theme in both light and dark mode.
 */

export { A2UIChatProvider, type A2UIChatProviderProps } from "./provider";
export { A2UIKitConfigProvider, useA2UIKitConfig, type A2UIKitConfig } from "./config";

// Individual pieces, for apps that want to place them themselves.
export { ChatResizer } from "./chat/ChatResizer";
export { ChatPipelineSlot } from "./chat/ChatPipelineSlot";
export { ToolList } from "./chat/ToolList";
export { A2UIPipeline, type A2UITrace } from "./explain/A2UIPipeline";
export { useSharedSelection } from "./hooks/useSharedSelection";

export {
  findConfirmWrite,
  isConfirmWriteInterrupt,
  type ConfirmWriteDecision,
  type ConfirmWriteInterrupt,
  type SharedAgentState,
} from "./agent-state";
