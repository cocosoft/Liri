/**
 * 风险分级引擎 — 借鉴 OpenWorker 五级风险模型
 *
 * 用于 PermissionChecker 在决策时进行声明式风险判断，
 * 替代工具名硬编码的分支逻辑。
 */
export enum RiskClass {
  /** 只读查询 — 读文件、搜索 → 自动放行，不进 Inbox */
  READ = 'read',
  /** 写本地 — 写文件、编辑 → 无人值守时进 Inbox，否则弹窗确认 */
  WRITE_LOCAL = 'write',
  /** 命令执行 — 运行脚本 → 始终进 Inbox（无人值守也不自动放行） */
  SHELL = 'shell',
  /** 外部写入 — 发消息、发邮件 → 进 Inbox + 可设 standing rule */
  EXTERNAL = 'external',
  /** 纯对话 — 普通聊天 → 完全放行 */
  DISCUSS = 'discuss',
}

/**
 * 风险覆盖规则
 * 允许用户配置特定路径/命令前缀的自动放行策略
 */
export interface RiskOverrides {
  /** 自动放行的文件路径前缀 */
  allowReadPatterns: string[];
  /** 自动放行的命令前缀 */
  allowCommandPrefixes: string[];
}

/**
 * 默认风险覆盖规则（空策略）
 */
export const DEFAULT_RISK_OVERRIDES: RiskOverrides = {
  allowReadPatterns: [],
  allowCommandPrefixes: [],
};

/**
 * 根据工具名推断风险等级（声明式默认值）
 * 在不设置工具 metadata.riskClass 时使用
 */
export function inferRiskClass(toolName: string): RiskClass {
  const lower = toolName.toLowerCase();

  // 只读工具
  if (
    lower.includes('read') ||
    lower.includes('search') ||
    lower.includes('grep') ||
    lower.includes('glob') ||
    lower.includes('list') ||
    lower.includes('get') ||
    lower.includes('fetch') ||
    lower.includes('view') ||
    lower.includes('preview')
  ) {
    return RiskClass.READ;
  }

  // 写本地工具
  if (
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('create') ||
    lower.includes('save') ||
    lower.includes('delete') ||
    lower.includes('remove') ||
    lower.includes('replace') ||
    lower.includes('update')
  ) {
    return RiskClass.WRITE_LOCAL;
  }

  // Shell 工具
  if (
    lower.includes('bash') ||
    lower.includes('shell') ||
    lower.includes('exec') ||
    lower.includes('run') ||
    lower.includes('command') ||
    lower.includes('powershell')
  ) {
    return RiskClass.SHELL;
  }

  // 外部发送工具
  if (
    lower.includes('send') ||
    lower.includes('message') ||
    lower.includes('notify') ||
    lower.includes('email') ||
    lower.includes('publish') ||
    lower.includes('post')
  ) {
    return RiskClass.EXTERNAL;
  }

  // 默认：最保守（SHELL）
  return RiskClass.SHELL;
}

/**
 * 检测 Shell 命令是否包含链式操作
 * 如 `;` `|` `&&` `||` 等
 */
export function detectChainedCommand(command: string): boolean {
  const chainedPatterns = [/;/, /\|/, /&&/, /\|\|/, />{1,2}/, /`/];
  return chainedPatterns.some((p) => p.test(command));
}
