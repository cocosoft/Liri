//
/**
 * MCP引导处理器
 * 负责处理MCP服务器的引导（elicitation）流程
 * 在服务器连接时自动引导用户完成配置
 *
 * 基于CC源码 cc_code/backend/services/mcp/elicitationHandler.ts 实现
 */

import { logger } from '@modules/utils/log';
import type { ScopedMcpServerConfig } from './types';
import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from '@modelcontextprotocol/sdk/types.js';

export interface ElicitationPrompt {
  type: 'text' | 'select' | 'confirm' | 'file';
  key: string;
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: string;
  options?: string[];
  validate?: (value: string) => string | null;
}

export interface ElicitationResult {
  serverName: string;
  answers: Record<string, string>;
  completed: boolean;
}

const ELICITATION_PROMPTS: Record<string, ElicitationPrompt[]> = {
  github: [
    {
      type: 'text',
      key: 'token',
      label: 'GitHub Personal Access Token',
      description: '需要具有repo和user权限的GitHub Token',
      required: true,
      validate: (value: string) => {
        if (value.length < 10) return 'Token长度不足';
        if (!value.startsWith('ghp_') && !value.startsWith('github_pat_')) {
          return 'Token格式不正确，应以ghp_或github_pat_开头';
        }
        return null;
      },
    },
  ],
  postgres: [
    {
      type: 'text',
      key: 'connectionString',
      label: 'PostgreSQL连接字符串',
      description: '例如: postgresql://user:password@localhost:5432/dbname',
      required: true,
      validate: (value: string) => {
        if (
          !value.startsWith('postgresql://') &&
          !value.startsWith('postgres://')
        ) {
          return '连接字符串应以postgresql://或postgres://开头';
        }
        return null;
      },
    },
  ],
  sentry: [
    {
      type: 'text',
      key: 'token',
      label: 'Sentry Auth Token',
      required: true,
    },
    {
      type: 'text',
      key: 'org',
      label: 'Sentry组织Slug',
      required: true,
    },
  ],
  'brave-search': [
    {
      type: 'text',
      key: 'apiKey',
      label: 'Brave Search API Key',
      required: true,
    },
  ],
  slack: [
    {
      type: 'text',
      key: 'botToken',
      label: 'Slack Bot Token',
      description: '以xoxb-开头的Bot Token',
      required: true,
    },
    {
      type: 'text',
      key: 'teamId',
      label: 'Slack Team ID',
      required: false,
    },
  ],
  jira: [
    {
      type: 'text',
      key: 'url',
      label: 'Jira实例URL',
      description: '例如: https://your-domain.atlassian.net',
      required: true,
    },
    {
      type: 'text',
      key: 'email',
      label: 'Jira邮箱',
      required: true,
    },
    {
      type: 'text',
      key: 'apiToken',
      label: 'Jira API Token',
      required: true,
    },
  ],
  linear: [
    {
      type: 'text',
      key: 'apiKey',
      label: 'Linear API Key',
      required: true,
    },
  ],
};

export function getElicitationPrompts(serverName: string): ElicitationPrompt[] {
  return ELICITATION_PROMPTS[serverName] || [];
}

export function needsElicitation(
  serverName: string,
  config: ScopedMcpServerConfig
): boolean {
  const prompts = getElicitationPrompts(serverName);
  if (prompts.length === 0) return false;

  const envConfig = (config as any).env || {};
  for (const prompt of prompts) {
    if (prompt.required && !envConfig[prompt.key]) {
      return true;
    }
  }

  return false;
}

export function validateElicitationAnswers(
  serverName: string,
  answers: Record<string, string>
): Record<string, string | null> {
  const prompts = getElicitationPrompts(serverName);
  const errors: Record<string, string | null> = {};

  for (const prompt of prompts) {
    const value = answers[prompt.key];

    if (prompt.required && (!value || value.trim() === '')) {
      errors[prompt.key] = `${prompt.label} 是必填项`;
      continue;
    }

    if (value && prompt.validate) {
      const error = prompt.validate(value);
      if (error) {
        errors[prompt.key] = error;
      }
    }
  }

  return errors;
}

export function applyElicitationAnswers(
  config: ScopedMcpServerConfig,
  answers: Record<string, string>
): ScopedMcpServerConfig {
  const existingEnv = (config as any).env || {};
  return {
    ...config,
    env: {
      ...existingEnv,
      ...answers,
    },
  } as ScopedMcpServerConfig;
}

export function registerElicitationPrompts(
  serverName: string,
  prompts: ElicitationPrompt[]
): void {
  ELICITATION_PROMPTS[serverName] = prompts;
  logger.info(`Registered elicitation prompts for MCP server: ${serverName}`);
}

// ----- 增强层：SDK交互式Elicit请求处理 -----

