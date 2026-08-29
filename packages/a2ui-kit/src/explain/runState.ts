/**
 * How far the current turn has actually got.
 *
 * Not a timer. LangGraph writes state after each node completes, so a thread
 * mid-run already reports its own progress: `intent` means the supervisor has
 * decided, `toolsUsed` means the worker finished its tool loop, `surfaceKind`
 * means it produced something to render, `hasTrace` means the A2UI subagent has
 * returned. Reading those is the difference between a panel that animates
 * because a clock said so and one that animates because work happened.
 */
export interface Progress {
  intent: string | null;
  routeReason: string | null;
  refinedQuery: string | null;
  toolsUsed: { tool: string; result?: string }[] | null;
  surfaceKind: string | null;
  hasTrace: boolean;
}

export interface RunState {
  running: boolean;
  progress: Progress | null;
}

export type StepStatus = "done" | "active" | "pending" | "idle";

/**
 * Which of the twelve steps is happening right now.
 *
 * The journey is a fixed list and the graph reports four checkpoints, so each
 * checkpoint claims the steps up to it. Between two checkpoints the first
 * unclaimed step is the one in flight, which is what gets the pulse.
 *
 * When nothing is running every step is "idle" and the panel looks exactly as
 * it did before: history, not motion.
 */
export function stepStatus(index: number, run: RunState): StepStatus {
  if (!run.running) return "idle";

  const p = run.progress;
  // Checkpoints, in journey order. The turn is somewhere at or before the
  // first one that has not reported yet.
  let reached = 2; // the question left the browser and reached the runtime
  if (p?.intent) reached = 5; // supervisor routed
  if (p?.toolsUsed?.length) reached = 7; // worker ran its tools
  if (p?.surfaceKind) reached = 8; // a surface exists
  if (p?.hasTrace) reached = 12; // the subagent designed the tree

  if (index < reached) return "done";
  if (index === reached) return "active";
  return "pending";
}
