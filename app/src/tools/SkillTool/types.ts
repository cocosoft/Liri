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
 * SkillTool类型定义
 */

/**
 * Skill类型
 */
export type SkillType = 'command' | 'prompt' | 'agent' | 'custom';

/**
 * Skill来源
 */
export type SkillSource = 'builtin' | 'mcp' | 'plugin' | 'user' | 'project';

/**
 * Skill输入参数
 */
export interface SkillInput {
  /** Skill名称 */
  name: string;
  /** Skill参数 */
  arguments?: Record<string, unknown>;
}

/**
 * Skill输出结果
 */
export interface SkillOutput {
  /** Skill名称 */
  name: string;
  /** 执行结果 */
  result?: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 执行时间 */
  executionTime: number;
}

/**
 * Skill定义
 */
export interface SkillDefinition {
  /** Skill名称 */
  name: string;
  /** Skill描述 */
  description: string;
  /** Skill类型 */
  type: SkillType;
  /** 来源 */
  source: SkillSource;
  /** 是否启用 */
  enabled: boolean;
  /** 是否延迟加载 */
  deferred?: boolean;
  /** 提示模板 */
  promptTemplate?: string;
  /** 命令 */
  command?: string;
  /** 参数模式 */
  argumentSchema?: Record<string, unknown>;
  /** 标签 */
  tags?: string[];
}

/**
 * Skill执行上下文
 */
export interface SkillContext {
  /** 当前目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否后台运行 */
  background?: boolean;
  /** 超时时间(ms) */
  timeout?: number;
}

/**
 * Skill执行进度
 */
export interface SkillProgress {
  /** 进度类型 */
  type: 'progress' | 'complete' | 'error';
  /** 消息 */
  message?: string;
  /** 进度百分比 */
  progress?: number;
  /** 结果 */
  result?: string;
  /** 错误 */
  error?: string;
}
