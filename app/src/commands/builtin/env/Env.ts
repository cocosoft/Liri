/**
 * Env 命令实现
 * 显示环境变量与系统信息
 */
import { arch, platform } from 'node:os';
import type { CommandContext, CommandResult } from '@modules/commands/types';

/**
 * 应用相关环境变量前缀列表
 */
const APP_ENV_PREFIXES = [
  'DEEPSEEK_',
  'APP_',
  'NODE_ENV',
  'PORT',
  'HOST',
  'JWT_',
  'CORS_',
  'SECURITY_',
  'NATIVE_SECURITY_',
  'LOG_',
  'DATABASE_',
  'PERMISSION_',
  'MAX_CONCURRENT_',
  'REQUEST_',
  'TOOL_',
  'NoDefaultCurrentDirectoryInExePath',
];

/**
 * 敏感键名关键词列表
 */
const SENSITIVE_KEYWORDS = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PASS'];

/**
 * 判断是否为应用相关环境变量
 */
function isAppEnvVar(key: string): boolean {
  return APP_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * 判断是否为敏感键名
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYWORDS.some((kw) => key.includes(kw));
}

/**
 * 判断是否为运行时内部变量
 */
function isRuntimeVar(key: string): boolean {
  return key.startsWith('npm_') || key.startsWith('bun_');
}

/**
 * 格式化单个环境变量条目
 */
function formatEnvVar(key: string, value: string): string {
  if (isSensitiveKey(key)) {
    return `  ${key}=****`;
  }
  return `  ${key}=${value}`;
}

/**
 * 获取过滤后的环境变量列表
 */
function getFilteredEnv(showAll: boolean): string[] {
  const env = process.env as Record<string, string>;
  const lines: string[] = [];

  const keys = Object.keys(env).sort();

  for (const key of keys) {
    if (isRuntimeVar(key)) continue;

    if (showAll) {
      lines.push(formatEnvVar(key, env[key]));
    } else if (isAppEnvVar(key)) {
      lines.push(formatEnvVar(key, env[key]));
    }
  }

  return lines;
}

/**
 * 获取系统信息
 */
function getSystemInfo(): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push('系统信息');
  lines.push(`  平台: ${platform()} ${arch()}`);
  lines.push(`  Node.js: ${process.version}`);
  lines.push(`  PID: ${process.pid}`);
  lines.push(`  CWD: ${process.cwd()}`);

  const terminal = detectTerminal();
  if (terminal) {
    lines.push(`  终端: ${terminal}`);
  }

  return lines;
}

/**
 * 检测终端类型
 */
function detectTerminal(): string | null {
  if (process.env.TERM_PROGRAM) {
    return process.env.TERM_PROGRAM;
  }
  if (process.env.WT_SESSION) return 'windows-terminal';
  if (process.env.TERM) return process.env.TERM;
  return null;
}

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  const help = `Env 命令使用帮助

用法:
  /env                      - 显示应用环境配置
  /env --all (-a)           - 显示全部环境变量
  /env --json               - 以 JSON 格式输出
  /env help                 - 显示此帮助

输出内容:
  环境变量 - 按前缀筛选的应用配置项（默认模式）
  全部变量 - 所有环境变量（--all 模式）
  系统信息 - 平台/架构/Node版本/终端类型

安全:
  敏感键名（KEY/SECRET/TOKEN/PASSWORD）的值自动隐藏为 ****

示例:
  /env
  /env --all
  /env --json
  /env --all --json

别名: /environment`;

  return { success: true, message: help };
}

/**
 * 处理默认模式
 */
function handleDefault(showAll: boolean): CommandResult {
  const envVars = getFilteredEnv(showAll);

  const lines: string[] = [];
  if (showAll) {
    lines.push('全部环境变量\n');
    lines.push('═'.repeat(40));
    lines.push('');
    lines.push('注: 敏感值已隐藏 (****)，运行时内部变量已过滤');
    lines.push('');
  } else {
    lines.push('应用环境配置\n');
    lines.push('═'.repeat(40));
    lines.push('');
    lines.push('注: 显示应用相关配置项，使用 --all 查看全部');
    lines.push('');
  }

  lines.push(...envVars);

  if (envVars.length === 0) {
    lines.push('  (无匹配项)');
  }

  lines.push(...getSystemInfo());

  return { success: true, message: lines.join('\n') };
}

/**
 * 处理 JSON 模式
 */
function handleJson(showAll: boolean): CommandResult {
  const env = process.env as Record<string, string>;
  const entries: Record<string, string> = {};

  const keys = Object.keys(env).sort();

  for (const key of keys) {
    if (isRuntimeVar(key)) continue;

    if (showAll) {
      entries[key] = isSensitiveKey(key) ? '****' : env[key];
    } else if (isAppEnvVar(key)) {
      entries[key] = isSensitiveKey(key) ? '****' : env[key];
    }
  }

  const jsonData = {
    environment: entries,
    system: {
      platform: platform(),
      arch: arch(),
      nodeVersion: process.version,
      pid: process.pid,
      cwd: process.cwd(),
      terminal: detectTerminal(),
    },
    filtered: !showAll,
    sensitiveMasked: true,
  };

  return { success: true, message: JSON.stringify(jsonData, null, 2) };
}

const envCommand = {
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    try {
      const trimmed = args.trim();

      if (trimmed === 'help' || trimmed === '-h' || trimmed === '--help') {
        return showHelp();
      }

      const showAll = /(^|\s)(--all|-a)(\s|$)/.test(trimmed);
      const showJson = /(^|\s)--json(\s|$)/.test(trimmed);

      if (showJson) {
        return handleJson(showAll);
      }

      try {
        const { logEvent } = await import('@modules/analytics/index.js');
        logEvent('tengu_env_view', { showAll });
      } catch {
        // analytics 非关键
      }

      return handleDefault(showAll);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default envCommand;
