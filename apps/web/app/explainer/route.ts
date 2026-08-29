import "server-only";

import fs from "node:fs";
import path from "node:path";

/**
 * GET /explainer — serves <repo root>/a2ui-explainer.html.
 *
 * The explainer deliberately lives at the repo root, not in apps/web/public: it
 * documents the whole system, not the web app, and it is meant to be opened
 * straight off disk with no server running. Copying it into public/ would give
 * us two files that drift apart, so this route reads the one canonical copy.
 *
 * It walks up from cwd rather than hard-coding "../../", matching lib/data.ts —
 * so it works whether Next was started from apps/web, from the repo root, or
 * from inside the container.
 */

let cache: { mtimeMs: number; html: string } | null = null;
let cachedPath: string | null = null;

function resolveExplainer(): string | null {
  if (cachedPath) return cachedPath;

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "a2ui-explainer.html");
    if (fs.existsSync(candidate)) {
      cachedPath = candidate;
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function GET() {
  const file = resolveExplainer();

  // A missing explainer is a broken link, not a broken app. Say which file is
  // missing instead of returning a blank 500 — the answer is always "it was not
  // copied into the image".
  if (!file) {
    return new Response(
      "a2ui-explainer.html was not found next to the repo root.\n" +
        "In Docker this means the Dockerfile did not COPY it into the image.",
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const { mtimeMs } = fs.statSync(file);
  if (!cache || cache.mtimeMs !== mtimeMs) {
    cache = { mtimeMs, html: fs.readFileSync(file, "utf8") };
  }

  return new Response(cache.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Re-read on mtime change, so editing the explainer shows up on reload
      // without a rebuild.
      "cache-control": "no-cache",
    },
  });
}
