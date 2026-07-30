#!/usr/bin/env node

/**
 * Maester MCP Server
 * Target: Maester 2.2.0+ (July 2026)
 *
 * Exposes Maester's Microsoft 365 / Entra / Defender / AD / GitHub security
 * test framework as MCP tools, enabling AI agents (Claude, Copilot, etc.) to
 * run security audits, triage failures, audit *other* AI agents, and guide
 * remediation conversationally.
 *
 * Prerequisites:
 *   - PowerShell 7+ with Maester 2.2.0+  (Install-Module Maester)
 *   - Maester tests installed            (Install-MaesterTests)
 *   - An Entra ID app registration       (New-MtMaesterApp) or Managed Identity
 *   - Env: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
 *     (or AZURE_USE_MANAGED_IDENTITY=true for Azure-hosted scenarios)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

// ─── Config ────────────────────────────────────────────────────────────────

const CONFIG = {
  testsPath: process.env.MAESTER_TESTS_PATH || path.join(os.homedir(), "maester-tests"),
  resultsPath: process.env.MAESTER_RESULTS_PATH || path.join(os.tmpdir(), "maester-results"),
  // Optional baseline dir for native drift detection (Invoke-Maester -DriftRoot)
  driftRoot: process.env.MAESTER_DRIFT_ROOT || "",
  pwsh: process.env.MAESTER_PWSH || "pwsh",
  useManagedIdentity: process.env.AZURE_USE_MANAGED_IDENTITY === "true",
  tenantId: process.env.AZURE_TENANT_ID || "",
  clientId: process.env.AZURE_CLIENT_ID || "",
  clientSecret: process.env.AZURE_CLIENT_SECRET || "",
};

// Services Connect-Maester understands in 2.2. Note: ActiveDirectory is
// deliberately excluded from "All" by Maester and must be opted into explicitly.
const VALID_SERVICES = [
  "Graph", "Exchange", "Teams", "Dataverse", "GitHub",
  "Azure", "ActiveDirectory", "SharePoint", "All",
];

// ─── PowerShell runner ─────────────────────────────────────────────────────

async function runPowerShell(script, timeoutMs = 120_000) {
  const escaped = script.replace(/"/g, '\\"');
  const cmd = `${CONFIG.pwsh} -NonInteractive -NoProfile -Command "${escaped}"`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: timeoutMs,
      maxBuffer: 100 * 1024 * 1024, // 100 MB — 2.2 result sets are large (600+ tests)
    });
    if (stderr && stderr.trim()) {
      const realErrors = stderr
        .split("\n")
        .filter((l) => l.match(/Error|Exception/i))
        .join("\n");
      if (realErrors) throw new Error(realErrors);
    }
    return stdout.trim();
  } catch (err) {
    throw new Error(`PowerShell error: ${err.message}`);
  }
}

/**
 * Normalises a requested service list, validates it, and returns a safe
 * comma-separated string for Connect-Maester -Service.
 */
function normaliseServices(services) {
  if (!services || services.length === 0) return "Graph";
  const clean = services
    .map((s) => VALID_SERVICES.find((v) => v.toLowerCase() === s.toLowerCase()))
    .filter(Boolean);
  return clean.length ? clean.join(",") : "Graph";
}

/**
 * Builds the connection block. Establishes a Graph context via the configured
 * auth method, then hands the full service list to Connect-Maester.
 */
function buildConnectBlock(services) {
  const svc = normaliseServices(services);

  if (CONFIG.useManagedIdentity) {
    return `Connect-Maester -Identity -Service ${svc}`;
  }

  return `
$secSecret = ConvertTo-SecureString '${CONFIG.clientSecret}' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('${CONFIG.clientId}', $secSecret)
Connect-MgGraph -TenantId '${CONFIG.tenantId}' -ClientSecretCredential $cred -NoWelcome
Connect-Maester -Service ${svc}
  `.trim();
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function ensureResultsDir() {
  if (!existsSync(CONFIG.resultsPath)) {
    await mkdir(CONFIG.resultsPath, { recursive: true });
  }
}

const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function parseMaesterResults(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse Maester JSON results.");
  }
}

