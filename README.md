# hulyctl

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for [Huly](https://huly.app) — the unified workspace for project management, collaboration, and more.

Manage Huly issues directly from **Claude Desktop**, **Cursor**, **Windsurf**, or any MCP-compatible AI client without leaving your workflow.

## Features

- **List Projects** — Browse all tracker projects in your Huly workspace
- **Query Issues** — Search and filter issues by project, assignee, or priority
- **View Issue Details** — Get full issue information including comments
- **Create Issues** — Create new issues with title, description, priority, and assignee
- **Update Issues** — Change status, priority, or reassign issues
- **Add Comments** — Add plain text or Markdown comments to any issue

## Prerequisites

- **Node.js** >= 20
- **npm** (comes with Node.js)
- A **Huly** account with an existing workspace
- A **GitHub Personal Access Token** (read-only packages scope) — required to install `@hcengineering/*` packages from the GitHub npm registry

## Setup

### 1. GitHub npm Registry Access

Create a `.npmrc` file in the project root:

```
@hcengineering:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

Replace `YOUR_GITHUB_PAT` with a GitHub Personal Access Token that has the `read:packages` scope.

### 2. Install Dependencies

```bash
npm install
```

### 3. Build

```bash
npm run build
```

This compiles TypeScript to the `dist/` directory.

## Configuration

`hulyctl` is configured via environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `HULY_URL` | No | Huly instance URL. Defaults to `https://huly.app` |
| `HULY_EMAIL` | Yes | Your Huly account email |
| `HULY_PASSWORD` | Yes | Your Huly account password |
| `HULY_WORKSPACE` | Yes | Your Huly workspace name |

## Usage with Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "huly": {
      "command": "node",
      "args": ["/absolute/path/to/hulyctl/dist/index.js"],
      "env": {
        "HULY_URL": "https://huly.app",
        "HULY_EMAIL": "you@example.com",
        "HULY_PASSWORD": "your-password",
        "HULY_WORKSPACE": "your-workspace"
      }
    }
  }
}
```

## Usage with Cursor / Windsurf

In your MCP settings, configure:

```json
{
  "mcpServers": {
    "huly": {
      "command": "node",
      "args": ["/absolute/path/to/hulyctl/dist/index.js"],
      "env": {
        "HULY_URL": "https://huly.app",
        "HULY_EMAIL": "you@example.com",
        "HULY_PASSWORD": "your-password",
        "HULY_WORKSPACE": "your-workspace"
      }
    }
  }
}
```

## Usage with Zed

Add the following to your Zed `settings.json` under the `context_servers` key:

```json
{
  "context_servers": {
    "huly": {
      "command": "node",
      "args": ["/absolute/path/to/hulyctl/dist/index.js"],
      "env": {
        "HULY_URL": "https://huly.app",
        "HULY_EMAIL": "you@example.com",
        "HULY_PASSWORD": "your-password",
        "HULY_WORKSPACE": "your-workspace"
      }
    }
  }
}
```

## Available Tools

Once connected, the following tools are available to your AI client:

### `list_projects`

List all tracker projects in the Huly workspace.

### `list_issues`

Query issues with optional filters. Returns title, status, priority, assignee, and identifier (e.g. `PROJ-12`).

**Parameters:**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project_id` | string | No | Filter by project `_id` (from `list_projects`) |
| `assignee_id` | string | No | Filter by assignee member `_id` |
| `priority` | string | No | Filter by priority: `urgent`, `high`, `medium`, `low`, `noPriority` |
| `limit` | number | No | Max results to return (default: 50) |

### `get_issue`

Get full details of a single issue by its `_id`, including comments.

**Parameters:**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `issue_id` | string | Yes | The `_id` of the issue |

### `create_issue`

Create a new issue in a project.

**Parameters:**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `project_id` | string | Yes | The `_id` of the project |
| `title` | string | Yes | Title of the issue |
| `description` | string | No | Description (plain text or Markdown) |
| `priority` | string | No | Priority: `urgent`, `high`, `medium`, `low`, `noPriority` |
| `assignee_id` | string | No | Assignee member `_id` |



### `update_issue`

Update status, priority, or assignee of an issue.

**Parameters:**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `issue_id` | string | Yes | The `_id` of the issue to update |
| `space_id` | string | Yes | The `_id` of the project that owns this issue |
| `status_id` | string | No | New status `_id` (from `list_projects`) |
| `priority` | string | No | New priority |
| `assignee_id` | string | No | New assignee member `_id`, or `null` to unassign |

### `add_comment`

Add a comment to an issue.

**Parameters:**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `issue_id` | string | Yes | The `_id` of the issue |
| `space_id` | string | Yes | The `_id` of the project that owns this issue |
| `text` | string | Yes | Comment text (plain text or Markdown) |

## Development

Run the server in development mode with hot-reloading:

```bash
npm run dev
```

## Project Structure

```
hulyctl/
├── src/
│   └── index.ts        # MCP server implementation and tool handlers
├── dist/               # Compiled JavaScript output
├── package.json
├── tsconfig.json
├── .npmrc              # GitHub npm registry auth
└── .env                # Environment variables (not committed)
```

## License

[MIT](LICENSE)
