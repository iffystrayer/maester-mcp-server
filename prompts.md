# Ready-to-use prompts

Copy-paste prompts for any MCP-compatible client connected to this server
(Claude Desktop, Claude Code, GitHub Copilot, Cursor, etc.). Each is tuned to
trigger a clean tool chain — the tools it fires are noted so you learn the
mapping as you go.

> **Prerequisite:** the server needs (1) PowerShell + the Maester module and
> (2) Azure auth configured before any of these will return real data. See the
> [setup section in the README](./README.md).

---

## 🟢 Posture check (start here)

> **Run the core Entra ID security checks against our tenant, give me the
> overall posture summary, then list just the failures sorted by severity.**

*Fires:* `run_maester_tests` → `get_security_posture_summary` → `get_failed_tests`

One sentence, touches the whole core workflow. Summary-first framing means you
get the headline before the noise.

---

## 🎯 Scope a run by tag

> **List all the available test tags, then run only the MFA and Conditional
> Access checks and summarize the results.**

*Fires:* `list_available_tags` → `run_maester_tests(tags:["MFA","CA"])` → `get_security_posture_summary`

Maester tests are tagged — you don't have to run all hundreds every time.
Other useful scopes: `CISA`, `CIS`, `Defender`, `Privileged`, `AIAgent`.

---

## 🔍 Deep-dive one failure (the remediation loop)

> **Get the detail for the highest-severity failure from the last run — I want
> the description, why it matters, the remediation steps, and the help URL.**

*Fires:* `get_test_detail(testId: …)` (after a prior run)

This is where MCP earns its keep — raw test IDs like `EIDSCA.AF01` become
"here's the fix." Ask it to paste the remediation PowerShell too if you want
to act.

---

## 📉 Drift / "what changed?"

> **Compare today's MFA and CA checks against our baseline and tell me what
> regressed.**

*Fires:* `run_maester_tests(useDrift: true, tags:["MFA","CA"])` → `get_failed_tests`

**Prerequisite:** snapshot a known-good result into `MAESTER_DRIFT_ROOT` once.
Catches silent config regressions ("someone disabled a CA policy") that a
one-off scan would miss.

---

## 🤖 AI agent audit (signature 2.2 use case)

> **Audit our AI attack surface — check all Copilot Studio agents and connected
> MCP servers for risky sharing, missing authentication, and exfiltration
> paths.**

*Fires:* `audit_ai_agents(services:["Graph","Dataverse"])`

**Prerequisite:** the `Dataverse` service is connected (Copilot Studio lives
there). The reflexive angle — the agent you're chatting with polices your org's
*other* agents.

---

## 🧪 Conditional Access simulator (no test run needed)

> **Simulate a sign-in for `alice@contoso.com` from IP 203.0.113.5 into the
> Azure portal from an unmanaged macOS device, and show me which Conditional
> Access policies would block or grant access.**

*Fires:* `run_ca_whatif(userId, ipAddress, devicePlatform, …)`

Answers "would this user actually get blocked?" against your real policies —
great for access reviews and onboarding edge cases. No test suite required.

---

## 🛠️ Keep the test suite current

> **Update Maester to the latest version and tell me what changed.**

*Fires:* `update_maester_tests`

Maester ships new tests frequently. Run this monthly, then re-run your baseline
to see findings from newly-added checks.

---

## 💡 Pro patterns to combine

- **Run, summarize, draft a fix:** *"Run the CISA checks, summarize failures,
  and draft a remediation plan I can hand to my IAM team."*
- **Explain like I'm new:** *"Run the Privileged-account checks, then explain
  each failure to me as if I'm new to Entra ID — include the risk and the fix."*
- **Exec summary:** add *"emit a markdown summary"* → triggers `emitMarkdown:
  true`, giving you a paste-ready snippet for a Slack/PR comment.

---

**Tip:** always let the agent read results *through the tools*
(`get_security_posture_summary`, `get_test_detail`) rather than asking it to
read the raw JSON file. The tools pre-digest severity, remediation, and help
links — that's where the real value is.
