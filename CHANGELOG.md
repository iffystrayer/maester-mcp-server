# Changelog

## 2.0.0 — Maester 2.2 alignment

Rebuilt against Maester 2.2.0 (July 2026). Maester grew from ~140 tests to 600+
across Entra, Exchange, Teams, SharePoint, Purview, Defender, Intune, Global
Secure Access, Active Directory, GitHub, and Azure DevOps.

### Added
- `audit_ai_agents` tool — runs the new `AIAgent` checks (MT.1113–MT.1122),
  including MCP-server-tools-needing-review, risky Copilot Studio agent sharing,
  AI-driven email exfiltration paths, hard-coded credentials, dormant/orphaned
  agents, and high agent-risk sign-ins. This is the reflexive "agents auditing
  agents" capability.
- `merge_tenant_results` tool — wraps `Merge-MtMaesterResult` + `Get-MtHtmlReport`
  for multi-tenant / MSP reporting.
- Native drift detection via `-DriftRoot` (env `MAESTER_DRIFT_ROOT`, `useDrift` arg).
- Optional markdown output via `-OutputMarkdownFile` (`emitMarkdown` arg) for
  PR comments and pipeline summaries.
- `NetworkAccess.Read.All` documented for Global Secure Access checks.

### Changed
- Connection model: replaced the ad-hoc `includeExchange`/`includeTeams`
  booleans with a general `services` array using `Connect-Maester -Service`
  (Graph, Exchange, Teams, Dataverse, GitHub, SharePoint, Azure, ActiveDirectory).
- `list_available_tags` now uses the official `Get-MtTestInventory` cmdlet
  instead of regex-scraping test files.
- `run_maester_tests` now passes `-NonInteractive -SkipVersionCheck`, reports
  `NotRun` counts, and computes pass rate over executed tests.
- `get_security_posture_summary` now surfaces critical/high failures first,
  matching 2.2's "critical findings sorted first" report behaviour.
- `run_ca_whatif` updated to the current Graph conditional access evaluate shape.
- Increased PowerShell buffer/timeouts for the larger 2.2 suites.

### Notes
- Active Directory testing (269 checks) is on-prem, opt-in, and intentionally
  excluded from `Connect-Maester -Service All`. Wire it in only where the host
  can reach domain controllers.
- Azure DevOps tests require the separate `ADOPS` module and `Connect-ADOPS`.
- For durable history, drift-over-time, and alerting, pair with Maester Cloud
  rather than storing runs here.
