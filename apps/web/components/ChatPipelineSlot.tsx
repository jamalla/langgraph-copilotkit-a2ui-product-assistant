"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { A2UIPipeline } from "./A2UIPipeline";

/**
 * Puts the "how this UI was generated" panel inside the chat message list.
 *
 * ## Why a portal rather than a CopilotKit hook
 *
 * Three documented extension points were tried first, and none of them fired
 * for the A2UI call:
 *
 *   - `useRenderTool({ name: "*" })` — renders MCP tool calls fine, never sees
 *     the A2UI one (it is not delivered as an ordinary tool call).
 *   - `renderCustomMessages` — the provider prop for injecting UI into the
 *     message list; its render never ran for these runs.
 *   - `useRenderActivityMessage` — the A2UI surface arrives as an
 *     `a2ui-surface` activity, but claiming that type would mean re-rendering
 *     the surface ourselves rather than annotating it.
 *
 * So this appends a mount node to `.copilotKitMessages` — a class verified
 * present in the live DOM — and portals into it. Less elegant than a hook, and
 * it depends on a class name that a CopilotKit upgrade could rename, so it
 * fails soft: no node found, nothing rendered, chat unaffected. If the panel
 * disappears after an upgrade, run `node scripts/dom-probe.mjs` and check what
 * the message list is called now.
 */

const MOUNT_ID = "a2ui-pipeline-slot";
const MESSAGE_LIST = ".copilotKitMessages";

export function ChatPipelineSlot() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let mount: HTMLElement | null = null;

    const attach = () => {
      const list = document.querySelector<HTMLElement>(MESSAGE_LIST);
      if (!list) return false;

      const existing = document.getElementById(MOUNT_ID);
      if (existing && list.contains(existing)) {
        setHost(existing);
        return true;
      }

      mount = existing ?? document.createElement("div");
      mount.id = MOUNT_ID;
      // Always last, so the panel sits under the surface it explains.
      list.appendChild(mount);
      setHost(mount);
      return true;
    };

    if (attach()) return;

    // The popup mounts lazily and re-mounts when reopened, so watch for it.
    const observer = new MutationObserver(() => {
      const list = document.querySelector(MESSAGE_LIST);
      if (!list) return;
      const inside = document.getElementById(MOUNT_ID);
      if (!inside || !list.contains(inside)) attach();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mount?.remove();
    };
  }, []);

  if (!host) return null;
  return createPortal(<A2UIPipeline />, host);
}
