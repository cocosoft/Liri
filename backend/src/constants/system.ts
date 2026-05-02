/**
 * 系统常量
 * 基于CC源码 cc_code/backend/constants/system.ts 实现
 * 定义系统提示词前缀和归因头等关键常量
 */

/**
 * 默认系统提示词前缀
 */
const DEFAULT_PREFIX = `You are PY_APP, an intelligent CLI assistant.`;

/**
 * Agent SDK预设前缀
 */
const AGENT_SDK_PY_APP_PRESET_PREFIX = `You are PY_APP, an intelligent CLI assistant, running within the PY_APP Agent SDK.`;

/**
 * Agent SDK通用前缀
 */
const AGENT_SDK_PREFIX = `You are a PY_APP agent, built on the PY_APP Agent SDK.`;

/**
 * 所有CLI系统提示词前缀值
 * 用于splitSysPromptPrefix按内容而非位置识别前缀块
 */
const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  AGENT_SDK_PY_APP_PRESET_PREFIX,
  AGENT_SDK_PREFIX,
] as const;

/**
 * CLI系统提示词前缀类型
 */
export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number];

/**
 * 所有可能的CLI系统提示词前缀集合
 */
export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
);

/**
 * 获取CLI系统提示词前缀
 * 根据运行模式选择合适的前缀
 */
export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean;
  hasAppendSystemPrompt: boolean;
}): CLISyspromptPrefix {
  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
      return AGENT_SDK_PY_APP_PRESET_PREFIX;
    }
    return AGENT_SDK_PREFIX;
  }
  return DEFAULT_PREFIX;
}

/**
 * 检查归因头是否启用
 * 默认启用，可通过环境变量禁用
 */
function isAttributionHeaderEnabled(): boolean {
  if (process.env.PY_APP_ATTRIBUTION_HEADER === 'false') {
    return false;
  }
  return true;
}

/**
 * 获取API请求的归因头
 * 返回包含版本号和入口点的头字符串
 * 默认启用，可通过环境变量禁用
 */
export function getAttributionHeader(fingerprint: string): string {
  if (!isAttributionHeaderEnabled()) {
    return '';
  }

  const version = `1.0.0.${fingerprint}`;
  const entrypoint = process.env.PY_APP_ENTRYPOINT ?? 'unknown';
  const header = `x-pyapp-billing-header: cc_version=${version}; cc_entrypoint=${entrypoint};`;

  return header;
}
