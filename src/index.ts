#!/usr/bin/env node
import { WebSocket } from "ws";
// @ts-ignore — polyfill WebSocket for @hcengineering/api-client
globalThis.WebSocket ??= WebSocket;
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { connect } from "@hcengineering/api-client";
import tracker from "@hcengineering/tracker";
import chunter from "@hcengineering/chunter";
import core, { SortingOrder, generateId } from "@hcengineering/core";
import { makeRank } from "@hcengineering/rank";

// ── Config from env ──────────────────────────────────────────────────────────

const HULY_URL = process.env.HULY_URL ?? "https://huly.app";
const HULY_EMAIL = process.env.HULY_EMAIL ?? "";
const HULY_PASSWORD = process.env.HULY_PASSWORD ?? "";
const HULY_WORKSPACE = process.env.HULY_WORKSPACE ?? "";

if (!HULY_EMAIL || !HULY_PASSWORD || !HULY_WORKSPACE) {
  process.stderr.write(
    "Missing HULY_EMAIL, HULY_PASSWORD or HULY_WORKSPACE env vars\n",
  );
  process.exit(1);
}

// ── Huly client (lazy singleton) ─────────────────────────────────────────────

let hulyClient: Awaited<ReturnType<typeof connect>> | null = null;

async function getClient() {
  if (!hulyClient) {
    hulyClient = await connect(HULY_URL, {
      email: HULY_EMAIL,
      password: HULY_PASSWORD,
      workspace: HULY_WORKSPACE,
    });
  }
  return hulyClient;
}

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "huly-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ── Tool Definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_projects",
      description: "List all tracker projects in the Huly workspace",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "list_issues",
      description:
        "Query issues with optional filters. Returns title, status, priority, assignee, identifier (e.g. PROJ-12).",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Filter by project _id (from list_projects)",
          },
          assignee_id: {
            type: "string",
            description: "Filter by assignee member _id",
          },
          priority: {
            type: "string",
            enum: ["urgent", "high", "medium", "low", "noPriority"],
            description: "Filter by priority",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 50)",
          },
        },
        required: [],
      },
    },
    {
      name: "get_issue",
      description: "Get full details of a single issue by its _id",
      inputSchema: {
        type: "object",
        properties: {
          issue_id: {
            type: "string",
            description:
              "The _id of the issue (not the human-readable PROJ-12 identifier)",
          },
        },
        required: ["issue_id"],
      },
    },
    {
      name: "update_issue",
      description: "Update status, priority, or assignee of an issue",
      inputSchema: {
        type: "object",
        properties: {
          issue_id: {
            type: "string",
            description: "The _id of the issue to update",
          },
          space_id: {
            type: "string",
            description:
              "The space (_id of the project) that owns this issue — required by updateDoc",
          },
          status_id: {
            type: "string",
            description:
              "New status _id (get from list_projects which includes statuses)",
          },
          priority: {
            type: "string",
            enum: ["urgent", "high", "medium", "low", "noPriority"],
            description: "New priority",
          },
          assignee_id: {
            type: "string",
            description: "New assignee member _id, or null to unassign",
          },
        },
        required: ["issue_id", "space_id"],
      },
    },
    {
      name: "add_comment",
      description: "Add a comment to an issue",
      inputSchema: {
        type: "object",
        properties: {
          issue_id: {
            type: "string",
            description: "The _id of the issue",
          },
          space_id: {
            type: "string",
            description: "The space (_id of the project) that owns this issue",
          },
          text: {
            type: "string",
            description: "Comment text (plain text or markdown)",
          },
        },
        required: ["issue_id", "space_id", "text"],
      },
    },
    {
      name: "create_issue",
      description: "Create a new issue in a project",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description:
              "The _id of the project to create the issue in (from list_projects)",
          },
          title: {
            type: "string",
            description: "Title of the issue",
          },
          description: {
            type: "string",
            description: "Description of the issue (plain text or markdown)",
          },
          priority: {
            type: "string",
            enum: ["urgent", "high", "medium", "low", "noPriority"],
            description: "Priority of the issue (default: noPriority)",
          },
          assignee_id: {
            type: "string",
            description: "Assignee member _id",
          },
        },
        required: ["project_id", "title"],
      },
    },
    {
      name: "create_sub_issue",
      description: "Create a sub-issue under an existing parent issue",
      inputSchema: {
        type: "object",
        properties: {
          parent_issue_id: {
            type: "string",
            description: "The _id of the parent issue",
          },
          space_id: {
            type: "string",
            description:
              "The space (_id of the project) that owns the parent issue",
          },
          title: {
            type: "string",
            description: "Title of the sub-issue",
          },
          description: {
            type: "string",
            description:
              "Description of the sub-issue (plain text or markdown)",
          },
          priority: {
            type: "string",
            enum: ["urgent", "high", "medium", "low", "noPriority"],
            description:
              "Priority of the sub-issue (default: inherits parent priority)",
          },
          assignee_id: {
            type: "string",
            description: "Assignee member _id",
          },
        },
        required: ["parent_issue_id", "space_id", "title"],
      },
    },
  ],
}));

