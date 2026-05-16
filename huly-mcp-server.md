# Huly MCP Server — Build Instructions

A TypeScript MCP server that connects Claude Desktop to Huly via the `@hcengineering/api-client` package. Uses stdio transport.

---

## Project Structure

```
huly-mcp/
├── src/
│   └── index.ts          # MCP server entry point (all tools here)
├── package.json
├── tsconfig.json
└── .npmrc                # Required for GitHub Packages registry
```

---

## Prerequisites

### GitHub Personal Access Token (for npm registry)

`@hcengineering/api-client` is published on GitHub Packages, not the public npm registry. You need a GitHub PAT with `read:packages` scope.

1. Go to https://github.com/settings/tokens
2. Generate a classic token with `read:packages` scope
3. Store it — you'll need it in `.npmrc`

---

## File Contents

### `.npmrc`

```
@hcengineering:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT_HERE
```

### `package.json`

```json
{
  "name": "huly-mcp",
  "version": "1.0.0",
  "description": "MCP server for Huly issue tracker",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "@hcengineering/api-client": "^0.6.0",
    "@hcengineering/core": "^0.6.0",
    "@hcengineering/tracker": "^0.6.0",
    "@hcengineering/chunter": "^0.6.0",
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.0"
  }
}
```

> **Note on versions:** Check the latest versions at https://github.com/orgs/hcengineering/packages — the `^0.6.0` above should match the version your Huly workspace is running. Mismatched model versions will cause class resolution errors.

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## `src/index.ts` — Full Implementation

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { connect } from '@hcengineering/api-client'
import tracker from '@hcengineering/tracker'
import chunter from '@hcengineering/chunter'
import { SortingOrder } from '@hcengineering/core'

// ── Config from env ──────────────────────────────────────────────────────────

const HULY_URL       = process.env.HULY_URL       ?? 'https://huly.app'
const HULY_EMAIL     = process.env.HULY_EMAIL      ?? ''
const HULY_PASSWORD  = process.env.HULY_PASSWORD   ?? ''
const HULY_WORKSPACE = process.env.HULY_WORKSPACE  ?? ''

if (!HULY_EMAIL || !HULY_PASSWORD || !HULY_WORKSPACE) {
  process.stderr.write('Missing HULY_EMAIL, HULY_PASSWORD or HULY_WORKSPACE env vars\n')
  process.exit(1)
}

// ── Huly client (lazy singleton) ─────────────────────────────────────────────

let hulyClient: Awaited<ReturnType<typeof connect>> | null = null

async function getClient() {
  if (!hulyClient) {
    hulyClient = await connect(HULY_URL, {
      email: HULY_EMAIL,
      password: HULY_PASSWORD,
      workspace: HULY_WORKSPACE,
    })
  }
  return hulyClient
}

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'huly-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

// ── Tool Definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_projects',
      description: 'List all tracker projects in the Huly workspace',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'list_issues',
      description: 'Query issues with optional filters. Returns title, status, priority, assignee, identifier (e.g. PROJ-12).',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: {
            type: 'string',
            description: 'Filter by project _id (from list_projects)',
          },
          assignee_id: {
            type: 'string',
            description: 'Filter by assignee member _id',
          },
          priority: {
            type: 'string',
            enum: ['urgent', 'high', 'medium', 'low', 'noPriority'],
            description: 'Filter by priority',
          },
          limit: {
            type: 'number',
            description: 'Max results to return (default 50)',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_issue',
      description: 'Get full details of a single issue by its _id',
      inputSchema: {
        type: 'object',
        properties: {
          issue_id: {
            type: 'string',
            description: 'The _id of the issue (not the human-readable PROJ-12 identifier)',
          },
        },
        required: ['issue_id'],
      },
    },
    {
      name: 'update_issue',
      description: 'Update status, priority, or assignee of an issue',
      inputSchema: {
        type: 'object',
        properties: {
          issue_id: {
            type: 'string',
            description: 'The _id of the issue to update',
          },
          space_id: {
            type: 'string',
            description: 'The space (_id of the project) that owns this issue — required by updateDoc',
          },
          status_id: {
            type: 'string',
            description: 'New status _id (get from list_projects which includes statuses)',
          },
          priority: {
            type: 'string',
            enum: ['urgent', 'high', 'medium', 'low', 'noPriority'],
            description: 'New priority',
          },
          assignee_id: {
            type: 'string',
            description: 'New assignee member _id, or null to unassign',
          },
        },
        required: ['issue_id', 'space_id'],
      },
    },
    {
      name: 'add_comment',
      description: 'Add a comment to an issue',
      inputSchema: {
        type: 'object',
        properties: {
          issue_id: {
            type: 'string',
            description: 'The _id of the issue',
          },
          space_id: {
            type: 'string',
            description: 'The space (_id of the project) that owns this issue',
          },
          text: {
            type: 'string',
            description: 'Comment text (plain text or markdown)',
          },
        },
        required: ['issue_id', 'space_id', 'text'],
      },
    },
  ],
}))

