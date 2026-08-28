#!/usr/bin/env node
/** Dump the page's element structure, shadow roots included, to learn selectors. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 9224;
const PAGE = process.argv[2] ?? "http://localhost:3000/";
const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];
const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) process.exit(0);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-probe-"));
const child = spawn(
  browser,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "--window-size=1400,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (c) => {
  try {
    child.kill();
  } catch {}
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(c);
};

let ws;
try {
  let url = null;
  for (let i = 0; i < 40 && !url; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      url = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
    } catch {}
    if (!url) await sleep(250);
  }
  ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const cmd = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id;
      pending.set(n, r);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await cmd("Runtime.enable");
  await cmd("Page.enable");
  await cmd("Page.navigate", { url: PAGE });
  await sleep(10000);

  const run = async (label, expr) => {
    const r = await cmd("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.result?.exceptionDetails || r.result?.result?.subtype === "error") {
      console.log(`${label}: THREW ${JSON.stringify(r.result).slice(0, 300)}`);
      return null;
    }
    console.log(`${label}:`, JSON.stringify(r.result?.result?.value, null, 1)?.slice(0, 2500));
    return r.result?.result?.value;
  };

  await run(
    "custom elements + shadow hosts",
    `(() => {
      const out = [];
      const walk = (node, depth) => {
        if (!node || depth > 25) return;
        if (node.tagName && node.tagName.includes('-')) out.push(node.tagName.toLowerCase() + (node.shadowRoot ? ' [shadow]' : ''));
        if (node.shadowRoot) for (const k of node.shadowRoot.children) walk(k, depth+1);
        for (const k of (node.children || [])) walk(k, depth+1);
      };
      walk(document.documentElement, 0);
      return [...new Set(out)];
    })()`,
  );

  await run(
    "buttons (light + shadow)",
    `(() => {
      const out = [];
      const walk = (node, depth) => {
        if (!node || depth > 25) return;
        if (node.tagName === 'BUTTON') out.push({
          label: node.getAttribute('aria-label'), title: node.title,
          cls: (node.className || '').toString().slice(0,60),
          text: (node.textContent || '').trim().slice(0, 30)
        });
        if (node.shadowRoot) for (const k of node.shadowRoot.children) walk(k, depth+1);
        for (const k of (node.children || [])) walk(k, depth+1);
      };
      walk(document.documentElement, 0);
      return out;
    })()`,
  );

  await run(
    "inputs (light + shadow)",
    `(() => {
      const out = [];
      const walk = (node, depth) => {
        if (!node || depth > 25) return;
        const t = node.tagName;
        if (t === 'TEXTAREA' || t === 'INPUT' || node.getAttribute?.('contenteditable') === 'true')
          out.push({ tag: t, type: node.type, ph: node.placeholder, cls: (node.className||'').toString().slice(0,50) });
        if (node.shadowRoot) for (const k of node.shadowRoot.children) walk(k, depth+1);
        for (const k of (node.children || [])) walk(k, depth+1);
      };
      walk(document.documentElement, 0);
      return out;
    })()`,
  );
} catch (err) {
  console.error("probe failed:", err.message);
}
done(0);
