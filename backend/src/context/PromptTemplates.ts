/**
 * 系统提示词模板（遵循规则K：品牌使用PY_APP，不使用Anthropic/CLAUDE）
 */
import * as os from 'os';

export interface SystemPromptParts {
  basePrompt: string[];
  userContext: Record<string, string>;
  systemContext: Record<string, string>;
}

export function buildBasePrompt(tools: string[] = []): string[] {
  return [
    `You are PY_APP, a powerful AI coding assistant.`,
    ``,
    `You have access to a set of tools that allow you to interact with the user's system.`,
    `Use these tools to help the user accomplish their tasks.`,
    ``,
    `When making changes to files:`,
    `- Use the available tools to read files before editing them`,
    `- Make surgical, minimal changes`,
    `- Do not add comments unless explicitly asked`,
    ``,
    `When executing commands:`,
    `- Explain what you're about to do`,
    `- Wait for user confirmation when necessary`,
    `- Report results clearly`,
  ];
}

export function buildUserContext(info: {
  platform?: string;
  cwd?: string;
  branch?: string | null;
  date?: string;
}): Record<string, string> {
  return {
    platform: info.platform || process.platform,
    cwd: info.cwd || process.cwd(),
    date: info.date || new Date().toISOString().split('T')[0],
    hostname: os.hostname(),
    ...(info.branch ? { gitBranch: info.branch } : {}),
  };
}

export function buildSystemContext(info: {
  gitStatus?: string | null;
  pyAppMd?: string | null;
  memoryMd?: string | null;
  readme?: string | null;
  projectName?: string;
}): Record<string, string> {
  const ctx: Record<string, string> = {};

  if (info.projectName) {
    ctx.projectName = info.projectName;
  }

  if (info.gitStatus) {
    ctx.gitStatus = info.gitStatus;
  }

  if (info.pyAppMd) {
    ctx.pyAppMd = info.pyAppMd;
  }

  if (info.memoryMd) {
    ctx.memoryMd = info.memoryMd;
  }

  if (info.readme) {
    ctx.projectReadme = info.readme;
  }

  return ctx;
}
