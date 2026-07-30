# Maester MCP Server

![CI](https://github.com/iffystrayer/maester-mcp-server/actions/workflows/ci.yml/badge.svg)

An MCP (Model Context Protocol) server that exposes [Maester](https://maester.dev) **2.2** — the Microsoft 365 / Entra / Defender / Active Directory / GitHub security test framework — as tools for AI agents.

Connect Claude, GitHub Copilot, or any MCP-compatible agent to your tenant's security posture and ask, for example:

> "Run Maester, summarise the critical failures, and audit our Copilot Studio agents and MCP servers while you're at it."

> **Version note:** aligned to Maester **2.2.0** (July 2026). Maester's test count has grown past 600 across Entra, Exchange, Teams, SharePoint, Purview, Defender, Intune, Global Secure Access, Active Directory, GitHub, and Azure DevOps. This server tracks the 2.2 cmdlet surface (`Get-MtTestInventory`, `Merge-MtMaesterResult`, `Get-MtHtmlReport`, `-OutputMarkdownFile`, `-DriftRoot`, the `-Service` connection model, and the `AIAgent` tag).

---

## Where this fits alongside Maester Cloud

Maester now has a companion commercial product, **[Maester Cloud](https://maester.cloud)** (private preview Aug 2026, GA targeted Sep 2026): a portal that keeps 5+ years of tenant history, highlights drift between runs, and alerts on change. It is the **durable evidence layer**.

This MCP server is a different, complementary layer:

| Layer | What it is | Strength |
|---|---|---|
| **Maester (open core)** | The test framework | Runs the checks |
| **Maester Cloud** | Hosted/self-hosted portal | History, drift, alerting, evidence retention |
| **This MCP server** | Conversational/agentic interface | Real-time triage, reasoning over failures, reflexive AI-surface auditing, remediation guidance |

Use them together: Maester Cloud remembers and alerts; the MCP server lets an agent investigate, explain, and act on any given run in natural language. They are not substitutes.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | For the MCP server |
| PowerShell 7+ (`pwsh`) | [Install guide](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell) |
| Maester 2.2+ | `Install-Module Maester -Scope CurrentUser` |
| Maester tests | `md ~/maester-tests; cd ~/maester-tests; Install-MaesterTests` |
| Entra ID app | `New-MtMaesterApp` (creates the app + permissions for you) |
| ADOPS module | Only for Azure DevOps tests: `Install-Module ADOPS` |
| PnP.PowerShell | Only for SharePoint tests |

---

## Auth setup

### Fastest path — let Maester create the app

```powershell
Connect-Maester -Service Azure
New-MtMaesterApp -GitHubActions -SetGitHubSecrets   # zero-config for GitHub Actions
```

### Manual app registration — Graph permissions (application, admin-consented)

| Permission | Used for |
|---|---|
| `Policy.Read.All` | Conditional access, auth methods |
| `Directory.Read.All` | Entra ID config |
| `IdentityRiskyUser.Read.All` | Risk-based CA tests |
| `RoleManagement.Read.All` | PIM / privileged role tests |
| `AuditLog.Read.All` | Sign-in and audit log checks |
| `SecurityEvents.Read.All` | Defender / ORCA checks |
| `NetworkAccess.Read.All` | **New in 2.2** — Global Secure Access checks |

Copilot Studio (`audit_ai_agents`) additionally needs the **Dataverse** service connection and access to the environment named in `maester-config.json`.

### Managed Identity (Azure-hosted, no secrets)

Set `AZURE_USE_MANAGED_IDENTITY=true`. Grant the managed identity the same Graph permissions.

---

## Installation

```bash
git clone https://github.com/iffystrayer/maester-mcp-server
cd maester-mcp-server
npm install
```

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `AZURE_TENANT_ID` | Yes* | Entra tenant ID |
| `AZURE_CLIENT_ID` | Yes* | App registration client ID |
| `AZURE_CLIENT_SECRET` | Yes* | App registration client secret |
| `AZURE_USE_MANAGED_IDENTITY` | No | `true` for Azure-hosted (no secret) |
| `MAESTER_TESTS_PATH` | No | Tests folder (default `~/maester-tests`) |
| `MAESTER_RESULTS_PATH` | No | Where result JSON/MD/HTML files are written |
| `MAESTER_DRIFT_ROOT` | No | Baseline folder for `-DriftRoot` drift detection |
| `MAESTER_PWSH` | No | PowerShell executable (default `pwsh`) |

\* Not required when `AZURE_USE_MANAGED_IDENTITY=true`.

---

## Claude Desktop config

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "maester": {
      "command": "node",
      "args": ["/absolute/path/to/maester-mcp-server/src/index.js"],
      "env": {
        "AZURE_TENANT_ID": "your-tenant-id",
        "AZURE_CLIENT_ID": "your-client-id",
        "AZURE_CLIENT_SECRET": "your-client-secret",
        "MAESTER_TESTS_PATH": "/Users/you/maester-tests",
        "MAESTER_DRIFT_ROOT": "/Users/you/maester-baseline"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

## Available tools

| Tool | What it does |
|---|---|
| `run_maester_tests` | Run tests (by tag/service), with optional markdown output and drift comparison. Returns summary + file paths. |
| `audit_ai_agents` | **New.** Run the `AIAgent` checks (MT.1113–MT.1122) — Copilot Studio agent risk, **MCP server tools needing review**, hard-coded creds, dormant/orphaned agents, high agent-risk sign-ins. |
| `get_security_posture_summary` | Overall pass rate, per-category breakdown, critical/high failures first. |
| `get_failed_tests` | All failures from a results file, filterable by category. |
| `get_test_detail` | Full description, remediation, help URL, severity for one test. |
| `run_ca_whatif` | Simulate a sign-in against Conditional Access policies. |
| `merge_tenant_results` | **New.** Merge many tenant result files into one multi-tenant HTML report (MSP use). |
| `list_available_tags` | Enumerate all tags via `Get-MtTestInventory`. |
| `update_maester_tests` | Update module + tests, report the new version. |

---

## The reflexive angle: agents auditing agents

The most valuable new capability in 2.2 for an agentic system is that **Maester now audits AI agents and MCP servers as an attack surface**. That means the very agent you connect this server to can police the rest of your org's agent sprawl:

```
You: We've had teams spinning up Copilot Studio agents and MCP servers all
     quarter. Which ones are risky?

Agent: [calls audit_ai_agents]
       → "8 agents checked. 3 findings: 'Sales Helper' is shared with the
          whole org and has no user authentication (MT.1113/MT.1114);
          'Invoice Bot' can send email with AI-controlled inputs — an
          exfiltration path (MT.1116); one connected MCP server exposes
          tools flagged for review (MT.1120). Want the remediation steps?"
```

This closes a real governance gap that most orgs don't have tooling for yet.

---

## Operational runbook

**1. Establish a baseline (once).** Run a full pass and snapshot the JSON as your drift baseline:
```
run_maester_tests(services: ["Graph","Exchange","Teams"]) → save resultsFile into MAESTER_DRIFT_ROOT
```

**2. Daily scheduled run (CI/CD).** Keep this in GitHub Actions / Azure DevOps, not the MCP server — the MCP server is for interactive investigation. Use `New-MtMaesterApp -GitHubActions -SetGitHubSecrets` for a secretless OIDC setup. Emit markdown for the PR/summary and JSON for retention.

**3. Interactive triage (MCP server).** When the scheduled run flags something, or ad hoc, have the agent call `run_maester_tests` with `useDrift: true`, then `get_security_posture_summary`, then drill in with `get_test_detail`.

**4. AI-surface review (monthly).** `audit_ai_agents` on a schedule as Copilot Studio and MCP adoption grows.

**5. Evidence retention.** For history/drift/alerting across runs, feed results into Maester Cloud rather than reinventing storage here.

---

## Security notes

- **Read-only by default.** Maester tests only read Graph/Azure/AD data.
- **Least privilege.** Grant only the scopes listed; don't run as Global Admin.
- **Secrets in env or a vault**, never in code. Prefer Managed Identity where possible.
- Result files can contain tenant configuration detail — store and retain them securely.
- The `run_ca_whatif` and remediation-adjacent flows are advisory; keep a human in the loop before any tenant write.

---

## Extending

Add an entry to `TOOLS` and a matching `case` in the request handler. Custom Maester tests in `tests/Custom/` are picked up automatically by `run_maester_tests` — no server change needed.

## Roadmap ideas

- HTTP+SSE / Streamable HTTP transport for remote deployment
- Streaming progress during long runs
- Optional Graph *write* tools for one-click remediation (behind an explicit approval gate)
- Auto-ticketing (Jira / Azure DevOps Boards / ServiceNow) on new failures
- Native Maester Cloud push once its ingest cmdlet ships
