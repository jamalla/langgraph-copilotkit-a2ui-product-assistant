#!/usr/bin/env node
/** Send a question, then dump what the chat actually rendered. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const QUESTION = process.argv[2] ?? "how many products i have";
const PORT = 9226;
const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];
const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) process.exit(0);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-cdom-"));
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

try {
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      wsUrl = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(250);
  }
  const ws = new WebSocket(wsUrl);
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
  const evaluate = async (expression) => {
    const r = await cmd("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      return `THREW: ${d.exception?.description ?? d.text}`;
    }
    return r.result?.result?.value;
  };

  await cmd("Runtime.enable");
  await cmd("Page.enable");
  await cmd("Page.navigate", { url: "http://localhost:3000/" });
  await sleep(12000);

  await evaluate(
    "(() => {const el=document.querySelector('textarea');if(!el)return 'no-input';" +
      "Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')" +
      `.set.call(el, ${JSON.stringify(QUESTION)});` +
      "el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();" +
      "el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));" +
      "return 'sent';})()",
  );
  await sleep(70000);

  console.log("\n=== elements carrying cpk classes (text, trimmed) ===");
  console.log(
    await evaluate(`JSON.stringify((() => {
      const out = [];
      document.querySelectorAll('*').forEach(el => {
        const cls = (el.className && el.className.toString) ? el.className.toString() : '';
        if (!cls.includes('cpk')) return;
        const txt = (el.innerText || '').trim();
        if (!txt) return;
        out.push({ tag: el.tagName.toLowerCase(), cls: cls.slice(0, 70), len: txt.length, txt: txt.slice(0, 110) });
      });
      return out.slice(-25);
    })(), null, 1)`),
  );

  console.log("\n=== does the answer text exist ANYWHERE in the DOM? ===");
  console.log(
    await evaluate(`JSON.stringify((() => {
      const needle = '30 products';
      const hits = [];
      document.querySelectorAll('*').forEach(el => {
        if (el.children.length === 0 && (el.textContent || '').includes(needle)) {
          hits.push({ tag: el.tagName, cls: String(el.className || '').slice(0,60), txt: el.textContent.slice(0,120) });
        }
      });
      return { bodyHasIt: (document.body.innerText || '').includes(needle), leafHits: hits };
    })(), null, 1)`),
  );

  console.log("\n=== message-ish containers ===");
  console.log(
    await evaluate(`JSON.stringify((() => {
      const sel = '[data-message-id],[data-role],[class*="message"],[class*="assistant"],[class*="Message"]';
      return [...document.querySelectorAll(sel)].slice(-15).map(el => ({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 80),
        role: el.getAttribute('data-role'),
        mid: el.getAttribute('data-message-id'),
        len: (el.innerText || '').trim().length,
        txt: (el.innerText || '').trim().slice(0, 100),
      }));
    })(), null, 1)`),
  );
} catch (err) {
  console.error("probe failed:", err.message);
}
done(0);
