# A2UI Product Assistant - the whole product in one image.
#
# Three processes live here: the Next.js web app, the LangGraph agent, and the
# MCP tool server. One image, because none of them is useful alone and only the
# web app needs to be reachable from outside.
#
#   docker build -t a2ui-assistant .
#   docker run --rm -p 3000:3000 --env-file .env a2ui-assistant
#
# Then open http://localhost:3000
#
# Deploying to Render: this is a Docker Web Service. Render injects PORT and
# publishes exactly one port; docker/start.sh binds the web app to $PORT and
# keeps the agent and the MCP server on internal loopback. See render.yaml.
#
# Layer order matters: manifests and lockfiles first, dependencies next, source
# last - so editing a component rebuilds two layers instead of reinstalling
# every dependency.

# ---------------------------------------------------------------------------
# uv, from its own published image. Copying the binary pins the version and is
# faster than curl-piping an installer.
# ---------------------------------------------------------------------------
FROM ghcr.io/astral-sh/uv:0.11.29 AS uv

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
# node:22-bookworm-slim, plus Debian's python3 - which is 3.11 on bookworm, and
# both Python projects ask for >=3.11. One base image beats stitching two
# runtimes together.
FROM node:22-bookworm-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /usr/local/bin/uv

# UV_LINK_MODE=copy: the uv cache and the project venvs land on different
# layers, where hardlinking is impossible and uv warns on every sync.
# UV_PYTHON pins the interpreter to the one apt installed, so the venvs point
# at a path that also exists in the runtime stage.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    UV_LINK_MODE=copy \
    UV_PYTHON=/usr/bin/python3 \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# --- JS dependencies -------------------------------------------------------
# Every manifest the workspace resolver needs, and nothing else. @a2ui/kit is a
# workspace member, so its package.json must be present or the link fails.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/a2ui-kit/package.json ./packages/a2ui-kit/
RUN corepack enable && corepack prepare --activate
RUN pnpm install --frozen-lockfile

# --- Python dependencies ---------------------------------------------------
# Both projects are installable packages, so uv needs their source present to
# build them - hence the src copy here rather than with the rest of the code.
COPY apps/mcp/pyproject.toml apps/mcp/uv.lock ./apps/mcp/
COPY apps/mcp/src ./apps/mcp/src
RUN uv sync --directory apps/mcp --all-groups --frozen

# --all-groups brings in langgraph-cli[inmem], which provides `langgraph dev`.
COPY apps/agent/pyproject.toml apps/agent/uv.lock ./apps/agent/
COPY apps/agent/src ./apps/agent/src
RUN uv sync --directory apps/agent --all-groups --frozen

# --- source ----------------------------------------------------------------
COPY data ./data
COPY packages/a2ui-kit ./packages/a2ui-kit
COPY apps/web ./apps/web
COPY apps/agent/langgraph.json ./apps/agent/
# Served by the web app at /explainer. Without this the link 404s in
# production while working perfectly on a developer's machine.
COPY a2ui-explainer.html ./
COPY docker ./docker

# The build reads data/products.json through a path that walks up out of the
# app directory, so the data has to be in place before this runs.
RUN pnpm --filter @app/web build

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# curl is the health check; tini reaps the three child processes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /usr/local/bin/uv

# The MCP server and the agent must bind 0.0.0.0 to be reachable at all inside
# a container; traffic between the three processes stays on loopback, since
# they share one network namespace. start.sh applies the same defaults, so
# overriding them in either place works.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    UV_LINK_MODE=copy \
    UV_PYTHON=/usr/bin/python3 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    MCP_SERVER_HOST=0.0.0.0 \
    MCP_SERVER_PORT=8931 \
    MCP_SERVER_URL=http://127.0.0.1:8931/mcp \
    LANGGRAPH_DEPLOYMENT_URL=http://127.0.0.1:2024 \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app
COPY --from=build /app /app

# Fetch pnpm now, at build time, into a place the runtime user can read.
#
# COREPACK_HOME is the whole point. Corepack caches into the invoking
# user's home, so preparing as root left it in /root while the container
# runs as uid 10001, which cannot read that. Corepack then re-downloaded
# pnpm from the npm registry on every container start, visible in the Render
# logs as "Corepack is about to download ...". A registry hiccup at that
# moment is a failed boot, for a dependency already inside the image.
# Activate pnpm from the version pinned in package.json now, at build time.
# Left until first use, corepack would try to download it when the container
# starts - a network call on the startup path, which is where you least want
# one.
RUN corepack enable && corepack prepare --activate

# Non-root. `langgraph dev` writes checkpoint state under the project
# directory, so the app tree has to belong to that user.
RUN useradd --create-home --uid 10001 app \
 && chown -R app:app /app /opt/corepack
USER app

# Documentation only - Render ignores EXPOSE and routes to $PORT. 2024 and 8931
# are internal; publish them locally only when you want LangGraph Studio or the
# MCP server from the host.
EXPOSE 3000

# The catalog route is the honest check: it is served by the web app and reads
# the product data, so a pass means the thing users hit is actually working.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -sf "http://127.0.0.1:${PORT}/api/products" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "/app/docker/start.sh"]
