// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 插件 MCP 工具暴露服务器。
 * 将已安装插件的命令/技能/代理作为 MCP 工具暴露给外部客户端。
 * 对标: openclaw plugin-tools-serve.ts
 */
import { Logger, LogLevel } from '@modules/monitoring';
import type { MCPToolDefinition } from '../../mcp/types/index.js';
import type { PluginRegistration } from '../../plugins/types/PluginTypes.js';

const logger = new Logger({ module: 'mcp:plugin-tools' });

/** 插件暴露配置 */
export interface PluginMCPToolOptions {
  /** 服务名 */
  name?: string;
  /** 服务版本 */
  version?: string;
}

/**
 * 从插件注册列表创建 MCP 工具定义。
 * 每个插件的命令/技能/代理各生成一个 MCP 工具条目。
 */
export function createPluginMCPTools(
  plugins: readonly PluginRegistration[]
): MCPToolDefinition[] {
  const tools: MCPToolDefinition[] = [];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    const manifest = plugin.manifest;
    if (!manifest) continue;

    // 暴露插件命令
    const commands = manifest.commands as string[] | undefined;
    if (commands) {
      for (const cmd of commands) {
        tools.push({
          name: `plugin_${plugin.id}_${cmd}`,
          description: `Plugin "${plugin.name}" command: ${cmd}`,
          inputSchema: {
            type: 'object',
            properties: {
              pluginId: { type: 'string', const: plugin.id },
              command: { type: 'string', const: cmd },
              args: { type: 'object', description: 'Command arguments' },
            },
          },
        });
      }
    }

    // 暴露插件技能
    const skills = manifest.skills as string[] | undefined;
    if (skills) {
      for (const skill of skills) {
        tools.push({
          name: `plugin_${plugin.id}_skill_${skill}`,
          description: `Plugin "${plugin.name}" skill: ${skill}`,
          inputSchema: {
            type: 'object',
            properties: {
              pluginId: { type: 'string', const: plugin.id },
              skill: { type: 'string', const: skill },
              input: { type: 'string', description: 'Skill input' },
            },
          },
        });
      }
    }

    // 暴露插件代理
    const agents = manifest.agents as string[] | undefined;
    if (agents) {
      for (const agent of agents) {
        tools.push({
          name: `plugin_${plugin.id}_agent_${agent}`,
          description: `Plugin "${plugin.name}" agent: ${agent}`,
          inputSchema: {
            type: 'object',
            properties: {
              pluginId: { type: 'string', const: plugin.id },
              agent: { type: 'string', const: agent },
              prompt: { type: 'string', description: 'Agent prompt' },
            },
          },
        });
      }
    }
  }

  return tools;
}

/**
 * 获取已安装插件的概要信息（供 MCP tools/list 展示）。
 */
export function getPluginSummary(
  plugins: readonly PluginRegistration[]
): Record<string, unknown>[] {
  return plugins
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      commandCount: Array.isArray(p.manifest?.commands)
        ? (p.manifest?.commands as string[]).length
        : 0,
      skillCount: Array.isArray(p.manifest?.skills)
        ? (p.manifest?.skills as string[]).length
        : 0,
      agentCount: Array.isArray(p.manifest?.agents)
        ? (p.manifest?.agents as string[]).length
        : 0,
    }));
}
