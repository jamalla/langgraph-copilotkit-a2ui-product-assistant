"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * New chat, portalled into the popup header.
 *
 * ## Why this does not use CopilotKit's own thread API
 *
 * v2 exposes `startNewThread()` on `useCopilotChatConfiguration()`, which looks
 * like the obvious answer and is not. That hook reads a context created INSIDE
 * `<CopilotPopup>`, and these controls render as a sibling of the popup, not a
 * child. So the hook returned `null`, the component returned `null`, and the
 * buttons never appeared. No error, nothing in the console: a component that
 * renders nothing looks exactly like a component that was never mounted.
 *
 * Rather than reach further into someone else's internals, the thread is ours.
 * `A2UIChatProvider` holds the id in state and passes it to `<CopilotPopup>` as
 * the documented `threadId` prop, so starting a new chat is one `useState` call
 * we control and can reason about.
 *
 * ## Why there is no separate "reset" button
 *
 * A new thread IS the reset. v2 offers no way to clear the messages of a thread
 * in place, so a second button would either do exactly this or do nothing, and
 * two controls that perform one action is worse than one that is honest about
 * what it does.
 */

const HOST_ID = "a2ui-session-slot";

export function ChatSessionControls({ onNewChat }: { onNewChat: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // The popup mounts after us and remounts on resize, so watch for it rather
    // than looking once. Same reasoning as ChatResizer.
    const attach = () => {
      const popup = document.querySelector<HTMLElement>(".copilotKitPopup");
      if (!popup) return false;

      let slot = document.getElementById(HOST_ID);
      if (!slot || !popup.contains(slot)) {
        slot = document.createElement("div");
        slot.id = HOST_ID;
        popup.appendChild(slot);
      }
      setHost(slot);
      return true;
    };

    if (attach()) return;
    const observer = new MutationObserver(() => {
      if (attach()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!host) return null;

  return createPortal(
    // Left of the close button, which sits at the far right of the header.
    <div className="absolute right-10 top-2 z-[1400] flex items-center gap-1">
      <button
        type="button"
        onClick={onNewChat}
        title="New chat"
        aria-label="Start a new chat"
        className="flex items-center gap-1 rounded-control border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:border-line-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        New chat
      </button>
    </div>,
    host,
  );
}
