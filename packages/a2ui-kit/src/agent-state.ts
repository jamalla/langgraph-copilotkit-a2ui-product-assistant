/**
 * The shape of the LangGraph agent's state, as far as the browser cares.
 *
 * This mirrors `AgentState` in apps/agent/src/agent/state.py. It is a CONTRACT,
 * not a convenience type: whatever this file and that file disagree about is a
 * bug you will only find at runtime.
 *
 * Keep it to the fields the UI actually reads or writes. Every field listed
 * here is one more thing that has to stay in sync across two languages, so
 * `surface`, `comparison` and the rest are deliberately absent - the agent owns
 * those and the browser never touches them.
 */

export interface SharedAgentState {
  /**
   * Products currently under discussion.
   *
   * The only genuinely BIDIRECTIONAL field: the React grid writes it when you
   * click a card, and the agent writes it when it decides what a turn is about.
   * That is what makes "is this one good for gaming?" resolve with no product
   * named - and equally, what makes a card light up when the agent picks it.
   */
  selected_product_ids?: string[];

  /** What the supervisor decided this turn is about. Read-only, for debugging. */
  intent?: "search" | "compare" | "recommend" | "cart" | "chitchat" | null;

  /** Why it routed that way. Read-only. */
  route_reason?: string | null;
}

/** The interrupt payload emitted by `_confirm_write` in apps/agent/src/agent/nodes.py. */
export interface ConfirmWriteInterrupt {
  kind: "confirm_write";
  tool: "add_to_cart" | "remove_from_cart";
  args: { product_id?: string; quantity?: number };
  summary: string;
}

/** What `resolve()` sends back to the paused graph. */
export interface ConfirmWriteDecision {
  approved: boolean;
  reason?: string;
}

export function isConfirmWriteInterrupt(value: unknown): value is ConfirmWriteInterrupt {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "confirm_write"
  );
}

/**
 * Dig the `confirm_write` payload out of an interrupt, wherever it landed.
 *
 * LangGraph's `interrupt({...})` value reaches the client through the AG-UI
 * standard-interrupt shape, and exactly which field carries it depends on the
 * adapter version: it may arrive as the event value, on `interrupt.metadata`,
 * or JSON-encoded in `interrupt.reason`. Checking all three costs a few lines
 * and makes this survive an adapter upgrade.
 */
export function findConfirmWrite(...candidates: unknown[]): ConfirmWriteInterrupt | null {
  for (const candidate of candidates) {
    if (isConfirmWriteInterrupt(candidate)) return candidate;

    if (typeof candidate === "string") {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (isConfirmWriteInterrupt(parsed)) return parsed;
      } catch {
        // not JSON - keep looking
      }
    }

    if (typeof candidate === "object" && candidate !== null) {
      const record = candidate as Record<string, unknown>;
      for (const key of ["value", "metadata", "reason", "message", "payload"]) {
        if (key in record) {
          const found = findConfirmWrite(record[key]);
          if (found) return found;
        }
      }
    }
  }
  return null;
}
