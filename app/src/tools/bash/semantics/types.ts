/**
 * Bash命令语义分析类型定义
 * 用于UI折叠显示和安全决策
 */

export type BashCommandType =
  | 'search'
  | 'read'
  | 'list'
  | 'silent'
  | 'neutral'
  | 'other'
  | 'unknown';

export interface BashCommandClassification {
  type: BashCommandType;
  isSearch: boolean;
  isRead: boolean;
  isList: boolean;
  isSemanticNeutral: boolean;
  isSilent: boolean;
}

export interface BashCommandAnalysisResult {
  classification: BashCommandClassification;
  isCollapsible: boolean;
  summary: string;
}
