"""Graph assembly.

    START -> supervisor -+-> catalog_agent   -+-> presenter -> END
                         +-> compare_agent   -+
                         +-> recommend_agent -+
                         +-> cart_agent      -+
                         +-> presenter ------+

The supervisor returns `Command(goto=...)`, so the edges out of it are declared
by the node's return type rather than by `add_conditional_edges`. Every worker
then runs straight to the presenter: one decision, one specialist, one answer.

No checkpointer is passed to `.compile()` on purpose. `langgraph dev` and
LangGraph Platform both inject their own, and passing one here would silently
override the host's persistence.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from langgraph.graph import END, START, StateGraph

# Load the ONE root .env before anything reads os.environ.
for parent in Path(__file__).resolve().parents:
    candidate = parent / ".env"
    if candidate.is_file():
        load_dotenv(candidate, override=False)
        break

from .nodes import (  # noqa: E402  - must come after load_dotenv
    cart_agent,
    catalog_agent,
    compare_agent,
    presenter,
    recommend_agent,
    supervisor,
)
from .state import AgentState  # noqa: E402

WORKERS = {
    "catalog_agent": catalog_agent,
    "compare_agent": compare_agent,
    "recommend_agent": recommend_agent,
    "cart_agent": cart_agent,
}


def build_graph() -> StateGraph:
    builder = StateGraph(AgentState)

    builder.add_node("supervisor", supervisor)
    for name, fn in WORKERS.items():
        builder.add_node(name, fn)
    builder.add_node("presenter", presenter)

    builder.add_edge(START, "supervisor")
    for name in WORKERS:
        builder.add_edge(name, "presenter")
    builder.add_edge("presenter", END)

    return builder


graph = build_graph().compile()
graph.name = "product_agent"
