"""Model construction.

One factory, one place to change. `MODEL_NAME` is read from the environment so
you can try a different model without editing code, and `OPENAI_BASE_URL` lets
you point the same code at a local OpenAI-compatible server (Ollama, LM Studio)
if you ever want to run offline.

Temperature is 0 everywhere. This is a tool-routing and data-summarising agent,
not a creative one - and a supervisor that routes differently on identical
input is close to impossible to debug.
"""

from __future__ import annotations

import os

from langchain_openai import ChatOpenAI

MODEL_NAME = os.getenv("AGENT_MODEL", "gpt-4o")


def make_model(*, temperature: float = 0.0, **kwargs) -> ChatOpenAI:
    """Build the chat model. Fails loudly if no key is configured."""
    if not os.getenv("OPENAI_API_KEY") and not os.getenv("OPENAI_BASE_URL"):
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Copy .env.example to .env at the repo "
            "root and add your key, or set OPENAI_BASE_URL to point at a local "
            "OpenAI-compatible server."
        )

    return ChatOpenAI(
        model=MODEL_NAME,
        temperature=temperature,
        base_url=os.getenv("OPENAI_BASE_URL") or None,
        # The SDK default is 2. Transient OpenAIConnectionErrors surface as
        # "An internal error occurred" in the chat with no hint of the cause,
        # and during debugging they are indistinguishable from a logic bug —
        # a run just fails and you go looking in the wrong place.
        max_retries=int(os.getenv("AGENT_MAX_RETRIES", "4")),
        timeout=float(os.getenv("AGENT_TIMEOUT_SECONDS", "60")),
        **kwargs,
    )
