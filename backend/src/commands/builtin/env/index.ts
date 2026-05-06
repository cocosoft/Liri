/**
 * env 命令
 * 显示环境变量，默认聚焦应用配置，支持 --all 查看全部
 */
import type { Command, CommandContext, CommandResult, CommandImplementation } from '@modules/commands/types';

/**
 * 应用相关环境变量前缀列表
 * 用于默认模式筛选，只显示用户关心的配置项
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
 * 匹配到的环境变量值将被隐藏
 */
const SENSITIVE_KEYWORDS = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PASS'];

/**
 * 判断是否为应用相关环境变量
 */
function isAppEnvVar(key: string): boolean {
  return APP_ENV_PREFIXES.some(prefix => key.startsWith(prefix));
}

/**
 * 判断是否为敏感键名
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYWORDS.some(kw => key.includes(kw));
}

/**
 * 判断是否为运行时内部变量（对用户无意义）
 */
function isRuntimeVar(key: string): boolean {
  return key.startsWith('npm_') || key.startsWith('bun_');
}

/**
 * 格式化单个环境变量条目
 */
function formatEnvVar(key: string, value: string): string {
  if (isSensitiveKey(key)) {
    return `${key}=****`;
  }
  return `${key}=${value}`;
}

/**
 * 获取过滤后的环境变量列表
 */
function getFilteredEnv(showAll: boolean): Array<{ key: string; line: string }> {
  const env = process.env as Record<string, string>;
  const result: Array<{ key: string; line: string }> = [];

  for (const [key, value] of Object.entries(env)) {
    if (isRuntimeVar(key)) continue;

    if (showAll) {
      result.push({ key, line: formatEnvVar(key, value) });
    } else if (isAppEnvVar(key)) {
      result.push({ key, line: formatEnvVar(key, value) });
    }
  }

  return result;
}

export const envCommand: Command = {
  type: 'local',
  name: 'env',
  description: '显示应用环境配置，使用 --all 查看全部',
  aliases: ['environment'],
  argumentHint: '[--all|-a]',

  load(): Promise<CommandImplementation> {
    const impl: CommandImplementation = {
      execute(args: string, context: CommandContext): Promise<CommandResult> {
        try {
          const showAll = /(^|\s)(--all|-a)(\s|$)/.test(args);

          const filtered = getFilteredEnv(showAll);

          const lines: string[] = [];
          if (showAll) {
            lines.push('# 全部环境变量\n');
            lines.push('═'.repeat(40));
            lines.push('');
            lines.push('注: 敏感值已隐藏 (****)，运行时内部变量已过滤');
            lines.push('');
          } else {
            lines.push('# 应用环境配置\n');
            lines.push('═'.repeat(40));
            lines.push('');
            lines.push('注: 显示应用相关配置项，使用 --all 查看全部');
            lines.push('');
          }

          for (const { line } of filtered) {
            lines.push(`  ${line}`);
          }

          return Promise.resolve({ success: true, message: lines.join('\n') });
        } catch (error) {
          return Promise.resolve({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };

    return Promise.resolve(impl);
  },
};

export default envCommand;
