#!/usr/bin/env node
/**
 * Load the app in a real headless browser and report console errors.
 *
 * Why this exists: the `useAgent: Agent 'default' not found` failure was
 * invisible to every check in this repo. `tsc` was clean, both pytest suites
 * passed, and driving the runtime with `curl` produced a perfect A2UI surface —
 * because none of those ever MOUNT REACT. The bug lived entirely in hook
 * defaults resolved at runtime in the browser.
 *
 * Uses Edge over the DevTools Protocol via Node 22's built-in WebSocket, so
 * there is nothing to install.
 *
 *   node scripts/smoke-browser.mjs [url]
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL_TO_LOAD = process.argv[2] ?? "http://localhost:3000/";
const PORT = 9222;

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) {
  console.error("No Edge or Chrome found — skipping browser smoke test.");
  process.exit(0);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-smoke-"));
const child = spawn(
  browser,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore", detached: false },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function devtoolsTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* browser still starting */
    }
    await sleep(250);
  }
  throw new Error("DevTools never came up");
}

function cleanup(code) {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  process.exit(code);
}

const errors = [];
const warnings = [];

try {
  const wsUrl = await devtoolsTarget();
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const send = (method, params = {}) =>
    ws.send(JSON.stringify({ id: ++id, method, params }));

  await new Promise((resolve, reject) => {
    ws.addEventListener("error", reject);
    ws.addEventListener("open", resolve);
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);

    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push(d.exception?.description ?? d.text ?? "unknown exception");
    }

    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args ?? [])
        .map((a) => a.value ?? a.description ?? "")
        .join(" ")
        .trim();
      if (!text) return;
      if (msg.params.type === "error") errors.push(text);
      else if (msg.params.type === "warning") warnings.push(text);
    }
  });

  send("Runtime.enable");
  send("Log.enable");
  send("Page.enable");
  send("Page.navigate", { url: URL_TO_LOAD });

  // Long enough for the runtime /info sync that resolves agent ids.
  await sleep(12000);
  ws.close();
} catch (err) {
  console.error(`smoke test could not run: ${err.message}`);
  cleanup(0);
}

// Noise the app does not own and cannot fix.
const IGNORE = [
  /Lit is in dev mode/i,
  /Download the React DevTools/i,
  /favicon/i,
  /telemetry/i,
  /Slow filesystem/i,
];
const real = errors.filter((e) => !IGNORE.some((re) => re.test(e)));

console.log(`\n  ${URL_TO_LOAD}`);
console.log(`  console errors: ${real.length}   warnings: ${warnings.length}\n`);

if (real.length > 0) {
  for (const e of real) console.log(`  ✗ ${e.split("\n")[0].slice(0, 200)}`);
  console.log();
  cleanup(1);
}

console.log("  no console errors\n");
cleanup(0);
