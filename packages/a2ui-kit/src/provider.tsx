"use client";

import { CopilotKitProvider, CopilotPopup, useInterrupt } from "@copilotkit/react-core/v2";

import { A2UIKitConfigProvider, type A2UIKitConfig, useA2UIKitConfig } from "./config";
import { ChatPipelineSlot } from "./chat/ChatPipelineSlot";
import { ChatResizer } from "./chat/ChatResizer";
import { findConfirmWrite } from "./agent-state";

/**
 * The whole generative-UI layer, in one component.
 *
 * Wrap your app in this and you get: the CopilotKit provider, a resizable and
 * maximisable chat, the tool list, the "how this UI was generated" explainer,
 * and confirmation for any write the agent tries to make.
 *
 * Nothing in this package knows what a product is. That is the boundary: it is
 * about how an agent's UI reaches a browser, so a second app — an admin panel,
 * a support console — gets the entire layer from one import.
 *
 * It is also where the CopilotKit-version-fragile parts live: the
 * `.copilotKitChat` selector, the `z-[1200]` sizing rules, the overrides for
 * colours the shipped catalog hard-codes inline. When a CopilotKit upgrade
 * breaks the chrome, everything to fix is in here rather than scattered
 * through an app.
 */

/** Approve or decline a state-changing tool call the agent wants to make. */
function ConfirmWrites() {
  const { agentId } = useA2UIKitConfig();

  useInterrupt({
    // Required: this renders outside <CopilotPopup>, so there is no chat
    // configuration to inherit and the hook would ask for "default".
    agentId,
    enabled: (event) => findConfirmWrite(event) !== null,
    render: ({ event, interrupt, resolve, cancel }) => {
      const payload = findConfirmWrite(event, interrupt);
      return (
        <div className="my-2 rounded-card border border-line bg-surface-2 p-3.5 shadow-card">
          <p className="text-sm font-medium text-ink">
            {payload?.summary ?? "Confirm this action?"}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            This changes state, so it needs your say-so.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => resolve({ approved: true })}
              className="rounded-control bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink transition hover:opacity-90"
            >
              Yes, do it
            </button>
            <button
              type="button"
              onClick={() => resolve({ approved: false, reason: "The user declined the change." })}
              className="rounded-control border border-line px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-surface"
            >
              No
            </button>
            <button
              type="button"
              onClick={() => cancel()}
              className="rounded-control px-3 py-1.5 text-sm text-ink-faint transition hover:text-ink"
            >
              Cancel the whole thing
            </button>
          </div>
        </div>
      );
    },
  });

  return null;
}

export interface A2UIChatProviderProps extends A2UIKitConfig {
  runtimeUrl: string;
  /** Placeholder in the chat input. */
  inputPlaceholder?: string;
  /**
   * App-specific pieces that need the CopilotKit context — typically your
   * `useFrontendTool` declarations. Things only the browser can do (scrolling,
   * focus, viewport measurement) are app concerns, not kit concerns.
   */
  children?: React.ReactNode;
  /** Your page. Rendered inside the provider so hooks work anywhere. */
  app: React.ReactNode;
}

export function A2UIChatProvider({
  runtimeUrl,
  inputPlaceholder = "Ask me anything…",
  children,
  app,
  ...config
}: A2UIChatProviderProps) {
  return (
    <CopilotKitProvider runtimeUrl={runtimeUrl}>
      <A2UIKitConfigProvider config={config}>
        <ConfirmWrites />
        {children}
        {app}
        <CopilotPopup
          agentId={config.agentId}
          labels={{ chatInputPlaceholder: inputPlaceholder }}
        />
        <ChatResizer />
        <ChatPipelineSlot />
      </A2UIKitConfigProvider>
    </CopilotKitProvider>
  );
}
