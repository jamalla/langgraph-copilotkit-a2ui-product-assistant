#!/usr/bin/env bash
# Start all three services and keep them together.
#
# One container, three processes, because they are one product: the web app is
# useless without the agent, and the agent is useless without the MCP server.
# If any of them dies the container exits, so whatever supervises it — compose
# restart, Render, Kubernetes — sees a real failure instead of a half-running
# app that answers the health check and nothing else.
set -eu

log() { printf '[start] %s\n' "$1"; }

# langgraph.json points at ../../.env and refuses to start when that file is
# missing. Real values arrive through the container environment, so an empty
# file is all it needs.
[ -f /app/.env ] || : > /app/.env

# Render injects PORT and publishes exactly that one port. Locally it defaults
# to 3000. Only the web app gets it; the other two are private.
PORT="${PORT:-3000}"

# Bind 0.0.0.0, not localhost. A process listening on 127.0.0.1 inside a
# container is reachable only from inside that container — published ports lead
# nowhere and it looks like the app never started. Both the MCP server and
# langgraph dev default to localhost.
export MCP_SERVER_HOST="${MCP_SERVER_HOST:-0.0.0.0}"
export MCP_SERVER_PORT="${MCP_SERVER_PORT:-8931}"

# Traffic BETWEEN the services stays on loopback: they share a network
# namespace, so there is no reason to leave the container and come back.
export MCP_SERVER_URL="${MCP_SERVER_URL:-http://127.0.0.1:${MCP_SERVER_PORT}/mcp}"
export LANGGRAPH_DEPLOYMENT_URL="${LANGGRAPH_DEPLOYMENT_URL:-http://127.0.0.1:2024}"

if [ -z "${OPENAI_API_KEY:-}" ]; then
  log "WARNING: OPENAI_API_KEY is not set."
  log "The catalog will render; the assistant will not answer."
fi

pids=""
stop() {
  trap - INT TERM EXIT
  for p in $pids; do kill "$p" 2>/dev/null || true; done
}
trap stop INT TERM EXIT

# Wait for a URL to respond at all. Any HTTP status counts as "listening" — the
# MCP endpoint answers 406 to a plain GET because it expects the
# streamable-http handshake, and that is a healthy server, not a broken one.
wait_for() { # url name attempts
  i=0
  while [ "$i" -lt "$3" ]; do
    if curl -s -o /dev/null --max-time 2 "$1"; then return 0; fi
    i=$((i + 1))
    sleep 1
  done
  log "$2 did not come up within $3s"
  return 1
}

log "mcp    127.0.0.1:${MCP_SERVER_PORT}  (internal)"
uv run --directory apps/mcp python -m mcp_products.server &
pids="$pids $!"
wait_for "http://127.0.0.1:${MCP_SERVER_PORT}/tools.json" "mcp" 60

log "agent  127.0.0.1:2024  (internal)"
uv run --directory apps/agent langgraph dev --host 0.0.0.0 --port 2024 --no-browser &
pids="$pids $!"
wait_for "http://127.0.0.1:2024/ok" "agent" 180

# Started last and bound to $PORT, so the port only opens once its two
# dependencies are up. On Render that means the health check cannot pass while
# the assistant would still fail.
log "web    0.0.0.0:${PORT}  (public)"
pnpm --filter @app/web exec next start --hostname 0.0.0.0 --port "$PORT" &
pids="$pids $!"

log "ready — http://localhost:${PORT}"

# Exit as soon as ANY service dies, so the container status reflects reality
# rather than reporting healthy while the assistant is gone.
#
# `wait -n` is a bash builtin. Debian's /bin/sh is dash, which does not have it
# — under sh this line fails and the container exits immediately, looking like
# a crash on startup. Hence the bash shebang and the bash CMD in the Dockerfile.
wait -n
log "a service exited; shutting the container down"
exit 1