// ── Tool Handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const client = await getClient();
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── list_projects ──────────────────────────────────────────────────────
      case "list_projects": {
        const projects = await client.findAll(
          tracker.class.Project,
          {},
          { limit: 100 },
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                projects.map((p) => ({
                  _id: p._id,
                  name: p.name,
                  identifier: p.identifier,
                  description: p.description,
                })),
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── list_issues ────────────────────────────────────────────────────────
      case "list_issues": {
        const query: Record<string, unknown> = {};
        if (args?.project_id) query.space = args.project_id;
        if (args?.assignee_id) query.assignee = args.assignee_id;
        if (args?.priority) query.priority = args.priority;

        const issues = await client.findAll(tracker.class.Issue, query, {
          limit: (args?.limit as number) ?? 50,
          sort: { modifiedOn: SortingOrder.Descending },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                issues.map((i) => ({
                  _id: i._id,
                  identifier: i.identifier,
                  title: i.title,
                  status: i.status,
                  priority: i.priority,
                  assignee: i.assignee,
                  space: i.space,
                  modifiedOn: i.modifiedOn,
                })),
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── get_issue ──────────────────────────────────────────────────────────
      case "get_issue": {
        if (!args?.issue_id) throw new Error("issue_id is required");

        const issue = await client.findOne(tracker.class.Issue, {
          _id: args.issue_id as string,
        });

        if (!issue) {
          return { content: [{ type: "text", text: "Issue not found" }] };
        }

        const comments = await client.findAll(
          chunter.class.ChatMessage,
          { attachedTo: args.issue_id as string },
          { sort: { createdOn: SortingOrder.Ascending } },
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  _id: issue._id,
                  identifier: issue.identifier,
                  title: issue.title,
                  description: issue.description,
                  status: issue.status,
                  priority: issue.priority,
                  assignee: issue.assignee,
                  space: issue.space,
                  createdOn: issue.createdOn,
                  modifiedOn: issue.modifiedOn,
                  comments: comments.map((c) => ({
                    _id: c._id,
                    text: c.message,
                    createdOn: c.createdOn,
                    createdBy: c.createdBy,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── update_issue ───────────────────────────────────────────────────────
      case "update_issue": {
        if (!args?.issue_id) throw new Error("issue_id is required");
        if (!args?.space_id) throw new Error("space_id is required");

        const updates: Record<string, unknown> = {};
        if (args.status_id !== undefined) updates.status = args.status_id;
        if (args.priority !== undefined) updates.priority = args.priority;
        if (args.assignee_id !== undefined)
          updates.assignee = args.assignee_id ?? null;

        if (Object.keys(updates).length === 0) {
          return {
            content: [{ type: "text", text: "No fields to update provided" }],
          };
        }

        await client.updateDoc(
          tracker.class.Issue,
          args.space_id as string,
          args.issue_id as string,
          updates,
        );

        return {
          content: [{ type: "text", text: "Issue updated successfully" }],
        };
      }

      // ── add_comment ────────────────────────────────────────────────────────
      case "add_comment": {
        if (!args?.issue_id) throw new Error("issue_id is required");
        if (!args?.space_id) throw new Error("space_id is required");
        if (!args?.text) throw new Error("text is required");

        await client.addCollection(
          chunter.class.ChatMessage,
          args.space_id as string,
          args.issue_id as string,
          tracker.class.Issue,
          "comments",
          { message: args.text as string },
        );

        return {
          content: [{ type: "text", text: "Comment added successfully" }],
        };
      }

      // ── create_issue ──────────────────────────────────────────────────────
      case "create_issue": {
        if (!args?.project_id) throw new Error("project_id is required");
        if (!args?.title) throw new Error("title is required");

        const project = await client.findOne(tracker.class.Project, {
          _id: args.project_id as string,
        });
        if (!project) throw new Error("Project not found");

        // Generate unique issue ID
        const issueId = generateId();

        // Increment project sequence to get next issue number
        const incResult = await client.updateDoc(
          tracker.class.Project,
          core.space.Space,
          project._id,
          { $inc: { sequence: 1 } },
          true,
        );
        const sequence = (incResult as any).object.sequence;

        // Get rank of last issue to insert after it
        const lastIssue = await client.findOne(
          tracker.class.Issue,
          { space: project._id },
          { sort: { rank: SortingOrder.Descending } },
        );

        const priority = (args.priority as string) ?? "noPriority";

        // Create the issue
        await client.addCollection(
          tracker.class.Issue,
          project._id,
          project._id,
          project._class,
          "issues",
          {
            title: args.title as string,
            description: (args.description as string) ?? "",
            status: project.defaultIssueStatus,
            number: sequence,
            kind: tracker.taskTypes.Issue,
            identifier: `${project.identifier}-${sequence}`,
            priority,
            assignee: (args.assignee_id as string) ?? null,
            component: null,
            estimation: 0,
            remainingTime: 0,
            reportedTime: 0,
            reports: 0,
            subIssues: 0,
            parents: [],
            childInfo: [],
            dueDate: null,
            rank: makeRank(lastIssue?.rank, undefined),
          },
          issueId,
        );

        const created = await client.findOne(tracker.class.Issue, {
          _id: issueId,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  _id: created?._id,
                  identifier: created?.identifier,
                  title: created?.title,
                  priority: created?.priority,
                  assignee: created?.assignee,
                  space: created?.space,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── create_sub_issue ──────────────────────────────────────────────────
      case "create_sub_issue": {
        if (!args?.parent_issue_id)
          throw new Error("parent_issue_id is required");
        if (!args?.space_id) throw new Error("space_id is required");
        if (!args?.title) throw new Error("title is required");

        // Fetch parent issue
        const parent = await client.findOne(tracker.class.Issue, {
          _id: args.parent_issue_id as string,
        });
        if (!parent) throw new Error("Parent issue not found");

        // Fetch project
        const project = await client.findOne(tracker.class.Project, {
          _id: args.space_id as string,
        });
        if (!project) throw new Error("Project not found");

        // Generate unique issue ID
        const subIssueId = generateId();

        // Increment project sequence
        const incResult = await client.updateDoc(
          tracker.class.Project,
          core.space.Space,
          project._id,
          { $inc: { sequence: 1 } },
          true,
        );
        const sequence = (incResult as any).object.sequence;

        // Get rank of last issue to insert after it
        const lastIssue = await client.findOne(
          tracker.class.Issue,
          { space: project._id },
          { sort: { rank: SortingOrder.Descending } },
        );

        const priority = (args.priority as string) ?? parent.priority;

        // Create the sub-issue with parent reference
        await client.addCollection(
          tracker.class.Issue,
          project._id,
          project._id,
          project._class,
          "issues",
          {
            title: args.title as string,
            description: (args.description as string) ?? "",
            status: project.defaultIssueStatus,
            number: sequence,
            kind: tracker.taskTypes.Issue,
            identifier: `${project.identifier}-${sequence}`,
            priority,
            assignee: (args.assignee_id as string) ?? parent.assignee,
            component: null,
            estimation: 0,
            remainingTime: 0,
            reportedTime: 0,
            reports: 0,
            subIssues: 0,
            parents: [
              {
                _id: parent._id,
                identifier: parent.identifier,
                title: parent.title,
                space: parent.space,
              },
            ],
            childInfo: [],
            dueDate: null,
            rank: makeRank(lastIssue?.rank, undefined),
          },
          subIssueId,
        );

        // Update parent's subIssues count and childInfo
        const updatedChildInfo = [
          ...((parent as any).childInfo ?? []),
          {
            _id: subIssueId,
            identifier: `${project.identifier}-${sequence}`,
            title: args.title,
            space: project._id,
          },
        ];

        await client.updateDoc(
          tracker.class.Issue,
          args.space_id as string,
          args.parent_issue_id as string,
          {
            subIssues: ((parent as any).subIssues ?? 0) + 1,
            childInfo: updatedChildInfo,
          },
        );

        const created = await client.findOne(tracker.class.Issue, {
          _id: subIssueId,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  _id: created?._id,
                  identifier: created?.identifier,
                  title: created?.title,
                  priority: created?.priority,
                  assignee: created?.assignee,
                  space: created?.space,
                  parentIssue: parent.identifier,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Huly MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
