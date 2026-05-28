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
 * 文档系统类型定义
 * 提供示例命令、释放说明、错误消息等文档类型支持
 */

/**
 * 示例命令分类
 */
export enum ExampleCategory {
  GENERAL = 'general',
  FILE_OPERATIONS = 'file_operations',
  CODE_ANALYSIS = 'code_analysis',
  GIT_OPERATIONS = 'git_operations',
  TESTING = 'testing',
  DEBUGGING = 'debugging',
  REFACTORING = 'refactoring',
}

/**
 * 示例命令接口
 */
export interface ExampleCommand {
  /** 命令ID */
  id: string;
  /** 命令分类 */
  category: ExampleCategory;
  /** 命令描述 */
  description: string;
  /** 命令内容 */
  command: string;
  /** 命令标签 */
  tags: string[];
  /** 使用次数 */
  usageCount: number;
  /** 创建时间 */
  createdAt: number;
  /** 最后使用时间 */
  lastUsedAt?: number;
}

/**
 * 释放说明条目
 */
export interface ReleaseNote {
  /** 版本号 */
  version: string;
  /** 发布日期 */
  releaseDate: string;
  /** 更新内容 */
  notes: string[];
  /** 重要更新标记 */
  isImportant: boolean;
  /** 更新类型 */
  type: 'feature' | 'bugfix' | 'improvement' | 'breaking';
}

/**
 * 错误消息条目
 */
export interface ErrorMessageEntry {
  /** 错误代码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 错误描述 */
  description: string;
  /** 解决建议 */
  suggestions: string[];
  /** 参考链接 */
  references: string[];
  /** 严重程度 */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * 语言包
 */
export interface LanguagePack {
  /** 语言代码 */
  code: string;
  /** 语言名称 */
  name: string;
  /** 翻译内容 */
  translations: Record<string, string>;
}

/**
 * 上下文帮助条目
 */
export interface ContextHelpEntry {
  /** 上下文ID */
  contextId: string;
  /** 上下文描述 */
  description: string;
  /** 帮助内容 */
  helpContent: string;
  /** 相关命令 */
  relatedCommands: string[];
  /** 相关工具 */
  relatedTools: string[];
  /** 匹配条件 */
  matchConditions: ContextMatchCondition[];
}

/**
 * 上下文匹配条件
 */
export interface ContextMatchCondition {
  /** 条件类型 */
  type: 'command' | 'tool' | 'file' | 'error';
  /** 匹配值 */
  value: string;
  /** 匹配方式 */
  matchType: 'exact' | 'contains' | 'startsWith' | 'endsWith' | 'regex';
}

/**
 * 搜索结果
 */
export interface SearchResult {
  /** 结果ID */
  id: string;
  /** 结果类型 */
  type: 'example' | 'release_note' | 'error_message' | 'help';
  /** 结果标题 */
  title: string;
  /** 结果内容 */
  content: string;
  /** 相关性分数 */
  relevance: number;
  /** 匹配的关键词 */
  matchedKeywords: string[];
}

/**
 * 文档统计信息
 */
export interface DocsStats {
  /** 示例命令数量 */
  exampleCount: number;
  /** 释放说明数量 */
  releaseNoteCount: number;
  /** 错误消息数量 */
  errorMessageCount: number;
  /** 语言包数量 */
  languagePackCount: number;
  /** 上下文帮助数量 */
  contextHelpCount: number;
  /** 搜索次数 */
  searchCount: number;
}
