"use client";

import { useCallback, useEffect, useState } from "react";

import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";

import { useA2UIKitConfig } from "../config";
import type { SharedAgentState } from "../agent-state";

/**
 * One selection, shared by the React grid and the LangGraph agent.
 *
 * ## Why this is not just prompt engineering
 *
 * The obvious way to tell an agent what the user is looking at is to paste it
 * into the system prompt: "The user is currently viewing the Aether NC 900,
 * $399, 32h battery…". That works, and it is worse in three ways:
 *
 *   - it goes stale the moment the user clicks something else,
 *   - it costs tokens on every single turn whether or not it is relevant,
 *   - and it is text, so it is the first thing thrown away by compaction.
 *
 * Sharing STATE instead fixes all three. The agent reads `selected_product_ids`
 * from its own state, which is always current, costs a handful of tokens, and
 * survives compaction because it is not part of the conversation at all.
 *
 * ## Why it is bidirectional, and why that is the hard part
 *
 * Both ends write to the same field:
 *
 *   grid  → agent   clicking a card sets the selection the agent reasons about
 *   agent → grid    the agent's chosen products light up in the grid
 *
 * Which means it can loop. The guard below is that we only ever push to the
 * agent from a user gesture (`select`), never from an effect watching state.
 * The effect is strictly one-directional: agent state in, React state out.
 */
export function useSharedSelection(agentIdOverride?: string) {
  const { agentId: configured } = useA2UIKitConfig();
  const agentId = agentIdOverride ?? configured;
  const { agent, isReady } = useAgent({
    agentId,
    // BOTH, and the second one is not optional.
    //
    // `updates` is not a per-hook filter - it configures the subscription for
    // this agent. Subscribing with only OnStateChanged made this hook the one
    // that set up the agent, and <CopilotPopup> then never received message
    // notifications: the run completed, the correct assistant message arrived
    // in the MESSAGES_SNAPSHOT, and the chat rendered an empty bubble.
    //
    // Nothing errored. The wire was perfect. Only the UI was wrong.
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnMessagesChanged],
  });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // agent → grid.
  useEffect(() => {
    if (!isReady) return;
    const next = (agent.state as SharedAgentState | undefined)?.selected_product_ids;
    if (!Array.isArray(next)) return;

    setSelectedIds((prev) =>
      // Reference equality is not enough: the agent re-emits state on every
      // snapshot, so without a value comparison this sets state on every event
      // and re-renders the whole grid several times per streamed token.
      prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next,
    );
  }, [agent, agent.state, isReady]);

  // grid → agent. Only ever called from a click.
  const select = useCallback(
    (ids: string[]) => {
      setSelectedIds(ids);
      if (!isReady) return;
      agent.setState({
        ...(agent.state as SharedAgentState),
        selected_product_ids: ids,
      });
    },
    [agent, isReady],
  );

  const intent = (agent.state as SharedAgentState | undefined)?.intent ?? null;
  const routeReason = (agent.state as SharedAgentState | undefined)?.route_reason ?? null;

  return { selectedIds, select, intent, routeReason, isReady };
}
