# Contributing

Contributions are welcome. This project exposes Maester as MCP tools, so most changes fall into one of two categories: adding or adjusting a tool, or keeping the server aligned with Maester releases.

## Development setup

```bash
git clone https://github.com/iffystrayer/maester-mcp-server
cd maester-mcp-server
npm install
npm test
```

`npm test` runs a smoke test that boots the server over stdio, completes the MCP handshake, and asserts the expected tool surface. It does not require PowerShell, Maester, or a tenant, so it runs anywhere Node.js does.

## Adding a tool

Two edits are required in `src/index.js`. Add an entry to the `TOOLS` array describing the tool and its input schema, and add a matching `case` to the handler in the `CallToolRequestSchema` block. If the tool advertises under a new name, update `EXPECTED_TOOLS` in `test/smoke.mjs` so CI stays accurate.

Keep tools thin. They should shell out to a documented public Maester command, parse the result, and return structured data. Business logic belongs in Maester, not here.

## Staying aligned with Maester

The integration surface is the Maester results JSON and a small set of public cmdlets: `Invoke-Maester`, `Connect-Maester`, `Get-MtTestInventory`, `Merge-MtMaesterResult`, `Get-MtHtmlReport`, and `Invoke-MtGraphRequest`. Avoid depending on individual built-in `Test-Mt...` functions, since Maester 3.0 plans to make those private. Route everything through `Invoke-Maester` with tag and service filters.

When a new Maester release ships, check the release notes for changes to the results JSON shape, new service connection names, new tags, and new or renamed cmdlets. Record any behavior change in `CHANGELOG.md`.

## Pull requests

Keep pull requests focused on one change. Run `npm test` before opening a request, and update the README and CHANGELOG when behavior changes.
