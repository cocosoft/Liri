/**
 * MCP Prompt管理器
 * 负责管理MCP服务器的Prompt资源
 * 参考CC源码 cc_code/backend/services/mcp/client.ts 实现
 */

import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { ListPromptsResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@modules/utils/log';

/**
 * Prompt参数
 */
export interface PromptParams {
  name: string;
  arguments?: Record<string, string>;
}

/**
 * Prompt信息
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * Prompt结果
 */
export interface MCPPromptResult {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

/**
 * Prompt内容接口
 */
interface PromptContent {
  type: string;
  text?: string;
  source?: {
    type: string;
    mimeType?: string;
    data?: string;
  };
}

/**
 * MCP Prompt管理器
 */
export class MCPPromptManager {
  private prompts: Map<string, MCPPrompt[]> = new Map();
  private serverCapabilities: Map<string, { prompts?: boolean }> = new Map();

  /**
   * 注册服务器的Prompt能力
   */
  registerServer(
    serverName: string,
    capabilities?: { prompts?: boolean }
  ): void {
    this.serverCapabilities.set(serverName, capabilities || {});
    if (!capabilities?.prompts) {
      logger.debug(`Server ${serverName} does not support prompts`);
    }
  }

  /**
   * 检查服务器是否支持Prompt
   */
  supportsPrompts(serverName: string): boolean {
    const capabilities = this.serverCapabilities.get(serverName);
    return capabilities?.prompts ?? false;
  }

  /**
   * 设置服务器的Prompt列表
   */
  setPrompts(serverName: string, prompts: MCPPrompt[]): void {
    this.prompts.set(serverName, prompts);
    logger.debug(
      `Updated prompts for ${serverName}: ${prompts.length} prompts`
    );
  }

  /**
   * 获取服务器的Prompt列表
   */
  getPrompts(serverName: string): MCPPrompt[] {
    return this.prompts.get(serverName) || [];
  }

  /**
   * 获取所有服务器的Prompt
   */
  getAllPrompts(): Map<string, MCPPrompt[]> {
    return new Map(this.prompts);
  }

  /**
   * 列出所有Prompt
   */
  listPrompts(): Array<{ server: string; prompt: MCPPrompt }> {
    const result: Array<{ server: string; prompt: MCPPrompt }> = [];
    const entries = Array.from(this.prompts.entries());

    for (const [server, prompts] of entries) {
      for (const prompt of prompts) {
        result.push({ server, prompt });
      }
    }

    return result;
  }

  /**
   * 处理Prompt列表响应
   */
  handleListPromptsResponse(
    serverName: string,
    response: ListPromptsResult
  ): void {
    const prompts: MCPPrompt[] = [];

    for (const item of response.prompts) {
      prompts.push({
        name: item.name,
        description: item.description,
        arguments: item.arguments?.map((arg) => ({
          name: arg.name,
          description: arg.description,
          required: arg.required,
        })),
      });
    }

    this.setPrompts(serverName, prompts);
  }

  /**
   * 处理Prompt获取响应
   */
  async handleGetPromptResponse(
    _serverName: string,
    response: { messages: Array<{ role: string; content: PromptContent }> }
  ): Promise<MCPPromptResult> {
    const messages: MCPPromptResult['messages'] = [];

    for (const msg of response.messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        let content = '';

        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (msg.content.type === 'text' && msg.content.text) {
          content = msg.content.text;
        } else if (msg.content.type === 'image' && msg.content.source) {
          content = `[Image: ${msg.content.source.type || 'unknown'}]`;
        }

        messages.push({
          role: msg.role,
          content,
        });
      }
    }

    return { messages };
  }

  /**
   * 构建Prompt请求消息
   */
  buildGetPromptRequest(
    _serverName: string,
    promptName: string,
    promptArgs?: Record<string, string>
  ): JSONRPCMessage {
    const params: PromptParams = {
      name: promptName,
    };

    if (promptArgs) {
      params.arguments = promptArgs;
    }

    return {
      jsonrpc: '2.0',
      id: `prompt-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      method: 'prompts/get',
      params: params as unknown as Record<string, unknown>,
    };
  }

  /**
   * 清空服务器的Prompt
   */
  clearPrompts(serverName: string): void {
    this.prompts.delete(serverName);
    this.serverCapabilities.delete(serverName);
  }

  /**
   * 清空所有Prompt
   */
  clearAllPrompts(): void {
    this.prompts.clear();
    this.serverCapabilities.clear();
  }
}

/**
 * 导出单例
 */
export const mcpPromptManager = new MCPPromptManager();
