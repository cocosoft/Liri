/**
 * 驾驶舱读侧聚合出口（P39，2026-11-02）
 *
 * 只做纯聚合；数据读取（workitems / assignments / executions）与 UI 装配由调用方负责，
 * 避免把存储或 React 依赖拖进本模块。
 */
export {
  COCKPIT_GROUP_LABELS,
  COCKPIT_GROUP_ORDER,
  buildCockpitSnapshot,
  checkCockpitInvariants,
  isPersonGroupKey,
} from './cockpitSnapshot';
export type {
  CockpitGroup,
  CockpitItem,
  CockpitMetrics,
  CockpitSnapshot,
} from './cockpitSnapshot';
export { loadCockpitItems, markActionableAttention } from './cockpitSource';
export type { CockpitSourceDeps } from './cockpitSource';
export { buildCockpitHistory, pickTakeoverSessionId } from './cockpitHistory';
export type {
  CockpitExecutionFact,
  CockpitHistory,
  CockpitWorkItemFact,
} from './cockpitHistory';
