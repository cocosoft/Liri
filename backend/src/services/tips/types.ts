/**
 * Tips系统类型定义
 * 基于CC源码 cc_code/backend/services/tips/types.ts 实现
 */

export interface Tip {
  id: string;
  content: string | (() => string | Promise<string>);
  cooldownSessions: number;
  isRelevant: () => boolean | Promise<boolean>;
}

export interface TipContext {
  bashTools?: Set<string>;
  readFileState?: Map<string, string>;
}
