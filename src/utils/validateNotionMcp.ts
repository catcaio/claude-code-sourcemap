import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { listMCPServers } from '../services/mcpClient.js'
import type {
  McpServerConfig,
  McpStdioServerConfig,
} from './config.js'

export type NotionMcpValidationResult = {
  isConfigured: boolean
  serverName?: string
  configValidation: {
    isValid: boolean
    errors: string[]
  }
  connectionValidation?: {
    isConnected: boolean
    error?: string
  }
  toolsValidation?: {
    tools: string[]
    hasExpectedTools: boolean
    missingTools: string[]
  }
}

// Known Notion MCP package identifiers
const NOTION_MCP_IDENTIFIERS = [
  'notion-mcp-server',
  '@notionhq/notion-mcp-server',
  '@modelcontextprotocol/server-notion',
]

// Minimum set of tools expected from the Notion MCP server
const NOTION_EXPECTED_TOOLS = ['search', 'retrieve-page', 'create-page']

const CONNECTION_TIMEOUT_MS = 10000

function isStdioConfig(config: McpServerConfig): config is McpStdioServerConfig {
  return config.type !== 'sse'
}

function isNotionServer(name: string, config: McpServerConfig): boolean {
  if (name.toLowerCase().includes('notion')) return true

  if (isStdioConfig(config)) {
    const commandAndArgs = [config.command, ...(config.args ?? [])].join(' ')
    if (NOTION_MCP_IDENTIFIERS.some(id => commandAndArgs.includes(id))) {
      return true
    }
    if (config.env?.['NOTION_API_KEY']) return true
  }

  return false
}

function validateNotionConfig(
  config: McpServerConfig,
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!isStdioConfig(config)) {
    if (!config.url) {
      errors.push('SSE server URL is required')
    }
  } else {
    if (!config.command) {
      errors.push('Server command is required')
    }

    const hasApiKey =
      config.env?.['NOTION_API_KEY'] || process.env['NOTION_API_KEY']

    if (!hasApiKey) {
      errors.push('NOTION_API_KEY environment variable is not set')
    }
  }

  return { isValid: errors.length === 0, errors }
}

async function connectAndValidate(
  serverName: string,
  config: McpServerConfig,
): Promise<{
  connectionValidation: { isConnected: boolean; error?: string }
  toolsValidation?: {
    tools: string[]
    hasExpectedTools: boolean
    missingTools: string[]
  }
}> {
  let client: Client | null = null

  try {
    const transport = isStdioConfig(config)
      ? new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: {
            ...process.env,
            ...config.env,
          } as Record<string, string>,
          stderr: 'pipe',
        })
      : new SSEClientTransport(new URL(config.url))

    client = new Client(
      { name: 'claude-validator', version: '0.1.0' },
      { capabilities: {} },
    )

    const connectPromise = client.connect(transport)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Connection to "${serverName}" timed out after ${CONNECTION_TIMEOUT_MS}ms`,
            ),
          ),
        CONNECTION_TIMEOUT_MS,
      ),
    )

    await Promise.race([connectPromise, timeoutPromise])

    const capabilities = await client.getServerCapabilities()

    if (!capabilities?.tools) {
      return {
        connectionValidation: { isConnected: true },
        toolsValidation: {
          tools: [],
          hasExpectedTools: false,
          missingTools: [...NOTION_EXPECTED_TOOLS],
        },
      }
    }

    const toolsResult = await client.request(
      { method: 'tools/list' },
      ListToolsResultSchema,
    )

    const toolNames = toolsResult.tools.map(t => t.name)
    const missingTools = NOTION_EXPECTED_TOOLS.filter(
      expected => !toolNames.some(t => t.includes(expected) || expected.includes(t)),
    )

    return {
      connectionValidation: { isConnected: true },
      toolsValidation: {
        tools: toolNames,
        hasExpectedTools: missingTools.length === 0,
        missingTools,
      },
    }
  } catch (error) {
    return {
      connectionValidation: {
        isConnected: false,
        error: error instanceof Error ? error.message : String(error),
      },
    }
  } finally {
    try {
      await client?.close()
    } catch {
      // ignore close errors
    }
  }
}

export async function validateNotionMcp(): Promise<NotionMcpValidationResult> {
  const allServers = listMCPServers()

  const notionEntry = Object.entries(allServers).find(([name, config]) =>
    isNotionServer(name, config),
  )

  if (!notionEntry) {
    return {
      isConfigured: false,
      configValidation: {
        isValid: false,
        errors: ['No Notion MCP server found in configuration'],
      },
    }
  }

  const [serverName, config] = notionEntry
  const configValidation = validateNotionConfig(config)

  if (!configValidation.isValid) {
    return {
      isConfigured: true,
      serverName,
      configValidation,
    }
  }

  const { connectionValidation, toolsValidation } = await connectAndValidate(
    serverName,
    config,
  )

  return {
    isConfigured: true,
    serverName,
    configValidation,
    connectionValidation,
    toolsValidation,
  }
}