// ── Tool Handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const client = await getClient()
  const { name, arguments: args } = request.params

  try {
    switch (name) {

      // ── list_projects ──────────────────────────────────────────────────────
      case 'list_projects': {
        const projects = await client.findAll(
          tracker.class.Project,
          {},
          { limit: 100 }
        )
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(projects.map(p => ({
              _id: p._id,
              name: p.name,
              identifier: p.identifier,   // e.g. "PROJ"
              description: p.description,
            })), null, 2),
          }],
        }
      }

      // ── list_issues ────────────────────────────────────────────────────────
      case 'list_issues': {
        const query: Record<string, unknown> = {}
        if (args?.project_id)  query.space     = args.project_id
        if (args?.assignee_id) query.assignee  = args.assignee_id
        if (args?.priority)    query.priority   = args.priority

        const issues = await client.findAll(
          tracker.class.Issue,
          query,
          {
            limit: (args?.limit as number) ?? 50,
            sort: { modifiedOn: SortingOrder.Descending },
          }
        )

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(issues.map(i => ({
              _id:        i._id,
              identifier: i.identifier,   // e.g. "PROJ-12"
              title:      i.title,
              status:     i.status,
              priority:   i.priority,
              assignee:   i.assignee,
              space:      i.space,
              modifiedOn: i.modifiedOn,
            })), null, 2),
          }],
        }
      }

      // ── get_issue ──────────────────────────────────────────────────────────
      case 'get_issue': {
        if (!args?.issue_id) throw new Error('issue_id is required')

        const issue = await client.findOne(
          tracker.class.Issue,
          { _id: args.issue_id as string }
        )

        if (!issue) {
          return { content: [{ type: 'text', text: 'Issue not found' }] }
        }

        // Also fetch comments
        const comments = await client.findAll(
          chunter.class.ChatMessage,
          { attachedTo: args.issue_id as string },
          { sort: { createdOn: SortingOrder.Ascending } }
        )

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              _id:         issue._id,
              identifier:  issue.identifier,
              title:       issue.title,
              description: issue.description,
              status:      issue.status,
              priority:    issue.priority,
              assignee:    issue.assignee,
              space:       issue.space,
              createdOn:   issue.createdOn,
              modifiedOn:  issue.modifiedOn,
              comments:    comments.map(c => ({
                _id:       c._id,
                text:      c.message,
                createdOn: c.createdOn,
                createdBy: c.createdBy,
              })),
            }, null, 2),
          }],
        }
      }

      // ── update_issue ───────────────────────────────────────────────────────
      case 'update_issue': {
        if (!args?.issue_id) throw new Error('issue_id is required')
        if (!args?.space_id) throw new Error('space_id is required')

        const updates: Record<string, unknown> = {}
        if (args.status_id   !== undefined) updates.status   = args.status_id
        if (args.priority    !== undefined) updates.priority  = args.priority
        if (args.assignee_id !== undefined) updates.assignee = args.assignee_id ?? null

        if (Object.keys(updates).length === 0) {
          return { content: [{ type: 'text', text: 'No fields to update provided' }] }
        }

        await client.updateDoc(
          tracker.class.Issue,
          args.space_id as string,
          args.issue_id as string,
          updates
        )

        return { content: [{ type: 'text', text: 'Issue updated successfully' }] }
      }

      // ── add_comment ────────────────────────────────────────────────────────
      case 'add_comment': {
        if (!args?.issue_id) throw new Error('issue_id is required')
        if (!args?.space_id) throw new Error('space_id is required')
        if (!args?.text)     throw new Error('text is required')

        await client.addCollection(
          chunter.class.ChatMessage,
          args.space_id as string,
          args.issue_id as string,
          tracker.class.Issue,
          'comments',
          { message: args.text as string }
        )

        return { content: [{ type: 'text', text: 'Comment added successfully' }] }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    }
  }
})

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('Huly MCP server running on stdio\n')
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`)
  process.exit(1)
})
```

