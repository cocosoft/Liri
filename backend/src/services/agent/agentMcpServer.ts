/**
 * Agent MCP服务器支持
 */

import { McpServerConfig } from '../mcp/types';

/**
 * Agent MCP服务器规格
 * 可以是对现有服务器的引用（通过名称），或内联定义
 */
export type AgentMcpServerSpec = 
  | string // 通过名称引用现有服务器（例如 "slack"）
  | { [name: string]: McpServerConfig }; // 内联定义为 { name: config }

/**
 * 检查Agent是否具有所需的MCP服务器
 */
export function hasRequiredMcpServers(
  agent: { requiredMcpServers?: string[] },
  availableServers: string[]
): boolean {
  if (!agent.requiredMcpServers || agent.requiredMcpServers.length === 0) {
    return true;
  }
  
  // 每个必需的模式必须匹配至少一个可用服务器（不区分大小写）
  return agent.requiredMcpServers.every(pattern =>
    availableServers.some(server =>
      server.toLowerCase().includes(pattern.toLowerCase())
    )
  );
}

/**
 * 根据MCP服务器要求过滤Agent
 */
export function filterAgentsByMcpRequirements<T extends { requiredMcpServers?: string[] }>(
  agents: T[],
  availableServers: string[]
): T[] {
  return agents.filter(agent => hasRequiredMcpServers(agent, availableServers));
}
