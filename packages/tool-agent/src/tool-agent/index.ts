/**
 * `@openliri/tool-agent` 包出口（H 档，2026-11-23）
 *
 * 域：Agent / Skill / Knowledge / Memory。
 * - 根出口：app 侧注册表与公共面所需符号；
 * - 深层子路径（`@openliri/tool-agent/AgentTool/*`）由 `package.json#exports["./*"]`
 *   与 `app/tsconfig.json` paths 支持，供 app/tests 的细化断言使用。
 */

// ── Agent ──
export {
  AgentTool,
  createAgentTool,
  filterToolPool,
  refreshAvailableSubagentTypeNames,
  resetAgentToolManager,
  resolveDeniedTools,
  setAgentToolManager,
} from './AgentTool/AgentTool';
export { SubAgentEngine, getSubAgentEngine } from './AgentTool/SubAgentEngine';
export { AGENT_TYPES } from './AgentTool/constants';
export { AgentRunStore, getAgentRunStore } from './AgentTool/AgentRunStore';
export type { AgentRunRow } from './AgentTool/AgentRunStore';
export { CuratorScheduler } from './AgentTool/CuratorScheduler';
export { SkillLifecycleManager } from './AgentTool/SkillLifecycleManager';
export {
  CuratorReviewScope,
  curatorReviewScope,
} from './AgentTool/CuratorReviewScope';
export type {
  ExtendedReviewResult,
  FileReviewTarget,
  MemoryReviewTarget,
  ConfigReviewTarget,
  CuratorScopeConfig,
} from './AgentTool/CuratorReviewScope';
export {
  setSpawnPaused,
  isSpawnPaused,
  getSpawnPauseState,
  resetSpawnPause,
} from './AgentTool/spawnPause';
export type { SpawnPauseState } from './AgentTool/spawnPause';
export { VERIFICATION_AGENT_TYPE } from './AgentTool/constants';
export { VERIFICATION_AGENT_DEFINITION } from './AgentTool/strategies/VerificationStrategy';
export { STATUSLINE_SETUP_AGENT_DEFINITION } from './AgentTool/strategies/StatuslineStrategy';
export type { AgentDisplayOutput } from './AgentTool/types';
export {
  AgentsListTool,
  createAgentsListTool,
  shapeAgentsList,
} from './AgentsListTool/AgentsListTool';
export type {
  AgentEntry,
  AgentsListFilter,
  AgentsListResult,
} from './AgentsListTool/AgentsListTool';

// ── Skill ──
export { SkillTool } from './SkillTool/SkillTool';
export { SkillListTool } from './SkillTool/SkillListTool';
export {
  SkillViewTool,
  SKILL_VIEW_OUTPUT_JSON_SCHEMA,
} from './SkillTool/SkillViewTool';
export { getSkillRegistryLazy } from './SkillTool/skillRegistryAccess';
export type { SkillDefinition } from './SkillTool/types';
export { createSkillFamilyTool } from './families/SkillFamilyTool';

// ── Knowledge ──
export { KnowledgeSaveTool } from './KnowledgeSaveTool/KnowledgeSaveTool';

// ── Memory ──
export { MemoryTool, createMemoryTool } from './memory/MemoryTool';
export { MemoryGetTool, createMemoryGetTool } from './memory/MemoryGetTool';
export {
  UnifiedSearchTool,
  createUnifiedSearchTool,
} from './memory/UnifiedSearchTool';
export type { SearchTool, AdvancedSearchOptions } from './memory/SearchTool';
export { RecallMemoryTool } from './RecallMemoryTool/RecallMemoryTool';
