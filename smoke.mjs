/**
 * Smoke test: starts the server over stdio, completes the MCP handshake,
 * and asserts that the expected tools are advertised.
 *
 * This does not touch a tenant or run PowerShell. It verifies the server
 * process boots, speaks MCP, and exposes its tool surface. Run with:
 *   node test/smoke.mjs
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "..", "src", "index.js");

const EXPECTED_TOOLS = [
  "run_maester_tests",
  "audit_ai_agents",
  "get_security_posture_summary",
  "get_failed_tests",
  "get_test_detail",
  "run_ca_whatif",
  "merge_tenant_results",
  "list_available_tags",
  "update_maester_tests",
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const proc = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
let buffer = "";
proc.stdout.on("data", (d) => { buffer += d.toString(); });
proc.stderr.on("data", () => {}); // server logs its banner to stderr; ignore

const send = (obj) => proc.stdin.write(JSON.stringify(obj) + "\n");

send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } },
});
setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/list" }), 300);

setTimeout(() => {
  const messages = buffer.trim().split("\n").map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const init = messages.find((m) => m.id === 1);
  if (!init || !init.result) fail("no initialize response");

  const list = messages.find((m) => m.id === 2);
  if (!list || !list.result || !Array.isArray(list.result.tools)) fail("no tools/list response");

  const names = list.result.tools.map((t) => t.name).sort();
  const expected = [...EXPECTED_TOOLS].sort();

  const missing = expected.filter((t) => !names.includes(t));
  const extra = names.filter((t) => !expected.includes(t));
  if (missing.length) fail(`missing tools: ${missing.join(", ")}`);
  if (extra.length) fail(`unexpected tools: ${extra.join(", ")}`);

  console.log(`PASS: handshake ok, ${names.length} tools advertised`);
  proc.kill();
  process.exit(0);
}, 1500);
