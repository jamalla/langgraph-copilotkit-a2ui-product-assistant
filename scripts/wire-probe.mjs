#!/usr/bin/env node
/**
 * Record what the BROWSER sends to and receives from /api/copilotkit.
 *
 * The server answers correctly over curl while the chat renders an empty
 * bubble, so the disagreement lives between the two. This taps the real request
 * the real client makes.
 *
 * The SSE stream is megabytes, so the tap PARSES AS IT READS and keeps only a
 * summary. Shipping the raw stream over CDP truncates it and hides the tail,
 * which is the part that matters.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const QUESTION = process.argv[2] ?? "how many products i have";
const PORT = 9225;
const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];
const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) process.exit(0);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "a2ui-wire-"));
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

// Built as an array of plain lines so no host-language escaping is involved.
const TAP = [
  "window.__wire = { requests: [] };",
  "(function () {",
  "  var orig = window.fetch;",
  "  window.fetch = function (input, init) {",
  "    var url = typeof input === 'string' ? input : (input && input.url) || '';",
  "    if (url.indexOf('/api/copilotkit') === -1) return orig.apply(this, arguments);",
  "    var rec = { url: url, body: (init && init.body) || null, bytes: 0, chunks: 0,",
  "                types: {}, order: [], text: '', errors: [], tail: '' };",
  "    window.__wire.requests.push(rec);",
  "    return orig.apply(this, arguments).then(function (res) {",
  "      if (!res.body) return res;",
  "      var pair = res.body.tee();",
  "      var reader = pair[0].getReader();",
  "      var dec = new TextDecoder();",
  "      var buf = '';",
  "      var NL = String.fromCharCode(10);",
  "      function pump() {",
  "        return reader.read().then(function (r) {",
  "          if (r.done) return;",
  "          var s = dec.decode(r.value, { stream: true });",
  "          rec.bytes += s.length; rec.chunks += 1;",
  "          rec.tail = (rec.tail + s).slice(-1500);",
  "          buf += s;",
  "          var lines = buf.split(NL);",
  "          buf = lines.pop();",
  "          for (var i = 0; i < lines.length; i++) {",
  "            var line = lines[i];",
  "            if (line.indexOf('data: ') !== 0) continue;",
  "            var ev; try { ev = JSON.parse(line.slice(6)); } catch (e) { continue; }",
  "            rec.types[ev.type] = (rec.types[ev.type] || 0) + 1;",
  "            if (rec.order.length < 60) rec.order.push(ev.type);",
  "            if (ev.type === 'TEXT_MESSAGE_CONTENT') rec.text += (ev.delta || '');",
  "            if (ev.type === 'RUN_ERROR') rec.errors.push(JSON.stringify(ev).slice(0, 400));",
  "            if (ev.type === 'MESSAGES_SNAPSHOT') {",
  "              rec.snapshot = (ev.messages || []).map(function (m) {",
  "                return { id: m.id, role: m.role, len: (m.content || '').length,",
  "                         head: String(m.content || '').slice(0, 90),",
  "                         toolCalls: (m.toolCalls || []).map(function (t) {",
  "                           return (t.function && t.function.name) || t.name || '?'; }) };",
  "              });",
  "            }",
  "            if (ev.type === 'TEXT_MESSAGE_START') rec.textMsgIds = (rec.textMsgIds||[]).concat([ev.messageId]);",
  "            if (ev.type === 'TOOL_CALL_START') rec.toolCalls = (rec.toolCalls||[]).concat([",
  "              { name: ev.toolCallName || null, id: ev.toolCallId || null, parent: ev.parentMessageId || null }]);",
  "            if (ev.type === 'TOOL_CALL_RESULT') rec.toolResults = (rec.toolResults||[]).concat([",
  "              { id: ev.toolCallId || null, msg: ev.messageId || null }]);",
  "          }",
  "          return pump();",
  "        });",
  "      }",
  "      pump().catch(function (e) { rec.streamError = String(e); });",
  "      return new Response(pair[1], { status: res.status, statusText: res.statusText, headers: res.headers });",
  "    });",
  "  };",
  "})();",
].join("\n");

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
      throw new Error(d.exception?.description ?? d.text ?? "evaluate threw");
    }
    return r.result?.result?.value;
  };

  await cmd("Runtime.enable");
  await cmd("Page.enable");
  await cmd("Page.addScriptToEvaluateOnNewDocument", { source: TAP });
  await cmd("Page.navigate", { url: "http://localhost:3000/" });
  await sleep(12000);

  const sent = await evaluate(
    "(() => {" +
      "const el = document.querySelector('textarea');" +
      "if (!el) return 'no-input';" +
      "Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')" +
      `.set.call(el, ${JSON.stringify(QUESTION)});` +
      "el.dispatchEvent(new Event('input',{bubbles:true}));" +
      "el.focus();" +
      "el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));" +
      "return 'sent';})()",
  );
  console.log(`\n  input: ${sent}`);

  await sleep(75000);

  const parsed = JSON.parse((await evaluate("JSON.stringify(window.__wire.requests)")) || "[]");
  console.log(`  captured ${parsed.length} request(s)\n`);

  for (const r of parsed) {
    console.log(`  -- ${r.url}`);
    if (r.body) {
      try {
        const b = JSON.parse(r.body);
        console.log(`     tools     : ${JSON.stringify((b.tools || []).map((t) => t.name))}`);
        console.log(
          `     context   : ${(b.context || []).map((c) => String(c.description || "").slice(0, 38)).join(" | ")}`,
        );
        console.log(`     forwarded : ${JSON.stringify(b.forwardedProps || {})}`);
      } catch {
        console.log(`     body      : ${String(r.body).slice(0, 200)}`);
      }
    }
    console.log(`     stream    : ${r.chunks} chunks, ${r.bytes} bytes`);
    if (r.streamError) console.log(`     STREAM ERR: ${r.streamError}`);
    if (Object.keys(r.types || {}).length) {
      console.log(`     events    : ${JSON.stringify(r.types)}`);
    }
    if (r.order && r.order.length) {
      console.log(`     order     : ${r.order.slice(0, 20).join(" ")}`);
    }
    for (const e of r.errors || []) console.log(`     RUN_ERROR : ${e}`);
    console.log(`     TEXT      : ${r.text ? r.text.slice(0, 400) : "(none)"}`);
    if (r.textMsgIds) console.log(`     text msgs : ${JSON.stringify(r.textMsgIds)}`);
    if (r.toolCalls) console.log(`     toolCalls : ${JSON.stringify(r.toolCalls)}`);
    if (r.toolResults) console.log(`     toolResult: ${JSON.stringify(r.toolResults)}`);
    if (r.snapshot) {
      console.log("     FINAL MESSAGES_SNAPSHOT:");
      for (const m of r.snapshot) {
        console.log(
          `       ${String(m.role).padEnd(10)} id=${String(m.id).padEnd(42)} len=${String(m.len).padEnd(5)} ${m.head}`,
        );
      }
    }
    if (!r.text && r.bytes) {
      console.log(`     tail      : ${String(r.tail || "").replace(/\s+/g, " ").slice(-420)}`);
    }
    console.log();
  }
} catch (err) {
  console.error("wire probe failed:", err.message);
}
done(0);
