/**
 * LSP补全类型定义
 */

import { Position, Range } from './LSPTypes.js';

/**
 * 补全项
 */
export interface CompletionItem {
  /**
   * 补全项标签
   */
  label: string;

  /**
   * 补全项详情
   */
  detail?: string;

  /**
   * 补全项文档
   */
  documentation?: string;

  /**
   * 补全项插入文本
   */
  insertText: string;

  /**
   * 补全项类型
   */
  kind?: CompletionItemKind;

  /**
   * 补全项排序
   */
  sortText?: string;

  /**
   * 补全项过滤文本
   */
  filterText?: string;

  /**
   * 补全项范围
   */
  textEdit?: TextEdit;
}

/**
 * 补全项类型
 */
export enum CompletionItemKind {
  TEXT = 1,
  METHOD = 2,
  FUNCTION = 3,
  CONSTRUCTOR = 4,
  FIELD = 5,
  VARIABLE = 6,
  CLASS = 7,
  INTERFACE = 8,
  MODULE = 9,
  PROPERTY = 10,
  UNIT = 11,
  VALUE = 12,
  ENUM = 13,
  KEYWORD = 14,
  SNIPPET = 15,
  COLOR = 16,
  FILE = 17,
  REFERENCE = 18,
  FOLDER = 19,
  ENUM_MEMBER = 20,
  CONSTANT = 21,
  STRUCT = 22,
  EVENT = 23,
  OPERATOR = 24,
  TYPE_PARAMETER = 25,
}

/**
 * 文本编辑
 */
export interface TextEdit {
  /**
   * 编辑范围
   */
  range: Range;

  /**
   * 插入文本
   */
  newText: string;
}

/**
 * 补全上下文
 */
export interface CompletionContext {
  /**
   * 触发字符
   */
  triggerCharacter?: string;

  /**
   * 触发原因
   */
  triggerKind?: CompletionTriggerKind;
}

/**
 * 补全触发原因
 */
export enum CompletionTriggerKind {
  INVOKED = 1,
  TRIGGER_CHARACTER = 2,
  TRIGGER_FOR_INCOMPLETE_COMPLETIONS = 3,
}

/**
 * 补全列表
 */
export interface CompletionList {
  /**
   * 补全项
   */
  items: CompletionItem[];

  /**
   * 是否是不完整的
   */
  isIncomplete?: boolean;
}
