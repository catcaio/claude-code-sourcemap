import type { Command } from '../commands.js'
import { validateNotionMcp } from '../utils/validateNotionMcp.js'

const mcpValidateNotion: Command = {
  name: 'mcp-validate-notion',
  description: 'Validates the Notion MCP server configuration and connection',
  isEnabled: true,
  isHidden: false,
  userFacingName() {
    return 'mcp-validate-notion'
  },
  type: 'local',
  async call() {
    const result = await validateNotionMcp()
    const lines: string[] = []

    lines.push('Notion MCP Validation')
    lines.push('─'.repeat(40))

    if (!result.isConfigured) {
      lines.push('✗ Not configured: ' + result.configValidation.errors.join(', '))
      return lines.join('\n')
    }

    lines.push(`✓ Server found: ${result.serverName}`)

    if (result.configValidation.isValid) {
      lines.push('✓ Configuration: valid')
    } else {
      lines.push('✗ Configuration errors:')
      for (const err of result.configValidation.errors) {
        lines.push(`  - ${err}`)
      }
      return lines.join('\n')
    }

    if (result.connectionValidation) {
      if (result.connectionValidation.isConnected) {
        lines.push('✓ Connection: successful')
      } else {
        lines.push(
          `✗ Connection failed: ${result.connectionValidation.error ?? 'unknown error'}`,
        )
        return lines.join('\n')
      }
    }

    if (result.toolsValidation) {
      const { tools, hasExpectedTools, missingTools } = result.toolsValidation
      lines.push(`✓ Tools available (${tools.length}): ${tools.join(', ')}`)
      if (hasExpectedTools) {
        lines.push('✓ Expected Notion tools: all present')
      } else {
        lines.push(`✗ Missing expected tools: ${missingTools.join(', ')}`)
      }
    }

    return lines.join('\n')
  },
}

export default mcpValidateNotion
