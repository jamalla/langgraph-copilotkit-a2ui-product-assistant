"""Binding the MCP server's tools into LangChain tools.

`MultiServerMCPClient` speaks MCP and hands back `StructuredTool` objects that
`ChatOpenAI.bind_tools` understands. The docstrings you wrote in apps/mcp
become the tool descriptions the model reads - that is the whole payoff of
having written them carefully.

Two things worth noticing:

  * The tool list is fetched ONCE and cached. Every worker node would otherwise
    re-open an MCP session per invocation, which is a round trip per turn for
    a list that never changes.
  * Each worker gets a NARROW subset. The catalog agent cannot call
    `add_to_cart`; only the cart path can. Withholding a tool is stronger than
    telling the model not to use it - a tool that is absent cannot be called by
    mistake, and it costs no context either.
"""

from __future__ import annotations

import asyncio
import os

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient

MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://127.0.0.1:8931/mcp")

# Which tools each worker is allowed to see.
TOOLSETS: dict[str, tuple[str, ...]] = {
    "catalog_agent": ("search_products", "list_categories", "check_stock", "get_product"),
    "compare_agent": ("compare_products", "get_product", "search_products"),
    "recommend_agent": ("search_products", "get_product", "compare_products", "check_stock"),
    "cart_agent": ("view_cart", "add_to_cart", "remove_from_cart", "check_stock", "get_product"),
}

_client: MultiServerMCPClient | None = None
_tools: list[BaseTool] | None = None
_lock = asyncio.Lock()


def _make_client() -> MultiServerMCPClient:
    return MultiServerMCPClient(
        {
            "products": {
                "url": MCP_SERVER_URL,
                "transport": "streamable_http",
            }
        }
    )


async def all_tools() -> list[BaseTool]:
    """Every tool the MCP server exposes, fetched once per process."""
    global _client, _tools
    if _tools is not None:
        return _tools

    async with _lock:
        if _tools is not None:  # another coroutine won the race
            return _tools
        if _client is None:
            _client = _make_client()
        try:
            _tools = await _client.get_tools()
        except Exception as exc:  # pragma: no cover - depends on a live server
            raise RuntimeError(
                f"Could not reach the MCP server at {MCP_SERVER_URL}. "
                "Start it first with:  pnpm dev:mcp"
            ) from exc
    return _tools


async def tools_for(worker: str) -> list[BaseTool]:
    """The subset of tools one worker is allowed to call."""
    allowed = TOOLSETS.get(worker)
    tools = await all_tools()
    if allowed is None:
        return tools

    by_name = {t.name: t for t in tools}
    missing = [name for name in allowed if name not in by_name]
    if missing:
        raise RuntimeError(
            f"MCP server is missing tools {missing} required by {worker!r}. "
            f"It offered: {sorted(by_name)}"
        )
    return [by_name[name] for name in allowed]


def reset_cache() -> None:
    """Drop the cached client and tools. Used by tests."""
    global _client, _tools
    _client = None
    _tools = None