function buildSummary(results) {
  const tests = results?.Tests || results?.Results || [];
  const total = tests.length;
  const passed = tests.filter((t) => t.Result === "Passed").length;
  const failed = tests.filter((t) => t.Result === "Failed").length;
  const skipped = tests.filter((t) => t.Result === "Skipped").length;
  const notRun = tests.filter((t) => t.Result === "NotRun").length;
  const passRate = total > 0 ? ((passed / (passed + failed || 1)) * 100).toFixed(1) : "0";
  return { total, passed, failed, skipped, notRun, passRate, tests };
}

// ─── Tool implementations ──────────────────────────────────────────────────

async function runMaesterTests({ tags, excludeTags, services, includeLongRunning, includePreview, emitMarkdown, useDrift }) {
  await ensureResultsDir();
  const stamp = timestamp();
  const jsonFile = path.join(CONFIG.resultsPath, `results-${stamp}.json`);
  const mdFile = emitMarkdown ? path.join(CONFIG.resultsPath, `results-${stamp}.md`) : "";

  const tagParam = tags?.length ? `-Tag '${tags.join("','")}'` : "";
  const excludeParam = excludeTags?.length ? `-ExcludeTag '${excludeTags.join("','")}'` : "";
  const longParam = includeLongRunning ? "-IncludeLongRunning" : "";
  const previewParam = includePreview ? "-IncludePreview" : "";
  const mdParam = mdFile ? `-OutputMarkdownFile '${mdFile}'` : "";
  const driftParam = useDrift && CONFIG.driftRoot ? `-DriftRoot '${CONFIG.driftRoot}'` : "";

  const script = `
Import-Module Maester -ErrorAction Stop
${buildConnectBlock(services)}
Invoke-Maester -Path '${CONFIG.testsPath}' ${tagParam} ${excludeParam} ${longParam} ${previewParam} ${driftParam} -OutputJsonFile '${jsonFile}' ${mdParam} -Verbosity None -NonInteractive -SkipVersionCheck -PassThru | Out-Null
Get-Content '${jsonFile}' -Raw
  `.trim();

  const raw = await runPowerShell(script, 600_000); // 10 min — 2.2 suites are big
  const results = parseMaesterResults(raw);
  const s = buildSummary(results);

  return {
    summary: `Ran ${s.total} tests: ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped, ${s.notRun} not run (${s.passRate}% of executed tests passed)`,
    passed: s.passed, failed: s.failed, skipped: s.skipped, notRun: s.notRun,
    total: s.total, passRate: `${s.passRate}%`,
    resultsFile: jsonFile,
    markdownFile: mdFile || null,
    driftUsed: Boolean(driftParam),
    failedTests: s.tests
      .filter((t) => t.Result === "Failed")
      .map((t) => ({ id: t.Id || t.Name, name: t.Name, tags: t.Tag || [], severity: t.Severity || "Unknown" })),
  };
}

