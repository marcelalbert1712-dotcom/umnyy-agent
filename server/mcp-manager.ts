import { tool } from "ai";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolConfig } from "./user-settings";

interface McpConnection {
  client: Client;
  serverId: string;
  tools: Array<{ name: string; description?: string; inputSchema: any }>;
}

const connections = new Map<string, McpConnection>();

export async function connectMcpServer(cfg: ToolConfig): Promise<void> {
  if (connections.has(cfg.id)) {
    await disconnectMcpServer(cfg.id);
  }

  const client = new Client(
    { name: "umnyy-agent", version: "1.0.0" },
    { capabilities: {} },
  );

  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args ?? [],
    env: cfg.env as Record<string, string> | undefined,
    stderr: "pipe",
  });

  await client.connect(transport);

  const toolsResult = await client.listTools();
  const mcpTools = (toolsResult.tools ?? []).map((t: any) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema,
  }));

  connections.set(cfg.id, { client, serverId: cfg.id, tools: mcpTools });

  // Handle tool list changes
  client.setRequestHandler(
    { method: "notifications/tools/list_changed" },
    async () => {
      const updated = await client.listTools();
      const entry = connections.get(cfg.id);
      if (entry) {
        entry.tools = (updated.tools ?? []).map((t: any) => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.inputSchema,
        }));
      }
    },
  );
}

export async function disconnectMcpServer(id: string): Promise<void> {
  const entry = connections.get(id);
  if (entry) {
    try { await entry.client.close(); } catch { /* ignore */ }
    connections.delete(id);
  }
}

export async function disconnectAllMcp(): Promise<void> {
  for (const id of connections.keys()) {
    await disconnectMcpServer(id);
  }
}

export function getMcpToolDescriptions(): Array<{
  serverId: string;
  name: string;
  description: string;
  inputSchema: any;
}> {
  const result: Array<{
    serverId: string;
    name: string;
    description: string;
    inputSchema: any;
  }> = [];
  for (const [, conn] of connections) {
    for (const t of conn.tools) {
      result.push({ serverId: conn.serverId, ...t });
    }
  }
  return result;
}

/**
 * Создаёт AI SDK tools для всех подключённых MCP-серверов.
 * Каждый MCP-инструмент оборачивается в `tool()` с динамической схемой.
 */
export function buildMcpAiTools(): Record<string, ReturnType<typeof tool>> {
  const aiTools: Record<string, ReturnType<typeof tool>> = {};

  for (const [, conn] of connections) {
    for (const mcpTool of conn.tools) {
      const toolName = `mcp_${conn.serverId}_${mcpTool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      const serverId = conn.serverId;
      const originalName = mcpTool.name;

      let schema = z.object({});
      try {
        if (mcpTool.inputSchema?.properties) {
          const shape: Record<string, z.ZodTypeAny> = {};
          for (const [key, prop] of Object.entries(mcpTool.inputSchema.properties as Record<string, any>)) {
            let fieldSchema: z.ZodTypeAny;
            if (prop.type === "number") fieldSchema = z.number();
            else if (prop.type === "integer") fieldSchema = z.number().int();
            else if (prop.type === "boolean") fieldSchema = z.boolean();
            else if (prop.type === "array") fieldSchema = z.array(z.any());
            else if (prop.type === "object") fieldSchema = z.record(z.any());
            else fieldSchema = z.string();

            if (mcpTool.inputSchema.required?.includes(key)) {
              shape[key] = fieldSchema.describe(prop.description ?? "");
            } else {
              shape[key] = fieldSchema.optional().describe(prop.description ?? "");
            }
          }
          schema = z.object(shape);
        }
      } catch {
        schema = z.object({});
      }

      aiTools[toolName] = tool({
        description: `[MCP: ${serverId}] ${mcpTool.description || originalName}`,
        inputSchema: schema,
        execute: async (input: any) => {
          const entry = connections.get(serverId);
          if (!entry) return { error: `MCP server "${serverId}" not connected` };
          try {
            const result = await entry.client.callTool({
              name: originalName,
              arguments: input,
            });
            return result;
          } catch (err: any) {
            return { error: err.message ?? String(err) };
          }
        },
      });
    }
  }

  return aiTools;
}
