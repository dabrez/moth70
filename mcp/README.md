# @moth70/mcp

An MCP server that gives coding agents direct access to Moth70 bug reports.

The workflow it enables: someone reports a bug from the browser extension, then a
developer tells their agent *"fix the open bugs on checkout"*. The agent lists the
reports, pulls the full evidence bundle for one, fixes it, and marks it resolved —
without leaving the editor.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_bugs` | List reports, newest first. Filter by `status`, `severity`, `domain`, or free-text `search`. |
| `get_bug` | Fetch one report's complete evidence bundle as markdown. |
| `update_bug_status` | Move a report to `open`, `acknowledged`, `in-progress`, `resolved`, or `closed`. |

`get_bug` returns the same document as `GET /api/reports/:id?format=md`: the failing
URL, reported steps, the **observed click path reconstructed from the session
recording**, JavaScript exceptions with stack traces, console output, failed network
requests, and the full browser/OS environment — everything needed to reproduce a bug,
in one response with no links to follow.

## Setup

```bash
cd mcp
npm install
npm run build
```

The server talks to the Moth70 HTTP API, so that app needs to be running.

### Claude Code

```bash
claude mcp add moth70 -- node /absolute/path/to/moth70/mcp/dist/index.js
```

### Any MCP client (`mcp.json`)

```json
{
  "mcpServers": {
    "moth70": {
      "command": "node",
      "args": ["/absolute/path/to/moth70/mcp/dist/index.js"],
      "env": { "MOTH70_URL": "http://localhost:3000" }
    }
  }
}
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOTH70_URL` | `http://localhost:3000` | Base URL of the Moth70 instance. |
| `MOTH70_API_KEY` | _(unset)_ | Sent as `Authorization: Bearer …`. Ignored by the current API, which has no auth yet. |

## Notes

- Input values are never exported. The extension records with `maskAllInputs`, so the
  click path reports *that* a field was typed into and how many keystrokes it took,
  never the content.
- Screenshots are not inlined — they are stored as data URIs and would flood an agent's
  context. The export links to the report page instead.
- All errors are returned as MCP error results rather than thrown, so an agent can
  recover and retry instead of losing the connection.
