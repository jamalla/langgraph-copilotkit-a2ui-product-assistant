#!/usr/bin/env bash
#
# Run the whole project locally: MCP server, LangGraph agent, and the web app.
#
#   ./run.sh              set up if needed, then start all three
#   ./run.sh --skip-setup skip dependency install and go straight to starting
#   ./run.sh --check      run the checks and exit without starting anything
#   ./run.sh --help
#
# What this does that `pnpm dev` does not:
#
#   * verifies the toolchain and the API key BEFORE starting anything, so a
#     missing key is one clear line rather than a stack trace three services deep
#   * starts the services in dependency order and WAITS for each to answer, so
#     the web app never comes up pointing at an agent that is not listening yet
#   * shuts all three down together on Ctrl+C, leaving no orphan holding a port
#
# Works in Git Bash on Windows, macOS, and Linux.

set -euo pipefail

cd "$(dirname "$0")"

SKIP_SETUP=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-setup) SKIP_SETUP=1 ;;
    --check)      CHECK_ONLY=1 ;;
    -h|--help)    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# Colour only when attached to a terminal, so piping to a file stays readable.
if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; DIM=""; OFF=""
fi

ok()   { printf '  %s+%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '  %sx%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }
step() { printf '\n%s%s%s\n' "$BOLD" "$1" "$OFF"; }

# ---------------------------------------------------------------------------
step "Toolchain"
# ---------------------------------------------------------------------------
need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 not found. $2"
  ok "$1 $( "$1" --version 2>&1 | head -1 )"
}
need node "Install Node 22 or newer from https://nodejs.org"
need uv   "Install uv: https://docs.astral.sh/uv/getting-started/installation/"

if ! command -v pnpm >/dev/null 2>&1; then
  # pnpm ships with Node via corepack; enabling it is friendlier than failing.
  warn "pnpm not found, enabling corepack"
  corepack enable >/dev/null 2>&1 || die "could not enable corepack. Run: npm i -g pnpm"
fi
ok "pnpm $(pnpm --version)"

# ---------------------------------------------------------------------------
step "Configuration"
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  warn ".env created from .env.example"
fi

# Read the key without sourcing .env, which would execute whatever is in it.
KEY="$(grep -E '^OPENAI_API_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r' || true)"
if [ -z "$KEY" ] || [ "$KEY" = "sk-..." ]; then
  die "OPENAI_API_KEY is not set in .env
     The catalog will render without it, but the assistant cannot answer.
     Get a key at https://platform.openai.com/api-keys and put it in .env"
fi
ok "OPENAI_API_KEY present (${KEY:0:7}...)"

if grep -qE '^LANGSMITH_TRACING=true' .env 2>/dev/null; then
  ok "LangSmith tracing enabled"
fi

# ---------------------------------------------------------------------------
step "Ports"
# ---------------------------------------------------------------------------
# Probe by CONNECTING, not by binding. `next dev` binds dual-stack, and a bind
# test reports a free port as taken.
port_busy() { curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$1/" && return 0 || return 1; }
BUSY=""
for p in 3000 2024 8931; do
  if port_busy "$p"; then BUSY="$BUSY $p"; fi
done
if [ -n "$BUSY" ]; then
  die "port(s)$BUSY already in use.
     Another copy of this project is probably running. Stop it first:
       Windows : netstat -ano | grep :3000    then  taskkill //PID <pid> //F
       macOS   : lsof -ti:3000 | xargs kill"
fi
ok "3000, 2024 and 8931 are free"

# ---------------------------------------------------------------------------
if [ "$SKIP_SETUP" -eq 0 ]; then
  step "Dependencies"
  if [ ! -d node_modules ]; then
    printf '  installing JS packages, this takes a minute\n'
    pnpm install --frozen-lockfile
  fi
  ok "JS packages"

  # --all-groups pulls in langgraph-cli[inmem], which provides `langgraph dev`.
  uv sync --directory apps/mcp   --all-groups --frozen >/dev/null
  uv sync --directory apps/agent --all-groups --frozen >/dev/null
  ok "Python environments"
else
  step "Dependencies"
  warn "skipped (--skip-setup)"
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  printf '\n%sEverything checks out. Run ./run.sh to start.%s\n' "$GREEN" "$OFF"
  exit 0
fi

# ---------------------------------------------------------------------------
step "Starting"
# ---------------------------------------------------------------------------
pids=""
stop() {
  trap - INT TERM EXIT
  printf '\n%sstopping%s\n' "$DIM" "$OFF"
  for p in $pids; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap stop INT TERM EXIT

# Any HTTP response means "listening". The MCP endpoint answers 406 to a plain
# GET because it expects the streamable-http handshake, and that is a healthy
# server rather than a broken one.
wait_for() { # url name seconds
  local i=0
  while [ "$i" -lt "$3" ]; do
    if curl -s -o /dev/null --max-time 2 "$1"; then return 0; fi
    i=$((i + 1)); sleep 1
  done
  die "$2 did not come up within $3s. Scroll up for its output."
}

printf '  mcp    http://localhost:8931\n'
pnpm dev:mcp & pids="$pids $!"
wait_for "http://127.0.0.1:8931/tools.json" "the MCP server" 60
ok "MCP server ready"

printf '  agent  http://localhost:2024\n'
pnpm dev:agent & pids="$pids $!"
wait_for "http://127.0.0.1:2024/ok" "the agent" 180
ok "LangGraph agent ready"

printf '  web    http://localhost:3000\n'
pnpm dev:web & pids="$pids $!"
wait_for "http://127.0.0.1:3000/" "the web app" 120
ok "Web app ready"

cat <<BANNER

  ${BOLD}${GREEN}Running.${OFF}

    App          http://localhost:3000
    Explainer    http://localhost:3000/explainer
    Studio       https://smith.langchain.com/studio/?baseUrl=http://localhost:2024
    MCP tools    http://localhost:8931/tools.json

  ${DIM}Try: "show me noise cancelling headphones under \$300"
  More prompts are in the README. Ctrl+C stops all three.${OFF}

BANNER

# Exit as soon as any service dies, rather than leaving a half-running stack
# that answers some requests and not others.
#
# `wait -n` is a bash builtin that dash does not have, which is why the shebang
# asks for bash specifically.
wait -n
die "a service exited. See its output above."
