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

export const elicitationHandler = {
  getElicitationPrompts,
  needsElicitation,
  validateElicitationAnswers,
  applyElicitationAnswers,
  registerElicitationPrompts,
};