async function auditAiAgents({ services }) {
  // Copilot Studio / AI-agent / MCP checks (MT.1113–MT.1122) require Dataverse.
  // High agent-risk Entra checks come from the default Graph set.
  await ensureResultsDir();
  const stamp = timestamp();
  const jsonFile = path.join(CONFIG.resultsPath, `ai-audit-${stamp}.json`);
  const svc = services?.length ? services : ["Graph", "Dataverse"];

  const script = `
Import-Module Maester -ErrorAction Stop
${buildConnectBlock(svc)}
Invoke-Maester -Path '${CONFIG.testsPath}' -Tag 'AIAgent' -OutputJsonFile '${jsonFile}' -Verbosity None -NonInteractive -SkipVersionCheck -PassThru | Out-Null
Get-Content '${jsonFile}' -Raw
  `.trim();

  const raw = await runPowerShell(script, 300_000);
  const results = parseMaesterResults(raw);
  const s = buildSummary(results);

  return {
    summary: `AI-agent surface audit: ${s.passed} passed, ${s.failed} failed of ${s.total} checks. Covers Copilot Studio agent sharing/auth/HTTP/exfiltration, MCP server tools needing review, hard-coded credentials, dormant/orphaned agents, and high agent-risk sign-ins.`,
    resultsFile: jsonFile,
    findings: s.tests.map((t) => ({
      id: t.Id || t.Name, name: t.Name, result: t.Result,
      remediation: t.Remediation || t.ResultDetail || "",
    })),
  };
}

async function getFailedTests({ resultsFile, category }) {
  const raw = await readFile(resultsFile, "utf8");
  const { tests } = buildSummary(parseMaesterResults(raw));
  let failed = tests.filter((t) => t.Result === "Failed");
  if (category) {
    failed = failed.filter((t) =>
      (t.Tag || []).some((tag) => tag.toLowerCase().includes(category.toLowerCase())));
  }
  return failed.map((t) => ({
    id: t.Id || t.Name, name: t.Name, tags: t.Tag || [],
    description: t.Description || t.HelpUrl || "",
    remediation: t.Remediation || t.ResultDetail || "",
    severity: t.Severity || "Unknown",
  }));
}

async function getTestDetail({ resultsFile, testId }) {
  const raw = await readFile(resultsFile, "utf8");
  const { tests } = buildSummary(parseMaesterResults(raw));
  const test = tests.find((t) => (t.Id || t.Name || "").toLowerCase() === testId.toLowerCase());
  if (!test) return { error: `Test '${testId}' not found in results file.` };
  return {
    id: test.Id || test.Name, name: test.Name, result: test.Result,
    tags: test.Tag || [], description: test.Description || "",
    remediation: test.Remediation || test.ResultDetail || "",
    helpUrl: test.HelpUrl || "", severity: test.Severity || "Unknown",
    rawDetail: test.ResultDetail || "",
  };
}

async function getSecurityPostureSummary({ resultsFile }) {
  const raw = await readFile(resultsFile, "utf8");
  const { tests, passed, failed, skipped, notRun, total, passRate } =
    buildSummary(parseMaesterResults(raw));
  const byCategory = {};
  for (const t of tests) {
    const cat = (t.Tag || ["Uncategorized"])[0];
    byCategory[cat] ??= { passed: 0, failed: 0, skipped: 0 };
    const key = t.Result?.toLowerCase();
    if (byCategory[cat][key] !== undefined) byCategory[cat][key]++;
  }
  return {
    overall: { total, passed, failed, skipped, notRun, passRate: `${passRate}%` },
    byCategory,
    criticalFailures: tests
      .filter((t) => t.Result === "Failed" && (t.Severity === "Critical" || t.Severity === "High"))
      .map((t) => ({ id: t.Id || t.Name, name: t.Name, severity: t.Severity, tags: t.Tag || [] })),
    topFailures: tests.filter((t) => t.Result === "Failed").slice(0, 5)
      .map((t) => ({ name: t.Name, tags: t.Tag || [] })),
  };
}

async function runCaWhatIf({ userId, appId, ipAddress, devicePlatform, deviceCompliant }) {
  const script = `
Import-Module Maester -ErrorAction Stop
${buildConnectBlock(["Graph"])}
$body = @{
  conditionalAccessWhatIfSubject = @{ userId = '${userId}' }
  conditionalAccessContext = @{
    ${appId ? `appId = '${appId}';` : ""}
    ${ipAddress ? `ipAddress = '${ipAddress}';` : ""}
    ${devicePlatform ? `devicePlatform = '${devicePlatform}';` : ""}
    ${deviceCompliant !== undefined ? `isCompliantDevice = $${deviceCompliant};` : ""}
  }
}
$result = Invoke-MtGraphRequest -RelativeUri 'identity/conditionalAccess/evaluate' -Method POST -Body $body
$result | ConvertTo-Json -Depth 10
  `.trim();
  const raw = await runPowerShell(script);
  try { return JSON.parse(raw); } catch { return { raw }; }
}

