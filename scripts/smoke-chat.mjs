#!/usr/bin/env node
/**
 * Drive the actual chat UI in a real browser and assert a non-empty answer.
 *
 * `smoke-browser.mjs` only loads the page. That caught the `Agent 'default'`
 * crash, but it cannot catch a turn that runs perfectly on the server and then
 * renders as an empty bubble — which is exactly what happened next.
 *
 * This one types a question into the real chat, waits for the assistant, and
 * fails if the reply is blank. It is the last untested layer in the stack.
 *
 *   node scripts/smoke-chat.mjs ["your question"]
 *
 * Selector note: CopilotKit's chat input is a plain <textarea> in the LIGHT DOM
 * (placeholder "Ask about the catalog…", classes prefixed `cpk:`). An earlier
 * version of this script assumed shadow DOM, walked shadow roots, threw, and
 * reported "could not find a chat input" while the box was plainly there. When
 * selectors drift, run `node scripts/dom-probe.mjs` rather than guessing.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const QUESTION = process.argv[2] ?? "how many products i have";
const PAGE = "http://localhost:3000/";
const PORT = 9223;

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) {
  console.error("No Edge or Chrome found — skipping chat smoke test.");
  process.exit(0);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-chat-"));
const child = spawn(
  browser,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1400,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finish(code) {
  try {
    child.kill();
  } catch {}
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(code);
}

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("DevTools never came up");
}

const errors = [];

try {
  const ws = new WebSocket(await target());
  let id = 0;
  const pending = new Map();

  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });

  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push(d.exception?.description ?? d.text ?? "exception");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
    }
  });

  const cmd = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await cmd("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(d.exception?.description ?? d.text ?? "evaluate threw");
    }
    return r.result?.result?.value;
  };

  await cmd("Runtime.enable");
  await cmd("Page.enable");
  await cmd("Page.navigate", { url: PAGE });
  await sleep(10000);

  // Open the chat if it is collapsed. Harmless when the input is already there.
  await evaluate(`(() => {
    if (document.querySelector('textarea')) return 'already-open';
    const toggle = [...document.querySelectorAll('button')].find(b =>
      /chat|assistant|open/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.title || ''))
    );
    if (toggle) { toggle.click(); return 'clicked'; }
    return 'no-toggle';
  })()`);
  await sleep(2000);

  const sent = await evaluate(`(() => {
    // The product filter bar also has inputs — pick the chat's textarea only.
    const el = document.querySelector('textarea');
    if (!el) return 'no-input';

    // React tracks the value on the node, so a plain assignment is ignored.
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      .set.call(el, ${JSON.stringify(QUESTION)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
    }));
    return 'sent';
  })()`);

  if (sent === "no-input") {
    console.log("\n  ✗ no chat textarea found — run scripts/dom-probe.mjs\n");
    finish(1);
  }

  // Read the assistant bubble DIRECTLY.
  //
  // An earlier version diffed document.body.innerText around the question and
  // reported "the assistant rendered NOTHING" for turns that rendered fine — it
  // kept matching only the "AI can make mistakes" footer. Half a debugging
  // session went into a bug that was in the TEST, not the app. Assert against
  // the element that is supposed to hold the answer.
  let answer = "";
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    answer = await evaluate(
      "(() => {" +
        "const all = document.querySelectorAll('.copilotKitAssistantMessage');" +
        "const el = all[all.length - 1];" +
        "if (!el) return '';" +
        "const noise = /^(view in inspector|\(local only\)|copy)$/i;" +
        "return (el.innerText || '').split(String.fromCharCode(10))" +
        ".map(function (l) { return l.trim(); })" +
        ".filter(function (l) { return l && !noise.test(l); })" +
        ".join(' ').trim();" +
      "})()",
    );
    if (answer) break;
  }

  console.log(`\n  question       : ${QUESTION}`);
  console.log(`  console errors : ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`    ✗ ${e.split("\n")[0].slice(0, 160)}`);

  if (!answer) {
    console.log("\n  ✗ the assistant rendered NOTHING\n");
    finish(1);
  }

  console.log(`\n  ✓ answer: ${answer.slice(0, 300)}\n`);
  finish(errors.length > 0 ? 1 : 0);
} catch (err) {
  console.error(`chat smoke test could not run: ${err.message}`);
  finish(1);
}
