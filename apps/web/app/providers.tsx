"use client";

import { A2UIChatProvider } from "@a2ui/kit";

import { FrontendTools } from "@/components/FrontendTools";
import { AGENT_ID } from "@/lib/agent";

/**
 * The app's only CopilotKit wiring.
 *
 * Everything about HOW the agent's UI reaches the browser - the chat shell,
 * resizing, the tool list, the A2UI theme, the pipeline explainer, write
 * confirmation - lives in @a2ui/kit. What stays here is what the kit cannot
 * know: which agent to talk to, and the browser-side tools that understand
 * product cards.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <A2UIChatProvider
      runtimeUrl="/api/copilotkit"
      agentId={AGENT_ID}
      inputPlaceholder="Ask about the catalog…"
      app={children}
    >
      <FrontendTools />
    </A2UIChatProvider>
  );
}
