/**
 * Tips系统类型定义
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
