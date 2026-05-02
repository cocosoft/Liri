import { createToolManager } from '../../../tools/ToolManager.js';
import type { CommandContext } from '../../types/index.js';
const call = async (
  args: string,
  _context: CommandContext
): Promise<{ type: 'text'; value: string }> => {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase();

  if (!subcommand || subcommand === 'help') {
    return {
      type: 'text',
      value: `Tool Command Help
=====================

Usage:
  /tool list                      - List all available tools
  /tool info <tool_name>          - Show tool details

Examples:
  /tool list
  /tool info file_read`,
    };
  }

  if (subcommand === 'list') {
    const toolManager = createToolManager();
    const registry = toolManager.getRegistry();
    const tools = registry.getTools();

    let output = 'Available Tools\n==================\n\n';
    for (const [name, tool] of tools) {
      const info = tool.getInfo
        ? tool.getInfo()
        : {
            name: tool.name,
            description: tool.description || '',
            params: tool.params || [],
            readOnly: false,
            concurrencySafe: true,
          };
      output += `Tool: ${name}\n`;
      output += `  Description: ${info.description || 'No description'}\n`;
      output += `  Read Only: ${info.readOnly ? 'Yes' : 'No'}\n`;
      output += `  Concurrent Safe: ${info.concurrencySafe ? 'Yes' : 'No'}\n`;
      const paramStr =
        info.params
          .map((p: any) => `${p.name}${p.required ? '*' : ''}`)
          .join(', ') || 'None';
      output += `  Parameters: ${paramStr}\n\n`;
    }
    output += `\nTotal: ${tools.size} tools`;

    return { type: 'text', value: output };
  }

  if (subcommand === 'info') {
    const toolName = parts[1];
    if (!toolName) {
      return {
        type: 'text',
        value: 'Error: Please specify tool name\nUsage: /tool info <tool_name>',
      };
    }

    const toolManager = createToolManager();
    const registry = toolManager.getRegistry();
    const tool = registry.getTool(toolName);

    if (!tool) {
      return { type: 'text', value: `Error: Tool not found: ${toolName}` };
    }

    const info = tool.getInfo();
    let output = `Tool Info: ${info.name}\n`;
    output += '==================\n\n';
    output += `Description: ${info.description}\n`;
    output += `Aliases: ${info.aliases?.join(', ') || 'None'}\n`;
    output += `Search Tips: ${info.searchTips?.join(', ') || 'None'}\n`;
    output += `Enabled: ${info.enabled ? 'Yes' : 'No'}\n`;
    output += `Read Only: ${info.readOnly ? 'Yes' : 'No'}\n`;
    output += `Destructive: ${info.destructive ? 'Yes' : 'No'}\n`;
    output += `Concurrent Safe: ${info.concurrencySafe ? 'Yes' : 'No'}\n\n`;
    output += 'Parameters:\n';
    for (const param of info.params) {
      output += `  - ${param.name}${param.required ? '*' : ''} (${param.type})\n`;
      output += `    ${param.description}\n`;
      if (param.default !== undefined) {
        output += `    Default: ${param.default}\n`;
      }
    }

    return { type: 'text', value: output };
  }

  return {
    type: 'text',
    value: `Error: Unknown subcommand: ${subcommand}\n\nUse /tool help for help`,
  };
};

export default { call };
