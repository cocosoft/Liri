// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
