"use client";

import { createContext, useContext } from "react";

/**
 * The two things this kit cannot know about your app.
 *
 * Everything else here is about HOW an agent's UI reaches a browser. These are
 * the only product-specific values, so they are configuration rather than
 * constants - which is exactly the boundary that makes the package reusable.
 */
export interface A2UIKitConfig {
  /**
   * The agent name.
   *
   * It must match the key in the runtime's `agents` map, and every CopilotKit
   * hook needs it explicitly: `useAgent`, `useInterrupt` and `useFrontendTool`
   * all fall back to a literal `"default"` and throw
   * `Agent 'default' not found` for a component mounted outside the chat.
   */
  agentId: string;

  /** Returns the most recent A2UI build trace. @default "/api/a2ui-trace" */
  traceEndpoint?: string;

  /** Returns the tools available to the agent. @default "/api/tools" */
  toolsEndpoint?: string;

  /** How often to poll for a new trace, in ms. @default 3000 */
  tracePollMs?: number;
}

const DEFAULTS = {
  traceEndpoint: "/api/a2ui-trace",
  toolsEndpoint: "/api/tools",
  tracePollMs: 3000,
} as const;

const Ctx = createContext<Required<A2UIKitConfig> | null>(null);

export function A2UIKitConfigProvider({
  config,
  children,
}: {
  config: A2UIKitConfig;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={{ ...DEFAULTS, ...config }}>{children}</Ctx.Provider>;
}

export function useA2UIKitConfig(): Required<A2UIKitConfig> {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error(
      "@a2ui/kit components must be rendered inside <A2UIChatProvider>. " +
        "It supplies the agentId every CopilotKit hook needs.",
    );
  }
  return value;
}