async function mergeTenantResults({ resultsFolder, outputHtml }) {
  const htmlOut = outputHtml || path.join(CONFIG.resultsPath, `multi-tenant-${timestamp()}.html`);
  const script = `
Import-Module Maester -ErrorAction Stop
$merged = Merge-MtMaesterResult -Path '${resultsFolder}'
$merged | Get-MtHtmlReport | Out-File '${htmlOut}' -Encoding UTF8
Write-Output '${htmlOut}'
  `.trim();
  const out = await runPowerShell(script, 180_000);
  return { message: `Merged multi-tenant report written.`, reportFile: out.trim() || htmlOut };
}

async function listAvailableTags() {
  // 2.2 ships an official inventory cmdlet — no more regex scraping.
  const script = `
Import-Module Maester -ErrorAction Stop
$inv = Get-MtTestInventory -Path '${CONFIG.testsPath}' -PassThru
$inv.Keys | Sort-Object | ConvertTo-Json
  `.trim();
  const out = await runPowerShell(script);
  let tags = [];
  try { tags = JSON.parse(out); } catch { tags = out.split("\n").filter(Boolean); }
  return { tags: Array.isArray(tags) ? tags : [tags] };
}

async function updateMaesterTests() {
  const script = `
Update-Module Maester -Force -ErrorAction Stop
Import-Module Maester
Update-MaesterTests -Path '${CONFIG.testsPath}'
(Get-Module Maester).Version.ToString()
  `.trim();
  const out = await runPowerShell(script, 180_000);
  return { message: `Maester updated. Module version: ${out.trim()}` };
}

