/**
 * 持久化层共享类型
 * 将 SkillDB.ts 需要引用的数据接口集中于此，避免跨模块循环依赖
 */

/**
 * 技能使用记录
 */
export interface SkillUsageRecord {
  skillName: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  error?: string;
  source: string;
  triggeredBy: 'user' | 'model' | 'agent' | 'system';
  argsSummary?: string;
}

/**
 * 策展操作类型
 */
export type CuratorAction = 'pin' | 'archive' | 'consolidate' | 'patch';

/**
 * 技能策展状态
 */
export interface SkillCurationState {
  skillName: string;
  pinned: boolean;
  archived: boolean;
  consolidatedAt: number | null;
  patchedAt: number | null;
  lastCuratedAt: number | null;
  curationHistory: CuratorActionRecord[];
}

/**
 * 策展操作记录
 */
export interface CuratorActionRecord {
  action: CuratorAction;
  timestamp: number;
  details: string;
}

/**
 * 技能溯源来源类型
 */
export type ProvenanceSource =
  | 'builtin'
  | 'user'
  | 'plugin'
  | 'hub'
  | 'external';

/**
 * 技能溯源条目
 */
export interface SkillProvenanceEntry {
  skillName: string;
  source: ProvenanceSource;
  sourceUrl?: string;
  sourceVersion?: string;
  installedAt: number;
  updatedAt: number;
  metadata?: Record<string, string>;
}