export interface ElicitationRequestEvent {
  serverName: string;
  requestId: string | number;
  params: ElicitRequestFormParams | ElicitRequestURLParams;
  signal: AbortSignal;
  respond: (response: ElicitResult) => void;
}

export type ElicitResponseType = 'accept' | 'decline' | 'cancel';

export interface MCPElicitResponse {
  action: ElicitResponseType;
  values?: Record<string, unknown>;
  message?: string;
}

export type ElicitInputType = 'text' | 'select' | 'confirm' | 'url';

export interface ElicitOption {
  label: string;
  description?: string;
  value: string;
}

export interface ElicitationWaitingState {
  actionLabel: string;
  showCancel?: boolean;
}

export interface MCPElicitHandler {
  onElicitRequest: (event: ElicitationRequestEvent) => void;
  onElicitResponse: (
    event: ElicitationRequestEvent,
    response: MCPElicitResponse
  ) => void;
}

export class MCPElicitationQueue {
  private queue: ElicitationRequestEvent[] = [];
  private handlers: MCPElicitHandler[] = [];

  addHandler(handler: MCPElicitHandler): void {
    this.handlers.push(handler);
  }

  removeHandler(handler: MCPElicitHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index > -1) {
      this.handlers.splice(index, 1);
    }
  }

  enqueue(event: ElicitationRequestEvent): void {
    this.queue.push(event);
    this.notifyHandlers('onElicitRequest', event);
  }

  dequeue(requestId: string | number): ElicitationRequestEvent | undefined {
    const index = this.queue.findIndex((e) => e.requestId === requestId);
    if (index > -1) {
      return this.queue.splice(index, 1)[0];
    }
    return undefined;
  }

  get(requestId: string | number): ElicitationRequestEvent | undefined {
    return this.queue.find((e) => e.requestId === requestId);
  }

  getAll(): ElicitationRequestEvent[] {
    return [...this.queue];
  }

  getByServer(serverName: string): ElicitationRequestEvent[] {
    return this.queue.filter((e) => e.serverName === serverName);
  }

  clear(): void {
    this.queue = [];
  }

  private notifyHandlers(
    method: 'onElicitRequest' | 'onElicitResponse',
    event: ElicitationRequestEvent,
    response?: MCPElicitResponse
  ): void {
    for (const handler of this.handlers) {
      try {
        if (method === 'onElicitRequest') {
          handler.onElicitRequest(event);
        } else if (response) {
          handler.onElicitResponse(event, response);
        }
      } catch (error) {
        logger.error('Error notifying elicitation handler:', error as Error);
      }
    }
  }
}

export interface ElicitToolParams {
  serverName: string;
  requestId: string | number;
  action: ElicitResponseType;
  values?: Record<string, unknown>;
  message?: string;
}

export function buildElicitResponse(
  action: ElicitResponseType,
  values?: Record<string, unknown>,
  message?: string
): ElicitResult {
  const result: ElicitResult = { action };
  if (values) result.values = values;
  if (message) result.message = message;
  return result;
}

export function getElicitInputType(
  params: ElicitRequestFormParams | ElicitRequestURLParams
): ElicitInputType {
  if (params.mode === 'url') return 'url';

  if ('requestedSchema' in params && params.requestedSchema) {
    const schema = params.requestedSchema;
    if (schema.type === 'object' && schema.properties) {
      const propValues = Object.values(schema.properties);
      if (propValues.some((p) => 'enum' in (p as Record<string, unknown>))) {
        return 'select';
      }
    }
  }

  return 'text';
}

export function validateElicitParams(
  params: ElicitRequestFormParams | ElicitRequestURLParams
): string[] {
  const errors: string[] = [];
  if (!params.message) errors.push('Missing message');
  return errors;
}

export class DefaultMCPElicitHandler implements MCPElicitHandler {
  private queue: MCPElicitationQueue;

  constructor(queue: MCPElicitationQueue) {
    this.queue = queue;
  }

  onElicitRequest(event: ElicitationRequestEvent): void {
    const errors = validateElicitParams(event.params);
    if (errors.length > 0) {
      logger.warn(`Invalid elicitation params: ${errors.join(', ')}`);
    }
    logger.debug(`Elicitation request from ${event.serverName}:`, event.params);
  }

  onElicitResponse(
    event: ElicitationRequestEvent,
    response: MCPElicitResponse
  ): void {
    const eventIndex = this.queue.getAll().indexOf(event);
    if (eventIndex > -1) {
      this.queue.dequeue(event.requestId);
    }
    logger.debug(
      `Elicitation response for ${event.serverName}:`,
      response as unknown as Record<string, unknown>
    );
  }
}

export const mcpElicitationQueue = new MCPElicitationQueue();

export const elicitationHandler = {
  getElicitationPrompts,
  needsElicitation,
  validateElicitationAnswers,
  applyElicitationAnswers,
  registerElicitationPrompts,
};
