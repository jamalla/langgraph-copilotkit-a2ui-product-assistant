#!/usr/bin/env node
/**
 * Pre-flight checks, run automatically before `pnpm dev`.
 *
 * Almost every failure while building this project was environmental rather
 * than a code bug: a stale process holding a port, a missing key, a Python
 * project that had never been synced. Each one surfaced later as a confusing
 * error from deep inside a stack trace. This script turns all of them into one
 * legible message before anything starts.
 */

import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const problems = [];
const notes = [];

const RESET = "[0m";
const paint = (code, text) => (process.stdout.isTTY ? `[${code}m${text}${RESET}` : text);
const red = (t) => paint("31", t);
const green = (t) => paint("32", t);
const yellow = (t) => paint("33", t);
const dim = (t) => paint("2", t);

function ok(label, detail = "") {
  console.log(`  ${green("ok")}   ${label}${detail ? dim(`  ${detail}`) : ""}`);
}
function fail(label, fix) {
  console.log(`  ${red("fail")} ${label}`);
  problems.push({ label, fix });
}
function warn(label, detail) {
  console.log(`  ${yellow("warn")} ${label}${detail ? dim(`  ${detail}`) : ""}`);
  notes.push(label);
}

function version(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Is something listening on this port?
 *
 * Probed by CONNECTING, not by trying to bind. Binding to 127.0.0.1 misses a
 * dual-stack server listening on `::` - which is exactly how `next dev` binds,
 * so a bind-probe cheerfully reported port 3000 free while the site was up.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(400);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

console.log(`\n${dim("preflight")}  checking the things that break first\n`);

// ---- toolchain -------------------------------------------------------------

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 20) ok("node", `v${process.versions.node}`);
else fail(`node is v${process.versions.node}, need 20 or newer`, "Install Node 20+.");

const uv = version("uv", ["--version"]);
if (uv) ok("uv", uv);
else
  fail("uv is not installed", "Install it: https://docs.astral.sh/uv/getting-started/installation/");

// ---- python environments ---------------------------------------------------

for (const app of ["mcp", "agent"]) {
  const venv = path.join(ROOT, "apps", app, ".venv");
  if (fs.existsSync(venv)) ok(`apps/${app} venv`);
  else fail(`apps/${app} has no .venv`, "Run: pnpm setup:python");
}

// ---- data ------------------------------------------------------------------

const dataFile = path.join(ROOT, "data", "products.json");
if (fs.existsSync(dataFile)) {
  try {
    const products = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    const categories = new Set(products.map((p) => p.category));
    ok("catalog", `${products.length} products, ${categories.size} categories`);
  } catch (err) {
    fail("data/products.json is not valid JSON", String(err.message));
  }
} else {
  fail("data/products.json is missing", "It is the source of truth for web and mcp alike.");
}

// ---- secrets ---------------------------------------------------------------

const envFile = path.join(ROOT, ".env");
if (!fs.existsSync(envFile)) {
  fail(".env does not exist", "Run: cp .env.example .env   then add your OPENAI_API_KEY");
} else {
  const env = fs.readFileSync(envFile, "utf8");
  const key = /^OPENAI_API_KEY=(.*)$/m.exec(env)?.[1]?.trim() ?? "";
  if (!key || key === "sk-..." || key.length < 20) {
    fail("OPENAI_API_KEY is not set in .env", "The agent cannot run without it (Parts 3 onward).");
  } else {
    ok("OPENAI_API_KEY", `${key.slice(0, 7)}…`);
  }
}

// ---- optional tracing --------------------------------------------------------

if (fs.existsSync(envFile)) {
  const env = fs.readFileSync(envFile, "utf8");
  const on = /^LANGSMITH_TRACING=true$/m.test(env);
  const key = /^LANGSMITH_API_KEY=lsv2_/m.test(env);
  if (on && key) ok("LangSmith tracing", "on — the journey panel will link to each run");
  else if (on && !key) warn("LANGSMITH_TRACING is true but no API key is set");
  else notes.push("langsmith-off");
}

// ---- ports -----------------------------------------------------------------

const PORTS = [
  [3000, "web"],
  [2024, "agent (langgraph dev)"],
  [8931, "mcp"],
];

for (const [port, who] of PORTS) {
  if (!(await portInUse(port))) {
    ok(`port ${port}`, `${who} — free`);
  } else {
    warn(
      `port ${port} is already in use (${who})`,
      "a previous run is probably still alive — that is usually what you want",
    );
  }
}

// ---- verdict ---------------------------------------------------------------

console.log();
if (problems.length > 0) {
  console.log(red(`  ${problems.length} problem${problems.length > 1 ? "s" : ""} to fix first:\n`));
  for (const { label, fix } of problems) console.log(`    • ${label}\n      ${dim(fix)}`);
  console.log();
  process.exit(1);
}

if (notes.includes("langsmith-off")) {
  console.log(
    dim(
      "  LangSmith tracing is off. It is optional, but it is the difference between\n" +
        "  a summary of each turn and the full tree: every prompt, token counts, and\n" +
        "  the A2UI subagent retries. See .env.example.\n",
    ),
  );
}

if (notes.filter((n) => n !== "langsmith-off").length > 0) {
  console.log(
    dim(
      "  Ports already in use are fine if you meant to leave those services running.\n" +
        "  If a service behaves like it is running stale code, stop it and start again —\n" +
        "  `langgraph dev` in particular does not reliably reload a changed state schema.\n",
    ),
  );
}

console.log(green("  ready\n"));
