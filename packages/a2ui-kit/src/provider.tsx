"use client";

import { useState } from "react";

import {
  CopilotKitProvider,
  CopilotPopup,
  useInterrupt,
  useRenderTool,
} from "@copilotkit/react-core/v2";

import { A2UIKitConfigProvider, type A2UIKitConfig, useA2UIKitConfig } from "./config";
import { ChatPipelineSlot } from "./chat/ChatPipelineSlot";
import { ChatResizer } from "./chat/ChatResizer";
import { ChatSessionControls } from "./chat/ChatSessionControls";
import { findConfirmWrite } from "./agent-state";
import { JourneyPanel } from "./explain/JourneyPanel";

/**
 * The whole generative-UI layer, in one component.
 *
 * Wrap your app in this and you get: the CopilotKit provider, a resizable and
 * maximisable chat, the tool list, the "how this UI was generated" explainer,
 * and confirmation for any write the agent tries to make.
 *
 * Nothing in this package knows what a product is. That is the boundary: it is
 * about how an agent's UI reaches a browser, so a second app - an admin panel,
 * a support console - gets the entire layer from one import.
 *
 * It is also where the CopilotKit-version-fragile parts live: the
 * `.copilotKitChat` selector, the `z-[1200]` sizing rules, the overrides for
 * colours the shipped catalog hard-codes inline. When a CopilotKit upgrade
 * breaks the chrome, everything to fix is in here rather than scattered
 * through an app.
 */

/**
 * How tool calls appear in the conversation.
 *
 * Without a renderer CopilotKit falls back to putting the raw call in the chat:
 * a bubble reading `generate_a2ui` - or, mid-stream, the entire arguments
 * payload as text. Backend calls become a quiet chip instead; the A2UI call
 * renders nothing at all, because it paints its own surface and announcing it
 * would caption a picture the user is already looking at.
 */
function ToolCallChips() {
  useRenderTool({
    name: "*",
    render: (props: { name?: string; status?: string }) => {
      const name = props.name ?? "";
      if (!name || name.includes("a2ui")) return <></>;

      const done = props.status === "complete" || props.status === "executed";
      return (
        <div className="my-1 inline-flex items-center gap-2 rounded-pill border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-ink-muted">
          <span className={done ? "text-positive" : "text-ink-faint"}>{done ? "✓" : "⋯"}</span>
          <span className="font-mono">{name}</span>
        </div>
      );
    },
  });

  return null;
}

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
   * App-specific pieces that need the CopilotKit context - typically your
   * `useFrontendTool` declarations. Things only the browser can do (scrolling,
   * focus, viewport measurement) are app concerns, not kit concerns.
   */
  children?: React.ReactNode;
  /** Your page. Rendered inside the provider so hooks work anywhere. */
  app: React.ReactNode;
  /**
   * Show the left-hand "How A2UI works" panel - the twelve hops from question
   * to rendered UI, each naming the file that does the work, filled in with
   * what actually happened on the last turn.
   *
   * Defaults ON, including in production.
   *
   * It used to default to `NODE_ENV !== "production"`, which is the right
   * instinct for a debug overlay and the wrong one here: in this project the
   * explanation IS the product. Deploying it hid the thing the deployment was
   * for, and the panel simply did not appear with nothing to say why.
   *
   * Pass `showJourney={false}` to turn it off, or set
   * NEXT_PUBLIC_SHOW_TEACHING=false to switch every teaching surface off at
   * once.
   */
  showJourney?: boolean;
}

const THREAD_KEY = "a2ui.threadId";

/** A fresh conversation id. randomUUID needs a secure context; the fallback
 *  keeps this working on plain http during local development. */
function newThreadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The thread survives a reload. Only "New chat" ends it.
 *
 * Minting a new id on every mount looked harmless and quietly broke the chat.
 * Reloading the page started an empty conversation every time, so the
 * "How this UI was generated" panel disappeared: it hides itself unless a
 * `.a2ui-surface` is actually on screen, and after a reload there was never
 * one. The panel was behaving correctly. The thread was the bug.
 *
 * sessionStorage rather than localStorage: a conversation belongs to a tab, and
 * two tabs sharing one thread would interleave their turns. Wrapped in
 * try/catch because private mode and blocked site data both throw on access,
 * and a chat that will not mount is worse than one that forgets.
 */
function initialThreadId(): string {
  try {
    const saved = sessionStorage.getItem(THREAD_KEY);
    if (saved) return saved;
    const fresh = newThreadId();
    sessionStorage.setItem(THREAD_KEY, fresh);
    return fresh;
  } catch {
    return newThreadId();
  }
}

function rememberThreadId(id: string): string {
  try {
    sessionStorage.setItem(THREAD_KEY, id);
  } catch {
    /* storage blocked: the id still works for this page's lifetime */
  }
  return id;
}

export function A2UIChatProvider({
  runtimeUrl,
  inputPlaceholder = "Ask me anything…",
  children,
  app,
  showJourney = process.env.NEXT_PUBLIC_SHOW_TEACHING !== "false",
  ...config
}: A2UIChatProviderProps) {
  // We own the thread id rather than letting CopilotKit mint one internally,
  // and it persists for the tab so a reload does not discard the conversation.
  //
  // That is what makes "New chat" a `useState` call instead of a reach into
  // someone else's context: `threadId` is a documented prop on the popup, and
  // changing it starts a fresh conversation. The previous attempt used
  // `startNewThread()` from `useCopilotChatConfiguration()`, whose context is
  // created INSIDE the popup, so a sibling component read `null` and rendered
  // nothing at all.
  const [threadId, setThreadId] = useState(initialThreadId);

  return (
    <CopilotKitProvider runtimeUrl={runtimeUrl}>
      <A2UIKitConfigProvider config={{ ...config, threadId }}>
        <ConfirmWrites />
        <ToolCallChips />
        {children}
        {app}
        <CopilotPopup
          agentId={config.agentId}
          threadId={threadId}
          labels={{ chatInputPlaceholder: inputPlaceholder }}
        />
        <ChatResizer />
        <ChatSessionControls onNewChat={() => setThreadId(rememberThreadId(newThreadId()))} />
        <ChatPipelineSlot />
        {showJourney && <JourneyPanel />}
      </A2UIKitConfigProvider>
    </CopilotKitProvider>
  );
}
