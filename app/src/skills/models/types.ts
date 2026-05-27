/**
 * 技能系统类型定义
 */

import type { ToolUseContext } from '@modules/context/types/ToolUseContext';

/**
 * 技能定义
 */
export interface SkillDefinition {
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 技能别名 */
  aliases?: string[];
  /** 使用场景 */
  whenToUse?: string;
  /** 参数提示 */
  argumentHint?: string;
  /** 允许使用的工具 */
  allowedTools?: string[];
  /** 使用的模型 */
  model?: string;
  /** 是否禁用模型调用 */
  disableModelInvocation?: boolean;
  /** 是否允许用户调用 */
  userInvocable?: boolean;
  /** 检查技能是否启用 */
  isEnabled?: () => boolean;
  /** 钩子设置 */
  hooks?: any;
  /** 执行上下文 */
  context?: 'inline' | 'fork';
  /** 代理名称 */
  agent?: string;
  /** 技能文件 */
  files?: Record<string, string>;
  /** 获取命令提示 */
  getPromptForCommand: (
    args: string,
    context: ToolUseContext
  ) => Promise<any[]>;
}

/**
 * 技能信息
 */
export interface SkillInfo {
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 技能别名 */
  aliases: string[];
  /** 使用场景 */
  whenToUse?: string;
  /** 参数提示 */
  argumentHint?: string;
  /** 是否允许用户调用 */
  userInvocable: boolean;
  /** 技能来源 */
  source: 'bundled' | 'custom' | 'marketplace';
  /** 技能根目录 */
  skillRoot?: string;
}

/**
 * 技能执行结果
 */
export interface SkillExecutionResult {
  /** 执行是否成功 */
  success: boolean;
  /** 执行结果 */
  result: any;
  /** 错误信息 */
  error?: string;
}

/**
 * 技能服务配置
 */
export interface SkillServiceConfig {
  /** 技能目录 */
  skillsDir?: string;
  /** 是否启用市场技能 */
  enableMarketplace?: boolean;
  /** 市场API地址 */
  marketplaceApiUrl?: string;
}
