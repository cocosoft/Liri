/**
 * Bash语义分析类型定义
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
