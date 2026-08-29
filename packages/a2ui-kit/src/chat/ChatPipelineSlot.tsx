"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { A2UIPipeline } from "../explain/A2UIPipeline";
import { ToolList } from "./ToolList";

/**
 * Puts the "how this UI was generated" panel inside the chat message list.
 *
 * ## Why a portal rather than a CopilotKit hook
 *
 * Three documented extension points were tried first, and none of them fired
 * for the A2UI call:
 *
 *   - `useRenderTool({ name: "*" })` - renders MCP tool calls fine, never sees
 *     the A2UI one (it is not delivered as an ordinary tool call).
 *   - `renderCustomMessages` - the provider prop for injecting UI into the
 *     message list; its render never ran for these runs.
 *   - `useRenderActivityMessage` - the A2UI surface arrives as an
 *     `a2ui-surface` activity, but claiming that type would mean re-rendering
 *     the surface ourselves rather than annotating it.
 *
 * So this appends a mount node to `.copilotKitMessages` - a class verified
 * present in the live DOM - and portals into it. Less elegant than a hook, and
 * it depends on a class name that a CopilotKit upgrade could rename, so it
 * fails soft: no node found, nothing rendered, chat unaffected. If the panel
 * disappears after an upgrade, run `node scripts/dom-probe.mjs` and check what
 * the message list is called now.
 */

const MOUNT_ID = "a2ui-pipeline-slot";
const TOOLS_ID = "a2ui-tools-slot";

/**
 * Two different hosts, because they appear at different times.
 *
 * `.copilotKitMessages` does not exist until the first message is sent - so
 * mounting there means the panels are invisible exactly when someone wants
 * them, and they vanish again when the thread changes. `.copilotKitChat` is
 * present as soon as the popup opens and stays put, so both panels anchor to
 * it: tools at the top, the pipeline explainer at the bottom.
 */
const CHAT_BODY = ".copilotKitChat";

export function ChatPipelineSlot() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [toolsHost, setToolsHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let mount: HTMLElement | null = null;
    let toolsMount: HTMLElement | null = null;

    const attach = () => {
      // Tool list: top of the chat body, visible from the moment it opens.
      const body = document.querySelector<HTMLElement>(CHAT_BODY);
      if (body) {
        const existingTools = document.getElementById(TOOLS_ID);
        if (existingTools && body.contains(existingTools)) {
          setToolsHost(existingTools);
        } else {
          toolsMount = existingTools ?? document.createElement("div");
          toolsMount.id = TOOLS_ID;
          toolsMount.style.padding = "0.5rem 0.75rem 0";
          body.prepend(toolsMount);
          setToolsHost(toolsMount);
        }
      }

      // Pipeline panel: TOP of the chat body, directly under the tool list.
      //
      // It used to be appended, making it the last child of `.copilotKitChat`,
      // below the message list and the input box. `.copilotKitChat` is
      // `overflow: hidden` so the chat cannot grow a second scrollbar, which
      // meant the panel was mounted, populated, and clipped entirely out of
      // view. Nothing errored, the node was in the DOM the whole time, and the
      // tool list a few lines above worked because it prepends.
      //
      // Two panels at the top, in a fixed order: what the agent can do, then
      // what it just built.
      if (!body) return false;

      const existing = document.getElementById(MOUNT_ID);
      if (existing && body.contains(existing)) {
        setHost(existing);
        return true;
      }

      mount = existing ?? document.createElement("div");
      mount.id = MOUNT_ID;
      mount.style.padding = "0 0.75rem 0.5rem";

      // After the tool list when it is there, otherwise first. Never appended:
      // the end of this container is off-screen.
      const tools = document.getElementById(TOOLS_ID);
      if (tools && body.contains(tools)) {
        tools.after(mount);
      } else {
        body.prepend(mount);
      }

      setHost(mount);
      return true;
    };

    if (attach()) return;

    // The popup mounts lazily and re-mounts when reopened, so watch for it.
    // Both hosts appear (and re-appear) as the popup mounts, opens and closes.
    const observer = new MutationObserver(() => {
      const body = document.querySelector(CHAT_BODY);
      if (!body) return;
      const has = (id: string) => {
        const node = document.getElementById(id);
        return !!node && body.contains(node);
      };
      if (!has(TOOLS_ID) || !has(MOUNT_ID)) attach();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mount?.remove();
      toolsMount?.remove();
    };
  }, []);

  return (
    <>
      {toolsHost && createPortal(<ToolList />, toolsHost)}
      {host && createPortal(<A2UIPipeline />, host)}
    </>
  );
}
