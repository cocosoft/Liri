/**
 * LSP诊断类型定义
 */

import { Position, Range, Location } from './LSPTool.js';

/**
 * 诊断信息
 */
export interface Diagnostic {
  /**
   * 诊断范围
   */
  range: Range;

  /**
   * 诊断严重程度
   */
  severity?: DiagnosticSeverity;

  /**
   * 诊断代码
   */
  code?: string | number;

  /**
   * 诊断来源
   */
  source?: string;

  /**
   * 诊断消息
   */
  message: string;

  /**
   * 诊断相关信息
   */
  relatedInformation?: DiagnosticRelatedInformation[];

  /**
   * 诊断标签
   */
  tags?: DiagnosticTag[];
}

/**
 * 诊断严重程度
 */
export enum DiagnosticSeverity {
  ERROR = 1,
  WARNING = 2,
  INFORMATION = 3,
  HINT = 4,
}

/**
 * 诊断标签
 */
export enum DiagnosticTag {
  UNNECESSARY = 1,
  DEPRECATED = 2,
}

/**
 * 诊断相关信息
 */
export interface DiagnosticRelatedInformation {
  /**
   * 相关位置
   */
  location: Location;

  /**
   * 相关消息
   */
  message: string;
}

/**
 * 诊断集合
 */
export interface DiagnosticCollection {
  /**
   * 文档URI
   */
  uri: string;

  /**
   * 诊断列表
   */
  diagnostics: Diagnostic[];
}
