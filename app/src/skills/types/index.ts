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
 * Skill 系统统一类型定义
 *
 * 整合 Track A/B/C/F 各套类型的统一入口。
 * 使用受歧视联合 (discriminated union) 区分 prompt 和 executable 两种执行模型。
 */

// ==================== 枚举 ====================

/** 技能来源 — 描述"谁创造的"，与加载方式正交 */
export enum SkillSource {
  /** 官方内置 — 系统运行必需，不可禁用 */
  BUILTIN = 'builtin',
  /** 官方发布 — 非必需技能，可选 */
  OFFICIAL = 'official',
  /** 第三方 — 通过适配器接入的任何来源 */
  THIRD_PARTY = 'third_party',
}

/** 加载方式：与来源正交的维度 */
export enum SkillLoadMethod {
  EMBEDDED = 'embedded',
  FILE_SYSTEM = 'file_system',
  ADAPTER = 'adapter',
  PLUGIN = 'plugin',
}

// ==================== 受歧视联合执行模型 ====================

/** Prompt 执行模型：生成消息供 LLM 处理 */
export interface PromptImplementation {
  kind: 'prompt';
  getPromptForCommand: (
    args: any,
    toolUseContext: any
  ) => Promise<{ type: string; text: string }[]>;
}

/** Executable 执行模型：直接执行代码 */
export interface ExecutableImplementation {
  kind: 'executable';
  execute: (context: any) => Promise<any>;
  validate?: (context: any) => boolean;
  cleanup?: () => void;
  init?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

/** 技能执行模型联合 */
export type SkillImplementation = PromptImplementation | ExecutableImplementation;

// ==================== 统一 Skill 接口 ====================

/** 技能实体 — 系统中唯一的 Skill 类型 */
export interface Skill {
  /** 基础信息 */
  name: string;
  description: string;
  source: SkillSource;
  loadMethod: SkillLoadMethod;
  loadedFrom: string;

  /** 可选展示字段 */
  aliases?: string[];
  argumentHint?: string;
  whenToUse?: string;
  allowedTools?: string[];
  userInvocable?: boolean;

  /** LLM 相关 */
  model?: string;
  agent?: string;
  effort?: string;
  disableModelInvocation?: boolean;
  context?: 'fork' | 'inline';
  paths?: string[];

  /** 执行模型（受歧视联合） */
  impl: SkillImplementation;

  /** 技能元数据（Track A 兼容，manifest 原始数据） */
  manifest?: SkillManifest;

  /** 扩展字段 */
  config?: Record<string, unknown>;
  author?: string;
  dependencies?: string[];
  hooks?: any;
  skillRoot?: string;
  isHidden?: boolean;
  progressMessage?: string;
  contentLength?: number;
  version?: string;
  hasUserSpecifiedDescription?: boolean;
  isEnabled?: () => boolean;
}

// ==================== 辅助类型 ====================

/** 技能 Manifest（JSON 定义） */
export interface SkillManifest {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  author?: string;
  version?: string;
  icon?: string;
  main?: string;
  [key: string]: any;
}

/** 技能执行上下文 */
export interface SkillContext {
  args?: any;
  toolUseContext?: any;
  [key: string]: any;
}

/** 技能执行结果 */
export interface SkillResult {
  success: boolean;
  error?: string;
  data?: any;
  usage?: {
    durationMs: number;
    [key: string]: any;
  };
  [key: string]: any;
}

/** 技能执行上下文（含 Skill 引用） */
export interface SkillExecutionContext {
  args: any;
  toolUseContext: any;
  skill: Skill;
}

/** 技能加载器接口 */
export interface SkillLoader {
  loadSkills(): Promise<Skill[]>;
  getSource(): SkillSource;
}

/** Skill Frontmatter（markdown 头部元数据） */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  arguments?: string[];
  'argument-hint'?: string;
  when_to_use?: string;
  'allowed-tools'?: string[];
  'user-invocable'?: boolean;
  model?: string;
  effort?: string;
  paths?: string[];
  version?: string;
  'disable-model-invocation'?: boolean;
  context?: 'fork';
  agent?: string;
  shell?: any;
}

/** @deprecated Track C 桥接类型，将由统一 Skill 替代 */
export interface SkillInfo {
  name: string;
  description: string;
  aliases: string[];
  whenToUse?: string;
  argumentHint?: string;
  userInvocable: boolean;
  source: 'bundled' | 'custom' | 'marketplace';
  skillRoot?: string;
}

/** @deprecated Track C 桥接类型，将由统一 Skill 替代 */
export interface SkillExecutionResult {
  success: boolean;
  result: any;
  error?: string;
}

/** @deprecated Track C 桥接类型，将由统一 SkillLoader 接口替代 */
export interface SkillServiceConfig {
  skillsDir?: string;
  enableMarketplace?: boolean;
  marketplaceApiUrl?: string;
}

/** @deprecated Track C 桥接类型，将由统一 Skill 接口替代 */
export interface SkillDefinition {
  name: string;
  description: string;
  aliases?: string[];
  whenToUse?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  isEnabled?: () => boolean;
  hooks?: any;
  context?: 'inline' | 'fork';
  agent?: string;
  files?: Record<string, string>;
  getPromptForCommand: (args: string, context: any) => Promise<any[]>;
}