// ─── Tool registry ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "run_maester_tests",
    description:
      "Run Maester 2.2 security tests against your Microsoft 365 / Entra tenant. Returns a pass/fail summary and results file paths. Scope with tags and services. Takes 2–10 min depending on breadth.",
    inputSchema: {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" },
          description: "Only run tests with these tags. Examples: EIDSCA, CISA, CIS, CA, MFA, Privileged, Defender, AIAgent, 'CIS GH', MT.1172." },
        excludeTags: { type: "array", items: { type: "string" }, description: "Exclude tests with these tags." },
        services: { type: "array", items: { type: "string", enum: VALID_SERVICES },
          description: "Services to connect. Default ['Graph']. Add Exchange, Teams, Dataverse (Copilot Studio), GitHub, SharePoint, Azure. 'ActiveDirectory' is on-prem opt-in and never part of 'All'." },
        includeLongRunning: { type: "boolean", description: "Include long-running tests (replaces the deprecated 'Full' tag).", default: false },
        includePreview: { type: "boolean", description: "Include preview tests (replaces the deprecated 'All' tag).", default: false },
        emitMarkdown: { type: "boolean", description: "Also emit a markdown summary suitable for a PR comment or pipeline step.", default: false },
        useDrift: { type: "boolean", description: "Compare against the configured baseline (MAESTER_DRIFT_ROOT) to detect configuration drift.", default: false },
      },
    },
  },
  {
    name: "audit_ai_agents",
    description:
      "Audit the organisation's AI attack surface using Maester's AIAgent checks (MT.1113–MT.1122): risky Copilot Studio agent sharing, missing agent authentication, risky HTTP config, AI-driven email exfiltration, MCP server tools that need review, hard-coded credentials in topics, dormant/orphaned agents, plus high agent-risk sign-ins. Requires the Dataverse service. Use this to let an AI agent police the org's *other* agents and MCP servers.",
    inputSchema: {
      type: "object",
      properties: {
        services: { type: "array", items: { type: "string", enum: VALID_SERVICES },
          description: "Defaults to ['Graph','Dataverse']. Dataverse is required for Copilot Studio checks." },
      },
    },
  },
  {
    name: "get_security_posture_summary",
    description:
      "Parse a results file into a structured summary: overall pass rate, per-category breakdown, critical/high failures sorted first, and top failures. Good first call after run_maester_tests.",
    inputSchema: { type: "object",
      properties: { resultsFile: { type: "string", description: "Path to the Maester JSON results file." } },
      required: ["resultsFile"] },
  },
  {
    name: "get_failed_tests",
    description: "List all failed tests from a results file with descriptions and remediation, optionally filtered by category tag.",
    inputSchema: { type: "object",
      properties: {
        resultsFile: { type: "string", description: "Path to the Maester JSON results file." },
        category: { type: "string", description: "Optional category filter (e.g. EIDSCA, CA, CISA, Defender, AIAgent)." },
      }, required: ["resultsFile"] },
  },
  {
    name: "get_test_detail",
    description: "Get full details — description, result, remediation, help URL, severity — for one test by ID.",
    inputSchema: { type: "object",
      properties: {
        resultsFile: { type: "string", description: "Path to the Maester JSON results file." },
        testId: { type: "string", description: "Test ID or name (e.g. EIDSCA.AF01, MT.1116, Test-MtCaRequireMfa)." },
      }, required: ["resultsFile", "testId"] },
  },
  {
    name: "run_ca_whatif",
    description: "Simulate a user sign-in against all Conditional Access policies via the Graph evaluate API. Returns which policies apply, block, or grant.",
    inputSchema: { type: "object",
      properties: {
        userId: { type: "string", description: "UPN or object ID (e.g. alice@contoso.com)." },
        appId: { type: "string", description: "Application (client) ID to simulate sign-in to. Optional." },
        ipAddress: { type: "string", description: "Source IP for the simulated sign-in. Optional." },
        devicePlatform: { type: "string", enum: ["android", "iOS", "windows", "macOS", "linux"], description: "Device platform. Optional." },
        deviceCompliant: { type: "boolean", description: "Whether the simulated device is Intune-compliant. Optional." },
      }, required: ["userId"] },
  },
  {
    name: "merge_tenant_results",
    description: "Merge multiple per-tenant Maester result files into a single multi-tenant HTML report (for MSPs / multi-tenant orgs). Wraps Merge-MtMaesterResult + Get-MtHtmlReport.",
    inputSchema: { type: "object",
      properties: {
        resultsFolder: { type: "string", description: "Folder containing multiple tenant result JSON files." },
        outputHtml: { type: "string", description: "Optional output path for the merged HTML report." },
      }, required: ["resultsFolder"] },
  },
  {
    name: "list_available_tags",
    description: "List every test tag available in the installed test suite via Get-MtTestInventory. Use these to scope run_maester_tests.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_maester_tests",
    description: "Update the Maester module and test files to the latest versions, and report the resulting module version.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ─── MCP Server setup ──────────────────────────────────────────────────────

const server = new Server({ name: "maester-mcp", version: "2.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case "run_maester_tests":            result = await runMaesterTests(args || {}); break;
      case "audit_ai_agents":              result = await auditAiAgents(args || {}); break;
      case "get_security_posture_summary": result = await getSecurityPostureSummary(args); break;
      case "get_failed_tests":             result = await getFailedTests(args); break;
      case "get_test_detail":              result = await getTestDetail(args); break;
      case "run_ca_whatif":                result = await runCaWhatIf(args); break;
      case "merge_tenant_results":         result = await mergeTenantResults(args); break;
      case "list_available_tags":          result = await listAvailableTags(); break;
      case "update_maester_tests":         result = await updateMaesterTests(); break;
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Maester MCP server (2.2-aligned) running on stdio");
