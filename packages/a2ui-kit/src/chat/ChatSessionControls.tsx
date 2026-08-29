"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";

/**
 * New chat, and the thread history drawer.
 *
 * Both come from CopilotKit's own chat configuration rather than from anything
 * we invent:
 *
 *   startNewThread()  mints a fresh client-side thread id and shows the welcome
 *                     screen. This IS the reset: v2 exposes no way to clear the
 *                     messages of a thread in place, so a separate "reset"
 *                     button would either do exactly this or do nothing.
 *   setDrawerOpen()   opens the thread list, which is where the conversation
 *                     you just left is still sitting.
 *
 * Both are documented as a no-op when `threadId` is prop-controlled. We do not
 * pass `threadId` to `<CopilotPopup>`, so they work; if someone later fixes the
 * thread from outside, these buttons go quiet and the console explains why.
 *
 * Portalled into the popup header for the same reason ChatResizer is: rendering
 * in place would put the controls behind the modal, or outside it entirely.
 */

const HOST_ID = "a2ui-session-slot";

function IconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="grid size-6 place-items-center rounded-control border border-line bg-surface text-ink-muted transition hover:border-line-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {children}
    </button>
  );
}

export function ChatSessionControls() {
  const config = useCopilotChatConfiguration();
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // The popup mounts after us and can remount on resize, so watch rather than
    // look once. Same approach as ChatResizer.
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

  if (!host || !config) return null;

  return createPortal(
    <div className="absolute right-11 top-2 z-[1400] flex items-center gap-1">
      <IconButton
        title="New chat"
        onClick={() => config.startNewThread()}
      >
        {/* A page with a plus: a new conversation, not a saved one. */}
        <svg
          viewBox="0 0 24 24"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </IconButton>

      <IconButton
        title="Previous chats"
        onClick={() => config.setDrawerOpen(!config.drawerOpen)}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </IconButton>
    </div>,
    host,
  );
}