---

## Key Implementation Notes

### Class strings used

| Purpose | Class |
|---|---|
| Projects | `tracker.class.Project` |
| Issues | `tracker.class.Issue` |
| Comments | `chunter.class.ChatMessage` |

The `chunter` package handles comments on issues — they are attached documents in the `comments` collection on an issue, not a separate comment class from tracker.

### Priority values

These are numeric enums in the Huly model, but the API client accepts the string form. The actual enum from `@hcengineering/tracker`:

```
0 = noPriority
1 = urgent
2 = high
3 = medium
4 = low
```

If the string form doesn't work at runtime, switch to numeric: `{ priority: 2 }` for high.

### Status IDs

Statuses are per-project documents, not a global enum. Use `list_projects` first — the returned project objects include a `defaultIssueStatus` field. To get all statuses for a project, you may need to query:

```typescript
await client.findAll(tracker.class.IssueStatus, { space: projectId })
```

Consider adding a `list_statuses` tool if you need to show users the available status options.

### `space_id` requirement

`updateDoc` and `addCollection` both require the `space` (project `_id`), not just the document `_id`. This is why `space_id` is a required param on `update_issue` and `add_comment`. Claude will have this from a prior `list_issues` call since each issue returns its `space` field.

### Connection lifecycle

The client is a lazy singleton. For stdio MCP servers this is fine — the process lives as long as Claude Desktop has it open. The WebSocket connection stays alive. If you get connection drop errors in practice, add a reconnect wrapper around `getClient()`.

---

## Build & Run

```bash
# Install deps (needs .npmrc with your GitHub PAT)
npm install

# Build
npm run build

# Test manually
HULY_URL=https://huly.app \
HULY_EMAIL=you@example.com \
HULY_PASSWORD=yourpassword \
HULY_WORKSPACE=your-workspace-name \
node dist/index.js
```

The server will emit `Huly MCP server running on stdio` to stderr and then wait for MCP protocol messages on stdin/stdout.

---

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "huly": {
      "command": "node",
      "args": ["/absolute/path/to/huly-mcp/dist/index.js"],
      "env": {
        "HULY_URL": "https://huly.app",
        "HULY_EMAIL": "you@example.com",
        "HULY_PASSWORD": "yourpassword",
        "HULY_WORKSPACE": "your-workspace-name"
      }
    }
  }
}
```

Replace `/absolute/path/to/huly-mcp` with the actual path. Restart Claude Desktop after saving.

---

## Possible Issues

**`@hcengineering` packages not found** — `.npmrc` is missing or the GitHub PAT doesn't have `read:packages`. Verify with:
```bash
npm whoami --registry=https://npm.pkg.github.com
```

**`tracker is not defined` / class resolution errors** — The `@hcengineering/tracker` version doesn't match your Huly instance's model version. Check the version your workspace runs on and pin accordingly.

**Comments not appearing** — The `collection` name passed to `addCollection` must be `'comments'` exactly as registered in the tracker model. If comments don't show up, inspect an existing comment object's `collection` field to confirm.

**`space_id` errors on update** — Every mutating operation needs the correct space. If you only have the issue `_id`, do a `findOne` first to get `issue.space`, then pass that as `space_id`.
